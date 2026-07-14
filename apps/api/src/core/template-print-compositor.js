const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const {
  cleanTemplateMask,
  getMaskContentBounds
} = require('./template-regions');

function orientedDimensions(metadata = {}) {
  const orientation = Number(metadata.orientation) || 1;
  const swapsAxes = orientation >= 5 && orientation <= 8;
  return {
    width: Number(swapsAxes ? metadata.height : metadata.width) || 0,
    height: Number(swapsAxes ? metadata.width : metadata.height) || 0
  };
}

function isBmpPath(filePath) {
  return path.extname(filePath || '').toLowerCase() === '.bmp';
}

async function readBmpRgba(filePath) {
  const bytes = await fs.readFile(filePath);
  if (bytes.length < 54 || bytes.subarray(0, 2).toString('ascii') !== 'BM') {
    throw new Error('BMP 文件头无效');
  }
  const pixelOffset = bytes.readUInt32LE(10);
  const dibSize = bytes.readUInt32LE(14);
  const signedWidth = bytes.readInt32LE(18);
  const signedHeight = bytes.readInt32LE(22);
  const planes = bytes.readUInt16LE(26);
  const bitsPerPixel = bytes.readUInt16LE(28);
  const compression = bytes.readUInt32LE(30);
  const width = Math.abs(signedWidth);
  const height = Math.abs(signedHeight);
  if (dibSize < 40 || planes !== 1 || ![24, 32].includes(bitsPerPixel) || compression !== 0 || !width || !height) {
    throw new Error('仅支持 Windows 24/32 位未压缩 BMP 图片');
  }
  const rowBytes = Math.ceil(width * bitsPerPixel / 32) * 4;
  const requiredBytes = pixelOffset + rowBytes * height;
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes > bytes.length) {
    throw new Error('BMP 像素数据不完整');
  }
  const data = Buffer.alloc(width * height * 4);
  const bytesPerPixel = bitsPerPixel / 8;
  const topDown = signedHeight < 0;
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const source = pixelOffset + sourceY * rowBytes + x * bytesPerPixel;
      const target = (y * width + x) * 4;
      data[target] = bytes[source + 2];
      data[target + 1] = bytes[source + 1];
      data[target + 2] = bytes[source];
      data[target + 3] = 255;
    }
  }
  return { data, info: { width, height, channels: 4 } };
}

async function readImageRgba(filePath) {
  if (isBmpPath(filePath)) return readBmpRgba(filePath);
  return sharp(filePath)
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function readImageDimensions(filePath) {
  if (isBmpPath(filePath)) {
    const image = await readBmpRgba(filePath);
    return { width: image.info.width, height: image.info.height };
  }
  return orientedDimensions(await sharp(filePath).metadata());
}

async function writeOutput(image, outputPath) {
  const extension = path.extname(outputPath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') {
    await image.jpeg({ quality: 98, chromaSubsampling: '4:4:4', optimizeScans: true }).toFile(outputPath);
    return;
  }
  if (extension === '.webp') {
    await image.webp({ quality: 100, lossless: true }).toFile(outputPath);
    return;
  }
  if (extension === '.tif' || extension === '.tiff') {
    await image.tiff({ compression: 'lzw', quality: 100, predictor: 'horizontal' }).toFile(outputPath);
    return;
  }
  if (extension === '.gif') {
    await image.gif({ colours: 256, dither: 0, effort: 10 }).toFile(outputPath);
    return;
  }
  if (extension === '.bmp') {
    const raw = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rowBytes = raw.info.width * 4;
    const pixelBytes = rowBytes * raw.info.height;
    const bitmap = Buffer.alloc(54 + pixelBytes);
    bitmap.write('BM', 0, 2, 'ascii');
    bitmap.writeUInt32LE(bitmap.length, 2);
    bitmap.writeUInt32LE(54, 10);
    bitmap.writeUInt32LE(40, 14);
    bitmap.writeInt32LE(raw.info.width, 18);
    bitmap.writeInt32LE(raw.info.height, 22);
    bitmap.writeUInt16LE(1, 26);
    bitmap.writeUInt16LE(32, 28);
    bitmap.writeUInt32LE(pixelBytes, 34);
    for (let y = 0; y < raw.info.height; y += 1) {
      const sourceY = raw.info.height - 1 - y;
      for (let x = 0; x < raw.info.width; x += 1) {
        const source = (sourceY * raw.info.width + x) * 4;
        const target = 54 + y * rowBytes + x * 4;
        bitmap[target] = raw.data[source + 2];
        bitmap[target + 1] = raw.data[source + 1];
        bitmap[target + 2] = raw.data[source];
        bitmap[target + 3] = raw.data[source + 3];
      }
    }
    await fs.writeFile(outputPath, bitmap);
    return;
  }
  if (extension === '.png') {
    await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(outputPath);
    return;
  }
  throw new Error(`不支持的套图输出格式：${extension || '无扩展名'}`);
}

async function composeTemplatePrint({
  templatePath,
  printPath,
  maskPath,
  cleanMaskPath,
  outputPath
}) {
  if (!templatePath || !printPath || !maskPath || !outputPath) {
    throw new TypeError('套图、原始印花、蒙版和输出路径不能为空');
  }

  const sourceBmp = isBmpPath(printPath) ? await readBmpRgba(printPath) : null;
  const [sourceStat, sourceMetadata, templateResult] = await Promise.all([
    fs.stat(printPath),
    sourceBmp ? { width: sourceBmp.info.width, height: sourceBmp.info.height, orientation: 1 } : sharp(printPath).metadata(),
    readImageRgba(templatePath)
  ]);
  const width = templateResult.info.width;
  const height = templateResult.info.height;
  const maskResult = await sharp(maskPath)
    .rotate()
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.nearest })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cleaned = cleanTemplateMask({
    templatePixels: templateResult.data,
    maskPixels: maskResult.data,
    width,
    height,
    maskWidth: maskResult.info.width,
    maskHeight: maskResult.info.height,
    maskChannels: maskResult.info.channels,
    templatePixelFormat: 'rgba'
  });
  const bounds = getMaskContentBounds(cleaned.mask, width, height, width, height, 1);
  if (!bounds) {
    throw new Error('可印花蒙版为空，没有可执行的印花区域');
  }

  const left = Math.max(0, Math.floor(bounds.x));
  const top = Math.max(0, Math.floor(bounds.y));
  const regionWidth = Math.min(width - left, Math.max(1, Math.ceil(bounds.width)));
  const regionHeight = Math.min(height - top, Math.max(1, Math.ceil(bounds.height)));
  const mappedPrintInput = sourceBmp
    ? sharp(sourceBmp.data, { raw: sourceBmp.info })
    : sharp(printPath).rotate();
  const mappedPrint = await mappedPrintInput
    .toColourspace('srgb')
    .ensureAlpha()
    .resize(regionWidth, regionHeight, {
      fit: 'contain',
      position: 'centre',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let maskPixels = 0;
  for (let y = 0; y < regionHeight; y += 1) {
    for (let x = 0; x < regionWidth; x += 1) {
      const maskValue = cleaned.mask[(top + y) * width + left + x] || 0;
      if (maskValue) maskPixels += 1;
      const alphaOffset = (y * regionWidth + x) * 4 + 3;
      mappedPrint.data[alphaOffset] = Math.round(mappedPrint.data[alphaOffset] * maskValue / 255);
    }
  }
  if (maskPixels === 0) {
    throw new Error('可印花蒙版为空，没有可执行的印花区域');
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  if (cleanMaskPath) {
    await fs.mkdir(path.dirname(cleanMaskPath), { recursive: true });
    await sharp(cleaned.mask, { raw: { width, height, channels: 1 } }).png().toFile(cleanMaskPath);
  }
  const output = sharp(templateResult.data, { raw: { width, height, channels: 4 } })
    .composite([{
      input: mappedPrint.data,
      raw: { width: regionWidth, height: regionHeight, channels: 4 },
      left,
      top
    }]);
  await writeOutput(output, outputPath);
  const outputStat = await fs.stat(outputPath);
  const sourceDimensions = orientedDimensions(sourceMetadata);
  return {
    width,
    height,
    sourceWidth: sourceDimensions.width,
    sourceHeight: sourceDimensions.height,
    sourceBytes: sourceStat.size,
    outputBytes: outputStat.size,
    maskPixels,
    maskCoverage: maskPixels / (width * height),
    mappingMode: 'contain'
  };
}

module.exports = {
  composeTemplatePrint,
  readImageDimensions,
  readImageRgba
};

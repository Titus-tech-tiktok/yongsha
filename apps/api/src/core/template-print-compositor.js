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
  await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(outputPath);
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

  const [sourceStat, sourceMetadata, templateResult] = await Promise.all([
    fs.stat(printPath),
    sharp(printPath).metadata(),
    sharp(templatePath)
      .rotate()
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
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
  const mappedPrint = await sharp(printPath)
    .rotate()
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
  composeTemplatePrint
};

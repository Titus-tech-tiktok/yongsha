'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

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

module.exports = {
  readImageDimensions,
  readImageRgba
};

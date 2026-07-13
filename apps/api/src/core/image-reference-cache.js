const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

function referenceCacheKey(filePath, stat, spec) {
  return crypto.createHash('sha256').update(JSON.stringify({
    path: path.resolve(filePath),
    size: Number(stat.size) || 0,
    mtimeMs: Number(stat.mtimeMs) || 0,
    maxEdge: Number(spec.maxEdge) || 2048,
    jpegQuality: Number(spec.jpegQuality) || 92
  })).digest('hex');
}

function imageApiSizeForDimensions(widthValue, heightValue) {
  const width = Math.max(0, Number(widthValue) || 0);
  const height = Math.max(0, Number(heightValue) || 0);
  if (width > height) return '1536x1024';
  if (height > width) return '1024x1536';
  return '1024x1024';
}

function createImageReferenceCache(options = {}) {
  const cacheRoot = path.resolve(options.cacheRoot || path.join(process.cwd(), '.image-reference-cache'));
  const spec = {
    maxEdge: Math.max(256, Number(options.maxEdge) || 2048),
    jpegQuality: Math.min(100, Math.max(1, Number(options.jpegQuality) || 92))
  };
  const conversionConcurrency = Math.max(1, Math.floor(Number(options.conversionConcurrency) || 2));
  const inFlight = new Map();
  const conversionWaiters = [];
  let activeConversions = 0;

  async function withConversionSlot(worker) {
    await new Promise(resolve => {
      if (activeConversions < conversionConcurrency) {
        activeConversions += 1;
        resolve();
      } else conversionWaiters.push(resolve);
    });
    try {
      return await worker();
    } finally {
      const next = conversionWaiters.shift();
      if (next) next();
      else activeConversions -= 1;
    }
  }

  async function convert(filePath, stat, metadata, key) {
    const extension = metadata.hasAlpha ? '.png' : '.jpg';
    const outputPath = path.join(cacheRoot, key.slice(0, 2), `${key}${extension}`);
    if (fs.existsSync(outputPath)) {
      const preparedStat = await fsp.stat(outputPath);
      return { path: outputPath, originalBytes: stat.size, preparedBytes: preparedStat.size };
    }

    options.onConvert?.(filePath);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.${process.pid}.${crypto.randomUUID()}.tmp${extension}`;
    let pipeline = sharp(filePath, { failOn: 'none' }).rotate().resize({
      width: spec.maxEdge,
      height: spec.maxEdge,
      fit: 'inside',
      withoutEnlargement: true
    });
    pipeline = metadata.hasAlpha
      ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
      : pipeline.jpeg({ quality: spec.jpegQuality, mozjpeg: true });
    try {
      await withConversionSlot(() => pipeline.toFile(temporaryPath));
      await fsp.rename(temporaryPath, outputPath);
    } catch (error) {
      if (!fs.existsSync(outputPath)) {
        await fsp.rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
      }
      await fsp.rm(temporaryPath, { force: true }).catch(() => {});
    }
    const preparedStat = await fsp.stat(outputPath);
    return { path: outputPath, originalBytes: stat.size, preparedBytes: preparedStat.size };
  }

  async function prepare(filePath) {
    const absolutePath = path.resolve(filePath);
    const stat = await fsp.stat(absolutePath);
    const key = referenceCacheKey(absolutePath, stat, spec);
    if (inFlight.has(key)) return inFlight.get(key);

    const pending = (async () => {
      const metadata = await sharp(absolutePath, { failOn: 'none' }).metadata();
      const result = await convert(absolutePath, stat, metadata, key);
      return { ...result, sourcePath: absolutePath, key };
    })();
    inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      inFlight.delete(key);
    }
  }

  return { prepare };
}

module.exports = {
  createImageReferenceCache,
  imageApiSizeForDimensions,
  referenceCacheKey
};

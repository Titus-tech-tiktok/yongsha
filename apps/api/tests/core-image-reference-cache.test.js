const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const {
  createImageReferenceCache,
  imageApiSizeForDimensions,
  referenceCacheKey
} = require('../src/core/image-reference-cache');

test('reference cache key includes source identity and conversion spec', () => {
  const stat = { size: 100, mtimeMs: 200 };
  const key = referenceCacheKey('C:\\images\\one.png', stat, { maxEdge: 2048, jpegQuality: 92 });
  assert.notEqual(key, referenceCacheKey('C:\\images\\two.png', stat, { maxEdge: 2048, jpegQuality: 92 }));
  assert.notEqual(key, referenceCacheKey('C:\\images\\one.png', { ...stat, size: 101 }, { maxEdge: 2048, jpegQuality: 92 }));
  assert.notEqual(key, referenceCacheKey('C:\\images\\one.png', stat, { maxEdge: 1024, jpegQuality: 92 }));
});

test('reference preparation is deduplicated, compressed, and never enlarged', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-reference-cache-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const opaque = path.join(temp, 'large.png');
  const alpha = path.join(temp, 'alpha.png');
  await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#88aaee' } }).png().toFile(opaque);
  await sharp({ create: { width: 100, height: 50, channels: 4, background: { r: 20, g: 30, b: 40, alpha: 0.5 } } }).png().toFile(alpha);
  let conversions = 0;
  const cache = createImageReferenceCache({
    cacheRoot: path.join(temp, 'cache'),
    maxEdge: 2048,
    jpegQuality: 92,
    onConvert() { conversions += 1; }
  });

  const [first, second] = await Promise.all([cache.prepare(opaque), cache.prepare(opaque)]);
  assert.equal(first.path, second.path);
  assert.equal(conversions, 1);
  assert.equal(path.extname(first.path), '.jpg');
  const opaqueMetadata = await sharp(first.path).metadata();
  assert.equal(opaqueMetadata.width, 2048);
  assert.equal(opaqueMetadata.height, 1024);
  assert.ok(first.preparedBytes < first.originalBytes);

  const alphaResult = await cache.prepare(alpha);
  assert.equal(path.extname(alphaResult.path), '.png');
  const alphaMetadata = await sharp(alphaResult.path).metadata();
  assert.equal(alphaMetadata.width, 100);
  assert.equal(alphaMetadata.height, 50);
  assert.equal(alphaMetadata.hasAlpha, true);
});

test('image API size follows the real template orientation', () => {
  assert.equal(imageApiSizeForDimensions(1000, 1000), '1024x1024');
  assert.equal(imageApiSizeForDimensions(1600, 900), '1536x1024');
  assert.equal(imageApiSizeForDimensions(900, 1600), '1024x1536');
});

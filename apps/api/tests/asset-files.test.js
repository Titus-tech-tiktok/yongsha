const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function removeTempWithRetry(target) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code) || attempt === 4) break;
      await wait(100 * (attempt + 1));
    }
  }
  throw lastError;
}

test('素材库支持追加同名文件并只删除当前素材库内的选中图片', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-asset-files-'));
  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = 'asset-files';
  const serverPath = require.resolve('../src/server');
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[serverPath];
  delete require.cache[runtimePath];
  const { addAssetFiles, createAssetThumbnail, deleteAssetFiles, normalizedThumbnailWidth } = require('../src/server');

  const firstUpload = path.join(temp, 'upload-1');
  await fs.writeFile(firstUpload, 'first');
  const first = await addAssetFiles('print', '', [{ path: firstUpload, originalname: 'flower.png' }], ['flower.png']);
  assert.equal(first.added, 1);
  assert.equal(await fs.readFile(path.join(first.root, 'flower.png'), 'utf8'), 'first');

  const secondUpload = path.join(temp, 'upload-2');
  await fs.writeFile(secondUpload, 'second');
  const second = await addAssetFiles('print', first.root, [{ path: secondUpload, originalname: 'flower.png' }], ['flower.png']);
  assert.equal(second.added, 1);
  assert.equal(await fs.readFile(path.join(first.root, 'flower (2).png'), 'utf8'), 'second');

  const originalRm = fs.rm;
  let simulatedLock = true;
  fs.rm = async (target, options) => {
    if (target === path.join(first.root, 'flower.png') && simulatedLock) {
      simulatedLock = false;
      const error = new Error('simulated Windows file lock');
      error.code = 'EPERM';
      throw error;
    }
    return originalRm(target, options);
  };
  let removed;
  try {
    removed = await deleteAssetFiles('print', first.root, [path.join(first.root, 'flower.png')]);
  } finally {
    fs.rm = originalRm;
  }
  assert.equal(removed.deleted, 1);
  await assert.rejects(() => fs.stat(path.join(first.root, 'flower.png')));
  await assert.rejects(() => deleteAssetFiles('print', first.root, [path.join(temp, 'outside.png')]), /不属于当前素材库/);

  const largeImage = path.join(first.root, 'large-preview.png');
  await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#b78c48' } }).png().toFile(largeImage);
  const thumbnail = await createAssetThumbnail(largeImage, 320);
  const thumbnailMetadata = await sharp(thumbnail.file).metadata();
  assert.equal(thumbnail.cacheHit, false);
  assert.equal(thumbnailMetadata.format, 'webp');
  assert.equal(thumbnailMetadata.width, 480);
  assert.ok((await fs.stat(thumbnail.file)).size < (await fs.stat(largeImage)).size);
  assert.equal((await createAssetThumbnail(largeImage, 480)).cacheHit, true);
  assert.equal(normalizedThumbnailWidth(999), 1200);

  sharp.cache(false);
  await wait(500);
  await removeTempWithRetry(temp);
});

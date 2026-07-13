const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

test('套图模板库列出多个导入文件夹并保留各自预览和图片数量', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-template-folders-'));
  process.env.CAISHEN_DATA_DIR = path.join(temp, 'data');
  process.env.CAISHEN_WORKSPACE_ID = 'template-folders';
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');
  const library = path.join(runtime.WORKSPACE_ROOT, 'assets', 'template');
  const first = path.join(library, '100-a', '套图A');
  const second = path.join(library, '200-b', '套图B', '详情页');
  await Promise.all([fs.mkdir(first, { recursive: true }), fs.mkdir(second, { recursive: true })]);
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#e8e2d7' } }).png().toBuffer();
  await Promise.all([
    fs.writeFile(path.join(first, '1.png'), image),
    fs.writeFile(path.join(first, '2.png'), image),
    fs.writeFile(path.join(second, '详情.png'), image)
  ]);

  const folders = await runtime.listTemplateFolders();
  assert.deepEqual(folders.map(item => [item.name, item.count]), [['套图A', 2], ['套图B', 1]]);
  assert.match(folders[0].preview.thumbnailUrl, /^\/api\/thumbnails\//);
  assert.equal(folders[1].path, path.join(library, '200-b', '套图B'));

  const deleted = await runtime.deleteTemplateFolder(first);
  assert.deepEqual({ deleted: deleted.deleted, count: deleted.count }, { deleted: true, count: 2 });
  assert.deepEqual((await runtime.listTemplateFolders()).map(item => item.name), ['套图B']);
  await assert.rejects(() => runtime.deleteTemplateFolder(path.join(library, '200-b')), /只能删除已导入的套图文件夹/);
  await assert.rejects(() => runtime.deleteTemplateFolder(first), /不存在或已被删除/);

  await fs.rm(temp, { recursive: true, force: true });
});

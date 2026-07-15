const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildZipDownloadName } = require('../src/server');

async function writeSource(folder, templateFolderPath) {
  const meta = path.join(folder, '.caishen-meta');
  await fs.mkdir(meta, { recursive: true });
  await fs.writeFile(path.join(meta, 'source.json'), JSON.stringify({ TemplateFolderPath: templateFolderPath }), 'utf8');
}

test('ZIP 下载名按套图文件夹、日期和两位序号生成', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-zip-name-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const templateFolder = path.join(root, 'templates', '款式1');
  await fs.mkdir(templateFolder, { recursive: true });
  const first = path.join(root, 'outputs', '0715-0001');
  const second = path.join(root, 'outputs', '0715-0002');
  await writeSource(first, templateFolder);
  await writeSource(second, templateFolder);

  assert.equal(await buildZipDownloadName(first), '款式1-0715-01');
  assert.equal(await buildZipDownloadName(second), '款式1-0715-02');
});


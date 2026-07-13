const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

test('套图自动识别结果会复用缓存，仅新增或变化图片需要再次识别', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-template-preparation-'));
  process.env.CAISHEN_DATA_DIR = path.join(temp, 'data');
  process.env.CAISHEN_WORKSPACE_ID = 'template-preparation';
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');
  const folder = path.join(runtime.WORKSPACE_ROOT, 'assets', 'templates', '整套主图');
  await fs.mkdir(folder, { recursive: true });
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#eee8dc' } }).png().toBuffer();
  await Promise.all([
    fs.writeFile(path.join(folder, '01-主图.png'), image),
    fs.writeFile(path.join(folder, '02-说明页.png'), image)
  ]);

  await runtime.saveTemplateConfiguration({
    folder,
    items: [
      { relativePath: '01-主图.png', action: 'replace_print', reason: '家具面板需要换印花' },
      { relativePath: '02-说明页.png', action: 'copy_template', reason: '说明页直接复制' }
    ]
  });

  const prepared = await runtime.getTemplatePreparation(folder);
  assert.equal(prepared.total, 2);
  assert.equal(prepared.pending, 0);
  assert.equal(prepared.generationReady, true);
  assert.deepEqual(prepared.counts, { replacePrint: 1, copyTemplate: 1, skipCopy: 0, manualCheck: 0 });
  assert.equal(prepared.preview.name, '01-主图.png');
  assert.match(prepared.preview.thumbnailUrl, /^\/api\/thumbnails\//);

  const reused = await runtime.prepareTemplateFolder(folder);
  assert.equal(reused.analyzed, 0);
  assert.equal(reused.reused, 2);
  assert.equal(reused.failed, 0);

  await fs.writeFile(path.join(folder, '01-主图.png'), Buffer.concat([image, Buffer.from('\nchanged')]));
  const changed = await runtime.getTemplatePreparation(folder);
  assert.equal(changed.pending, 1);
  assert.equal(changed.cached, 1);
  assert.equal(changed.generationReady, false);

  const copyFolder = path.join(runtime.WORKSPACE_ROOT, 'assets', 'templates', '直接复制套图');
  const printPath = path.join(runtime.WORKSPACE_ROOT, 'assets', 'prints', '印花.png');
  await fs.mkdir(copyFolder, { recursive: true });
  await fs.mkdir(path.dirname(printPath), { recursive: true });
  await fs.writeFile(path.join(copyFolder, '无需换印花.png'), image);
  await fs.writeFile(path.join(copyFolder, '未选择.png'), image);
  await fs.writeFile(printPath, image);
  await runtime.saveTemplateConfiguration({
    folder: copyFolder,
    items: [
      { relativePath: '无需换印花.png', action: 'copy_template', reason: '无需调用 API' },
      { relativePath: '未选择.png', action: 'copy_template', reason: '本次不选' }
    ]
  });
  await runtime.initializeRuntime();
  const finishedRoot = path.join(temp, '成品输出');
  await runtime.saveConfig({ outputPath: finishedRoot });
  const generated = await runtime.generateTask({
    taskNumber: 1,
    generationMode: 'template_print',
    printPath,
    printName: '印花.png',
    templateFolderPath: copyFolder,
    templateRelativePaths: ['无需换印花.png']
  });
  assert.equal(path.dirname(generated.folder), finishedRoot);
  assert.deepEqual(
    await fs.readFile(path.join(generated.folder, '无需换印花.png')),
    await fs.readFile(path.join(copyFolder, '无需换印花.png'))
  );
  await assert.rejects(fs.access(path.join(generated.folder, '未选择.png')));

  const outputFile = path.join(generated.folder, '无需换印花.png');
  await fs.writeFile(outputFile, Buffer.from('旧的不合格图片'));
  await runtime.generateTemplateSetForFolder(generated.folder, false, ['无需换印花.png']);
  assert.deepEqual(await fs.readFile(outputFile), await fs.readFile(path.join(copyFolder, '无需换印花.png')));
  assert.deepEqual(
    (await fs.readdir(generated.folder)).filter(name => name.includes('.caishen-next-') || name.includes('.caishen-old-')),
    []
  );

  await fs.rm(temp, { recursive: true, force: true });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const { templateCachePaths } = require('../src/core/template-regions');

async function writeTemplate(file, accent) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width: 80, height: 60, channels: 4, background: '#d2d2d2' } })
    .composite([
      { input: Buffer.from('<svg width="64" height="42"><rect width="64" height="42" fill="#f7f7f7"/></svg>'), left: 8, top: 9 },
      { input: Buffer.from(`<svg width="4" height="42"><rect width="4" height="42" fill="${accent}"/></svg>`), left: 38, top: 9 }
    ])
    .png()
    .toFile(file);
}

function createBmp24(width, height, pixelAt) {
  const rowBytes = Math.ceil(width * 3 / 4) * 4;
  const bytes = Buffer.alloc(54 + rowBytes * height);
  bytes.write('BM', 0, 2, 'ascii');
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(rowBytes * height, 34);
  for (let fileY = 0; fileY < height; fileY += 1) {
    const y = height - 1 - fileY;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixelAt(x, y);
      const offset = 54 + fileY * rowBytes + x * 3;
      bytes[offset] = b;
      bytes[offset + 1] = g;
      bytes[offset + 2] = r;
    }
  }
  return bytes;
}

test('template-print planner ignores unselected manual work and local generation expands copies without image API', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-local-template-print-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  process.env.CAISHEN_DATA_DIR = path.join(temp, 'data');
  process.env.CAISHEN_WORKSPACE_ID = 'local-template-print';
  delete process.env.CAISHEN_API_BASE_URL;
  delete process.env.CAISHEN_API_KEY;
  delete process.env.CAISHEN_IMAGE_API_KEY;
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');

  const templateRoot = path.join(runtime.WORKSPACE_ROOT, 'assets', 'template', 'set');
  const replacePath = path.join(templateRoot, '01-main.png');
  const copyPath = path.join(templateRoot, '02-logistics.png');
  const unresolvedPath = path.join(templateRoot, '03-side.png');
  const excludedPath = path.join(templateRoot, '04-internal-note.png');
  await Promise.all([
    writeTemplate(replacePath, '#151515'),
    writeTemplate(copyPath, '#303030'),
    writeTemplate(unresolvedPath, '#454545'),
    writeTemplate(excludedPath, '#606060')
  ]);
  const printPath = path.join(runtime.WORKSPACE_ROOT, 'assets', 'print', 'pattern.png');
  await fs.mkdir(path.dirname(printPath), { recursive: true });
  await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#df2435' } })
    .composite([{ input: Buffer.from('<svg width="600" height="600"><rect width="600" height="600" fill="#245ee0"/></svg>'), left: 600, top: 0 }])
    .png({ compressionLevel: 0 })
    .toFile(printPath);

  const configuration = [
    {
      relativePath: '01-main.png',
      action: 'replace_print',
      reason: 'white front panels are printable',
      replaceArea: 'front white panels',
      forbiddenArea: 'background, frame, seam and handle',
      regions: [{ x: 0.1, y: 0.15, width: 0.8, height: 0.7 }]
    },
    { relativePath: '02-logistics.png', action: 'copy_original', reason: 'required logistics page' },
    { relativePath: '03-side.png', action: 'manual_check', reason: 'operator must decide' },
    { relativePath: '04-internal-note.png', action: 'exclude', reason: 'operator explicitly excluded it' }
  ];
  await runtime.saveTemplateConfiguration({ folder: templateRoot, items: configuration });
  const outputRoot = path.join(temp, 'outputs');
  await fs.mkdir(outputRoot, { recursive: true });
  await runtime.saveConfig({ outputPath: outputRoot });

  await assert.rejects(
    runtime.generateTask({
      taskNumber: 1,
      generationMode: 'template_print',
      printPath,
      templateFolderPath: templateRoot,
      templateRelativePaths: ['03-side.png']
    }),
    /人工确认.*03-side\.png/
  );
  assert.deepEqual(await fs.readdir(outputRoot), [], 'selected manual work must block before a task folder is created');

  const partial = await runtime.generateTask({
    taskNumber: 1,
    generationMode: 'template_print',
    printPath,
    templateFolderPath: templateRoot,
    templateRelativePaths: ['01-main.png']
  });
  assert.equal(partial.summary.composited, 1);
  assert.equal(partial.summary.copied, 1);
  assert.equal(partial.summary.excluded, 1);
  assert.deepEqual(await fs.readFile(path.join(partial.folder, '02-logistics.png')), await fs.readFile(copyPath));
  await assert.rejects(fs.access(path.join(partial.folder, '03-side.png')));

  await runtime.saveTemplateConfiguration({
    folder: templateRoot,
    items: [{ relativePath: '03-side.png', action: 'copy_original', reason: 'keep this required side page unchanged' }]
  });
  const plan = await runtime.planTemplateOutputJobs(templateRoot, ['01-main.png']);
  assert.deepEqual(plan.relativePaths, ['01-main.png', '02-logistics.png', '03-side.png']);
  assert.deepEqual(plan.excludedRelativePaths, ['04-internal-note.png']);

  const generated = await runtime.generateTask({
    taskNumber: 2,
    generationMode: 'template_print',
    printPath,
    templateFolderPath: templateRoot,
    templateRelativePaths: ['01-main.png']
  });
  assert.equal(generated.summary.composited, 1);
  assert.equal(generated.summary.copied, 2);
  assert.equal(generated.summary.excluded, 1);
  assert.equal(generated.summary.apiGenerated, 0);
  assert.deepEqual(await fs.readFile(path.join(generated.folder, '02-logistics.png')), await fs.readFile(copyPath));
  assert.deepEqual(await fs.readFile(path.join(generated.folder, '03-side.png')), await fs.readFile(unresolvedPath));
  await assert.rejects(fs.access(path.join(generated.folder, '04-internal-note.png')));
  const outputMetadata = await sharp(path.join(generated.folder, '01-main.png')).metadata();
  assert.deepEqual([outputMetadata.width, outputMetadata.height], [80, 60]);
  const source = JSON.parse(await fs.readFile(path.join(generated.folder, '.caishen-source.json'), 'utf8'));
  assert.deepEqual(source.templateRelativePaths, ['01-main.png', '02-logistics.png', '03-side.png']);

  const listedTemplates = await runtime.listTemplates(templateRoot);
  const listedReplacement = listedTemplates.find(item => item.relativePath === '01-main.png');
  assert.match(listedReplacement.maskUrl, /^\/api\/(?:files\/|image\?)/);
  assert.match(listedReplacement.cleanMaskUrl, /^\/api\/(?:files\/|image\?)/);
  assert.ok(listedReplacement.maskCoverage > 0 && listedReplacement.maskCoverage < 1);

  const bmpTemplateRoot = path.join(runtime.WORKSPACE_ROOT, 'assets', 'template', 'bmp-set');
  const bmpTemplatePath = path.join(bmpTemplateRoot, '01-main.bmp');
  const bmpPrintPath = path.join(runtime.WORKSPACE_ROOT, 'assets', 'print', 'pattern.bmp');
  await fs.mkdir(bmpTemplateRoot, { recursive: true });
  await fs.writeFile(bmpTemplatePath, createBmp24(80, 60, () => [240, 240, 240]));
  await fs.writeFile(bmpPrintPath, createBmp24(400, 200, x => x < 200 ? [220, 30, 40] : [20, 92, 230]));
  await runtime.saveTemplateConfiguration({
    folder: bmpTemplateRoot,
    items: [{
      relativePath: '01-main.bmp',
      action: 'replace_print',
      reason: 'BMP white front panel',
      replaceArea: 'front panel',
      regions: [{ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }]
    }]
  });
  const bmpGenerated = await runtime.generateTask({
    taskNumber: 4,
    generationMode: 'template_print',
    printPath: bmpPrintPath,
    templateFolderPath: bmpTemplateRoot,
    templateRelativePaths: ['01-main.bmp']
  });
  const bmpOutput = await fs.readFile(path.join(bmpGenerated.folder, '01-main.bmp'));
  assert.equal(bmpOutput.subarray(0, 2).toString('ascii'), 'BM');
  assert.equal(bmpOutput.readInt32LE(18), 80);
  assert.equal(bmpOutput.readInt32LE(22), 60);

  const beforeInvalid = await fs.readdir(outputRoot);
  const cache = templateCachePaths(templateRoot, '01-main.png');
  await Promise.all([
    fs.rm(cache.maskFile, { force: true }),
    fs.rm(cache.cleanMaskFile, { force: true })
  ]);
  await assert.rejects(
    runtime.generateTask({
      taskNumber: 3,
      generationMode: 'template_print',
      printPath,
      templateFolderPath: templateRoot,
      templateRelativePaths: ['01-main.png']
    }),
    /蒙版.*01-main\.png/
  );
  assert.deepEqual(await fs.readdir(outputRoot), beforeInvalid, 'invalid replacement must block before a task folder is created');
});

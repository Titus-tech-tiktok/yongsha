const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

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

test('template-print planner expands copies and sends replace_print through image API', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-template-print-api-'));
  const resultPng = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#55aaee' } }).png().toBuffer();
  let requests = 0;
  const server = http.createServer((req, res) => {
    if (req.url !== '/v1/images/edits') return res.writeHead(404).end();
    requests += 1;
    req.resume();
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ b64_json: resultPng.toString('base64') }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  });

  process.env.CAISHEN_DATA_DIR = path.join(temp, 'data');
  process.env.CAISHEN_WORKSPACE_ID = 'template-print-api';
  process.env.CAISHEN_API_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  process.env.CAISHEN_API_KEY = 'image-key';
  process.env.CAISHEN_IMAGE_API_KEY = 'image-key';
  process.env.CAISHEN_IMAGE_MODEL = 'gpt-image-2';
  process.env.CAISHEN_IMAGE_API_START_INTERVAL_MS = '0';
  process.env.CAISHEN_API_TIMEOUT_SECONDS = '10';
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
    /03-side\.png/
  );
  assert.deepEqual(await fs.readdir(outputRoot), [], 'selected manual work must block before a task folder is created');

  const partial = await runtime.generateTask({
    taskNumber: 1,
    generationMode: 'template_print',
    printPath,
    templateFolderPath: templateRoot,
    templateRelativePaths: ['01-main.png']
  });
  assert.equal(partial.summary.apiGenerated, 1);
  assert.equal(partial.summary.copied, 1);
  assert.equal(partial.summary.excluded, 1);
  assert.equal(requests, 1);
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
  assert.equal(generated.summary.apiGenerated, 1);
  assert.equal(generated.summary.copied, 2);
  assert.equal(generated.summary.excluded, 1);
  assert.equal(requests, 2);
  assert.deepEqual(await fs.readFile(path.join(generated.folder, '02-logistics.png')), await fs.readFile(copyPath));
  assert.deepEqual(await fs.readFile(path.join(generated.folder, '03-side.png')), await fs.readFile(unresolvedPath));
  await assert.rejects(fs.access(path.join(generated.folder, '04-internal-note.png')));
  const outputMetadata = await sharp(path.join(generated.folder, '01-main.png')).metadata();
  assert.deepEqual([outputMetadata.width, outputMetadata.height], [80, 60]);
  const source = JSON.parse(await fs.readFile(path.join(generated.folder, '.caishen-source.json'), 'utf8'));
  assert.deepEqual(source.templateRelativePaths, ['01-main.png', '02-logistics.png', '03-side.png']);
});

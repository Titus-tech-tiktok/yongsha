const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

test('template-print regeneration entrypoints use the image API', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-image-retry-'));
  const resultPng = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#88aaee' } }).png().toBuffer();
  let requests = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/generated.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(resultPng);
    }
    if (req.url !== '/v1/images/edits') return res.writeHead(404).end();
    requests += 1;
    req.resume();
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (requests === 1) {
        res.writeHead(503);
        return res.end(JSON.stringify({ error: { message: 'Upstream service temporarily unavailable' } }));
      }
      return res.end(JSON.stringify({ data: [{ url: `http://${req.headers.host}/generated.png` }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  });

  process.env.CAISHEN_DATA_DIR = path.join(temp, 'data');
  process.env.CAISHEN_WORKSPACE_ID = 'image-retry';
  process.env.CAISHEN_API_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  process.env.CAISHEN_API_KEY = 'image-key';
  process.env.CAISHEN_IMAGE_API_KEY = 'image-key';
  process.env.CAISHEN_IMAGE_MODEL = 'gpt-image-2';
  process.env.CAISHEN_IMAGE_API_START_INTERVAL_MS = '1';
  process.env.CAISHEN_IMAGE_API_BACKOFF_BASE_MS = '1';
  process.env.CAISHEN_IMAGE_API_BACKOFF_MAX_MS = '1';
  process.env.CAISHEN_IMAGE_API_MAX_ATTEMPTS = '8';
  process.env.CAISHEN_API_TIMEOUT_SECONDS = '10';
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');

  const outputRoot = path.join(temp, 'output');
  const templateRoot = path.join(runtime.WORKSPACE_ROOT, 'assets', 'templates', 'set');
  const printPath = path.join(runtime.WORKSPACE_ROOT, 'assets', 'prints', 'print.png');
  await fs.mkdir(templateRoot, { recursive: true });
  await fs.mkdir(path.dirname(printPath), { recursive: true });
  const templateImage = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#f7f7f7' } }).png().toBuffer();
  await fs.writeFile(path.join(templateRoot, '1.png'), templateImage);
  await fs.writeFile(printPath, resultPng);
  await runtime.saveConfig({ outputPath: outputRoot, auditMode: 'economy' });
  await runtime.saveTemplateConfiguration({
    folder: templateRoot,
    items: [{
      relativePath: '1.png',
      action: 'replace_print',
      reason: 'front panel can receive print',
      replaceArea: 'front white panel',
      forbiddenArea: 'background and handle',
      regions: [{ x: 0, y: 0, width: 1, height: 1 }]
    }]
  });

  const generated = await runtime.generateTask({
    taskNumber: 1,
    generationMode: 'template_print',
    printPath,
    printName: 'print.png',
    masterImagePath: path.join(templateRoot, '1.png'),
    templateFolderPath: templateRoot,
    templateRelativePaths: ['1.png']
  });
  const outputFile = path.join(generated.folder, '1.png');
  await fs.access(outputFile);
  const outputMetadata = await sharp(outputFile).metadata();
  assert.equal(outputMetadata.width, 40);
  assert.equal(outputMetadata.height, 20);
  const outputPixel = await sharp(outputFile).removeAlpha().raw().toBuffer();
  const centerOffset = (10 * 40 + 20) * 3;
  assert.deepEqual([...outputPixel.subarray(centerOffset, centerOffset + 3)], [0x88, 0xaa, 0xee]);
  assert.equal(generated.summary.apiGenerated, 1);
  assert.equal(requests, 2, 'standard template-print should call the image API and retry once');

  await runtime.generateTemplateSetForFolder(generated.folder, true);
  assert.equal(requests, 2);

  await fs.rm(outputFile, { force: true });
  await runtime.generateTemplateSetForFolder(generated.folder, true);
  await fs.access(outputFile);
  assert.equal(requests, 3, '补生成缺失图片仍应调用图片 API');

  await runtime.generateTemplateSetForFolder(generated.folder, false);
  assert.equal(requests, 4, '重新生成整套图仍应调用图片 API');

  await runtime.regenerateSingleTemplate({ folder: generated.folder, relativePath: '1.png' });
  assert.equal(requests, 5, '单张重新生成仍应调用图片 API');

});

test('template-print queue completes all thirty images through the image API', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-image-capacity-'));
  const resultPng = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#44aa77' } }).png().toBuffer();
  let requests = 0;
  let active = 0;
  let accepted = 0;
  let peakAccepted = 0;
  const server = http.createServer((req, res) => {
    if (req.url !== '/v1/images/edits') return res.writeHead(404).end();
    requests += 1;
    req.resume();
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      active += 1;
      if (active > 4) {
        active -= 1;
        res.setHeader('Retry-After', '0.002');
        res.writeHead(429);
        return res.end(JSON.stringify({ error: { message: 'Upstream rate limit' } }));
      }
      accepted += 1;
      peakAccepted = Math.max(peakAccepted, active);
      setTimeout(() => {
        active -= 1;
        res.end(JSON.stringify({ data: [{ b64_json: resultPng.toString('base64') }] }));
      }, 50);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  });

  process.env.CAISHEN_DATA_DIR = path.join(temp, 'data');
  process.env.CAISHEN_WORKSPACE_ID = 'image-capacity';
  process.env.CAISHEN_API_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  process.env.CAISHEN_API_KEY = 'image-key';
  process.env.CAISHEN_IMAGE_API_KEY = 'image-key';
  process.env.CAISHEN_IMAGE_MODEL = 'gpt-image-2';
  process.env.CAISHEN_IMAGE_API_INITIAL_CONCURRENCY = '4';
  process.env.CAISHEN_IMAGE_API_MAX_CONCURRENCY = '12';
  process.env.CAISHEN_IMAGE_API_START_INTERVAL_MS = '0';
  process.env.CAISHEN_IMAGE_API_BACKOFF_BASE_MS = '2';
  process.env.CAISHEN_IMAGE_API_BACKOFF_MAX_MS = '10';
  process.env.CAISHEN_IMAGE_API_MAX_ATTEMPTS = '8';
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');

  const outputRoot = path.join(temp, 'output');
  const templateRoot = path.join(runtime.WORKSPACE_ROOT, 'assets', 'templates', 'set');
  const printPath = path.join(runtime.WORKSPACE_ROOT, 'assets', 'prints', 'print.png');
  await fs.mkdir(templateRoot, { recursive: true });
  await fs.mkdir(path.dirname(printPath), { recursive: true });
  const templateImage = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#f7f7f7' } }).png().toBuffer();
  const relativePaths = Array.from({ length: 30 }, (_, index) => `${String(index + 1).padStart(2, '0')}.png`);
  await Promise.all(relativePaths.map(name => fs.writeFile(path.join(templateRoot, name), templateImage)));
  await fs.writeFile(printPath, resultPng);
  await runtime.saveConfig({ outputPath: outputRoot, auditMode: 'economy' });
  await runtime.saveTemplateConfiguration({
    folder: templateRoot,
    items: relativePaths.map(relativePath => ({
      relativePath,
      action: 'replace_print',
      reason: 'front panel can receive print',
      replaceArea: 'front white panel',
      forbiddenArea: 'background and handle',
      regions: [{ x: 0, y: 0, width: 1, height: 1 }]
    }))
  });

  const progressEvents = [];
  const generated = await runtime.generateTask({
    taskNumber: 1,
    generationMode: 'template_print',
    printPath,
    printName: 'print.png',
    masterImagePath: path.join(templateRoot, relativePaths[0]),
    templateFolderPath: templateRoot,
    templateRelativePaths: relativePaths
  }, {
    reportProgress(progress) {
      progressEvents.push({ ...progress });
    }
  });

  assert.equal(generated.summary.total, 30);
  assert.equal(generated.summary.apiGenerated, 30);
  assert.equal(generated.summary.failed, 0);
  assert.equal(accepted, 30);
  assert.ok(peakAccepted <= 4);
  assert.ok(requests >= 30);
  assert.deepEqual(runtime.getImageSchedulerSnapshot().active, 0);
  assert.ok(progressEvents.some(progress => Number(progress.waitingUpstream || 0) > 0) || requests === 30);
  await fs.access(path.join(generated.folder, '.caishen-meta', 'image-api-events.jsonl'));
  await Promise.all(relativePaths.map(name => fs.access(path.join(generated.folder, name))));
});

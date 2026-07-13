const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

test('template generation retries temporary image API failures and regeneration entrypoints work', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-image-retry-'));
  const resultPng = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#88aaee' } }).png().toBuffer();
  let requests = 0;
  const server = http.createServer((req, res) => {
    if (req.url !== '/v1/images/edits') return res.writeHead(404).end();
    requests += 1;
    req.resume();
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (requests === 1) {
        res.writeHead(503);
        return res.end(JSON.stringify({ error: { message: 'Upstream service temporarily unavailable' } }));
      }
      return res.end(JSON.stringify({ data: [{ b64_json: resultPng.toString('base64') }] }));
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
  process.env.CAISHEN_IMAGE_API_STAGGER_MIN_MS = '1';
  process.env.CAISHEN_IMAGE_API_STAGGER_MAX_MS = '1';
  process.env.CAISHEN_IMAGE_API_RETRY_MIN_MS = '1';
  process.env.CAISHEN_IMAGE_API_RETRY_MAX_MS = '1';
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
      regions: []
    }]
  });

  const generated = await runtime.generateTask({
    taskNumber: 1,
    generationMode: 'template_print',
    printPath,
    printName: 'print.png',
    templateFolderPath: templateRoot,
    templateRelativePaths: ['1.png']
  });
  const outputFile = path.join(generated.folder, '1.png');
  await fs.access(outputFile);
  const outputMetadata = await sharp(outputFile).metadata();
  assert.equal(outputMetadata.width, 40);
  assert.equal(outputMetadata.height, 20);
  const outputPixel = await sharp(outputFile).raw().toBuffer();
  assert.deepEqual([...outputPixel.slice(0, 3)], [0x88, 0xaa, 0xee], '生成图应 cover 到套图比例，不应 contain 留白');
  assert.equal(requests, 2);

  await runtime.generateTemplateSetForFolder(generated.folder, true);
  assert.equal(requests, 2, '补生成没有缺失图时不应请求生图接口');

  await fs.rm(outputFile, { force: true });
  await runtime.generateTemplateSetForFolder(generated.folder, true);
  await fs.access(outputFile);
  assert.equal(requests, 3, '补生成缺失图片会请求一次');

  await runtime.generateTemplateSetForFolder(generated.folder, false);
  assert.equal(requests, 4, '重新生成整套图会覆盖已有图片');

  await runtime.regenerateSingleTemplate({ folder: generated.folder, relativePath: '1.png' });
  assert.equal(requests, 5, '单张重新生成会请求指定图片');

});

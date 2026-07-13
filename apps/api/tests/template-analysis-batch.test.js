const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

test('单张和批量 AI 分析失败会重试三次并持久显示最终状态', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-template-analysis-'));
  let mode = 'recover';
  let requests = 0;
  const server = http.createServer((req, res) => {
    if (req.url !== '/v1/chat/completions') return res.writeHead(404).end();
    requests += 1;
    req.resume();
    req.on('end', () => {
      if (mode === 'success' || (mode === 'recover' && requests >= 4)) {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          version: 6,
          action: 'replace_print',
          confidence: 0.93,
          reason: '商品场景图，柜门面板可以替换印花',
          replace_area: '正面柜门外表面',
          forbidden_area: '文字、背景、把手和柜体结构',
          replace_regions: []
        }) } }] }));
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'temporary failure' } }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = 'template-analysis';
  process.env.CAISHEN_API_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  process.env.CAISHEN_API_KEY = 'test-key';
  process.env.CAISHEN_ANALYSIS_API_KEY = 'test-key';
  process.env.CAISHEN_ANALYSIS_WIRE_API = 'chat_completions';
  process.env.CAISHEN_ANALYSIS_RETRY_BASE_MS = '1';
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');
  const folder = path.join(runtime.WORKSPACE_ROOT, 'assets', 'template', 'set');
  await fs.mkdir(folder, { recursive: true });
  await Promise.all(['one.png', 'two.png'].map(name => sharp({ create: { width: 24, height: 24, channels: 3, background: '#d8c59b' } }).png().toFile(path.join(folder, name))));

  const recovered = await runtime.analyzeTemplateItems({ folder, relativePaths: ['one.png'] });
  assert.equal(requests, 4, '首次调用加三次自动重试后成功');
  assert.equal(recovered.failed, 0);
  assert.equal(recovered.items.find(item => item.relativePath === 'one.png').analysisStatus, 'success');

  mode = 'fail';
  requests = 0;
  const failed = await runtime.analyzeTemplateItems({ folder, relativePaths: ['two.png'] });
  const failedItem = failed.items.find(item => item.relativePath === 'two.png');
  assert.equal(requests, 4);
  assert.equal(failed.failed, 1);
  assert.equal(failedItem.analysisStatus, 'failed');
  assert.equal(failedItem.analysisAttempts, 4);
  assert.match(failedItem.analysisError, /temporary failure/);

  mode = 'success';
  requests = 0;
  const batch = await runtime.analyzeTemplateItems({ folder, relativePaths: ['one.png', 'two.png'] });
  assert.equal(batch.concurrency, 2);
  assert.equal(batch.completed, 2);
  assert.equal(batch.failed, 0);
  assert.equal(requests, 2);

  await new Promise(resolve => server.close(resolve));
  await fs.rm(temp, { recursive: true, force: true });
});

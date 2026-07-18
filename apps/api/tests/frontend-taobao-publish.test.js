const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('web app exposes Taobao publish assistant page and bridge methods', async () => {
  const index = await fs.readFile(path.join(__dirname, '../../web/index.html'), 'utf8');
  const bridge = await fs.readFile(path.join(__dirname, '../../web/src/api-bridge.js'), 'utf8');
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const server = await fs.readFile(path.join(__dirname, '../src/server.js'), 'utf8');

  assert.match(index, /page-taobao-publish/);
  assert.match(index, /taobaoPublishTaskList/);
  assert.match(index, /taobaoCategoryEditor/);
  assert.match(bridge, /getTaobaoPublishSettings/);
  assert.match(bridge, /saveTaobaoPublishSettings/);
  assert.match(bridge, /queueTaobaoPublishTask/);
  assert.match(renderer, /renderTaobaoPublishPage/);
  assert.match(renderer, /saveActiveTaobaoCategoryTemplate/);
  assert.match(renderer, /queueActiveTaobaoPublishTask/);
  assert.match(server, /runTaobaoPublishWithToken/);
  assert.match(server, /\/images\/:group\/:index/);
  assert.ok(server.indexOf("app.post('/api/taobao/publish/claim'") < server.indexOf("app.use('/api'"));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('web app exposes Taobao publish assistant page and bridge methods', async () => {
  const index = await fs.readFile(path.join(__dirname, '../../web/index.html'), 'utf8');
  const bridge = await fs.readFile(path.join(__dirname, '../../web/src/api-bridge.js'), 'utf8');
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');

  assert.match(index, /page-taobao-publish/);
  assert.match(index, /淘宝发布辅助/);
  assert.match(bridge, /getTaobaoPublishSettings/);
  assert.match(bridge, /saveTaobaoPublishSettings/);
  assert.match(bridge, /queueTaobaoPublishTask/);
  assert.match(renderer, /renderTaobaoPublishPage/);
  assert.match(renderer, /saveActiveTaobaoCategoryTemplate/);
  assert.match(renderer, /发布到淘宝草稿/);
  assert.match(index, /taobaoCategoryEditor/);
});

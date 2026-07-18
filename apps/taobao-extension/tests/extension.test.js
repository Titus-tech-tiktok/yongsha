const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'src/popup.html'), 'utf8');

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.service_worker, 'src/background.js');
assert.ok(manifest.host_permissions.includes('https://item.upload.taobao.com/*'));
assert.match(background, /claimTaobaoPublishTask|\/api\/taobao\/publish\/claim/);
assert.match(background, /CAISHEN_TAOBAO_STATUS/);
assert.match(content, /input\[type="file"\]/);
assert.match(content, /保存草稿/);
assert.match(popup, /插件连接令牌/);

console.log('taobao extension smoke test passed');

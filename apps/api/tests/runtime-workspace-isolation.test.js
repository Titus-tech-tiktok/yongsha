const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('不同团队账号使用独立配置、素材目录和文件令牌边界', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-workspaces-'));
  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = 'local';
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');

  let adminFile;
  await runtime.runWithWorkspace('local', async () => {
    await runtime.initializeRuntime();
    await runtime.saveConfig({ operatorCode: 'admin' });
    await runtime.savePromptSetting('freeImageDefault', '管理员统一提示词');
    await runtime.saveApiSettings({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'server-api-key',
      imageModel: 'gpt-image-2',
      analysisModel: 'gpt-5-3',
      responseFormat: 'b64_json',
      requestTimeoutSeconds: 120
    });
    adminFile = path.join(runtime.WORKSPACE_ROOT, 'assets', 'print', 'admin.png');
    await fs.mkdir(path.dirname(adminFile), { recursive: true });
    await fs.writeFile(adminFile, 'admin');
    assert.equal(runtime.fileFromToken(runtime.fileToken(adminFile)), adminFile);
  });

  await runtime.runWithWorkspace('user-artist', async () => {
    await runtime.initializeRuntime();
    await runtime.saveConfig({ operatorCode: 'artist' });
    assert.equal((await runtime.loadConfig()).operatorCode, 'artist');
    assert.match(runtime.WORKSPACE_ROOT, /user-artist$/);
    assert.throws(() => runtime.fileToken(adminFile), /不属于/);
    assert.equal((await runtime.loadPromptSettings()).prompts.find(item => item.id === 'freeImageDefault').value, '管理员统一提示词');
    assert.equal((await runtime.loadApiSettings()).baseUrl, 'https://api.example.com/v1');
  });

  await runtime.runWithWorkspace('local', async () => {
    assert.equal((await runtime.loadConfig()).operatorCode, 'admin');
  });

  await fs.rm(temp, { recursive: true, force: true });
});

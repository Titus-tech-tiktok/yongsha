const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { canAccessRpc, isWithin, safeRelative } = require('../src/server');
const { createAuthService } = require('../src/auth');
const { isSameOrChildPath } = require('../src/core/path-utils');
const runtime = require('../src/runtime');

test('上传相对路径会移除穿越段', () => {
  assert.equal(safeRelative('../../套图/../01.png', 'fallback.png'), '套图/01.png');
});

test('工作区边界不会把相邻前缀误判为内部路径', () => {
  const root = path.resolve('/tmp/workspace');
  assert.equal(isWithin(root, path.join(root, 'assets/a.png')), true);
  assert.equal(isWithin(root, '/tmp/workspace-evil/a.png'), false);
});

test('Windows 路径归属比较兼容大小写差异', () => {
  const root = 'C:\\Users\\Administrator\\Desktop\\v8-source\\data\\workspaces\\local';
  const child = 'c:\\users\\administrator\\desktop\\v8-source\\data\\workspaces\\local\\assets\\a.png';
  const neighbor = 'c:\\users\\administrator\\desktop\\v8-source\\data\\workspaces\\local-evil\\a.png';
  assert.equal(isSameOrChildPath(root, child), process.platform === 'win32');
  assert.equal(isSameOrChildPath(root, neighbor), false);
});

test('文件令牌经过签名，篡改或旧式裸路径令牌会被拒绝', () => {
  const file = path.join(runtime.WORKSPACE_ROOT, 'outputs', '结果.png');
  const token = runtime.fileToken(file);
  assert.equal(runtime.fileFromToken(token), file);
  assert.equal(runtime.fileFromToken(Buffer.from(file).toString('base64url')), '');
  assert.equal(runtime.fileFromToken(`${token.slice(0, -1)}x`), '');
});

test('role access separates prompt management from API management', () => {
  const member = { role: 'member' };
  const admin = { role: 'admin' };
  const superadmin = { role: 'superadmin' };
  for (const method of ['savePromptSetting', 'resetPromptSetting']) {
    assert.equal(canAccessRpc(member, method), false);
    assert.equal(canAccessRpc(admin, method), false);
    assert.equal(canAccessRpc(superadmin, method), true);
  }
  assert.equal(canAccessRpc(member, 'getPromptSettings'), false);
  assert.equal(canAccessRpc(admin, 'getPromptSettings'), true);
  assert.equal(canAccessRpc(superadmin, 'getPromptSettings'), true);
  for (const method of ['getApiSettings', 'saveApiSettings', 'testApiSettings', 'testAnalysisApi']) {
    assert.equal(canAccessRpc(member, method), false);
    assert.equal(canAccessRpc(admin, method), false);
    assert.equal(canAccessRpc(superadmin, method), true);
  }
  assert.equal(canAccessRpc(member, 'getConfig'), true);
  assert.equal(canAccessRpc(member, 'generateTitles'), true);
});

test('all account roles can change their own password with current password verification', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-auth-'));
  const auth = createAuthService(root);
  const admin = await auth.createUser({ username: 'admin1', password: 'old-admin', role: 'admin' });
  const member = await auth.createUser({ username: 'member1', password: 'old-member', role: 'member' });

  await auth.changeOwnPassword(admin.id, 'old-admin', 'new-admin');
  await auth.changeOwnPassword(member.id, 'old-member', 'new-member');

  assert.equal(await auth.authenticate('admin1', 'old-admin'), null);
  assert.equal(await auth.authenticate('member1', 'old-member'), null);
  assert.equal((await auth.authenticate('admin1', 'new-admin')).id, admin.id);
  assert.equal((await auth.authenticate('member1', 'new-member')).id, member.id);
  await assert.rejects(() => auth.changeOwnPassword(member.id, 'wrong-password', 'next-member'), /当前密码不正确/);
});

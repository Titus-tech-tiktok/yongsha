const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAuthService } = require('../src/auth');

test('团队账号支持首次管理员、成员登录、会话和停用', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-auth-'));
  const auth = createAuthService(root);
  assert.equal(await auth.hasUsers(), false);

  const admin = await auth.createUser({ username: 'admin', displayName: '管理员', password: 'admin-pass-123' }, { bootstrap: true });
  assert.equal(admin.role, 'superadmin');
  assert.equal(admin.workspaceId, 'local');
  await assert.rejects(
    auth.createUser({ username: 'other-admin', password: 'admin-pass-456' }, { bootstrap: true }),
    /已经创建/
  );

  const member = await auth.createUser({ username: 'artist_a', displayName: '美工 A', password: 'artist-pass-123' });
  assert.equal(member.role, 'member');
  assert.notEqual(member.workspaceId, admin.workspaceId);
  assert.equal((await auth.authenticate('artist_a', 'artist-pass-123')).id, member.id);
  assert.equal(await auth.authenticate('artist_a', 'wrong-password'), null);

  const token = await auth.createSession(member);
  const request = { headers: { cookie: `other=1; caishen_session=${encodeURIComponent(token)}` } };
  assert.equal((await auth.userFromRequest(request)).id, member.id);
  await auth.setUserActive(member.id, false, admin.id);
  assert.equal(await auth.userFromRequest(request), null);
  await assert.rejects(auth.setUserActive(admin.id, false, admin.id), /不能停用/);

  await fs.rm(root, { recursive: true, force: true });
});

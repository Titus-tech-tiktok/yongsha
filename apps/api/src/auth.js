const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const SESSION_COOKIE = 'caishen_session';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function createAuthService(dataRoot) {
  const authRoot = path.join(dataRoot, 'system');
  const usersFile = path.join(authRoot, 'users.json');
  const secretFile = path.join(authRoot, 'session-secret');
  let writeChain = Promise.resolve();
  let cachedSecret = '';

  async function ensureSecret() {
    if (cachedSecret) return cachedSecret;
    const fromEnv = String(process.env.CAISHEN_SESSION_SECRET || '').trim();
    if (fromEnv.length >= 32) return (cachedSecret = fromEnv);
    try {
      cachedSecret = String(await fs.readFile(secretFile, 'utf8')).trim();
    } catch {}
    if (cachedSecret.length >= 32) return cachedSecret;
    cachedSecret = crypto.randomBytes(48).toString('base64url');
    await fs.mkdir(authRoot, { recursive: true });
    await fs.writeFile(secretFile, cachedSecret, { encoding: 'utf8', mode: 0o600 });
    return cachedSecret;
  }

  async function loadUsers() {
    try {
      const value = JSON.parse(await fs.readFile(usersFile, 'utf8'));
      return Array.isArray(value?.users) ? value.users : [];
    } catch {
      return [];
    }
  }

  async function writeUsersFile(users) {
    await fs.mkdir(authRoot, { recursive: true });
    const temporary = `${usersFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ version: 1, users }, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, usersFile);
  }

  function mutateUsers(worker) {
    const operation = writeChain.then(async () => {
      const users = await loadUsers();
      const result = await worker(users);
      await writeUsersFile(users);
      return result;
    });
    writeChain = operation.catch(() => {});
    return operation;
  }

  function normalizedUsername(value) {
    const username = String(value || '').normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
    if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(username)) throw new Error('账号只能使用 2-32 位中文、字母、数字、下划线或短横线');
    return username;
  }

  function normalizedDisplayName(value, fallback) {
    return String(value || fallback || '').normalize('NFKC').trim().slice(0, 40) || fallback;
  }

  function validatePassword(value) {
    const password = String(value || '');
    if (password.length < 3 || password.length > 128) throw new Error('密码长度需要在 3-128 位之间');
    return password;
  }

  function passwordHash(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
  }

  function publicUser(user) {
    return user ? {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      active: user.active !== false,
      workspaceId: user.workspaceId,
      parentUserId: user.parentUserId || '',
      createdAt: user.createdAt
    } : null;
  }

  function normalizeRole(value, options = {}) {
    const requested = String(value || '').trim();
    if (options.bootstrap) return 'superadmin';
    if (options.actorRole === 'superadmin' && ['admin', 'member'].includes(requested)) return requested;
    return 'member';
  }

  function createUser(payload = {}, options = {}) {
    return mutateUsers(users => {
      if (options.bootstrap && users.length) throw new Error('管理员账号已经创建');
      const username = normalizedUsername(payload.username);
      if (users.some(user => user.username === username)) throw new Error('该账号已存在');
      const password = validatePassword(payload.password);
      const id = crypto.randomUUID();
      const salt = crypto.randomBytes(24).toString('hex');
      const user = {
        id,
        username,
        displayName: normalizedDisplayName(payload.displayName, username),
        passwordSalt: salt,
        passwordHash: passwordHash(password, salt),
        role: normalizeRole(payload.role, options),
        active: true,
        workspaceId: options.bootstrap ? 'local' : `user-${id.replaceAll('-', '').slice(0, 20)}`,
        parentUserId: options.parentUserId ? String(options.parentUserId) : '',
        createdAt: new Date().toISOString()
      };
      users.push(user);
      return publicUser(user);
    });
  }

  async function authenticate(usernameValue, passwordValue) {
    let username;
    try { username = normalizedUsername(usernameValue); } catch { return null; }
    const users = await loadUsers();
    const user = users.find(item => item.username === username && item.active !== false);
    if (!user) return null;
    const password = String(passwordValue || '');
    if (password.length > 128) return null;
    const actual = Buffer.from(passwordHash(password, user.passwordSalt), 'hex');
    const expected = Buffer.from(String(user.passwordHash || ''), 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    return publicUser(user);
  }

  async function listUsers() {
    return (await loadUsers()).map(publicUser);
  }

  async function getUserById(id) {
    return publicUser((await loadUsers()).find(item => item.id === String(id)));
  }

  function updateUser(id, payload = {}, actor = {}) {
    return mutateUsers(users => {
      const user = users.find(item => item.id === String(id));
      if (!user) throw new Error('账号不存在');
      if (user.role === 'superadmin' && actor.role !== 'superadmin') throw new Error('不能编辑超级管理员');
      if (user.id === actor.id && payload.active === false) throw new Error('不能停用当前登录账号');
      if (Object.prototype.hasOwnProperty.call(payload, 'displayName')) {
        user.displayName = normalizedDisplayName(payload.displayName, user.username);
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'active')) user.active = payload.active !== false;
      if (payload.password) {
        const password = validatePassword(payload.password);
        const salt = crypto.randomBytes(24).toString('hex');
        user.passwordSalt = salt;
        user.passwordHash = passwordHash(password, salt);
      }
      if (actor.role === 'superadmin' && ['admin', 'member'].includes(String(payload.role || ''))) {
        if (user.role === 'superadmin') throw new Error('不能修改超级管理员角色');
        user.role = String(payload.role);
      }
      return publicUser(user);
    });
  }

  function setUserActive(id, active, actorId) {
    return mutateUsers(users => {
      const user = users.find(item => item.id === String(id));
      if (!user) throw new Error('账号不存在');
      if (user.id === actorId && active === false) throw new Error('不能停用当前登录账号');
      user.active = active !== false;
      return publicUser(user);
    });
  }

  async function hasUsers() {
    return (await loadUsers()).length > 0;
  }

  async function createSession(user) {
    const payload = Buffer.from(JSON.stringify({ uid: user.id, exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 })).toString('base64url');
    const signature = crypto.createHmac('sha256', await ensureSecret()).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  async function userFromRequest(req) {
    const rawCookie = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${SESSION_COOKIE}=`));
    const token = rawCookie ? decodeURIComponent(rawCookie.slice(SESSION_COOKIE.length + 1)) : '';
    try {
      const [payload, signature] = token.split('.');
      if (!payload || !signature) return null;
      const expected = crypto.createHmac('sha256', await ensureSecret()).update(payload).digest('base64url');
      const actualBytes = Buffer.from(signature);
      const expectedBytes = Buffer.from(expected);
      if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return null;
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!session.uid || Number(session.exp) <= Date.now()) return null;
      const user = (await loadUsers()).find(item => item.id === session.uid && item.active !== false);
      return publicUser(user);
    } catch {
      return null;
    }
  }

  function sessionCookie(token, secure = false) {
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`;
  }

  function clearSessionCookie(secure = false) {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
  }

  return {
    authenticate,
    clearSessionCookie,
    createSession,
    createUser,
    getUserById,
    hasUsers,
    listUsers,
    publicUser,
    sessionCookie,
    setUserActive,
    updateUser,
    userFromRequest
  };
}

module.exports = { createAuthService };

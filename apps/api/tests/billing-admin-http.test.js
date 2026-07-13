const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function removeTempWithRetry(target) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code) || attempt === 4) break;
      await wait(100 * (attempt + 1));
    }
  }
  throw lastError;
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

test('管理员可查看全平台流水和账号名但只返回可管理账号余额', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-billing-admin-http-'));
  const port = 21000 + Math.floor(Math.random() * 1000);
  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = 'local';
  process.env.CAISHEN_HOST = '127.0.0.1';
  process.env.PORT = String(port);
  for (const modulePath of ['../src/server', '../src/runtime', '../src/auth', '../src/billing']) {
    delete require.cache[require.resolve(modulePath)];
  }
  const { startServer } = require('../src/server');
  const server = await startServer();
  const base = `http://127.0.0.1:${port}`;
  try {
    const bootstrap = await jsonFetch(`${base}/api/auth/bootstrap`, {
      method: 'POST',
      body: JSON.stringify({ username: 'root', displayName: 'Root', password: 'abc147852' })
    });
    assert.equal(bootstrap.response.status, 201);
    const superCookie = bootstrap.response.headers.get('set-cookie')?.split(';')[0] || '';

    const adminCreate = await jsonFetch(`${base}/api/auth/users`, {
      method: 'POST',
      headers: { Cookie: superCookie },
      body: JSON.stringify({ username: 'teamadmin', displayName: 'Team Admin', password: 'abc147852', role: 'admin' })
    });
    assert.equal(adminCreate.response.status, 201);
    const admin = adminCreate.body.data;

    const outsiderCreate = await jsonFetch(`${base}/api/auth/users`, {
      method: 'POST',
      headers: { Cookie: superCookie },
      body: JSON.stringify({ username: 'otheradmin', displayName: 'Other Admin', password: 'abc147852', role: 'admin' })
    });
    assert.equal(outsiderCreate.response.status, 201);
    const outsider = outsiderCreate.body.data;

    await jsonFetch(`${base}/api/billing/adjust`, {
      method: 'POST',
      headers: { Cookie: superCookie },
      body: JSON.stringify({ userId: admin.id, amountMinor: 1000, description: 'admin ledger' })
    });
    await jsonFetch(`${base}/api/billing/adjust`, {
      method: 'POST',
      headers: { Cookie: superCookie },
      body: JSON.stringify({ userId: outsider.id, amountMinor: 2000, description: 'outsider ledger' })
    });

    const login = await jsonFetch(`${base}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'teamadmin', password: 'abc147852' })
    });
    assert.equal(login.response.status, 200);
    const adminCookie = login.response.headers.get('set-cookie')?.split(';')[0] || '';

    const billing = await jsonFetch(`${base}/api/billing/admin`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(billing.response.status, 200);
    const data = billing.body.data;
    assert.equal(data.rules, undefined);
    assert.deepEqual(data.users.map(user => user.id), [admin.id]);
    assert.ok(data.transactions.some(entry => entry.workspaceId === outsider.workspaceId));
    assert.ok(data.transactionUsers.some(user => user.workspaceId === outsider.workspaceId && user.displayName === 'Other Admin'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await removeTempWithRetry(temp);
  }
});

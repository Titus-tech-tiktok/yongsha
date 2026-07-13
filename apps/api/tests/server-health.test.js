const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('health endpoint exposes deployment and image queue state only', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-health-'));
  const port = 22000 + Math.floor(Math.random() * 1000);
  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = 'local';
  process.env.CAISHEN_HOST = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.APP_COMMIT_SHA = 'test-commit';
  for (const modulePath of ['../src/server', '../src/runtime', '../src/auth']) {
    delete require.cache[require.resolve(modulePath)];
  }

  const { startServer } = require('../src/server');
  const server = await startServer();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body).sort(), [
      'activeImageRequests',
      'commit',
      'currentImageConcurrency',
      'maxImageConcurrency',
      'ok',
      'queuedImageRequests',
      'uptimeSeconds'
    ].sort());
    assert.equal(body.ok, true);
    assert.equal(body.commit, 'test-commit');
    assert.equal(body.activeImageRequests, 0);
    assert.equal(body.queuedImageRequests, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
    delete process.env.APP_COMMIT_SHA;
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('job persistence retries transient Windows EPERM rename failures', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'caishen-job-retry-'));
  const previousDataDir = process.env.CAISHEN_DATA_DIR;
  process.env.CAISHEN_DATA_DIR = temp;
  delete require.cache[require.resolve('../src/server')];
  const server = require('../src/server');
  const originalRename = fs.promises.rename;
  let attempts = 0;

  fs.promises.rename = async (...args) => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error('simulated EPERM');
      error.code = 'EPERM';
      throw error;
    }
    return originalRename.apply(fs.promises, args);
  };

  try {
    await server.writeJob({ id: 'retry-test', status: 'running', progress: { current: 1 } });
    const saved = JSON.parse(await fsp.readFile(path.join(temp, 'workspaces', 'local', 'jobs', 'retry-test.json'), 'utf8'));
    assert.equal(saved.status, 'running');
    assert.equal(attempts, 2);
  } finally {
    fs.promises.rename = originalRename;
    if (previousDataDir === undefined) delete process.env.CAISHEN_DATA_DIR;
    else process.env.CAISHEN_DATA_DIR = previousDataDir;
    delete require.cache[require.resolve('../src/server')];
    await fsp.rm(temp, { recursive: true, force: true });
  }
});

const { readdirSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function listTests(folder) {
  return readdirSync(folder, { withFileTypes: true })
    .flatMap(entry => {
      const target = path.join(folder, entry.name);
      if (entry.isDirectory()) return listTests(target);
      return entry.isFile() && entry.name.endsWith('.test.js') ? [target] : [];
    })
    .sort();
}

const testRoot = path.resolve(__dirname, '../tests');
const result = spawnSync(process.execPath, [
  '--test',
  ...process.argv.slice(2),
  ...listTests(testRoot)
], { stdio: 'inherit' });

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

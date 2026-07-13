const fs = require('node:fs');
const path = require('node:path');

const required = [
  'src/server.js',
  'src/runtime.js',
  '../web/dist/index.html'
];

for (const relative of required) {
  const file = path.resolve(__dirname, '..', relative);
  if (!fs.existsSync(file)) throw new Error(`构建缺少文件：${file}`);
}

console.log('API 构建检查通过');

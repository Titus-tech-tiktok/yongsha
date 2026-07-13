const path = require('node:path');
const { generateTitlesFromFlatKeywords } = require('./title-engine');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff']);

function isImagePath(file) {
  return IMAGE_EXTENSIONS.has(path.extname(file || '').toLowerCase());
}

function safeFileName(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80) || '未命名';
}

function taskFolderName(operatorCode, date, serial, productPath, printPath) {
  const code = safeFileName(operatorCode || 'ys').replace(/\s/g, '').slice(0, 10) || 'ys';
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const sequence = String(serial).padStart(4, '0');
  const product = safeFileName(path.basename(productPath, path.extname(productPath))).slice(0, 20);
  const print = safeFileName(path.basename(printPath, path.extname(printPath))).slice(0, 20);
  return `${code}${mm}${dd}${sequence}-${product}-${print}`;
}

function extractImageResult(body) {
  const item = body?.data?.[0];
  if (typeof item?.b64_json === 'string' && item.b64_json.trim()) {
    const raw = item.b64_json.includes(',') ? item.b64_json.slice(item.b64_json.indexOf(',') + 1) : item.b64_json;
    return { type: 'base64', value: raw };
  }
  if (typeof item?.url === 'string' && item.url.trim()) {
    return { type: 'url', value: item.url };
  }
  throw new Error('接口没有返回图片内容');
}

function generateTitles(prefixValue, keywordValue, countValue, requiredValue = '') {
  return generateTitlesFromFlatKeywords(prefixValue, keywordValue, countValue, requiredValue);
}

module.exports = {
  IMAGE_EXTENSIONS,
  extractImageResult,
  generateTitles,
  isImagePath,
  safeFileName,
  taskFolderName
};

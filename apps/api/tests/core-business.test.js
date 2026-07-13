const test = require('node:test');
const assert = require('node:assert/strict');
const { extractImageResult, generateTitles, isImagePath, safeFileName, taskFolderName } = require('../src/core/business');

test('识别常用图片扩展名', () => {
  assert.equal(isImagePath('/tmp/a.JPG'), true);
  assert.equal(isImagePath('/tmp/a.txt'), false);
});

test('清理不安全文件名', () => {
  assert.equal(safeFileName(' 柜子:/A* '), '柜子--A-');
});

test('生成稳定任务目录名', () => {
  const value = taskFolderName('ys', new Date(2026, 6, 10), 7, '/a/餐边柜.png', '/b/001.jpg');
  assert.equal(value, 'ys07100007-餐边柜-001');
});

test('解析 base64 图片响应', () => {
  assert.deepEqual(extractImageResult({ data: [{ b64_json: 'data:image/png;base64,YQ==' }] }), { type: 'base64', value: 'YQ==' });
  assert.deepEqual(extractImageResult({ data: [{ url: 'https://example.test/image.png' }] }), { type: 'url', value: 'https://example.test/image.png' });
});

test('标题唯一且不超过 30 字', () => {
  const titles = generateTitles('餐边柜 储物柜', '整装发货 免安装 大容量 客厅 收纳 奶油风', 12);
  assert.equal(titles.length, 12);
  assert.equal(new Set(titles).size, titles.length);
  assert.ok(titles.length > 1);
  assert.ok(titles.every(title => title.length <= 30));
});

test('每个标题优先保留必选词', () => {
  const titles = generateTitles('餐边柜', '客厅 收纳 奶油风 落地 轻奢 新款', 8, '玄关 摆放柜');
  assert.equal(titles.length, 8);
  assert.ok(titles.every(title => title.includes('玄关') && title.includes('摆放柜')));
});

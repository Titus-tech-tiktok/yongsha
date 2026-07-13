const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTitlesFromFlatKeywords } = require('../src/core/title-engine');

test('标题生成保持数量、开头词根和去重', () => {
  const values = generateTitlesFromFlatKeywords('餐边柜 玄关柜', '储物 收纳 客厅 实木 轻奢 多功能', 12, '收纳');
  assert.equal(values.length, 12);
  assert.equal(new Set(values).size, values.length);
  assert.ok(values.every(value => value.startsWith('餐边柜') || value.startsWith('玄关柜')));
  assert.ok(values.every(value => value.includes('收纳')));
});

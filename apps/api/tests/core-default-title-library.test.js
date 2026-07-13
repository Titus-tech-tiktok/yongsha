const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_TITLE_ROOTS, createDefaultTitleLibrary } = require('../src/core/default-title-library');
const { generateStandaloneTitles, getTitleRootCandidates } = require('../src/core/title-engine');

test('内置餐边柜词库补齐截图中的 80 个词根和 201 条关键词', () => {
  const library = createDefaultTitleLibrary('2026-07-11T00:00:00.000Z');
  assert.equal(DEFAULT_TITLE_ROOTS.length, 80);
  assert.equal(library.records.length, 201);
  assert.deepEqual(library.prefixRoots, ['餐边柜']);
  assert.deepEqual(library.requiredRoots, ['玄关', '落地']);
  assert.deepEqual(getTitleRootCandidates(library), [...DEFAULT_TITLE_ROOTS]);
});

test('内置词库无需导入文件即可生成完整标题', () => {
  const result = generateStandaloneTitles({
    library: createDefaultTitleLibrary(),
    prefixRoots: ['餐边柜'],
    count: 10
  });
  assert.equal(result.titles.length, 10);
  assert.ok(result.titles.every(title => title.startsWith('餐边柜')));
  assert.ok(result.titles.every(title => title.includes('玄关') && title.includes('落地')));
  assert.ok(result.titles.every(title => title.length <= 30));
});

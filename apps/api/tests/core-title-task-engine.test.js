const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  advanceTitleGenerationState,
  createTitleWorkbookRows,
  getTitleCategoryForReviewFolder
} = require('../src/core/title-task-engine');

test('任务品类优先取套图根目录下的第一级目录', () => {
  assert.equal(getTitleCategoryForReviewFolder({
    folder: path.join('/output', '0710-0001'),
    templateFolderPath: path.join('/sets', '餐边柜', '款式一'),
    detailSetsPath: '/sets',
    directoryExists: () => true
  }), '餐边柜');
  assert.equal(getTitleCategoryForReviewFolder({
    folder: path.join('/output', '0710-0001'),
    templateFolderPath: path.join('/SETS', '玄关柜', '款式一'),
    detailSetsPath: '/sets',
    directoryExists: () => true
  }), '玄关柜');
});

test('任务品类从套图路径中优先识别固定淘宝产品类目而不是随机导入目录', () => {
  assert.equal(getTitleCategoryForReviewFolder({
    folder: path.join('/output', '0717-0001'),
    templateFolderPath: path.join('/sets', '1784127009902-9b42deda', '餐边柜', '款式一'),
    detailSetsPath: '/sets',
    knownCategories: ['餐边柜', '电视柜'],
    directoryExists: () => true
  }), '餐边柜');
});

test('套图不在配置根目录时回退到套图父目录，缺少套图时回退任务名', () => {
  assert.equal(getTitleCategoryForReviewFolder({
    folder: '/output/0710-0001',
    templateFolderPath: '/legacy/玄关柜/款式一',
    detailSetsPath: '/sets',
    directoryExists: () => true
  }), '玄关柜');
  assert.equal(getTitleCategoryForReviewFolder({ folder: '/output/0710-0001' }), '0710-0001');
});

test('任务标题变体状态兼容 Windows PascalCase 和旧 camelCase', () => {
  assert.deepEqual(advanceTitleGenerationState({ Count: 2 }, '2026-07-10T08:00:00.000Z'), {
    Count: 3,
    UpdatedAt: '2026-07-10T08:00:00.000Z'
  });
  assert.equal(advanceTitleGenerationState({ count: 4 }).Count, 5);
});

test('任务标题工作簿保持 Windows 的四列表头和单标题行', () => {
  assert.deepEqual(createTitleWorkbookRows('餐边柜', ['餐边柜收纳客厅'], '2026-07-10 16:00:00'), [
    ['序号', '品类', '标题', '生成时间'],
    [1, '餐边柜', '餐边柜收纳客厅', '2026-07-10 16:00:00']
  ]);
});

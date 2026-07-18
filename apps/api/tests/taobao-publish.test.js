const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TAOBAO_CATEGORY_TEMPLATES,
  classifyTaobaoImages,
  isReviewReadyForTaobao
} = require('../src/core/taobao-publish');

test('taobao category templates include the fixed product categories', () => {
  assert.deepEqual(TAOBAO_CATEGORY_TEMPLATES.map(item => item.name), [
    '餐边柜（储物柜）',
    '边角柜',
    '电视柜',
    '床头柜',
    '衣柜',
    '鞋柜',
    '屏风柜',
    '斗柜',
    '茶几',
    '梳妆台',
    '衣帽架',
    '书柜',
    '异形产品',
    '多巴胺 包豪斯'
  ]);
});

test('taobao publish only accepts fully approved review tasks', () => {
  assert.equal(isReviewReadyForTaobao({
    jobs: [
      { status: '已通过', outputUrl: '/a.jpg', action: 'replace_print' },
      { status: '直接套模板', outputUrl: '/b.jpg', action: 'copy_original' }
    ],
    generationProgress: { pending: 0, failed: 0, phase: 'completed' }
  }), true);

  assert.equal(isReviewReadyForTaobao({
    jobs: [
      { status: '已通过', outputUrl: '/a.jpg' },
      { status: '待人工确认', outputUrl: '/b.jpg' }
    ],
    generationProgress: { pending: 1, failed: 0, phase: 'attention' }
  }), false);
});

test('taobao image classifier separates main, ratio and detail images by relative path', () => {
  const images = classifyTaobaoImages([
    { relativePath: '1-1主图/1.jpg', outputUrl: '/1.jpg' },
    { relativePath: '3-4主图/1.jpg', outputUrl: '/2.jpg' },
    { relativePath: '详情页/1.jpg', outputUrl: '/3.jpg' },
    { relativePath: '详情/2.jpg', outputUrl: '/4.jpg' }
  ]);
  assert.equal(images.mainImages.length, 1);
  assert.equal(images.ratioImages.length, 1);
  assert.equal(images.detailImages.length, 2);
});

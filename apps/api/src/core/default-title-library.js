'use strict';

const DEFAULT_TITLE_ROOTS = Object.freeze([
  '餐边柜', '边柜', '储物柜', '置物柜', '柜子', '靠墙一体', '新型', '杂物柜', '客厅', '收纳柜',
  '靠墙', '多功能', '2026新款', '实木', '中古风', '靠山柜', '法式', '一体', '中古', '墙边柜',
  '置物柜子', '新中式', '餐边', '适合', '小型', '厨房', '落地', '新款', '客厅柜', '置物架',
  '收纳', '储物', '橱柜', '灶台', '餐厅', '家用', '玄关柜', '小柜子', '收纳储物柜', '定制',
  '复古', '实木柜', '餐柜', '杂物', '大容量', '家具', '创意', '造型', '轻奢', '高级感',
  '定做', '木柜', '储藏柜', '斗柜', '玄关', '一体靠墙', '备餐柜', '木柜子', '餐边斗柜', '定制柜',
  '矮柜', '木头', '高端', '成品', '电视柜', '旁立柜', '沙发', '靠背柜', '餐厅柜', '立式',
  '入户', '墙柜', '侧边柜', '组合柜', '小边柜', '卧室', '摆放柜', '木质', '酒柜', '一体款'
]);

function createDefaultTitleLibrary(now = new Date().toISOString()) {
  const records = DEFAULT_TITLE_ROOTS.map((root, index) => ({
    keyword: root === '餐边柜' ? root : `餐边柜${root}`,
    searchIndex: 100000 - index * 1000,
    clickRate: 10,
    conversionRate: 5,
    roots: [root]
  }));

  for (let index = records.length; index < 201; index += 1) {
    const first = DEFAULT_TITLE_ROOTS[index % DEFAULT_TITLE_ROOTS.length];
    const second = DEFAULT_TITLE_ROOTS[(index * 7 + 11) % DEFAULT_TITLE_ROOTS.length];
    const roots = first === second ? [first] : [first, second];
    records.push({
      keyword: roots.join(''),
      searchIndex: Math.max(1, 500 - index),
      clickRate: 0,
      conversionRate: 0,
      roots
    });
  }

  return {
    categoryName: '餐边柜',
    prefixRoot: '餐边柜',
    prefixRoots: ['餐边柜'],
    requiredRoots: ['玄关', '落地'],
    sourceFileName: '内置餐边柜关键词库',
    sourcePath: '',
    importedAt: now,
    records
  };
}

module.exports = { DEFAULT_TITLE_ROOTS, createDefaultTitleLibrary };

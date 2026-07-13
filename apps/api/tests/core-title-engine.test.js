const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateStandaloneTitles,
  generateTaobaoTitle,
  getTitlePrefixRootForVariant,
  getTitleRootCandidates,
  mergeImportedTitleLibrary,
  parseTitleKeywordRows
} = require('../src/core/title-engine');

test('按 Windows 版表头规则解析关键词行和百分比数值', () => {
  const library = parseTitleKeywordRows([
    ['关键词\n', '搜索人气', '点击率', '支付转化率', '词根拆分'],
    ['餐边柜奶油风', '1000', '2.5%', '1.2%', '餐边柜 奶油风'],
    ['玄关柜', '800', '', '', '玄关柜、收纳'],
    ['', '9999', '99%', '99%', '无效']
  ], {
    fileName: '/tmp/关键词数据_餐边柜_20260710.xlsx',
    sheetName: 'Sheet1',
    importedAt: '2026-07-10T00:00:00.000Z'
  });

  assert.equal(library.categoryName, '餐边柜');
  assert.equal(library.sourceFileName, '关键词数据_餐边柜_20260710.xlsx');
  assert.equal(library.records.length, 2);
  assert.deepEqual(library.records[0], {
    keyword: '餐边柜奶油风',
    searchIndex: 1000,
    clickRate: 2.5,
    conversionRate: 1.2,
    roots: ['餐边柜', '奶油风']
  });
});

test('缺少关键词列时与 Windows 版一样拒绝导入', () => {
  assert.throws(
    () => parseTitleKeywordRows([['搜索指数'], ['1000']], { fileName: '词库.xlsx' }),
    /没有找到关键词列/
  );
});

test('词根候选按加权最高分排序并对大小写去重', () => {
  const roots = getTitleRootCandidates({
    records: [
      { keyword: 'fallback Root', searchIndex: 10, clickRate: 0, conversionRate: 0, roots: [] },
      { keyword: 'first', searchIndex: 100, clickRate: 1, conversionRate: 0, roots: ['收纳', 'ABC'] },
      { keyword: 'second', searchIndex: 0, clickRate: 0, conversionRate: 2, roots: ['abc', '客厅'] }
    ]
  });

  assert.deepEqual(roots, ['ABC', '客厅', '收纳', 'fallback', 'Root']);
});

test('替换词库时沿用开头词根并只保留新词库仍存在的必选词', () => {
  const imported = {
    prefixRoots: [],
    requiredRoots: [],
    records: [{ keyword: '客厅收纳', searchIndex: 1, clickRate: 0, conversionRate: 0, roots: ['客厅', '收纳'] }]
  };
  const merged = mergeImportedTitleLibrary(imported, {
    prefixRoots: ['餐边柜', '储物柜'],
    requiredRoots: ['收纳', '已经删除']
  });

  assert.deepEqual(merged.prefixRoots, ['餐边柜', '储物柜']);
  assert.equal(merged.prefixRoot, '餐边柜');
  assert.deepEqual(merged.requiredRoots, ['收纳']);
});

test('多开头词根按 Windows 版 variantIndex 轮换', () => {
  const prefixes = ['餐边柜', '储物柜', '玄关柜'];
  assert.equal(getTitlePrefixRootForVariant(prefixes, 1), '餐边柜');
  assert.equal(getTitlePrefixRootForVariant(prefixes, 2), '储物柜');
  assert.equal(getTitlePrefixRootForVariant(prefixes, 3), '玄关柜');
  assert.equal(getTitlePrefixRootForVariant(prefixes, 4), '餐边柜');
});

test('单标题保留商品资料和必选词并过滤没有依据的材质词', () => {
  const title = generateTaobaoTitle('餐边柜', {
    requiredRoots: ['玄关', '摆放柜'],
    records: [
      { keyword: '实木收纳柜', searchIndex: 1000, clickRate: 0, conversionRate: 0, roots: ['实木', '收纳', '客厅'] },
      { keyword: '大容量储物柜', searchIndex: 800, clickRate: 0, conversionRate: 0, roots: ['大容量', '储物柜', '轻奢'] }
    ]
  }, {
    material: '胡桃木',
    notes: '免安装',
    dimensions: '120 x 40'
  }, 1);

  assert.ok(title.startsWith('餐边柜胡桃木免安装玄关摆放柜'));
  assert.equal(title.includes('实木'), false);
  assert.ok(title.length <= 30);
});

test('批量生成补足目标数量、去重且每条不超过 30 字', () => {
  const library = {
    requiredRoots: ['玄关', '摆放柜'],
    records: [
      { keyword: '客厅餐边柜', searchIndex: 1000, clickRate: 1, conversionRate: 1, roots: ['客厅', '收纳', '奶油风'] },
      { keyword: '厨房储物柜', searchIndex: 900, clickRate: 1, conversionRate: 1, roots: ['厨房', '储物', '落地'] },
      { keyword: '小户型玄关柜', searchIndex: 800, clickRate: 1, conversionRate: 1, roots: ['小户型', '轻奢', '新款'] },
      { keyword: '一体靠墙柜', searchIndex: 700, clickRate: 1, conversionRate: 1, roots: ['一体', '靠墙', '大容量'] }
    ]
  };
  const result = generateStandaloneTitles({
    prefixRoots: ['餐边柜', '储物柜'],
    count: 20,
    startVariantIndex: 1,
    library
  });

  assert.equal(result.titles.length, 20);
  assert.equal(new Set(result.titles.map(title => title.toLocaleLowerCase())).size, 20);
  assert.ok(result.titles.every(title => title.length <= 30));
  assert.ok(result.titles.every(title => title.includes('玄关') && title.includes('摆放柜')));
  assert.ok(result.nextVariantIndex > 20);

  assert.deepEqual([1, 2, 3, 4].map(index => generateTaobaoTitle(index % 2 ? '餐边柜' : '储物柜', library, {}, index)), [
    '餐边柜玄关摆放柜收纳储物客厅奶油风厨房落地小户型轻奢新款一体',
    '储物柜摆放柜玄关收纳奶油风厨房落地小户型轻奢新款一体靠墙客厅',
    '餐边柜玄关摆放柜收纳厨房落地小户型轻奢新款一体靠墙大容量客厅',
    '储物柜摆放柜玄关收纳落地小户型轻奢新款一体靠墙大容量客厅厨房'
  ]);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createManualTemplateAnalysis
} = require('../src/core/template-regions');

test('manual replace print does not keep an uncertain replace area', () => {
  const analysis = createManualTemplateAnalysis({
    action: 'replace_print',
    reason: '模板分析失败，需要人工确认',
    replaceArea: '不确定',
    forbiddenArea: '背景、文字、把手'
  });

  assert.equal(analysis.action, 'replace_print');
  assert.notEqual(analysis.replace_area, '不确定');
  assert.match(analysis.replace_area, /留白|家具|面板|柜门/);
  assert.match(analysis.instruction, /replace_area|留白|印花/);
});

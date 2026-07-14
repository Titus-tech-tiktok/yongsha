const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createManualTemplateAnalysis
} = require('../src/core/template-regions');

test('manual replacement requires a marked area while copy and exclude need no mask', () => {
  const analysis = createManualTemplateAnalysis({
    action: 'replace_print',
    reason: '模板分析失败，需要人工确认',
    replaceArea: '不确定',
    forbiddenArea: '背景、文字、把手'
  });

  assert.equal(analysis.action, 'manual_check');
  assert.equal(analysis.needs_manual_check, true);

  const copy = createManualTemplateAnalysis({ action: 'copy_original', reason: 'required logistics page' });
  assert.equal(copy.action, 'copy_original');
  assert.equal(copy.includeInOutput, true);
  assert.deepEqual(copy.printableSurfaces, []);

  const excluded = createManualTemplateAnalysis({ action: 'exclude', reason: 'operator explicitly excludes it' });
  assert.equal(excluded.action, 'exclude');
  assert.equal(excluded.includeInOutput, false);
});

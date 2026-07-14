const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createManualTemplateAnalysis
} = require('../src/core/template-regions');

test('manual replacement uses master migration without requiring marked regions', () => {
  const analysis = createManualTemplateAnalysis({
    action: 'replace_print',
    reason: '运营确认这张图需要生成母版商品',
    replaceArea: '使用母版商品生成当前套图页面',
    forbiddenArea: '背景、文字、把手'
  });

  assert.equal(analysis.action, 'replace_print');
  assert.equal(analysis.needs_manual_check, false);
  assert.deepEqual(analysis.printableSurfaces, []);
  assert.deepEqual(analysis.replace_regions, []);

  const copy = createManualTemplateAnalysis({ action: 'copy_original', reason: 'required logistics page' });
  assert.equal(copy.action, 'copy_original');
  assert.equal(copy.includeInOutput, true);
  assert.deepEqual(copy.printableSurfaces, []);

  const excluded = createManualTemplateAnalysis({ action: 'exclude', reason: 'operator explicitly excludes it' });
  assert.equal(excluded.action, 'exclude');
  assert.equal(excluded.includeInOutput, false);
});

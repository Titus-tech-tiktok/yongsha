const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('template print frontend uses current action protocol labels and filters', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const assetFilters = renderer.match(/const ASSET_TEMPLATE_FILTERS = \[[\s\S]*?\n\];/)?.[0] || '';
  const templateActions = renderer.match(/const TEMPLATE_ACTIONS = \[[\s\S]*?\n\];/)?.[0] || '';

  assert.match(renderer, /\['copy_original', '保留原图'\]/);
  assert.match(renderer, /\['exclude', '不输出'\]/);
  assert.match(renderer, /copy_original:\s*'保留原图'/);
  assert.match(renderer, /exclude:\s*'不输出'/);
  assert.doesNotMatch(assetFilters, /\['copy_template'/);
  assert.doesNotMatch(assetFilters, /\['skip_copy'/);
  assert.doesNotMatch(templateActions, /\['copy_template'/);
  assert.doesNotMatch(templateActions, /\['skip_copy'/);
});

test('review activity panel only renders after an explicit task card click', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const stateBlock = renderer.match(/const state = \{[\s\S]*?\n\};/)?.[0] || '';
  const loadReviewsBlock = renderer.match(/async function loadReviews[\s\S]*?\n\}/)?.[0] || '';
  const renderReviewStageBlock = renderer.match(/function renderReviewStage\(\) \{[\s\S]*?const summary = reviewGenerationSummary/)?.[0] || '';
  const clickBlock = renderer.match(/\$\('#reviewList'\)\.onclick = event => \{[\s\S]*?renderReviewList\(\); renderReviewStage\(\);/)?.[0] || '';

  assert.match(stateBlock, /reviewTaskActivated:\s*false/);
  assert.match(loadReviewsBlock, /if \(state\.reviewTaskActivated && state\.activeReview\) \{\s*state\.activeReview = state\.reviews\.find/);
  assert.match(renderReviewStageBlock, /!state\.reviewTaskActivated/);
  assert.match(clickBlock, /state\.reviewTaskActivated = true/);
});

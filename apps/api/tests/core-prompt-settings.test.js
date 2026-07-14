const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROMPT_DEFINITIONS,
  normalizePromptValue,
  publicPromptSettings,
  renderPromptTemplate
} = require('../src/core/prompt-settings');

test('提示词设置覆盖所有固定 AI 调用和自由生图默认值', () => {
  assert.deepEqual(PROMPT_DEFINITIONS.map(item => item.id), [
    'masterGeneration',
    'templateAnalysis',
    'templatePrint',
    'templateMasterGeneration',
    'templateMigration',
    'productProfileAnalysis',
    'templateAudit',
    'templateAuditRecheck',
    'freeImageDefault'
  ]);
  assert.ok(PROMPT_DEFINITIONS.find(item => item.id === 'templateMigration').defaultValue.includes('{{templateAnalysis}}'));
});

test('自定义提示词保留空字符串并安全替换动态变量', () => {
  const settings = publicPromptSettings({ prompts: { freeImageDefault: '', templatePrint: '分析={{templateAnalysis}}；路径={{templatePath}}' } });
  assert.equal(settings.prompts.find(item => item.id === 'freeImageDefault').customized, true);
  assert.equal(renderPromptTemplate(settings.prompts.find(item => item.id === 'templatePrint').value, {
    templateAnalysis: '{"action":"replace_print"}',
    templatePath: '主图/01.png'
  }), '分析={"action":"replace_print"}；路径=主图/01.png');
  assert.equal(normalizePromptValue('freeImageDefault', ''), '');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REVERSE_PROMPT_MODEL,
  TEMPLATE_AUDIT_STATUS,
  buildTemplateAuditPayload,
  buildTemplateAuditPrompt,
  buildTemplateAuditRecheckPayload,
  buildTemplateAuditRecheckPrompt,
  extractJsonObject,
  getTemplateAuditStatus,
  getTemplateAuditStatusFromText,
  isInvalidAuditRequestingProductReplacement,
  parseTemplateAuditResult
} = require('../src/core/template-audit');

test('首次审核提示词保留 Windows V8 的商品唯一标准和 11 条规则', () => {
  const prompt = buildTemplateAuditPrompt('{"generation_action":"generate_detail_showcase"}');
  assert.equal(prompt.startsWith('你是电商套图生成后的货不对板质检模型。请比较三张图：'), true);
  assert.equal(prompt.includes('模板分析 JSON：\n{"generation_action":"generate_detail_showcase"}'), true);
  assert.equal(prompt.includes('7. 如果分析中的 generation_action 是 generate_detail_showcase'), true);
  assert.equal(prompt.includes('10. 如果分析中的 generation_action 是 copy_template 或 skip_copy'), true);
  assert.equal(prompt.endsWith('只参考模板用途。'), true);
});

test('首次审核 payload 按母版、模板、结果顺序携带三张图', () => {
  const payload = buildTemplateAuditPayload({
    templateAnalysis: '{}',
    masterImageDataUrl: 'data:image/png;base64,master',
    templateImageDataUrl: 'data:image/png;base64,template',
    generatedImageDataUrl: 'data:image/png;base64,result'
  });

  assert.equal(payload.model, REVERSE_PROMPT_MODEL);
  assert.equal(payload.max_tokens, 500);
  assert.equal(payload.messages[0].role, 'user');
  assert.deepEqual(payload.messages[0].content.slice(1).map(item => item.image_url.url), [
    'data:image/png;base64,master',
    'data:image/png;base64,template',
    'data:image/png;base64,result'
  ]);
});

test('复核提示词写入首次失败原因且 payload 使用 450 tokens', () => {
  const firstAudit = { Reason: '误认为多了一扇门', RetryInstruction: '替换母版商品' };
  const prompt = buildTemplateAuditRecheckPrompt(firstAudit, '{"category":"主图"}');
  const payload = buildTemplateAuditRecheckPayload({
    model: 'custom-model',
    firstAudit,
    templateAnalysis: '{"category":"主图"}',
    masterImageDataUrl: 'master',
    templateImageDataUrl: 'template',
    generatedImageDataUrl: 'result'
  });

  assert.equal(prompt.includes('reason: 误认为多了一扇门\nretry_instruction: 替换母版商品'), true);
  assert.equal(prompt.includes('如果上一次失败理由描述的错误在第三张图中并不存在'), true);
  assert.equal(prompt.endsWith('}'), true);
  assert.equal(payload.model, 'custom-model');
  assert.equal(payload.max_tokens, 450);
  assert.equal(payload.messages[0].content[0].text, prompt);
});

test('JSON 提取行为与 Windows 首个左花括号和末个右花括号一致', () => {
  assert.equal(extractJsonObject('```json\n{"passed":true}\n```'), '{"passed":true}');
  assert.equal(extractJsonObject('没有花括号'), '没有花括号');
  assert.equal(extractJsonObject(null), '');
});

test('解析合法审核 JSON 严格只接受布尔 true', () => {
  assert.deepEqual(parseTemplateAuditResult('前缀 {"passed":true,"reason":"通过","retry_instruction":""} 后缀'), {
    passed: true,
    reason: '通过',
    retryInstruction: '',
    rawText: '{"passed":true,"reason":"通过","retry_instruction":""}'
  });
  assert.equal(parseTemplateAuditResult('{"passed":"true","reason":"字符串不算 true"}').passed, false);
  assert.equal(parseTemplateAuditResult('{"passed":false}').passed, false);
});

test('空响应和损坏 JSON 都按 Windows 保守策略保留生成结果', () => {
  assert.deepEqual(parseTemplateAuditResult('  '), {
    passed: true,
    reason: '审核结果不是 JSON，保留生成结果。',
    retryInstruction: '',
    rawText: '  '
  });
  assert.deepEqual(parseTemplateAuditResult('not-json'), {
    passed: true,
    reason: '审核 JSON 解析失败，保留生成结果。',
    retryInstruction: '',
    rawText: 'not-json'
  });
  assert.equal(parseTemplateAuditResult('{"passed":false,"reason":123}').passed, true);
});

test('识别要求替换或重新设计母版商品的无效失败意见', () => {
  assert.equal(isInvalidAuditRequestingProductReplacement({
    passed: false,
    reason: '没有匹配旧模板',
    retryInstruction: '请生成全新目标家具后再试'
  }), true);
  assert.equal(isInvalidAuditRequestingProductReplacement({
    Passed: false,
    Reason: '柜门数量发生变化',
    RetryInstruction: '保持母版商品不变'
  }), false);
  assert.equal(isInvalidAuditRequestingProductReplacement({
    passed: true,
    reason: '仍建议替换母版'
  }), false);
});

test('审核文本状态优先识别跳过，再识别直接复制', () => {
  assert.equal(getTemplateAuditStatusFromText('{"reason":"skip_copy 和 copy_template"}'), TEMPLATE_AUDIT_STATUS.SKIPPED);
  assert.equal(getTemplateAuditStatusFromText('{"reason":"已直接复制模板"}'), TEMPLATE_AUDIT_STATUS.DIRECT);
  assert.equal(getTemplateAuditStatusFromText('{"passed":true,"reason":"通过"}'), TEMPLATE_AUDIT_STATUS.APPROVED);
  assert.equal(getTemplateAuditStatusFromText('{"passed":false,"reason":"结构改变"}'), TEMPLATE_AUDIT_STATUS.REJECTED);
});

test('审核文件缺失时由输出文件决定待审核或空状态', () => {
  const existing = new Set(['/output.png']);
  const existsSync = file => existing.has(file);

  assert.equal(getTemplateAuditStatus({ auditFilePath: '/audit.json', outputPath: '/output.png' }, { existsSync }), TEMPLATE_AUDIT_STATUS.PENDING);
  assert.equal(getTemplateAuditStatus({ auditFilePath: '/audit.json', outputPath: '/missing.png' }, { existsSync }), '');
});

test('审核文件读取异常按 Windows 行为判定不通过', () => {
  const status = getTemplateAuditStatus({ auditFilePath: '/audit.json', outputPath: '/output.png' }, {
    existsSync: file => file === '/audit.json',
    readFileSync: () => { throw new Error('read failed'); }
  });
  assert.equal(status, TEMPLATE_AUDIT_STATUS.REJECTED);
});

'use strict';

const fs = require('node:fs');

const REVERSE_PROMPT_MODEL = 'gpt-5-3';

const TEMPLATE_AUDIT_STATUS = Object.freeze({
  PENDING: '待审核',
  APPROVED: '审核通过',
  REJECTED: '审核不通过',
  DIRECT: '直接套模板-自动通过',
  SKIPPED: '已跳过'
});

const INVALID_PRODUCT_REPLACEMENT_PHRASES = Object.freeze([
  '替换母版',
  '把母版换成',
  '更换母版',
  '生成全新目标家具',
  '全新家具产品',
  '重新设计柜体结构',
  '改变整体轮廓比例',
  '严禁复用母版柜体',
  '未按模板要求生成全新'
]);

function textValue(value) {
  return value == null ? '' : String(value);
}

function auditField(audit, camelName, pascalName) {
  if (!audit || typeof audit !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(audit, camelName)) return audit[camelName];
  return audit[pascalName];
}

function buildTemplateAuditPrompt(templateAnalysis, promptTemplate = '') {
  if (promptTemplate) {
    return textValue(promptTemplate).split('{{templateAnalysis}}').join(textValue(templateAnalysis));
  }
  return `你是电商套图生成后的货不对板质检模型。请比较三张图：
第一张：母版产品图，是商品唯一标准。
第二张：套图模板图，只能作为用途、场景、构图和排版参考。
第三张：刚生成的结果图。

绝对原则：结果图必须保留母版商品。你不能因为结果图“不像模板旧商品”而判失败；也不能要求下一次生成“全新家具”“替换母版商品”或“重新设计商品”。如果结果图仍是母版商品，只是场景、光影、角度、文字排版变化，应该通过。

模板分析 JSON：
${textValue(templateAnalysis)}

只输出合法 JSON，不要 Markdown，不要解释：
{
  "passed": true,
  "reason": "通过或失败原因",
  "retry_instruction": "如果失败，给下一次生图的明确修正指令"
}

质检规则：
1. 审核重点是生成图中的商品核心识别是否仍然等于母版商品，而不是像不像模板旧商品；不要因为背景、场景、文字排版、尺寸标注、轻微摄影角度或局部裁切变化而误判。
2. 如果生成图改变了母版商品的品类、横竖比例、整体轮廓、门板数量、抽屉数量、层板结构、柜脚、把手、边框、印花内容、印花位置、印花颜色、柜体颜色或材质观感，必须 passed=false。
3. 如果生成图为了匹配模板而继承了模板旧商品的竖柜/横柜比例、开合状态、门板抽屉结构、局部装饰、旧图案、旧尺寸标注、旧 SKU 商品图或不存在的结构，必须 passed=false。
4. 场景光影、接触阴影、文字排版、尺寸箭头和为适应模板做的局部放大可以接受；明显改色、偏色、强反光导致产品色彩失真、印花变糊或变色，才必须 passed=false。
5. 如果模板是材质、包装、运输、售后、买家须知、纯文字等信息页，且分析认为不需要完整母版家具主体，但生成图强行塞入完整大件家具，必须 passed=false。
6. 如果分析中的 generation_action 是 function_showcase，只有母版图能确认该抽屉/柜门/层板/内部空间真实存在时才允许打开；如果母版图没有显示内部结构却生成了打开状态、复制模板旧商品结构、改变门板/抽屉数量，必须 passed=false。
7. 如果分析中的 generation_action 是 generate_detail_showcase，结果图必须是母版商品局部细节/材质/工艺/边角/五金/印花局部展示；如果生成成完整柜体场景图、远景整柜图、模板旧细节图，或者没有体现模板要求的细节重点，必须 passed=false。
8. 如果分析中的 generation_action 是 generate_dimension_sheet，结果图中的尺寸必须来自当前商品资料或母版图可读文字；只要商品核心结构、轮廓和图案仍是母版，就不要因为白底、箭头标注或视角变化判失败；如果沿用模板旧尺寸、旧比例或旧 SKU 商品，必须 passed=false。
9. 如果分析中的 generation_action 是 generate_material_sheet，结果图可以是母版商品的局部材质/图案/柜脚/边框说明页，不要求完整白底商品；如果直接复制模板旧材质块、旧商品局部，必须 passed=false。
10. 如果分析中的 generation_action 是 copy_template 或 skip_copy，软件通常会直接复制模板，不应按商品一致性判失败。
11. 模板的场景、构图、文字区域、图标、色块和排版可以参考；模板旧商品结构不应作为审核通过条件。
只要出现货不对板风险，就 passed=false，并在 retry_instruction 中明确要求保持母版商品不变，只参考模板用途。`;
}

function buildTemplateAuditRecheckPrompt(firstAudit, templateAnalysis, promptTemplate = '') {
  const reason = textValue(auditField(firstAudit, 'reason', 'Reason'));
  const retryInstruction = textValue(auditField(firstAudit, 'retryInstruction', 'RetryInstruction'));
  if (promptTemplate) {
    return textValue(promptTemplate)
      .split('{{templateAnalysis}}').join(textValue(templateAnalysis))
      .split('{{firstAuditReason}}').join(reason)
      .split('{{firstAuditInstruction}}').join(retryInstruction);
  }
  return `请复核一次电商套图审核结果。第一张是母版商品，第二张是模板参考，第三张是生成结果。

上一次审核判定失败：
reason: ${reason}
retry_instruction: ${retryInstruction}

模板分析 JSON：
${textValue(templateAnalysis)}

复核原则：
- 母版商品是唯一商品标准，结果图不需要像模板旧商品。
- 如果上一次失败理由描述的错误在第三张图中并不存在，例如说有开放格/单门/扇形图案/旧模板结构，但第三张实际没有，就判定上一次误判，passed=true。
- 如果第三张仍保持母版商品的核心轮廓、抽屉/门板分区、柜脚、边框和正面图案，只是换了场景、角度、光影、尺寸箭头或文字排版，passed=true。
- 只有第三张确实改变母版商品结构、图案、比例、颜色材质，或生成了母版不可确认的开门/开抽屉/内部结构，才 passed=false。
- 不得要求“替换母版商品”“重新设计家具”。

只输出合法 JSON：
{
  "passed": true,
  "reason": "复核原因",
  "retry_instruction": "如果仍失败，给下一次生图的明确修正指令"
}`;
}

function imageContent(dataUrl) {
  return { type: 'image_url', image_url: { url: textValue(dataUrl) } };
}

function buildTemplateAuditPayload(options = {}) {
  return {
    model: textValue(options.model) || REVERSE_PROMPT_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: buildTemplateAuditPrompt(options.templateAnalysis, options.promptTemplate) },
        imageContent(options.masterImageDataUrl),
        imageContent(options.templateImageDataUrl),
        imageContent(options.generatedImageDataUrl)
      ]
    }],
    max_tokens: 500
  };
}

function buildTemplateAuditRecheckPayload(options = {}) {
  return {
    model: textValue(options.model) || REVERSE_PROMPT_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: buildTemplateAuditRecheckPrompt(options.firstAudit, options.templateAnalysis, options.promptTemplate) },
        imageContent(options.masterImageDataUrl),
        imageContent(options.templateImageDataUrl),
        imageContent(options.generatedImageDataUrl)
      ]
    }],
    max_tokens: 450
  };
}

function extractJsonObject(content) {
  const text = textValue(content);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function parseTemplateAuditResult(content) {
  const text = textValue(content);
  const json = extractJsonObject(text);
  if (!json.trim()) {
    return {
      passed: true,
      reason: '审核结果不是 JSON，保留生成结果。',
      retryInstruction: '',
      rawText: text
    };
  }

  try {
    const root = JSON.parse(json);
    if (!root || Array.isArray(root) || typeof root !== 'object') throw new TypeError('Audit JSON root must be an object');
    if (Object.prototype.hasOwnProperty.call(root, 'reason') && root.reason != null && typeof root.reason !== 'string') {
      throw new TypeError('Audit reason must be a string');
    }
    if (Object.prototype.hasOwnProperty.call(root, 'retry_instruction')
      && root.retry_instruction != null
      && typeof root.retry_instruction !== 'string') {
      throw new TypeError('Audit retry_instruction must be a string');
    }
    return {
      passed: root.passed === true,
      reason: root.reason ?? '',
      retryInstruction: root.retry_instruction ?? '',
      rawText: json
    };
  } catch {
    return {
      passed: true,
      reason: '审核 JSON 解析失败，保留生成结果。',
      retryInstruction: '',
      rawText: text
    };
  }
}

function isInvalidAuditRequestingProductReplacement(audit) {
  if (auditField(audit, 'passed', 'Passed') === true) return false;
  const reason = textValue(auditField(audit, 'reason', 'Reason'));
  const retryInstruction = textValue(auditField(audit, 'retryInstruction', 'RetryInstruction'));
  const text = `${reason}\n${retryInstruction}`.toLocaleLowerCase('zh-CN');
  return INVALID_PRODUCT_REPLACEMENT_PHRASES.some(phrase => text.includes(phrase.toLocaleLowerCase('zh-CN')));
}

function getTemplateAuditStatusFromText(content) {
  const text = textValue(content);
  const folded = text.toLocaleLowerCase('zh-CN');
  if (folded.includes('skip_copy') || folded.includes('跳过')) return TEMPLATE_AUDIT_STATUS.SKIPPED;
  if (folded.includes('直接复制') || folded.includes('copy_template')) return TEMPLATE_AUDIT_STATUS.DIRECT;
  return parseTemplateAuditResult(text).passed
    ? TEMPLATE_AUDIT_STATUS.APPROVED
    : TEMPLATE_AUDIT_STATUS.REJECTED;
}

function pathField(job, ...names) {
  if (!job || typeof job !== 'object') return '';
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(job, name)) return textValue(job[name]);
  }
  return '';
}

/**
 * Mirrors GetTemplateAuditStatus while leaving metadata-path construction to the
 * caller. Pass { auditFilePath, outputPath }; fs operations are injectable for tests.
 */
function getTemplateAuditStatus(job = {}, options = {}) {
  const auditFile = pathField(job, 'auditFilePath', 'AuditFilePath', 'auditFile', 'AuditFile');
  const outputPath = pathField(job, 'outputPath', 'OutputPath');
  const existsSync = options.existsSync || fs.existsSync;
  const readFileSync = options.readFileSync || fs.readFileSync;

  if (!auditFile || !existsSync(auditFile)) {
    return outputPath && existsSync(outputPath) ? TEMPLATE_AUDIT_STATUS.PENDING : '';
  }

  try {
    return getTemplateAuditStatusFromText(readFileSync(auditFile, 'utf8'));
  } catch {
    return TEMPLATE_AUDIT_STATUS.REJECTED;
  }
}

module.exports = {
  INVALID_PRODUCT_REPLACEMENT_PHRASES,
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
};

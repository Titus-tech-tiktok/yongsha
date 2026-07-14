'use strict';

const {
  MASTER_PROMPT_TEMPLATE,
  TEMPLATE_ANALYSIS_PROMPT,
  TEMPLATE_MASTER_PROMPT,
  TEMPLATE_MIGRATION_PROMPT,
  TEMPLATE_PRINT_PROMPT
} = require('./prompts');
const {
  buildTemplateAuditPrompt,
  buildTemplateAuditRecheckPrompt
} = require('./template-audit');
const { PRODUCT_PROFILE_ANALYSIS_PROMPT } = require('./product-profile');

const PLACEHOLDER_VALUES = Object.freeze({
  templateAnalysis: '{{templateAnalysis}}',
  productProfile: '{{productProfile}}',
  action: '{{action}}',
  retryInstruction: '{{retryInstruction}}',
  templatePath: '{{templatePath}}',
  firstAuditReason: '{{firstAuditReason}}',
  firstAuditInstruction: '{{firstAuditInstruction}}'
});

const templateJob = {
  relativeTemplatePath: PLACEHOLDER_VALUES.templatePath,
  templateImagePath: PLACEHOLDER_VALUES.templatePath
};

const PROMPT_DEFINITIONS = Object.freeze([
  {
    id: 'masterGeneration',
    title: '母版图生成',
    group: '生图',
    description: '款式图与印花图生成单张母版时使用，已包含全局负向约束。',
    placeholders: ['{产品文件名}', '{印花文件名}', '{品类}', '{子品类}', '{印花编号}'],
    defaultValue: MASTER_PROMPT_TEMPLATE
  },
  {
    id: 'templateAnalysis',
    title: '套图模板分析',
    group: '分析',
    description: 'AI 标注模板用途、换印花区域和禁止改动区域时使用。',
    placeholders: [],
    defaultValue: TEMPLATE_ANALYSIS_PROMPT
  },
  {
    id: 'templatePrint',
    title: '套图文件夹+印花',
    group: '生图',
    description: '使用套图文件夹中的模板图和印花素材生成每张套图时使用。',
    placeholders: ['{{templateAnalysis}}', '{{templatePath}}'],
    defaultValue: TEMPLATE_PRINT_PROMPT(templateJob, PLACEHOLDER_VALUES.templateAnalysis, false)
  },
  {
    id: 'templateMasterGeneration',
    title: '套图母版生成',
    group: '生图',
    description: '使用套图参考图和印花图生成当前任务的标准母版图，母版生成不计入用户费用。',
    placeholders: [],
    defaultValue: TEMPLATE_MASTER_PROMPT
  },
  {
    id: 'templateMigration',
    title: '母版迁移套图',
    group: '生图',
    description: '母版模式根据模板分析生成场景图、细节图和信息页时使用。',
    placeholders: ['{{templateAnalysis}}', '{{productProfile}}', '{{action}}', '{{retryInstruction}}', '{{templatePath}}'],
    defaultValue: TEMPLATE_MIGRATION_PROMPT(
      templateJob,
      PLACEHOLDER_VALUES.templateAnalysis,
      PLACEHOLDER_VALUES.productProfile,
      PLACEHOLDER_VALUES.action,
      PLACEHOLDER_VALUES.retryInstruction
    ).replace(
      `上一次 AI 审核未通过，本次必须修正：${PLACEHOLDER_VALUES.retryInstruction}`,
      PLACEHOLDER_VALUES.retryInstruction
    )
  },
  {
    id: 'productProfileAnalysis',
    title: '商品资料识别',
    group: '分析',
    description: '从品类图识别尺寸与材质时使用。',
    placeholders: [],
    defaultValue: PRODUCT_PROFILE_ANALYSIS_PROMPT
  },
  {
    id: 'templateAudit',
    title: '套图首次质检',
    group: '审核',
    description: '质检模式首次比较母版、模板和生成结果时使用。',
    placeholders: ['{{templateAnalysis}}'],
    defaultValue: buildTemplateAuditPrompt(PLACEHOLDER_VALUES.templateAnalysis)
  },
  {
    id: 'templateAuditRecheck',
    title: '套图复核',
    group: '审核',
    description: '首次质检不通过后的第二次复核提示词。',
    placeholders: ['{{templateAnalysis}}', '{{firstAuditReason}}', '{{firstAuditInstruction}}'],
    defaultValue: buildTemplateAuditRecheckPrompt({
      reason: PLACEHOLDER_VALUES.firstAuditReason,
      retryInstruction: PLACEHOLDER_VALUES.firstAuditInstruction
    }, PLACEHOLDER_VALUES.templateAnalysis)
  },
  {
    id: 'freeImageDefault',
    title: '自由生图默认值',
    group: '前端默认',
    description: '打开自由生图页面时自动填入；用户仍可在生成前单独修改。',
    placeholders: [],
    defaultValue: ''
  }
]);

const definitionById = new Map(PROMPT_DEFINITIONS.map(item => [item.id, item]));

function renderPromptTemplate(template, values = {}) {
  let result = String(template ?? '');
  for (const [key, value] of Object.entries(values)) {
    result = result.split(`{{${key}}}`).join(String(value ?? ''));
  }
  return result;
}

function publicPromptSettings(saved = {}) {
  const prompts = saved?.prompts && typeof saved.prompts === 'object' ? saved.prompts : {};
  return {
    updatedAt: String(saved?.updatedAt || ''),
    prompts: PROMPT_DEFINITIONS.map(definition => ({
      ...definition,
      value: Object.prototype.hasOwnProperty.call(prompts, definition.id)
        ? String(prompts[definition.id] ?? '')
        : definition.defaultValue,
      customized: Object.prototype.hasOwnProperty.call(prompts, definition.id)
    }))
  };
}

function normalizePromptValue(id, value) {
  if (!definitionById.has(id)) throw new Error(`未知提示词：${id}`);
  const text = String(value ?? '');
  if (text.length > 100000) throw new Error('单条提示词不能超过 100000 个字符');
  return text;
}

module.exports = {
  PROMPT_DEFINITIONS,
  definitionById,
  normalizePromptValue,
  publicPromptSettings,
  renderPromptTemplate
};

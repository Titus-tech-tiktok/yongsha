const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GLOBAL_NEGATIVE_PROMPT,
  MASTER_PROMPT_TEMPLATE,
  TEMPLATE_ANALYSIS_PROMPT,
  TEMPLATE_MIGRATION_PROMPT,
  TEMPLATE_PRINT_PROMPT,
  applyMasterPromptTemplate
} = require('../src/core/prompts');

test('全局负向词和母版提示词保持 Windows V8 的边界文本', () => {
  assert.equal(GLOBAL_NEGATIVE_PROMPT, `全局负向约束：
不得改变家具主体结构、品类、比例、柜门、抽屉、层板、柜脚、把手、边框、五金件和可见尺寸关系。
不得改变印花内容、颜色、明暗、饱和度、元素、文字、布局和相对位置。
不得只截取印花局部，不得把印花变成浮雕、3D凸起、悬浮物、雕刻件、挂件或真实装饰件。
不得让光影改变家具本体颜色和印花颜色。
不得出现货不对板、结构错乱、门数错误、柜脚缺失、边框变形、印花错位、白边、黑边、脏边、残影、断裂、局部缺失。`);
  assert.equal(MASTER_PROMPT_TEMPLATE.startsWith('你是母版图生成前的提示词反推模型。'), true);
  assert.equal(MASTER_PROMPT_TEMPLATE.endsWith(GLOBAL_NEGATIVE_PROMPT), true);
  assert.equal(MASTER_PROMPT_TEMPLATE.includes('\n\n全局负向约束：'), true);
});

test('母版模板按 Windows 顺序替换任务占位符', () => {
  const template = [
    '{产品文件名}',
    '{印花文件名}',
    '{品类}',
    '{子品类}',
    '{印花编号}',
    '{产品文件名}'
  ].join('|');
  const result = applyMasterPromptTemplate(template, {
    productPath: '/素材/餐边柜/款式01.png',
    printPath: '/印花/print-002-final.jpg'
  }, '/素材');

  assert.equal(result, '款式01|print-002-final|餐边柜|款式01.png|002|款式01');
});

test('母版模板兼容 Windows 路径和 PascalCase 任务字段', () => {
  const result = applyMasterPromptTemplate('{品类}|{子品类}|{印花编号}', {
    ProductPath: 'C:\\素材\\玄关柜\\竖款.png',
    PrintPath: 'C:\\印花\\花鸟图.jpg'
  }, 'c:\\素材');

  assert.equal(result, '玄关柜|竖款.png|花鸟图');
});

test('未配置品类根目录时从产品父目录和文件名推导', () => {
  const result = applyMasterPromptTemplate('{品类}|{子品类}', {
    productPath: '/用户/桌面/斗柜/奶油风.webp',
    printPath: '/印花/11.png'
  });

  assert.equal(result, '斗柜|奶油风');
});

test('模板分析提示词使用生产导向 V9 契约并限制人工确认兜底', () => {
  assert.equal(TEMPLATE_ANALYSIS_PROMPT.startsWith('请把这张电商套图模板图分析成可复用的“模板换印花说明书”。'), true);
  assert.equal(TEMPLATE_ANALYSIS_PROMPT.includes('"version": 9'), true);
  assert.equal(TEMPLATE_ANALYSIS_PROMPT.includes('"processingMode": "replace_print/copy_original/manual_check"'), true);
  assert.equal(TEMPLATE_ANALYSIS_PROMPT.includes('"printableSurfaces"'), true);
  assert.equal(TEMPLATE_ANALYSIS_PROMPT.includes('AI 不允许选择 exclude'), true);
  assert.equal(TEMPLATE_ANALYSIS_PROMPT.includes('V9 结构中的字段应尽量完整输出'), true);
  assert.equal(TEMPLATE_ANALYSIS_PROMPT.includes('不得输出旧版 replace_regions 矩形'), true);
  assert.equal(TEMPLATE_ANALYSIS_PROMPT.includes('不要因为图片是多宫格、尺寸图、场景图或有人物遮挡就直接人工确认'), true);
  assert.equal(TEMPLATE_ANALYSIS_PROMPT.includes('confidence 只表示判断把握，不作为自动降级人工确认的硬门槛'), true);
  assert.equal(TEMPLATE_ANALYSIS_PROMPT.endsWith('只有图像损坏、主体完全不可判断或可印花区域无法形成任何有效面板时，才使用 manual_check。'), true);
});

test('套图换印花提示词替换相对路径占位符且 hasMask 不改变 Windows 文本', () => {
  const job = {
    RelativeTemplatePath: '套图\\主图1.jpg',
    TemplateImagePath: 'C:\\模板\\套图\\主图1.jpg'
  };
  const analysis = '{"relative":"{模板相对路径}","file":"{模板文件名}","folder":"{模板文件夹}"}';
  const withoutMask = TEMPLATE_PRINT_PROMPT(job, analysis, false);
  const withMask = TEMPLATE_PRINT_PROMPT(job, analysis, true);

  assert.equal(withMask, withoutMask);
  assert.equal(withoutMask.includes('{模板相对路径}'), false);
  assert.equal(withoutMask.includes('{模板文件名}'), false);
  assert.equal(withoutMask.includes('{模板文件夹}'), false);
  assert.equal(withoutMask.includes('{"relative":"套图\\主图1.jpg","file":"主图1.jpg","folder":"套图"}'), true);
  assert.equal(withoutMask.includes('当前模板相对路径：套图\\主图1.jpg'), true);
  assert.equal(withoutMask.startsWith('你将根据输入图生成一张电商套图成品图。'), true);
  assert.equal(withoutMask.endsWith('直接输出最终成品图，不要输出解释文字。'), true);
});

test('母版迁移提示词按 ProductProfile 规则生成资料并加入审核重试要求', () => {
  const prompt = TEMPLATE_MIGRATION_PROMPT({
    relativeTemplatePath: '餐边柜/主图2.png',
    templateImagePath: '/模板/餐边柜/主图2.png'
  }, '{"source":"{模板文件名}"}', {
    dimensions: '120×40×90cm',
    material: '实木多层板',
    sellingPoints: ['不应进入提示词']
  }, 'generate_product_scene', '保留{模板文件夹}里的文字区');

  assert.equal(prompt.startsWith('你将根据一张“母版商品图”生成当前套图图片。'), true);
  assert.equal(prompt.includes('当前商品资料：\n尺寸：120×40×90cm\n材质：实木多层板'), true);
  assert.equal(prompt.includes('模板图文字分析 JSON：\n{"source":"主图2.png"}'), true);
  assert.equal(prompt.includes('当前生成动作：generate_product_scene'), true);
  assert.equal(prompt.includes('上一次 AI 审核未通过，本次必须修正：保留餐边柜里的文字区'), true);
  assert.equal(prompt.includes('不应进入提示词'), false);
  assert.equal(prompt.endsWith('直接输出最终成品图，不要输出解释文字。'), true);
});

test('空白重试要求与 Windows 一样不产生审核修正文案', () => {
  const prompt = TEMPLATE_MIGRATION_PROMPT({
    RelativeTemplatePath: '主图1.jpg',
    TemplateImagePath: 'C:\\模板\\主图1.jpg'
  }, '{}', {}, 'copy_template', '  \n ');

  assert.equal(prompt.includes('上一次 AI 审核未通过'), false);
  assert.equal(prompt.includes('未提供商品资料。尺寸和材质不得编造；缺资料的信息页应保守处理或复制模板。'), true);
});

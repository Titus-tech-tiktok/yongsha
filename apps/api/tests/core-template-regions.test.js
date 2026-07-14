const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  TEMPLATE_CACHE_FOLDER,
  TEMPLATE_CACHE_VERSION,
  buildTemplateAnalysisCache,
  createFallbackTemplateAnalysis,
  createManualTemplateAnalysis,
  formatDotNetUtc,
  getTemplateFileSignature,
  normalizeRegions,
  normalizePrintableSurfaces,
  normalizeTemplateProcessingMode,
  parseTemplateAnalysisSummary,
  readTemplateAnalysisCache,
  readValidTemplateAnalysisCache,
  resolveGenerationAction,
  safeMetadataName,
  serializeTemplateAnalysis,
  templateCachePaths,
  validateTemplateAnalysis,
  writeTemplateAnalysisCache
} = require('../src/core/template-regions');

test('按 WPF 字段规则规范化区域并兼容 w/h', () => {
  assert.deepEqual(normalizeRegions([
    { x: '-0.2', y: 0.25, w: '1.4', h: 0.5 },
    { x: 0.2, y: 0.2, width: 0, height: 0.4 },
    null
  ]), [
    { x: 0, y: 0.25, width: 1, height: 0.5 }
  ]);
});

test('旧多边形面板只做缓存兼容解析，不参与生成区域', () => {
  const surfaces = normalizePrintableSurfaces([
    {
      id: 'front-door-1',
      label: '左侧柜门外表面',
      polygon: [[0.1, 0.2], [0.45, 0.2], [0.4, 0.8], [0.15, 0.8]],
      surfaceState: '外侧闭合'
    },
    { id: 'invalid', polygon: [[0.1, 0.1], [0.2, 0.2]] }
  ]);
  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0].surfaceState, '外侧闭合');
});

test('分析动作使用新语义并兼容旧缓存别名', () => {
  assert.equal(normalizeTemplateProcessingMode('copy_template'), 'copy_original');
  assert.equal(normalizeTemplateProcessingMode('skip_copy'), 'exclude');
  assert.equal(normalizeTemplateProcessingMode('换印花'), 'replace_print');
  assert.equal(normalizeTemplateProcessingMode('人工确认'), 'manual_check');
  assert.equal(normalizeTemplateProcessingMode(''), 'manual_check');
  assert.equal(normalizeTemplateProcessingMode('unexpected_action'), 'manual_check');
});

test('换印花动作不再依赖区域或蒙版', () => {
  const valid = validateTemplateAnalysis({
    version: TEMPLATE_CACHE_VERSION,
    imageRole: '主图',
    includeInOutput: true,
    processingMode: 'replace_print',
    confidence: 0.96,
    imageUnderstanding: '正面闭合四门柜，白色柜门外表面清晰可见。',
    printableArea: '使用母版商品生成当前主图场景',
    printableSurfaces: [],
    preserveAreas: '文字、背景、边框、门缝、把手和柜脚'
  }, { source: 'ai' });
  assert.equal(valid.processingMode, 'replace_print');
  assert.equal(valid.action, 'replace_print');
  assert.equal(valid.printableSurfaces.length, 0);
  assert.equal(valid.replace_regions.length, 0);
  assert.equal(valid.needs_manual_check, false);
});

test('AI 不能自动排除图片且无可印花表面时默认保留原图', () => {
  const excluded = validateTemplateAnalysis({
    version: TEMPLATE_CACHE_VERSION,
    imageRole: '包装物流',
    includeInOutput: false,
    processingMode: 'exclude',
    confidence: 1,
    imageUnderstanding: '物流包装详情页',
    printableSurfaces: [],
    preserveAreas: '整张原图'
  }, { source: 'ai' });
  assert.equal(excluded.processingMode, 'copy_original');
  assert.equal(excluded.includeInOutput, true);
  assert.equal(excluded.preserveAreas, '整张原图');
});

test('AI 缺失动作和旧版本仍需人工确认，旧矩形区域不再驱动换印花', () => {
  const surface = {
    id: 'front',
    label: '正面白色柜门',
    polygon: [[0.2, 0.4], [0.8, 0.4], [0.8, 0.8], [0.2, 0.8]],
    surfaceState: '外侧闭合'
  };
  const base = {
    version: TEMPLATE_CACHE_VERSION,
    imageRole: '主图',
    includeInOutput: true,
    confidence: 0.96,
    imageUnderstanding: '正面闭合柜体，外侧白色柜门清晰可见。',
    printableArea: '正面白色柜门',
    printableSurfaces: [surface],
    preserveAreas: '文字、背景、边框、门缝、把手和柜脚'
  };

  const missingAction = validateTemplateAnalysis(base, { source: 'ai' });
  assert.equal(missingAction.action, 'manual_check');

  const unknownAction = validateTemplateAnalysis({
    ...base,
    processingMode: 'decorate_cabinet'
  }, { source: 'ai' });
  assert.equal(unknownAction.action, 'manual_check');

  const oldVersion = validateTemplateAnalysis({
    ...base,
    version: TEMPLATE_CACHE_VERSION - 1,
    processingMode: 'replace_print'
  }, { source: 'ai' });
  assert.equal(oldVersion.action, 'manual_check');
  assert.equal(oldVersion.needs_manual_check, true);

  const legacyRectangle = validateTemplateAnalysis({
    ...base,
    processingMode: 'replace_print',
    printableSurfaces: [],
    replace_regions: [{ x: 0.2, y: 0.4, width: 0.6, height: 0.4 }]
  }, { source: 'ai' });
  assert.equal(legacyRectangle.action, 'replace_print');
  assert.equal(legacyRectangle.printableSurfaces.length, 0);
  assert.equal(legacyRectangle.replace_regions.length, 0);
});

test('AI 可执行结果缺少说明字段时保留生产动作并补默认值', () => {
  const complete = {
    version: TEMPLATE_CACHE_VERSION,
    imageRole: '主图',
    includeInOutput: true,
    processingMode: 'replace_print',
    confidence: 0.96,
    imageUnderstanding: '正面闭合柜体，外侧白色柜门清晰可见。',
    printableArea: '正面白色柜门',
    printableSurfaces: [{
      id: 'front',
      label: '正面白色柜门',
      polygon: [[0.2, 0.4], [0.8, 0.4], [0.8, 0.8], [0.2, 0.8]],
      surfaceState: '外侧闭合'
    }],
    preserveAreas: '文字、背景、边框、门缝、把手和柜脚'
  };

  for (const field of ['confidence', 'imageRole', 'imageUnderstanding', 'preserveAreas']) {
    const incomplete = { ...complete };
    delete incomplete[field];
    const result = validateTemplateAnalysis(incomplete, { source: 'ai' });
    assert.equal(result.action, 'replace_print', `missing ${field} must keep executable replacement`);
    assert.equal(result.needs_manual_check, false);
    assert.equal(result.printableSurfaces.length, 0);
    assert.equal(result.replace_regions.length, 0);
  }
});

test('人工模板分析 JSON 使用新版动作并兼容 WPF 缓存字段', () => {
  const analysis = createManualTemplateAnalysis({
    action: '复制模板',
    regions: [{ x: 0.123456, y: 0.2, width: 0.3, height: 0.4 }]
  });
  assert.equal(analysis.version, TEMPLATE_CACHE_VERSION);
  assert.equal(analysis.category, '保留原图');
  assert.equal(analysis.action, 'copy_original');
  assert.equal(analysis.generation_action, 'copy_original');
  assert.equal(analysis.processingMode, 'copy_original');
  assert.equal(analysis.includeInOutput, true);
  assert.equal(analysis.manual_override, undefined);
  assert.deepEqual(analysis.replace_regions, []);
  assert.equal(analysis.needs_manual_check, false);

  const summary = parseTemplateAnalysisSummary(`\n\`\`\`json\n${serializeTemplateAnalysis(analysis)}\n\`\`\``);
  assert.equal(summary.action, 'copy_original');
  assert.equal(summary.confidence, 1);
  assert.deepEqual(summary.regions, []);
});

test('生成动作只遵守明确人工确认，不把低置信度当硬门槛', () => {
  assert.equal(resolveGenerationAction({ action: 'replace_print', confidence: 0.2 }), 'replace_print');
  assert.equal(resolveGenerationAction({ generation_action: '换印花', confidence: 0.75 }), 'replace_print');
  assert.equal(resolveGenerationAction({ action: 'copy_template', confidence: 1, needs_manual_check: true }), 'manual_check');
  assert.equal(resolveGenerationAction({ category: '纯文字页', needs_master_product: false }), 'copy_original');
});

test('不可读分析回退为人工确认', () => {
  const fallback = createFallbackTemplateAnalysis();
  assert.equal(fallback.version, TEMPLATE_CACHE_VERSION);
  assert.equal(fallback.action, 'manual_check');
  assert.deepEqual(parseTemplateAnalysisSummary('{broken'), {
    action: 'manual_check',
    confidence: 0,
    reason: '分析结果不可读，请人工确认。',
    replaceArea: '',
    forbiddenArea: '',
    regions: []
  });
});

test('缓存路径同时兼容 Windows 和 macOS 相对路径', () => {
  assert.equal(safeMetadataName('3：4\\分组/a:b?.jpg'), '3：4_分组_a_b_');
  assert.deepEqual(templateCachePaths('/tmp/套图', '子目录/柜子.png'), {
    cacheFolder: path.join('/tmp/套图', TEMPLATE_CACHE_FOLDER),
    analysisFile: path.join('/tmp/套图', TEMPLATE_CACHE_FOLDER, '子目录_柜子.template-analysis.json')
  });
});

test('.NET UTC 时间格式保留七位小数', () => {
  assert.equal(formatDotNetUtc(new Date('2026-07-10T01:02:03.456Z')), '2026-07-10T01:02:03.4560000Z');
  assert.equal(formatDotNetUtc(1783645323456789000n), '2026-07-10T01:02:03.4567890Z');
});

test('模板分析缓存按 WPF 包装字段写入并校验读取', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-template-region-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const templateImagePath = path.join(temp, '柜子.jpg');
  await fs.writeFile(templateImagePath, Buffer.from('fixture'));
  const analysis = serializeTemplateAnalysis(createManualTemplateAnalysis({ action: 'replace_print' }));

  const written = await writeTemplateAnalysisCache({
    templateRoot: temp,
    templateImagePath,
    relativeTemplatePath: '柜子.jpg',
    analysis,
    manualOverride: true,
    now: new Date('2026-07-10T01:02:03.456Z')
  });
  assert.equal(written.payload.version, TEMPLATE_CACHE_VERSION);
  assert.equal(written.payload.template_relative_path, '柜子.jpg');
  assert.equal(written.payload.manual_override, true);
  assert.equal(written.payload.updated_at, '2026-07-10T01:02:03.4560000Z');

  const read = await readTemplateAnalysisCache({
    cacheFile: written.cacheFile,
    templateImagePath
  });
  assert.equal(read.valid, true);
  assert.equal(read.analysis, analysis);
  assert.equal(await readValidTemplateAnalysisCache({
    cacheFile: written.cacheFile,
    templateImagePath
  }), analysis);

  await fs.appendFile(templateImagePath, 'changed');
  const stale = await readTemplateAnalysisCache({ cacheFile: written.cacheFile, templateImagePath });
  assert.equal(stale.valid, false);
  assert.equal(stale.reason, 'template-signature-mismatch');
});

test('旧版本缓存仅在人工覆盖标记存在时有效', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-template-cache-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const templateImagePath = path.join(temp, 'a.png');
  const cacheFile = path.join(temp, 'a.json');
  await fs.writeFile(templateImagePath, 'image');
  const signature = await getTemplateFileSignature(templateImagePath);

  const old = buildTemplateAnalysisCache({
    relativeTemplatePath: 'a.png',
    signature,
    analysis: '{"action":"replace_print"}',
    manualOverride: false,
    version: 7
  });
  await fs.writeFile(cacheFile, JSON.stringify(old));
  assert.equal((await readTemplateAnalysisCache({ cacheFile, templateImagePath })).valid, false);

  old.analysis = '{"reason":"运营手动确认","action":"replace_print"}';
  await fs.writeFile(cacheFile, JSON.stringify(old));
  assert.equal((await readTemplateAnalysisCache({ cacheFile, templateImagePath })).valid, false);

  old.manual_override = true;
  old.manualOverride = true;
  await fs.writeFile(cacheFile, JSON.stringify(old));
  assert.equal((await readTemplateAnalysisCache({ cacheFile, templateImagePath })).valid, true);
});

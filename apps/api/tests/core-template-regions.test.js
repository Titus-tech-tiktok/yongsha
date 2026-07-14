const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  TEMPLATE_CACHE_FOLDER,
  TEMPLATE_CACHE_VERSION,
  boundingRegionFromAddStrokes,
  buildTemplateAnalysisCache,
  calculateDisplaySize,
  cleanTemplateMask,
  createFallbackTemplateAnalysis,
  createManualTemplateAnalysis,
  createMaskStrokeFromDisplay,
  deserializeMaskData,
  displayRectToRegion,
  formatDotNetUtc,
  formatRegionSummary,
  getMaskContentBounds,
  getTemplateFileSignature,
  isLikelyLightFurniturePanel,
  normalizeRegions,
  normalizePrintableSurfaces,
  normalizeTemplateProcessingMode,
  parseTemplateAnalysisSummary,
  rasterizeMask,
  readTemplateAnalysisCache,
  readValidTemplateAnalysisCache,
  removeSmallMaskComponents,
  regionToPixelRect,
  resolveGenerationAction,
  safeMetadataName,
  serializeMaskData,
  serializeTemplateAnalysis,
  templateCachePaths,
  validateTemplateAnalysis,
  erodeMask,
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
  assert.equal(formatRegionSummary([], false), '未框选区域。换印花图片必须先框选或画笔标出可换印花面板。');
  assert.equal(formatRegionSummary([], true), '已有画笔蒙版，但没有矩形外接区域。重新保存一次会自动补齐。');
  assert.equal(
    formatRegionSummary([{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }], true),
    '已有画笔蒙版，已标记 1 个区域：1. x=0.1, y=0.2, w=0.3, h=0.4'
  );
});

test('显示尺寸和坐标转换与 Windows 编辑器一致', () => {
  assert.deepEqual(calculateDisplaySize(2000, 1000), {
    imageWidth: 2000,
    imageHeight: 1000,
    displayWidth: 980,
    displayHeight: 490,
    scale: 0.49
  });

  assert.deepEqual(displayRectToRegion(
    { x: 490, y: 245 },
    { x: 245, y: 122.5 },
    980,
    490
  ), { x: 0.25, y: 0.25, width: 0.25, height: 0.25 });

  assert.equal(displayRectToRegion({ x: 1, y: 1 }, { x: 7, y: 20 }, 980, 490), null);
  assert.deepEqual(regionToPixelRect({ x: 0.8, y: 0.9, width: 0.5, height: 0.5 }, 1000, 600), {
    x: 800,
    y: 540,
    width: 200,
    height: 60
  });
});

test('画笔数据使用显示宽度归一化并能补出外接区域', () => {
  const add = createMaskStrokeFromDisplay({ x: 10, y: 20 }, 28, 100, 50, false);
  const erase = createMaskStrokeFromDisplay({ x: 90, y: 25 }, 200, 100, 50, true);
  assert.deepEqual(add, { x: 0.1, y: 0.4, sizeRatio: 0.28, erase: false });
  assert.deepEqual(erase, { x: 0.9, y: 0.5, sizeRatio: 1.2, erase: true });
  assert.equal(createMaskStrokeFromDisplay({ x: 1, y: 1 }, 0, 100, 50).sizeRatio, 0.06);
  assert.deepEqual(boundingRegionFromAddStrokes([add, erase]), {
    x: 0,
    y: 0.26,
    width: 0.28,
    height: 0.28
  });
});

test('矩形、画笔、橡皮按 Windows 绘制顺序合成二值蒙版', () => {
  const mask = rasterizeMask({
    width: 10,
    height: 10,
    regions: [{ x: 0.2, y: 0.2, width: 0.6, height: 0.6 }],
    strokes: [
      { x: 0.1, y: 0.1, sizeRatio: 0.2, erase: false },
      { x: 0.5, y: 0.5, sizeRatio: 0.2, erase: true }
    ]
  });
  assert.equal(mask.length, 100);
  assert.equal(mask[1 * 10 + 1], 255);
  assert.equal(mask[3 * 10 + 3], 255);
  assert.equal(mask[5 * 10 + 5], 0);
  assert.equal(mask[9 * 10 + 9], 0);
});

test('多边形面板会按归一化坐标生成精确蒙版', () => {
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

  const mask = rasterizeMask({ width: 20, height: 20, surfaces });
  assert.equal(mask[10 * 20 + 5], 255);
  assert.equal(mask[2 * 20 + 18], 0);
});

test('分析动作使用新语义并兼容旧缓存别名', () => {
  assert.equal(normalizeTemplateProcessingMode('copy_template'), 'copy_original');
  assert.equal(normalizeTemplateProcessingMode('skip_copy'), 'exclude');
  assert.equal(normalizeTemplateProcessingMode('换印花'), 'replace_print');
  assert.equal(normalizeTemplateProcessingMode('人工确认'), 'manual_check');
  assert.equal(normalizeTemplateProcessingMode(''), 'manual_check');
  assert.equal(normalizeTemplateProcessingMode('unexpected_action'), 'manual_check');
});

test('严格分析契约要求换印花必须有有效面板多边形', () => {
  const valid = validateTemplateAnalysis({
    version: 9,
    imageRole: '主图',
    includeInOutput: true,
    processingMode: 'replace_print',
    confidence: 0.96,
    imageUnderstanding: '正面闭合四门柜，白色柜门外表面清晰可见。',
    printableSurfaces: [{
      id: 'front',
      label: '四扇白色柜门外表面',
      polygon: [[0.2, 0.4], [0.8, 0.4], [0.8, 0.8], [0.2, 0.8]],
      surfaceState: '外侧闭合'
    }],
    preserveAreas: '文字、背景、边框、门缝、把手和柜脚'
  }, { source: 'ai' });
  assert.equal(valid.processingMode, 'replace_print');
  assert.equal(valid.action, 'replace_print');
  assert.equal(valid.printableSurfaces.length, 1);
  assert.equal(valid.needs_manual_check, false);

  const invalid = validateTemplateAnalysis({
    version: 9,
    includeInOutput: true,
    processingMode: 'replace_print',
    confidence: 0.98,
    imageUnderstanding: '需要换印花',
    printableSurfaces: [],
    preserveAreas: '背景和文字'
  }, { source: 'ai' });
  assert.equal(invalid.processingMode, 'manual_check');
  assert.equal(invalid.needs_manual_check, true);
  assert.match(invalid.reason, /区域|面板|人工/);
});

test('AI 不能自动排除图片且无可印花表面时默认保留原图', () => {
  const excluded = validateTemplateAnalysis({
    version: 9,
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

test('非 V9、缺失动作或旧矩形区域的 AI 返回不得直接执行换印花', () => {
  const surface = {
    id: 'front',
    label: '正面白色柜门',
    polygon: [[0.2, 0.4], [0.8, 0.4], [0.8, 0.8], [0.2, 0.8]],
    surfaceState: '外侧闭合'
  };
  const base = {
    version: 9,
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
    version: 8,
    processingMode: 'replace_print'
  }, { source: 'ai' });
  assert.equal(oldVersion.action, 'manual_check');

  const legacyRectangle = validateTemplateAnalysis({
    ...base,
    processingMode: 'replace_print',
    printableSurfaces: [],
    replace_regions: [{ x: 0.2, y: 0.4, width: 0.6, height: 0.4 }]
  }, { source: 'ai' });
  assert.equal(legacyRectangle.action, 'manual_check');
});

test('AI 可执行结果缺少说明字段时保留生产动作并补默认值', () => {
  const complete = {
    version: 9,
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
    assert.equal(result.printableSurfaces.length, 1);
  }
});

test('蒙版边界按 96 阈值缩放回模板像素', () => {
  const mask = new Uint8Array(4 * 3);
  mask[1 * 4 + 1] = 95;
  mask[1 * 4 + 2] = 96;
  mask[2 * 4 + 3] = 255;
  assert.deepEqual(getMaskContentBounds(mask, 4, 3, 8, 6), {
    x: 4,
    y: 2,
    width: 4,
    height: 4
  });
});

test('清洁蒙版复刻浅色面板、腐蚀和小连通域规则', () => {
  assert.equal(isLikelyLightFurniturePanel(240, 235, 225), true);
  assert.equal(isLikelyLightFurniturePanel(40, 40, 40), false);
  assert.equal(isLikelyLightFurniturePanel(210, 160, 40), false);

  const square = new Uint8Array(7 * 7).fill(1);
  assert.equal(erodeMask(square, 7, 7, 2).reduce((sum, value) => sum + value, 0), 9);
  assert.equal(removeSmallMaskComponents(square, 7, 7, 50).some(Boolean), false);

  const width = 16;
  const height = 16;
  const templatePixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    templatePixels[index * 4] = 240;
    templatePixels[index * 4 + 1] = 235;
    templatePixels[index * 4 + 2] = 225;
    templatePixels[index * 4 + 3] = 255;
  }
  const cleaned = cleanTemplateMask({
    templatePixels,
    maskPixels: new Uint8Array(width * height).fill(255),
    width,
    height
  });
  assert.equal(cleaned.usedLightPanelFilter, true);
  assert.equal(cleaned.rawCount, 256);
  assert.equal(cleaned.cleanedCount, 256);
  assert.equal(cleaned.mask.reduce((sum, value) => sum + (value === 255 ? 1 : 0), 0), 144);

  const darkTemplatePixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    darkTemplatePixels[index * 4] = 40;
    darkTemplatePixels[index * 4 + 1] = 40;
    darkTemplatePixels[index * 4 + 2] = 40;
    darkTemplatePixels[index * 4 + 3] = 255;
  }
  const rejectedDarkArea = cleanTemplateMask({
    templatePixels: darkTemplatePixels,
    maskPixels: new Uint8Array(width * height).fill(255),
    width,
    height
  });
  assert.equal(rejectedDarkArea.usedLightPanelFilter, true);
  assert.equal(rejectedDarkArea.cleanedCount, 0);
  assert.equal(rejectedDarkArea.mask.some(Boolean), false);
});

test('蒙版编辑数据可稳定序列化和反序列化', () => {
  const text = serializeMaskData({
    regions: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
    strokes: [{ x: 0.5, y: 0.6, sizeRatio: 0.08, erase: true }],
    keepExistingMask: true
  });
  const restored = deserializeMaskData(text);
  assert.deepEqual(restored, {
    version: TEMPLATE_CACHE_VERSION,
    replaceRegions: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
    maskStrokes: [{ x: 0.5, y: 0.6, sizeRatio: 0.08, erase: true }],
    keepExistingMask: true
  });
});

test('人工模板分析 JSON 使用新版动作并兼容 WPF 缓存字段', () => {
  const analysis = createManualTemplateAnalysis({
    action: '复制模板',
    regions: [{ x: 0.123456, y: 0.2, width: 0.3, height: 0.4 }]
  });
  assert.equal(analysis.version, 9);
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
  assert.equal(fallback.version, 9);
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
    analysisFile: path.join('/tmp/套图', TEMPLATE_CACHE_FOLDER, '子目录_柜子.template-analysis.json'),
    maskFile: path.join('/tmp/套图', TEMPLATE_CACHE_FOLDER, '子目录_柜子.replace-mask.png'),
    cleanMaskFile: path.join('/tmp/套图', TEMPLATE_CACHE_FOLDER, '子目录_柜子.clean-mask.png'),
    maskMetaFile: path.join('/tmp/套图', TEMPLATE_CACHE_FOLDER, '子目录_柜子.mask-meta.json')
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
  assert.equal(written.payload.version, 9);
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

test('旧版本缓存仅在人工覆盖标记或人工文案存在时有效', async (t) => {
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
  assert.equal((await readTemplateAnalysisCache({ cacheFile, templateImagePath })).valid, true);
});

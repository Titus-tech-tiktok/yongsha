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

test('人工模板分析 JSON 字段和值与 WPF V8 对齐', () => {
  const analysis = createManualTemplateAnalysis({
    action: '复制模板',
    regions: [{ x: 0.123456, y: 0.2, width: 0.3, height: 0.4 }]
  });
  assert.equal(analysis.version, 8);
  assert.equal(analysis.category, '纯文字信息页');
  assert.equal(analysis.action, 'copy_template');
  assert.equal(analysis.generation_action, 'copy_template');
  assert.equal(analysis.manual_override, undefined);
  assert.deepEqual(analysis.replace_regions, [{ x: 0.1235, y: 0.2, width: 0.3, height: 0.4 }]);
  assert.equal(analysis.needs_manual_check, false);

  const summary = parseTemplateAnalysisSummary(`\n\`\`\`json\n${serializeTemplateAnalysis(analysis)}\n\`\`\``);
  assert.equal(summary.action, 'copy_template');
  assert.equal(summary.confidence, 1);
  assert.equal(summary.regions[0].x, 0.1235);
});

test('生成动作遵守人工确认和 0.75 置信度门槛', () => {
  assert.equal(resolveGenerationAction({ action: 'replace_print', confidence: 0.74 }), 'manual_check');
  assert.equal(resolveGenerationAction({ generation_action: '换印花', confidence: 0.75 }), 'replace_print');
  assert.equal(resolveGenerationAction({ action: 'copy_template', confidence: 1, needs_manual_check: true }), 'manual_check');
  assert.equal(resolveGenerationAction({ category: '纯文字页', needs_master_product: false }), 'copy_template');
});

test('不可读分析回退为人工确认', () => {
  const fallback = createFallbackTemplateAnalysis();
  assert.equal(fallback.version, 6);
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
    cleanMaskFile: path.join('/tmp/套图', TEMPLATE_CACHE_FOLDER, '子目录_柜子.clean-mask.png')
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
  assert.equal(written.payload.version, 8);
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

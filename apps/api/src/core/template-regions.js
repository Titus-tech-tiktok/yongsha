'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const TEMPLATE_CACHE_VERSION = 10;
const TEMPLATE_CACHE_FOLDER = '.caishen-template-cache';
const DEFAULT_FORBIDDEN_AREA = '背景、文字、尺寸线、墙面、地面、柜脚、把手、门缝、抽屉缝、抽屉内侧、柜门内侧、包装、道具等非留白家具表面区域';

function finiteNumber(value, fallback = 0) {
  if (typeof value === 'string' && !value.trim()) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finiteNumber(value, minimum)));
}

function round(value, digits = 4) {
  return Number(finiteNumber(value).toFixed(digits));
}

function normalizeRegion(value) {
  if (!value || typeof value !== 'object') return null;
  const width = finiteNumber(value.width ?? value.w);
  const height = finiteNumber(value.height ?? value.h);
  if (width <= 0 || height <= 0) return null;
  return {
    x: clamp(value.x, 0, 1),
    y: clamp(value.y, 0, 1),
    width: clamp(width, 0, 1),
    height: clamp(height, 0, 1)
  };
}

function normalizeRegions(values) {
  if (!Array.isArray(values)) return [];
  return values.map(normalizeRegion).filter(Boolean);
}

function normalizePolygonPoint(value) {
  const x = Array.isArray(value) ? value[0] : value?.x;
  const y = Array.isArray(value) ? value[1] : value?.y;
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;
  return [round(clamp(x, 0, 1)), round(clamp(y, 0, 1))];
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(area) / 2;
}

function normalizePrintableSurface(value, index = 0) {
  if (!value || typeof value !== 'object') return null;
  const polygon = (Array.isArray(value.polygon) ? value.polygon : Array.isArray(value.points) ? value.points : [])
    .map(normalizePolygonPoint)
    .filter(Boolean);
  if (polygon.length < 3 || polygonArea(polygon) < 0.0005) return null;
  return {
    id: String(value.id || `surface-${index + 1}`).trim() || `surface-${index + 1}`,
    label: String(value.label || value.note || `可印花面板 ${index + 1}`).trim(),
    polygon,
    surfaceState: String(value.surfaceState || value.surface_state || '外侧可见').trim()
  };
}

function normalizePrintableSurfaces(values) {
  if (!Array.isArray(values)) return [];
  return values.map(normalizePrintableSurface).filter(Boolean);
}

function normalizeTemplateProcessingMode(value) {
  const action = String(value || '').trim().toLowerCase();
  if (action.includes('copy_original') || action.includes('copy_template') || action.includes('保留原图') || action.includes('复制')) return 'copy_original';
  if (action.includes('exclude') || action.includes('skip_copy') || action.includes('不输出') || action.includes('排除') || action.includes('跳过')) return 'exclude';
  if (action.includes('manual') || action.includes('人工') || action.includes('不确定')) return 'manual_check';
  if (action.includes('replace_print') || action.includes('换印花') || action.includes('更换印花')) return 'replace_print';
  return 'manual_check';
}

function normalizeTemplateAction(value) {
  return normalizeTemplateProcessingMode(value);
}

function normalizeGenerationAction(value) {
  return normalizeTemplateProcessingMode(value);
}

function categoryForAction(action) {
  if (action === 'copy_original') return '保留原图';
  if (action === 'exclude') return '运营排除';
  if (action === 'manual_check') return '不确定';
  return '商品场景图';
}

function isUncertainManualText(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  return [
    '不确定',
    '无',
    '没有',
    '模板分析失败',
    '需要人工确认',
    'manual',
    'uncertain',
    'unknown',
    'none'
  ].some(token => text.includes(token));
}

function createManualTemplateAnalysis({ action: actionValue, reason = '', replaceArea = '', forbiddenArea = '' } = {}) {
  const action = normalizeTemplateAction(actionValue);
  const needsManualCheck = action === 'manual_check';
  const manualReason = String(reason || '').trim();
  const manualReplaceArea = String(replaceArea || '').trim();
  const defaultReplaceArea = action === 'replace_print' ? '运营确认的留白家具面板或柜门外表面' : '无';
  const safeReplaceArea = action === 'replace_print' && isUncertainManualText(manualReplaceArea)
    ? defaultReplaceArea
    : manualReplaceArea || defaultReplaceArea;
  const analysis = {
    version: TEMPLATE_CACHE_VERSION,
    category: categoryForAction(action),
    imageRole: categoryForAction(action),
    includeInOutput: action !== 'exclude',
    processingMode: action,
    action,
    generation_action: action,
    confidence: needsManualCheck ? 0.5 : 1,
    reason: manualReason || '运营手动筛选',
    replace_area: safeReplaceArea,
    imageUnderstanding: manualReason || '运营手动筛选',
    replace_regions: [],
    printableSurfaces: [],
    printableArea: action === 'replace_print' ? safeReplaceArea : '无',
    forbidden_area: String(forbiddenArea || '').trim() || DEFAULT_FORBIDDEN_AREA,
    preserveAreas: action === 'copy_original' ? '整张原图' : String(forbiddenArea || '').trim() || DEFAULT_FORBIDDEN_AREA,
    view_state: '按模板原图保持',
    print_mapping: action === 'replace_print' ? '把一张完整印花按模板留白家具表面等比例贴合，不平铺、不重复主视觉' : '无',
    handle_door_rule: '保持模板的开门、开抽屉、背面和遮挡状态；只处理可见留白外表面',
    drawer_or_door_state: '按模板原图保持',
    risk_points: ['运营手动筛选结果优先于AI分析'],
    instruction: action === 'replace_print'
      ? '按 replace_area 描述把原始印花完整贴到留白家具表面，其他区域保持模板原图。'
      : action === 'copy_original'
        ? '直接复制模板图，不调用生图。'
        : action === 'exclude'
          ? '运营已明确排除该图，不输出文件。'
          : '需要人工进一步确认后再生成。',
    needs_manual_check: needsManualCheck
  };
  return validateTemplateAnalysis(analysis, { source: 'manual' });
}

function createFallbackTemplateAnalysis() {
  return {
    version: TEMPLATE_CACHE_VERSION,
    category: '不确定',
    imageRole: '不确定',
    includeInOutput: true,
    processingMode: 'manual_check',
    action: 'manual_check',
    generation_action: 'manual_check',
    confidence: 0,
    reason: '模板分析失败，需要人工确认',
    replace_area: '不确定',
    replace_regions: [],
    printableSurfaces: [],
    printableArea: '不确定',
    forbidden_area: '背景、文字、墙面、地面、柜脚、把手、抽屉内侧、柜门内侧、包装、留白等非可印花面板区域',
    preserveAreas: '整张原图，等待运营确认',
    drawer_or_door_state: '无',
    risk_points: ['模板未成功分析，不能自动生成'],
    instruction: '请人工确认可替换印花区域后再生成。',
    needs_manual_check: true
  };
}

function analysisText(root, ...names) {
  for (const name of names) {
    if (root?.[name] !== undefined && root?.[name] !== null) return String(root[name]).trim();
  }
  return '';
}

function validateTemplateAnalysis(value, options = {}) {
  let root;
  try {
    root = deserializeTemplateAnalysis(value);
  } catch {
    return createFallbackTemplateAnalysis();
  }
  const source = String(options.source || 'ai');
  const sourceVersion = Number(root.version);
  let processingMode = normalizeTemplateProcessingMode(
    root.processingMode ?? root.processing_mode ?? root.action ?? root.generation_action
  );
  if (source === 'ai' && processingMode === 'exclude') processingMode = 'copy_original';
  const confidence = clamp(getJsonNumber(root, 'confidence', processingMode === 'manual_check' ? 0.5 : 1), 0, 1);
  const surfaces = normalizePrintableSurfaces(root.printableSurfaces ?? root.printable_surfaces);
  const understanding = analysisText(root, 'imageUnderstanding', 'image_understanding', 'reason') || '未提供可靠的图片用途判断';
  let reason = analysisText(root, 'reason') || understanding;
  if (source === 'ai' && sourceVersion !== TEMPLATE_CACHE_VERSION) {
    processingMode = 'manual_check';
    reason = `AI 分析契约版本无效，需要 V${TEMPLATE_CACHE_VERSION}，请人工确认。`;
  }
  if (root.needs_manual_check === true) processingMode = 'manual_check';
  const includeInOutput = processingMode !== 'exclude';
  const replaceArea = processingMode === 'replace_print'
    ? analysisText(root, 'printableArea', 'printable_area', 'replace_area') || surfaces.map(surface => surface.label).join('、') || '使用母版商品生成当前套图页面'
    : '无';
  const preserveAreas = processingMode === 'copy_original'
    ? '整张原图'
    : analysisText(root, 'preserveAreas', 'preserve_areas', 'forbidden_area') || DEFAULT_FORBIDDEN_AREA;
  const needsManualCheck = processingMode === 'manual_check';
  return {
    ...root,
    version: TEMPLATE_CACHE_VERSION,
    category: analysisText(root, 'category', 'imageRole', 'image_role') || categoryForAction(processingMode),
    imageRole: analysisText(root, 'imageRole', 'image_role', 'category') || categoryForAction(processingMode),
    includeInOutput,
    processingMode,
    action: processingMode,
    generation_action: processingMode,
    confidence: needsManualCheck ? Math.min(confidence, 0.74) : confidence,
    reason,
    imageUnderstanding: understanding,
    printableArea: replaceArea,
    replace_area: replaceArea,
    printableSurfaces: [],
    replace_regions: [],
    preserveAreas,
    forbidden_area: preserveAreas,
    mappingMode: processingMode === 'replace_print' ? 'master_product_migration' : 'none',
    print_mapping: processingMode === 'replace_print' ? '使用母版商品作为唯一商品标准迁移到当前套图页面' : '无',
    needs_manual_check: needsManualCheck
  };
}

function extractJsonObject(content) {
  const text = String(content ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function deserializeTemplateAnalysis(value) {
  if (value && typeof value === 'object') return value;
  const parsed = JSON.parse(extractJsonObject(value));
  if (typeof parsed?.analysis === 'string' && !parsed.action && !parsed.generation_action) {
    return deserializeTemplateAnalysis(parsed.analysis);
  }
  return parsed;
}

function serializeTemplateAnalysis(value, space = 2) {
  const parsed = typeof value === 'string' ? deserializeTemplateAnalysis(value) : value;
  return JSON.stringify(parsed, null, space);
}

function getJsonString(object, ...names) {
  for (const name of names) {
    const value = object?.[name];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

function getJsonNumber(object, name, fallback) {
  const value = object?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseTemplateAnalysisSummary(value) {
  try {
    const root = deserializeTemplateAnalysis(value);
    const action = getJsonString(root, 'processingMode', 'processing_mode', 'action', 'generation_action') || 'manual_check';
    return {
      action: normalizeTemplateAction(action),
      processingMode: normalizeTemplateAction(action),
      includeInOutput: root.includeInOutput !== false && root.include_in_output !== false,
      confidence: getJsonNumber(root, 'confidence', 0),
      reason: getJsonString(root, 'imageUnderstanding', 'image_understanding', 'reason'),
      replaceArea: getJsonString(root, 'printableArea', 'printable_area', 'replace_area'),
      forbiddenArea: getJsonString(root, 'preserveAreas', 'preserve_areas', 'forbidden_area'),
      regions: normalizeRegions(root.replace_regions),
      printableSurfaces: normalizePrintableSurfaces(root.printableSurfaces ?? root.printable_surfaces)
    };
  } catch {
    return {
      action: 'manual_check',
      confidence: 0,
      reason: '分析结果不可读，请人工确认。',
      replaceArea: '',
      forbiddenArea: '',
      regions: []
    };
  }
}

function includesAny(value, ...needles) {
  const text = String(value || '');
  return needles.some(needle => text.includes(needle));
}

function inferGenerationAction(text, needsMaster = true) {
  if (!needsMaster) return 'copy_original';
  if (includesAny(text, '纯装饰', '横幅', '品牌底图', '无效', '不需要生成', '无法迁移')) return 'exclude';
  if (includesAny(text, '包装运输', '包装', '运输', '安装售后', '售后', '买家须知', '纯文字', '信息页')) return 'copy_original';
  return 'replace_print';
}

function resolveGenerationAction(value) {
  let root;
  try {
    root = deserializeTemplateAnalysis(value);
  } catch {
    return inferGenerationAction(value, true);
  }

  if (root.needs_manual_check === true) return 'manual_check';
  const action = getJsonString(root, 'processingMode', 'processing_mode', 'action', 'generation_action');
  if (action.trim()) return normalizeGenerationAction(action);
  const category = getJsonString(root, 'category', 'template_purpose', 'template_type');
  const needsMaster = root.needs_master_product === undefined || root.needs_master_product === true;
  return inferGenerationAction(category, needsMaster);
}

/** Cross-platform equivalent of WPF SafeMetadataName, using Windows' invalid-name superset. */
function safeMetadataName(relativePathValue) {
  let value = String(relativePathValue || '');
  const lastSeparator = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  const lastDot = value.lastIndexOf('.');
  if (lastDot > lastSeparator) value = value.slice(0, lastDot);
  value = value
    .replace(/[\\/]/g, '_')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_');
  return value.trim() ? value : 'template';
}

function templateCachePaths(templateRoot, relativeTemplatePath) {
  const cacheFolder = path.join(templateRoot, TEMPLATE_CACHE_FOLDER);
  const name = safeMetadataName(relativeTemplatePath);
  return {
    cacheFolder,
    analysisFile: path.join(cacheFolder, `${name}.template-analysis.json`)
  };
}

/** Formats Date or Unix nanoseconds like DateTime.UtcNow.ToString("O"). */
function formatDotNetUtc(value = new Date()) {
  if (typeof value === 'bigint') {
    let seconds = value / 1_000_000_000n;
    let nanoseconds = value % 1_000_000_000n;
    if (nanoseconds < 0) {
      seconds -= 1n;
      nanoseconds += 1_000_000_000n;
    }
    const stem = new Date(Number(seconds) * 1000).toISOString().slice(0, 19);
    const fraction = String(nanoseconds / 100n).padStart(7, '0');
    return `${stem}.${fraction}Z`;
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('无效的 UTC 时间');
  return date.toISOString().replace(/\.(\d{3})Z$/, '.$10000Z');
}

async function getTemplateFileSignature(templateImagePath) {
  let stat;
  try {
    stat = await fs.stat(templateImagePath, { bigint: true });
  } catch (error) {
    if (error?.code !== 'ERR_INVALID_ARG_VALUE' && error?.code !== 'ERR_INVALID_ARG_TYPE') throw error;
    stat = await fs.stat(templateImagePath);
  }
  const length = typeof stat.size === 'bigint' ? Number(stat.size) : stat.size;
  const templateLastWriteUtc = typeof stat.mtimeNs === 'bigint'
    ? formatDotNetUtc(stat.mtimeNs)
    : formatDotNetUtc(stat.mtime);
  return { length, templateLastWriteUtc };
}

function analysisToString(analysis) {
  return typeof analysis === 'string' ? analysis : serializeTemplateAnalysis(analysis);
}

function buildTemplateAnalysisCache({
  relativeTemplatePath = '',
  signature,
  analysis,
  manualOverride = false,
  version = TEMPLATE_CACHE_VERSION,
  now = new Date()
}) {
  if (!signature || !Number.isFinite(Number(signature.length)) || !signature.templateLastWriteUtc) {
    throw new TypeError('缺少模板文件签名');
  }
  return {
    version,
    template_relative_path: String(relativeTemplatePath || ''),
    template_last_write_utc: String(signature.templateLastWriteUtc),
    template_length: Number(signature.length),
    updated_at: formatDotNetUtc(now),
    manual_override: Boolean(manualOverride),
    analysis: analysisToString(analysis)
  };
}

async function writeTemplateAnalysisCache({
  cacheFile,
  templateRoot,
  templateImagePath,
  relativeTemplatePath,
  analysis,
  manualOverride = false,
  now = new Date()
}) {
  if (!templateImagePath) throw new TypeError('缺少模板图片路径');
  const relativePath = relativeTemplatePath || path.basename(templateImagePath);
  const root = templateRoot || path.dirname(templateImagePath);
  const outputFile = cacheFile || templateCachePaths(root, relativePath).analysisFile;
  const signature = await getTemplateFileSignature(templateImagePath);
  const payload = buildTemplateAnalysisCache({
    relativeTemplatePath: relativePath,
    signature,
    analysis,
    manualOverride,
    now
  });
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, JSON.stringify(payload, null, 2), 'utf8');
  return { cacheFile: outputFile, payload };
}

function cacheField(cache, snakeName, camelName) {
  return cache?.[snakeName] ?? cache?.[camelName];
}

async function readTemplateAnalysisCache({ cacheFile, templateImagePath }) {
  if (!cacheFile || !templateImagePath) {
    return { valid: false, analysis: '', reason: 'missing-path', cache: null };
  }

  let text;
  try {
    text = await fs.readFile(cacheFile, 'utf8');
  } catch (error) {
    return { valid: false, analysis: '', reason: error?.code === 'ENOENT' ? 'cache-not-found' : 'cache-read-failed', cache: null };
  }

  let cache;
  try {
    cache = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { valid: false, analysis: '', reason: 'invalid-json', cache: null };
  }

  const analysis = cache?.analysis;
  if (typeof analysis !== 'string') {
    return { valid: false, analysis: '', reason: 'missing-analysis', cache };
  }

  let signature;
  try {
    signature = await getTemplateFileSignature(templateImagePath);
  } catch (error) {
    return { valid: false, analysis: '', reason: error?.code === 'ENOENT' ? 'template-not-found' : 'template-stat-failed', cache };
  }

  const cachedLength = Number(cacheField(cache, 'template_length', 'templateLength'));
  const cachedLastWrite = String(cacheField(cache, 'template_last_write_utc', 'templateLastWriteUtc') || '');
  if (cachedLength !== signature.length || cachedLastWrite.toLowerCase() !== signature.templateLastWriteUtc.toLowerCase()) {
    return { valid: false, analysis: '', reason: 'template-signature-mismatch', cache };
  }

  const version = Number(cache.version) || 0;
  const manualOverride = cacheField(cache, 'manual_override', 'manualOverride') === true;
  if (version < TEMPLATE_CACHE_VERSION && !manualOverride) {
    return { valid: false, analysis: '', reason: 'unsupported-cache-version', cache };
  }
  return { valid: true, analysis, reason: 'ok', cache };
}

async function readValidTemplateAnalysisCache(options) {
  const result = await readTemplateAnalysisCache(options);
  return result.valid ? result.analysis : '';
}

module.exports = {
  DEFAULT_FORBIDDEN_AREA,
  TEMPLATE_CACHE_FOLDER,
  TEMPLATE_CACHE_VERSION,
  buildTemplateAnalysisCache,
  createFallbackTemplateAnalysis,
  createManualTemplateAnalysis,
  deserializeTemplateAnalysis,
  extractJsonObject,
  formatDotNetUtc,
  getTemplateFileSignature,
  inferGenerationAction,
  normalizeGenerationAction,
  normalizePrintableSurfaces,
  normalizeRegion,
  normalizeRegions,
  normalizeTemplateAction,
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
};

const path = require('node:path');
const fsp = require('node:fs/promises');
const { isSameOrChildPath } = require('./path-utils');

const PRODUCT_PROFILE_FILE_NAME = '商品资料.json';
const TASK_METADATA_FOLDER = '.caishen-meta';
const TASK_PRODUCT_PROFILE_FILE_NAME = 'product-profile.json';
const EMPTY_PROMPT_TEXT = '未提供商品资料。尺寸和材质不得编造；缺资料的信息页应保守处理或复制模板。';

// Kept text-compatible with AnalyzeProductProfileAsync in MainWindow.xaml.cs.
const PRODUCT_PROFILE_ANALYSIS_PROMPT = `请从这张商品品类图中提取本商品资料。只输出合法 JSON，不要 Markdown，不要解释。
规则：
- 尺寸只能读取图片中真实出现的尺寸文字，例如 140cm、56.57cm、40cm、12cm；不要根据比例推测，不要编造。
- 如果能判断尺寸含义，可以整理成 高/宽/深/局部尺寸；不能判断含义也要保留原始尺寸文字。
- 材质只在图片文字明确写出，或商品可见材质特征非常明确时填写；不确定就返回空字符串。
- 不要把颜色、风格、印花主题误写成材质。
输出格式：
{
  "dimensions": "整理后的中文尺寸描述，没有则空字符串",
  "material": "材质描述，没有则空字符串",
  "raw_values": ["图片中出现的原始尺寸文字"]
}`;

const FIELD_ALIASES = Object.freeze({
  category: ['品类', 'Category', 'category'],
  dimensions: ['尺寸', '默认尺寸', 'Dimensions', 'dimensions', 'size'],
  material: ['材质', '默认材质', 'Material', 'material'],
  structure: ['结构', 'Structure', 'structure'],
  color: ['颜色', 'Color', 'color'],
  notes: ['注意', '备注', 'Notes', 'notes'],
  sellingPoints: ['卖点', '默认卖点', 'SellingPoints', 'selling_points', 'sellingPoints']
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function wpfScalarText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (value !== null && typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return ''; }
  }
  return '';
}

function firstField(source, aliases) {
  if (!isObject(source)) return undefined;
  for (const name of aliases) {
    if (Object.prototype.hasOwnProperty.call(source, name)) return source[name];
  }
  return undefined;
}

function normalizeStringField(source, aliases) {
  return wpfScalarText(firstField(source, aliases)).trim();
}

function splitLines(value) {
  return String(value || '')
    .split(/\r\n|\n/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map(wpfScalarText).map(item => item.trim()).filter(Boolean);
  }
  if (typeof value === 'string') return splitLines(value);
  return [];
}

function emptyProductProfile() {
  return {
    category: '',
    dimensions: '',
    material: '',
    structure: '',
    color: '',
    notes: '',
    sellingPoints: []
  };
}

/**
 * Reads every field spelling accepted by the WPF ReadProductProfile helper and
 * converts it to the lower-camel shape used by the native Mac implementation.
 */
function normalizeProductProfile(value = {}) {
  const source = isObject(value) ? value : {};
  return {
    category: normalizeStringField(source, FIELD_ALIASES.category),
    dimensions: normalizeStringField(source, FIELD_ALIASES.dimensions),
    material: normalizeStringField(source, FIELD_ALIASES.material),
    structure: normalizeStringField(source, FIELD_ALIASES.structure),
    color: normalizeStringField(source, FIELD_ALIASES.color),
    notes: normalizeStringField(source, FIELD_ALIASES.notes),
    sellingPoints: normalizeStringList(firstField(source, FIELD_ALIASES.sellingPoints))
  };
}

function toWpfProductProfile(value = {}) {
  const profile = normalizeProductProfile(value);
  return {
    Category: profile.category,
    Dimensions: profile.dimensions,
    Material: profile.material,
    Structure: profile.structure,
    Color: profile.color,
    Notes: profile.notes,
    SellingPoints: [...profile.sellingPoints]
  };
}

function firstNonEmpty(preferred, fallback) {
  return String(preferred || '').trim() ? preferred : fallback;
}

/** Mutates target just like the WPF MergeProductProfile method. */
function mergeProductProfile(target, source) {
  const destination = isObject(target) ? target : emptyProductProfile();
  Object.assign(destination, normalizeProductProfile(destination));
  if (!isObject(source)) return destination;

  const incoming = normalizeProductProfile(source);
  destination.category = firstNonEmpty(incoming.category, destination.category);
  destination.dimensions = firstNonEmpty(incoming.dimensions, destination.dimensions);
  destination.material = firstNonEmpty(incoming.material, destination.material);
  destination.structure = firstNonEmpty(incoming.structure, destination.structure);
  destination.color = firstNonEmpty(incoming.color, destination.color);
  destination.notes = firstNonEmpty(incoming.notes, destination.notes);
  if (incoming.sellingPoints.length > 0) destination.sellingPoints = [...incoming.sellingPoints];
  return destination;
}

function getTemplateProductProfileFile(templateFolderPath) {
  return path.join(String(templateFolderPath || ''), PRODUCT_PROFILE_FILE_NAME);
}

function getTaskProductProfileFile(outputRoot) {
  return path.join(String(outputRoot || ''), TASK_METADATA_FOLDER, TASK_PRODUCT_PROFILE_FILE_NAME);
}

function toPromptText(value = {}) {
  const profile = normalizeProductProfile(value);
  const lines = [];
  if (profile.dimensions) lines.push(`尺寸：${profile.dimensions}`);
  if (profile.material) lines.push(`材质：${profile.material}`);
  return lines.length ? lines.join('\n') : EMPTY_PROMPT_TEXT;
}

function extractJsonObject(content) {
  const text = String(content || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function parseAiProductProfileContent(content) {
  const text = String(content || '').trim();
  if (!text) return emptyProductProfile();
  try {
    const parsed = JSON.parse(extractJsonObject(text));
    if (!isObject(parsed)) throw new TypeError('AI result is not a JSON object');
    return normalizeProductProfile(parsed);
  } catch {
    // This intentionally mirrors WPF: malformed model text is retained as a
    // dimensions description instead of making the entire workflow fail.
    return normalizeProductProfile({ dimensions: text });
  }
}

function parseProductProfileChatResponse(body) {
  let response = body;
  if (typeof response === 'string') {
    try { response = JSON.parse(response); } catch { return emptyProductProfile(); }
  }
  const choices = response?.choices || response?.Choices || [];
  const message = choices[0]?.message || choices[0]?.Message || {};
  const content = message.content ?? message.Content ?? '';
  return parseAiProductProfileContent(content);
}

function buildProductProfileAnalysisPrompt(prompt = PRODUCT_PROFILE_ANALYSIS_PROMPT) {
  return String(prompt ?? PRODUCT_PROFILE_ANALYSIS_PROMPT);
}

function buildProductProfileAnalysisRequest({ model, imageDataUrl, prompt } = {}) {
  return {
    model: String(model || ''),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: buildProductProfileAnalysisPrompt(prompt) },
        { type: 'image_url', image_url: { url: String(imageDataUrl || '') } }
      ]
    }],
    temperature: 0
  };
}

function serializeProductProfile(value = {}) {
  return JSON.stringify(toWpfProductProfile(value), null, 2);
}

async function readProductProfileFile(filePath) {
  if (!filePath) return null;
  try {
    const text = (await fsp.readFile(filePath, 'utf8')).replace(/^\uFEFF/, '');
    const parsed = JSON.parse(text);
    if (!isObject(parsed)) return null;
    return normalizeProductProfile(parsed);
  } catch {
    return null;
  }
}

async function writeProductProfileFile(filePath, value = {}) {
  if (!filePath) throw new Error('商品资料文件路径不能为空');
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, serializeProductProfile(value), 'utf8');
  return normalizeProductProfile(value);
}

async function loadTemplateProductProfile(templateFolderPath) {
  if (!templateFolderPath) return emptyProductProfile();
  return (await readProductProfileFile(getTemplateProductProfileFile(templateFolderPath))) || emptyProductProfile();
}

async function loadProductProfileForJob({ outputRoot = '', templateFolderPath = '' } = {}) {
  const taskProfile = outputRoot ? await readProductProfileFile(getTaskProductProfileFile(outputRoot)) : null;
  if (taskProfile) return taskProfile;
  return loadTemplateProductProfile(templateFolderPath);
}

function isoTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  if (typeof value === 'string') return value;
  return '';
}

function createTaskProductProfilePayload(value = {}, metadata = {}) {
  const profile = normalizeProductProfile(value);
  return {
    source_product_path: String(metadata.sourceProductPath || ''),
    source_product_last_write_utc: isoTimestamp(metadata.sourceProductLastWriteUtc),
    updated_at: isoTimestamp(metadata.updatedAt) || new Date().toISOString(),
    Dimensions: profile.dimensions,
    Material: profile.material,
    Notes: profile.notes
  };
}

function shouldRefreshTaskProductProfile({
  profileExists = false,
  productExists = false,
  profileLastWriteMs = Number.NaN,
  productLastWriteMs = Number.NaN
} = {}) {
  if (!profileExists) return true;
  if (!productExists) return false;
  if (!Number.isFinite(profileLastWriteMs) || !Number.isFinite(productLastWriteMs)) return true;
  return profileLastWriteMs < productLastWriteMs;
}

function isProductProfileBackupEntry(entryPath) {
  if (typeof entryPath !== 'string' || entryPath.includes('\0')) return false;
  const normalized = entryPath.replaceAll('\\', '/');
  return path.posix.basename(normalized).toLocaleLowerCase('en-US') === PRODUCT_PROFILE_FILE_NAME.toLocaleLowerCase('en-US');
}

function resolveProductProfileBackupTarget(detailSetsRoot, entryPath) {
  if (!detailSetsRoot || !isProductProfileBackupEntry(entryPath)) return null;
  const normalized = entryPath.replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalized) || /^[a-z]:\//i.test(normalized)) return null;

  const root = path.resolve(detailSetsRoot);
  const target = path.resolve(root, ...normalized.split('/').filter(Boolean));
  return target !== root && isSameOrChildPath(root, target) ? target : null;
}

async function collectProductProfileBackupEntries(detailSetsRoot) {
  if (!detailSetsRoot) return [];
  const root = path.resolve(detailSetsRoot);
  const entries = [];

  async function walk(folder) {
    let children;
    try {
      children = await fsp.readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    children.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }));
    for (const child of children) {
      const fullPath = path.join(folder, child.name);
      if (child.isDirectory()) {
        await walk(fullPath);
      } else if (child.isFile() && child.name.toLocaleLowerCase('en-US') === PRODUCT_PROFILE_FILE_NAME.toLocaleLowerCase('en-US')) {
        entries.push({
          sourcePath: fullPath,
          archivePath: path.relative(root, fullPath).split(path.sep).join('/')
        });
      }
    }
  }

  await walk(root);
  return entries.sort((left, right) => left.archivePath.localeCompare(right.archivePath, 'zh-CN', { numeric: true }));
}

module.exports = {
  EMPTY_PROMPT_TEXT,
  FIELD_ALIASES,
  PRODUCT_PROFILE_ANALYSIS_PROMPT,
  PRODUCT_PROFILE_FILE_NAME,
  TASK_METADATA_FOLDER,
  TASK_PRODUCT_PROFILE_FILE_NAME,
  buildProductProfileAnalysisPrompt,
  buildProductProfileAnalysisRequest,
  collectProductProfileBackupEntries,
  createTaskProductProfilePayload,
  emptyProductProfile,
  extractJsonObject,
  getTaskProductProfileFile,
  getTemplateProductProfileFile,
  isProductProfileBackupEntry,
  loadProductProfileForJob,
  loadTemplateProductProfile,
  mergeProductProfile,
  normalizeProductProfile,
  parseAiProductProfileContent,
  parseProductProfileChatResponse,
  readProductProfileFile,
  resolveProductProfileBackupTarget,
  serializeProductProfile,
  shouldRefreshTaskProductProfile,
  splitLines,
  toPromptText,
  toWpfProductProfile,
  writeProductProfileFile
};

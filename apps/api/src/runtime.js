const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { execFile } = require('node:child_process');
const sharp = require('sharp');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('@e965/xlsx');
const {
  extractImageResult,
  isImagePath,
  safeFileName
} = require('./core/business');
const {
  generateStandaloneTitles,
  generateTaobaoTitle,
  getTitleRootCandidates,
  mergeImportedTitleLibrary,
  normalizeHeader,
  normalizeTitleText,
  parseTitleKeywordRows,
  parseTitlePrefixRoots,
  parseTitleNumber,
  splitTitleRoots
} = require('./core/title-engine');
const {
  createFallbackTemplateAnalysis,
  createManualTemplateAnalysis,
  parseTemplateAnalysisSummary,
  rasterizeMask,
  readValidTemplateAnalysisCache,
  resolveGenerationAction,
  templateCachePaths,
  writeTemplateAnalysisCache
} = require('./core/template-regions');
const {
  appendOperationLog,
  applyBatchApproval,
  deriveFolderStatus,
  deriveImageStatus,
  isFolderReadyForTitle,
  metadataPaths,
  normalizeOperationLogs,
  normalizeReviewMetadata,
  normalizeSourceMetadata,
  summarizeGenerationProgress,
  toMacReviewMetadata,
  toMacSourceMetadata,
  toWpfManualReviewState,
  toWpfOperationLogs,
  toWpfSourceMetadata
} = require('./core/review-engine');
const {
  advanceTitleGenerationState,
  createTitleWorkbookRows,
  getTitleCategoryForReviewFolder
} = require('./core/title-task-engine');
const { createDefaultTitleLibrary } = require('./core/default-title-library');
const {
  applyMasterPromptTemplate
} = require('./core/prompts');
const {
  buildTemplateAuditPayload,
  buildTemplateAuditRecheckPayload,
  isInvalidAuditRequestingProductReplacement,
  parseTemplateAuditResult
} = require('./core/template-audit');
const {
  buildProductProfileAnalysisRequest,
  createTaskProductProfilePayload,
  getTaskProductProfileFile,
  getTemplateProductProfileFile,
  loadProductProfileForJob,
  loadTemplateProductProfile,
  normalizeProductProfile,
  parseProductProfileChatResponse,
  readProductProfileFile,
  shouldRefreshTaskProductProfile,
  toPromptText,
  writeProductProfileFile
} = require('./core/product-profile');
const {
  definitionById: promptDefinitionById,
  normalizePromptValue,
  publicPromptSettings,
  renderPromptTemplate
} = require('./core/prompt-settings');
const { isSameOrChildPath } = require('./core/path-utils');
const { createBillingService } = require('./billing');


const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const configuredDataRoot = String(process.env.CAISHEN_DATA_DIR || 'data');
const DATA_ROOT = path.isAbsolute(configuredDataRoot) ? configuredDataRoot : path.resolve(PROJECT_ROOT, configuredDataRoot);
const SYSTEM_STATE_ROOT = path.join(DATA_ROOT, 'system');
const billing = createBillingService(DATA_ROOT);
const DEFAULT_WORKSPACE_ID = String(process.env.CAISHEN_WORKSPACE_ID || 'local').replace(/[^a-zA-Z0-9_-]/g, '') || 'local';
const workspaceContext = new AsyncLocalStorage();
const configuredOutputRoots = new Map();

function normalizeWorkspaceId(value) {
  return String(value || DEFAULT_WORKSPACE_ID).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || DEFAULT_WORKSPACE_ID;
}

function currentWorkspaceId() {
  return normalizeWorkspaceId(workspaceContext.getStore()?.workspaceId || DEFAULT_WORKSPACE_ID);
}

function currentWorkspaceRoot() {
  return path.join(DATA_ROOT, 'workspaces', currentWorkspaceId());
}

function currentUserDataRoot() {
  return path.join(currentWorkspaceRoot(), 'state');
}

function currentDefaultOutputRoot() {
  return path.join(currentWorkspaceRoot(), 'outputs');
}

function runWithWorkspace(workspaceId, worker) {
  return workspaceContext.run({ workspaceId: normalizeWorkspaceId(workspaceId) }, worker);
}
const app = {
  getPath(name) {
    if (name === 'userData') return currentUserDataRoot();
    if (name === 'pictures') return currentDefaultOutputRoot();
    if (name === 'downloads') return path.join(currentWorkspaceRoot(), 'exports');
    return currentWorkspaceRoot();
  }
};

const ENV_API = Object.freeze({
  serviceUrl: String(process.env.CAISHEN_API_SERVICE_URL || '').trim(),
  baseUrl: String(process.env.CAISHEN_API_BASE_URL || '').trim(),
  key: String(process.env.CAISHEN_API_KEY || '').trim(),
  imageKey: String(process.env.CAISHEN_IMAGE_API_KEY || process.env.CAISHEN_API_KEY || '').trim(),
  analysisKey: String(process.env.CAISHEN_ANALYSIS_API_KEY || '').trim(),
  imageModel: String(process.env.CAISHEN_IMAGE_MODEL || 'gpt-image-2').trim(),
  analysisModel: String(process.env.CAISHEN_REVERSE_PROMPT_MODEL || 'gpt-5-3').trim(),
  analysisWireApi: String(process.env.CAISHEN_ANALYSIS_WIRE_API || 'chat_completions').trim(),
  responseFormat: String(process.env.CAISHEN_IMAGE_RESPONSE_FORMAT || 'url').trim(),
  requestTimeoutSeconds: Number(process.env.CAISHEN_API_TIMEOUT_SECONDS || 300)
});
let runtimeApiSettings = { version: 2, ...ENV_API };
const FILE_TOKEN_SECRET = String(process.env.CAISHEN_FILE_TOKEN_SECRET || ENV_API.imageKey || 'local-development-only');

function currentApiSettings() {
  return runtimeApiSettings;
}

function requireApiConfig(channel = 'image') {
  const settings = currentApiSettings();
  if (!settings.baseUrl) throw new Error('请先在系统设置中配置 API 地址');
  if (channel === 'analysis' && !settings.analysisKey) throw new Error('请先配置文字分析 API 密钥');
  if (channel === 'image' && !settings.imageKey) throw new Error('请先配置 Image2 生图 API 密钥');
  return settings;
}

const IMAGE_API_CONCURRENCY = Math.max(1, Number(process.env.CAISHEN_IMAGE_API_CONCURRENCY || 50));
const IMAGE_API_STAGGER_MIN_MS = Math.max(0, Number(process.env.CAISHEN_IMAGE_API_STAGGER_MIN_MS || 5000));
const IMAGE_API_STAGGER_MAX_MS = Math.max(IMAGE_API_STAGGER_MIN_MS, Number(process.env.CAISHEN_IMAGE_API_STAGGER_MAX_MS || 10000));
const CPU_OVERLOAD_RETRY_MIN_MS = Math.max(0, Number(process.env.CAISHEN_IMAGE_API_RETRY_MIN_MS || 45000));
const CPU_OVERLOAD_RETRY_MAX_MS = Math.max(CPU_OVERLOAD_RETRY_MIN_MS, Number(process.env.CAISHEN_IMAGE_API_RETRY_MAX_MS || 90000));
const CPU_OVERLOAD_MAX_ATTEMPTS = 3;
const ANALYSIS_RETRY_BASE_MS = Math.max(1, Number(process.env.CAISHEN_ANALYSIS_RETRY_BASE_MS || 600));

class AsyncSemaphore {
  constructor(limit) {
    this.limit = Math.max(1, Number(limit) || 1);
    this.active = 0;
    this.waiters = [];
  }

  async acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise(resolve => this.waiters.push(resolve));
    this.active += 1;
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    this.waiters.shift()?.();
  }

  async use(worker) {
    await this.acquire();
    try { return await worker(); }
    finally { this.release(); }
  }
}

const imageApiSlots = new AsyncSemaphore(IMAGE_API_CONCURRENCY);
const warmingTemplateFolders = new Set();

let mainWindow;
let promptSettingsWriteChain = Promise.resolve();
let apiSettingsWriteChain = Promise.resolve();

function localDateParts(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return {
    year: date.getFullYear(),
    month: pad(date.getMonth() + 1),
    day: pad(date.getDate()),
    hour: pad(date.getHours()),
    minute: pad(date.getMinutes()),
    second: pad(date.getSeconds())
  };
}

function localFileTimestamp(date = new Date()) {
  const value = localDateParts(date);
  return `${value.year}${value.month}${value.day}_${value.hour}${value.minute}${value.second}`;
}

function localDisplayTimestamp(date = new Date()) {
  const value = localDateParts(date);
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}:${value.second}`;
}

function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}

function promptSettingsFile() {
  return path.join(SYSTEM_STATE_ROOT, 'prompt-settings.json');
}

function apiSettingsFile() {
  return path.join(SYSTEM_STATE_ROOT, 'api-settings.json');
}

function legacyAdminSettingFile(name) {
  return path.join(DATA_ROOT, 'workspaces', 'local', 'state', name);
}

async function readGlobalSettingWithLegacy(file, legacyName) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch {}
  try {
    const value = JSON.parse(await fsp.readFile(legacyAdminSettingFile(legacyName), 'utf8'));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    return value;
  } catch {
    return {};
  }
}

function normalizeApiBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) return '';
  if (text.length > 2000) throw new Error('API 地址过长');
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error('API 地址格式不正确'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('API 地址只支持 http 或 https');
  return text;
}

function normalizeModelName(value, fallback) {
  const text = String(value || fallback || '').trim();
  if (!text || text.length > 120 || /[\r\n]/.test(text)) throw new Error('模型名称格式不正确');
  return text;
}

function normalizeResponseFormat(value, fallback = 'url') {
  const text = String(value || fallback || 'url').trim();
  if (!['b64_json', 'url'].includes(text)) throw new Error('图片响应格式不支持');
  return text;
}

function normalizeRequestTimeoutSeconds(value, fallback = 300) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 15 || number > 600) throw new Error('请求超时必须在 15 到 600 秒之间');
  return Math.round(number);
}

function normalizeAnalysisWireApi(value, fallback = 'chat_completions') {
  const text = String(value || fallback || 'chat_completions').trim().toLowerCase().replaceAll('-', '_');
  if (text === 'responses') return 'responses';
  if (text === 'chat' || text === 'chat_completions') return 'chat_completions';
  throw new Error('文字接口协议只支持 Responses API 或 Chat Completions');
}

function apiBaseRoot(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '').replace(/\/v1(?:beta)?$/i, '');
}

function apiEndpoint(baseUrl, pathName) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const pathText = String(pathName || '').startsWith('/') ? String(pathName || '') : `/${pathName || ''}`;
  if (/change2pro\.com/i.test(base)) {
    const root = apiBaseRoot(base);
    if (pathText === '/models' || pathText === '/chat/completions' || pathText === '/usage') return `${root}/v1${pathText}`;
    return `${root}${pathText}`;
  }
  return `${base}${pathText}`;
}

function maskedApiKey(value) {
  const key = String(value || '');
  if (!key) return '';
  if (key.length <= 8) return `${key.slice(0, 2)}••••${key.slice(-2)}`;
  return `${key.slice(0, 4)}••••••${key.slice(-4)}`;
}

async function readPrivateApiSettings() {
  const saved = await readGlobalSettingWithLegacy(apiSettingsFile(), 'api-settings.json');
  const legacyImageKey = String(saved.key || ENV_API.imageKey || ENV_API.key || '').trim();
  const next = {
    version: 2,
    serviceUrl: String(saved.serviceUrl || ENV_API.serviceUrl || '').trim(),
    baseUrl: normalizeApiBaseUrl(saved.baseUrl || ENV_API.baseUrl || ''),
    imageKey: String(saved.imageKey || legacyImageKey).trim(),
    analysisKey: String(saved.analysisKey || ENV_API.analysisKey || '').trim(),
    imageModel: normalizeModelName(saved.imageModel, ENV_API.imageModel),
    analysisModel: normalizeModelName(saved.analysisModel, ENV_API.analysisModel),
    analysisWireApi: normalizeAnalysisWireApi(saved.analysisWireApi, ENV_API.analysisWireApi),
    responseFormat: normalizeResponseFormat(saved.responseFormat, ENV_API.responseFormat),
    requestTimeoutSeconds: normalizeRequestTimeoutSeconds(saved.requestTimeoutSeconds, ENV_API.requestTimeoutSeconds)
  };
  runtimeApiSettings = next;
  return next;
}

function publicApiSettings(value = currentApiSettings()) {
  const imageConfigured = Boolean(value.baseUrl && value.imageKey);
  const analysisConfigured = Boolean(value.baseUrl && value.analysisKey);
  return {
    version: 2,
    baseUrl: String(value.baseUrl || ''),
    imageModel: String(value.imageModel || ENV_API.imageModel),
    analysisModel: String(value.analysisModel || ENV_API.analysisModel),
    analysisWireApi: normalizeAnalysisWireApi(value.analysisWireApi, ENV_API.analysisWireApi),
    responseFormat: normalizeResponseFormat(value.responseFormat, ENV_API.responseFormat),
    requestTimeoutSeconds: normalizeRequestTimeoutSeconds(value.requestTimeoutSeconds, ENV_API.requestTimeoutSeconds),
    imageKeyConfigured: Boolean(value.imageKey),
    imageKeyMasked: maskedApiKey(value.imageKey),
    analysisKeyConfigured: Boolean(value.analysisKey),
    analysisKeyMasked: maskedApiKey(value.analysisKey),
    imageConfigured,
    analysisConfigured,
    configured: imageConfigured && analysisConfigured
  };
}

async function loadApiSettings() {
  return publicApiSettings(await readPrivateApiSettings());
}

async function saveApiSettings(payload = {}) {
  const operation = apiSettingsWriteChain.then(async () => {
    const current = await readPrivateApiSettings();
    const next = {
      version: 2,
      serviceUrl: current.serviceUrl,
      baseUrl: normalizeApiBaseUrl(payload.baseUrl),
      imageKey: String(payload.imageApiKey || payload.apiKey || '').trim() || current.imageKey,
      analysisKey: String(payload.analysisApiKey || '').trim() || current.analysisKey,
      imageModel: normalizeModelName(payload.imageModel, current.imageModel),
      analysisModel: normalizeModelName(payload.analysisModel, current.analysisModel),
      analysisWireApi: normalizeAnalysisWireApi(payload.analysisWireApi, current.analysisWireApi),
      responseFormat: normalizeResponseFormat(payload.responseFormat, current.responseFormat),
      requestTimeoutSeconds: normalizeRequestTimeoutSeconds(payload.requestTimeoutSeconds, current.requestTimeoutSeconds)
    };
    if (!next.baseUrl) throw new Error('请填写 API 地址');
    if (!next.imageKey && !next.analysisKey) throw new Error('请至少填写一个 API 密钥');
    await fsp.mkdir(path.dirname(apiSettingsFile()), { recursive: true });
    await fsp.writeFile(apiSettingsFile(), JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    runtimeApiSettings = next;
    return publicApiSettings(next);
  });
  apiSettingsWriteChain = operation.catch(() => {});
  return operation;
}

async function testApiSettings(payload = {}) {
  const current = await readPrivateApiSettings();
  const channel = payload.channel === 'analysis' ? 'analysis' : 'image';
  const draft = {
    baseUrl: normalizeApiBaseUrl(payload.baseUrl || current.baseUrl),
    key: channel === 'analysis'
      ? String(payload.analysisApiKey || '').trim() || current.analysisKey
      : String(payload.imageApiKey || payload.apiKey || '').trim() || current.imageKey,
    requestTimeoutSeconds: normalizeRequestTimeoutSeconds(payload.requestTimeoutSeconds, current.requestTimeoutSeconds)
  };
  if (!draft.baseUrl) throw new Error('请先填写 API 地址');
  if (!draft.key) throw new Error(channel === 'analysis' ? '请先配置文字分析 API 密钥' : '请先配置 Image2 生图 API 密钥');
  const startedAt = Date.now();
  const body = await apiJson(apiEndpoint(draft.baseUrl, '/models'), {
    method: 'GET',
    headers: { Authorization: `Bearer ${draft.key}`, Accept: 'application/json' }
  }, Math.min(draft.requestTimeoutSeconds * 1000, 60000));
  const sourceModels = Array.isArray(body?.data) ? body.data
    : Array.isArray(body?.models) ? body.models
      : [];
  const models = sourceModels.slice(0, 500).map(item => ({
    id: String(item?.id || item?.name || '').replace(/^models\//, '').trim().slice(0, 200),
    object: String(item?.object || 'model').trim().slice(0, 80),
    created: Number.isFinite(Number(item?.created)) ? Number(item.created) : 0,
    ownedBy: String(item?.owned_by || '').trim().slice(0, 120)
  })).filter(item => item.id);
  return { ok: true, channel, latencyMs: Date.now() - startedAt, modelCount: models.length, models };
}

async function testAnalysisApi(payload = {}) {
  const current = await readPrivateApiSettings();
  const draft = {
    baseUrl: normalizeApiBaseUrl(payload.baseUrl || current.baseUrl),
    key: String(payload.analysisApiKey || '').trim() || current.analysisKey,
    analysisModel: normalizeModelName(payload.analysisModel, current.analysisModel),
    analysisWireApi: normalizeAnalysisWireApi(payload.analysisWireApi, current.analysisWireApi),
    requestTimeoutSeconds: normalizeRequestTimeoutSeconds(payload.requestTimeoutSeconds, current.requestTimeoutSeconds)
  };
  if (!draft.baseUrl) throw new Error('请先填写 API 地址');
  if (!draft.key) throw new Error('请先配置文字分析 API 密钥');
  const modelResult = await testApiSettings({
    ...payload,
    channel: 'analysis',
    baseUrl: draft.baseUrl,
    analysisApiKey: draft.key,
    requestTimeoutSeconds: draft.requestTimeoutSeconds
  });
  if (!modelResult.models.some(model => model.id === draft.analysisModel)) {
    const available = modelResult.models.map(model => model.id).join('、') || '无';
    throw new Error(`文字分析密钥不支持模型 ${draft.analysisModel}；可用模型：${available}`);
  }
  const startedAt = Date.now();
  const body = await analysisApiJson({
    ...draft,
    analysisKey: draft.key
  }, {
    model: draft.analysisModel,
    messages: [{ role: 'user', content: '仅回复 OK' }],
    stream: false,
    max_tokens: 8
  }, Math.min(draft.requestTimeoutSeconds * 1000, 60000));
  if (!Array.isArray(body?.choices) || !body.choices.length) throw new Error('分析接口响应格式不正确：缺少 choices');
  const content = body.choices[0]?.message?.content;
  return {
    ok: true,
    latencyMs: Date.now() - startedAt,
    model: draft.analysisModel,
    wireApi: draft.analysisWireApi,
    responsePreview: typeof content === 'string' ? content.trim().slice(0, 80) : ''
  };
}

function apiSettingsStatus() {
  return publicApiSettings(currentApiSettings());
}

async function readSavedPromptSettings() {
  const value = await readGlobalSettingWithLegacy(promptSettingsFile(), 'prompt-settings.json');
  return value && typeof value === 'object' ? value : {};
}

async function loadPromptSettings() {
  return publicPromptSettings(await readSavedPromptSettings());
}

async function getPromptValue(id) {
  const settings = await loadPromptSettings();
  const prompt = settings.prompts.find(item => item.id === id);
  if (!prompt) throw new Error(`未知提示词：${id}`);
  return prompt.value;
}

async function savePromptSetting(id, value) {
  const operation = promptSettingsWriteChain.then(async () => {
    const text = normalizePromptValue(String(id || ''), value);
    const saved = await readSavedPromptSettings();
    const next = {
      prompts: { ...(saved.prompts || {}), [id]: text },
      updatedAt: new Date().toISOString()
    };
    await fsp.mkdir(path.dirname(promptSettingsFile()), { recursive: true });
    await fsp.writeFile(promptSettingsFile(), JSON.stringify(next, null, 2));
    return loadPromptSettings();
  });
  promptSettingsWriteChain = operation.catch(() => {});
  return operation;
}

async function resetPromptSetting(id = '') {
  const operation = promptSettingsWriteChain.then(async () => {
    const saved = await readSavedPromptSettings();
    if (!id) {
      await fsp.rm(promptSettingsFile(), { force: true });
      return loadPromptSettings();
    }
    if (!promptDefinitionById.has(id)) throw new Error(`未知提示词：${id}`);
    const prompts = { ...(saved.prompts || {}) };
    delete prompts[id];
    const next = { prompts, updatedAt: new Date().toISOString() };
    await fsp.mkdir(path.dirname(promptSettingsFile()), { recursive: true });
    await fsp.writeFile(promptSettingsFile(), JSON.stringify(next, null, 2));
    return loadPromptSettings();
  });
  promptSettingsWriteChain = operation.catch(() => {});
  return operation;
}

function defaultConfig() {
  return {
    operatorCode: 'ys',
    categoriesPath: '',
    printsPath: '',
    detailSetsPath: '',
    outputPath: currentDefaultOutputRoot(),
    imageSize: '1024x1024',
    imageQuality: 'auto',
    auditMode: 'saving'
  };
}

async function loadConfig() {
  try {
    const config = { ...defaultConfig(), ...JSON.parse(await fsp.readFile(configFile(), 'utf8')) };
    configuredOutputRoots.set(currentWorkspaceId(), path.resolve(config.outputPath || currentDefaultOutputRoot()));
    return config;
  } catch {
    const config = defaultConfig();
    await saveConfig(config);
    return config;
  }
}

async function saveConfig(next) {
  const safe = {
    ...defaultConfig(),
    operatorCode: String(next.operatorCode || 'ys').trim().slice(0, 20),
    categoriesPath: String(next.categoriesPath || '').trim(),
    printsPath: String(next.printsPath || '').trim(),
    detailSetsPath: String(next.detailSetsPath || '').trim(),
    outputPath: String(next.outputPath || currentDefaultOutputRoot()).trim(),
    imageSize: String(next.imageSize || '1024x1024'),
    imageQuality: String(next.imageQuality || 'auto'),
    auditMode: next.auditMode === 'quality' ? 'quality' : 'saving'
  };
  await fsp.mkdir(safe.outputPath, { recursive: true });
  configuredOutputRoots.set(currentWorkspaceId(), path.resolve(safe.outputPath));
  await fsp.mkdir(path.dirname(configFile()), { recursive: true });
  await fsp.writeFile(configFile(), JSON.stringify(safe, null, 2));
  return safe;
}

function titleLibraryFile() {
  return path.join(app.getPath('userData'), 'current-title-library.json');
}

function titleKeywordLibraryRoot() {
  return path.join(app.getPath('userData'), 'title-keyword-libraries');
}

function categoryTitleLibraryFile(categoryName) {
  return path.join(titleKeywordLibraryRoot(), `${safeFileName(categoryName)}.json`);
}

function titleGenerationStateFile() {
  return path.join(app.getPath('userData'), 'standalone-title-generation-state.json');
}

function titleGenerationStateKey(library, prefixRoots) {
  const libraryName = normalizeTitleText(library?.sourceFileName || '');
  const prefixes = prefixRoots.map(normalizeTitleText).join('|');
  const required = (library?.requiredRoots || []).map(normalizeTitleText).filter(Boolean).join('|');
  return `${libraryName}::${prefixes}::${required}`;
}

async function loadTitleGenerationState() {
  try {
    const parsed = JSON.parse(await fsp.readFile(titleGenerationStateFile(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : { nextIndexes: {} };
  } catch {
    return { nextIndexes: {} };
  }
}

async function saveTitleGenerationState(state) {
  await fsp.mkdir(path.dirname(titleGenerationStateFile()), { recursive: true });
  await fsp.writeFile(titleGenerationStateFile(), JSON.stringify(state, null, 2));
}

async function loadTitleLibrary() {
  try {
    return JSON.parse(await fsp.readFile(titleLibraryFile(), 'utf8'));
  } catch {
    const library = createDefaultTitleLibrary();
    await fsp.mkdir(path.dirname(titleLibraryFile()), { recursive: true });
    await fsp.writeFile(titleLibraryFile(), JSON.stringify(library, null, 2));
    await saveCategoryTitleLibrary(library);
    return library;
  }
}

async function saveTitleLibrary(library) {
  await fsp.mkdir(path.dirname(titleLibraryFile()), { recursive: true });
  await fsp.writeFile(titleLibraryFile(), JSON.stringify(library, null, 2));
  return publicTitleLibrary(library);
}

async function saveCategoryTitleLibrary(library) {
  if (!library?.categoryName) return;
  await fsp.mkdir(titleKeywordLibraryRoot(), { recursive: true });
  await fsp.writeFile(categoryTitleLibraryFile(library.categoryName), JSON.stringify(library, null, 2));
}

async function loadCategoryTitleLibrary(categoryName) {
  const category = String(categoryName || '').trim();
  if (!category) return null;
  try {
    return JSON.parse(await fsp.readFile(categoryTitleLibraryFile(category), 'utf8'));
  } catch {
    // Earlier Mac builds only stored the currently selected library. Migrate it
    // lazily so already-imported keyword files also work for approved tasks.
    const current = await loadTitleLibrary();
    if (String(current?.categoryName || '').localeCompare(category, 'zh-CN', { sensitivity: 'accent' }) === 0) {
      await saveCategoryTitleLibrary(current);
      return current;
    }
    return null;
  }
}

function titleRootCandidates(library) {
  return getTitleRootCandidates(library);
}

function publicTitleLibrary(library) {
  if (!library) return null;
  return {
    categoryName: library.categoryName || '',
    sourceFileName: library.sourceFileName,
    recordCount: library.records?.length || 0,
    prefixRoots: library.prefixRoots || [],
    requiredRoots: library.requiredRoots || [],
    rootCandidates: titleRootCandidates(library).slice(0, 80)
  };
}

async function importTitleLibrary(fileValue) {
  const file = path.resolve(String(fileValue || ''));
  if (!fileValue || !fs.existsSync(file)) throw new Error('请选择 Excel 或 CSV 关键词表');
  const workbook = path.extname(file).toLowerCase() === '.csv'
    ? XLSX.read(await fsp.readFile(file, 'utf8'), { type: 'string' })
    : XLSX.readFile(file);
  const sheetName = workbook.SheetNames[0];
  const worksheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!worksheet) throw new Error('Excel 没有工作表');
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });
  if (!rows.length) throw new Error('Excel 表为空');
  const imported = parseTitleKeywordRows(rows, {
    fileName: file,
    sheetName,
    importedAt: new Date().toISOString()
  });
  if (!imported.records.length) throw new Error('关键词列没有有效数据');
  const existing = await loadTitleLibrary();
  const library = { ...mergeImportedTitleLibrary(imported, existing), sourcePath: file };
  await saveCategoryTitleLibrary(library);
  await saveTitleLibrary(library);
  return publicTitleLibrary(library);
}

function isWorkspacePath(file) {
  return isSameOrChildPath(currentWorkspaceRoot(), file);
}

function isOutputPath(file) {
  return isSameOrChildPath(configuredOutputRoots.get(currentWorkspaceId()) || currentDefaultOutputRoot(), file);
}

function isServablePath(file) {
  return isWorkspacePath(file) || isOutputPath(file);
}

function fileToken(file) {
  const resolved = path.resolve(String(file || ''));
  if (!isServablePath(resolved)) throw new Error('文件不属于当前工作区或成品输出目录');
  const payload = Buffer.from(resolved).toString('base64url');
  const signature = crypto.createHmac('sha256', FILE_TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function fileFromToken(tokenValue) {
  try {
    const [payload, signature] = String(tokenValue || '').split('.');
    if (!payload || !signature) return '';
    const expected = crypto.createHmac('sha256', FILE_TOKEN_SECRET).update(payload).digest('base64url');
    const actualBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return '';
    const file = Buffer.from(payload, 'base64url').toString();
    return isServablePath(file) ? path.resolve(file) : '';
  } catch {
    return '';
  }
}

function imageUrl(file) {
  return `/api/files/${fileToken(file)}`;
}

function thumbnailUrl(file, width, version) {
  return `/api/thumbnails/${fileToken(file)}?w=${width}&v=${encodeURIComponent(version)}`;
}

async function scanImages(root, query = '', limit = 10000) {
  if (!root) return [];
  const rootStat = await fsp.stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) return [];
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const files = [];

  async function walk(directory, depth) {
    if (files.length >= limit || depth > 24) return;
    let entries = [];
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath, depth + 1);
      else if (entry.isFile() && isImagePath(fullPath) && (!normalizedQuery || fullPath.toLocaleLowerCase('zh-CN').includes(normalizedQuery))) {
        const stat = await fsp.stat(fullPath).catch(() => null);
        const version = stat ? `${Math.trunc(stat.mtimeMs)}-${stat.size}` : '1';
        files.push({
          path: fullPath,
          name: entry.name,
          folder: path.relative(root, directory) || '根目录',
          url: `${imageUrl(fullPath)}?v=${version}`,
          thumbnailUrl: thumbnailUrl(fullPath, 480, version),
          previewUrl: thumbnailUrl(fullPath, 1200, version)
        });
      }
    }
  }

  await walk(root, 0);
  return files;
}

function imageMimeType(file) {
  const extension = path.extname(file).toLowerCase();
  return extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
    : extension === '.webp' ? 'image/webp'
      : extension === '.gif' ? 'image/gif'
        : extension === '.bmp' ? 'image/bmp'
          : 'image/png';
}

async function imageAsDataUrl(file) {
  if (!isImagePath(file)) throw new Error('不支持的图片格式');
  const mime = imageMimeType(file);
  return `data:${mime};base64,${(await fsp.readFile(file)).toString('base64')}`;
}

async function imageAsAnalysisDataUrl(file) {
  if (!isImagePath(file)) throw new Error('不支持的图片格式');
  const bytes = await sharp(file, { failOn: 'none', animated: false, limitInputPixels: 120_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

function shouldUsePowerShellApiFallback(url, error) {
  return process.platform === 'win32'
    && /change2pro\.com/i.test(String(url || ''))
    && /fetch failed|ECONNRESET|socket|network/i.test(`${error?.message || ''} ${error?.cause?.code || ''}`);
}

async function powershellJsonRequest(url, options = {}, timeoutMs = 120000) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = options.headers || {};
  const body = typeof options.body === 'string' ? options.body : '';
  const payload = JSON.stringify({
    url,
    method,
    headers,
    body,
    timeoutSeconds: Math.max(15, Math.ceil(timeoutMs / 1000))
  });
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'caishen-api-'));
  const payloadFile = path.join(tempRoot, 'payload.json');
  const scriptFile = path.join(tempRoot, 'request.ps1');
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$payload = [IO.File]::ReadAllText($args[0], [Text.Encoding]::UTF8) | ConvertFrom-Json
$headers = @{}
$contentType = ''
$payload.headers.PSObject.Properties | ForEach-Object {
  if ($_.Name -ieq 'Content-Type') { $contentType = [string]$_.Value }
  else { $headers[$_.Name] = [string]$_.Value }
}
$params = @{ Uri = [string]$payload.url; Method = [string]$payload.method; Headers = $headers; TimeoutSec = [int]$payload.timeoutSeconds }
if ($contentType) { $params.ContentType = $contentType }
if ([string]$payload.body) { $params.Body = [Text.Encoding]::UTF8.GetBytes([string]$payload.body) }
try {
  $response = Invoke-WebRequest @params -UseBasicParsing
  [Console]::Out.Write((@{ status = [int]$response.StatusCode; body = [string]$response.Content } | ConvertTo-Json -Compress -Depth 5))
} catch {
  $status = 0
  $content = ''
  if ($_.Exception.Response) {
    $status = [int]$_.Exception.Response.StatusCode
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      if ($stream) {
        $reader = New-Object IO.StreamReader($stream)
        $content = $reader.ReadToEnd()
      }
    } catch {}
  }
  if (-not $content) { $content = $_.ErrorDetails.Message }
  if (-not $content) { $content = $_.Exception.Message }
  [Console]::Out.Write((@{ status = $status; body = [string]$content } | ConvertTo-Json -Compress -Depth 5))
}
`;
  await fsp.writeFile(payloadFile, payload, 'utf8');
  await fsp.writeFile(scriptFile, script, 'utf8');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, payloadFile], {
      timeout: timeoutMs + 5000,
      windowsHide: true,
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024
    }, (error, stdout, stderr) => {
      fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
      const outputText = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout || '');
      const errorText = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr || '');
      if (error) return reject(new Error(errorText || error.message));
      try { return resolve(JSON.parse(outputText || '{}')); }
      catch { return reject(new Error(outputText || errorText || 'PowerShell API request failed')); }
    });
  });
}

async function powershellMultipartJsonRequest(url, request = {}, timeoutMs = 120000) {
  const payload = JSON.stringify({
    url,
    headers: request.headers || {},
    fields: request.fields || [],
    files: request.files || [],
    timeoutSeconds: Math.max(15, Math.ceil(timeoutMs / 1000))
  });
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'caishen-image-api-'));
  const payloadFile = path.join(tempRoot, 'payload.json');
  const scriptFile = path.join(tempRoot, 'request.ps1');
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Net.Http
$payload = [IO.File]::ReadAllText($args[0], [Text.Encoding]::UTF8) | ConvertFrom-Json
$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds([int]$payload.timeoutSeconds)
$payload.headers.PSObject.Properties | ForEach-Object {
  if ($_.Name -ine 'Content-Type') {
    [void]$client.DefaultRequestHeaders.TryAddWithoutValidation([string]$_.Name, [string]$_.Value)
  }
}
$content = [System.Net.Http.MultipartFormDataContent]::new()
foreach ($field in @($payload.fields)) {
  $part = [System.Net.Http.StringContent]::new([string]$field.value, [Text.Encoding]::UTF8)
  $content.Add($part, [string]$field.name)
}
foreach ($file in @($payload.files)) {
  $bytes = [IO.File]::ReadAllBytes([string]$file.path)
  $part = [System.Net.Http.ByteArrayContent]::new($bytes)
  if ([string]$file.contentType) {
    $part.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse([string]$file.contentType)
  }
  $content.Add($part, [string]$file.name, [string]$file.fileName)
}
try {
  $response = $client.PostAsync([string]$payload.url, $content).GetAwaiter().GetResult()
  $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  [Console]::Out.Write((@{ status = [int]$response.StatusCode; body = [string]$responseBody } | ConvertTo-Json -Compress -Depth 5))
} catch {
  $responseBody = $_.Exception.Message
  [Console]::Out.Write((@{ status = 0; body = [string]$responseBody } | ConvertTo-Json -Compress -Depth 5))
} finally {
  if ($content) { $content.Dispose() }
  if ($client) { $client.Dispose() }
}
`;
  await fsp.writeFile(payloadFile, payload, 'utf8');
  await fsp.writeFile(scriptFile, script, 'utf8');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, payloadFile], {
      timeout: timeoutMs + 5000,
      windowsHide: true,
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024
    }, (error, stdout, stderr) => {
      fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
      const outputText = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout || '');
      const errorText = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr || '');
      if (error) return reject(new Error(errorText || error.message));
      try { return resolve(JSON.parse(outputText || '{}')); }
      catch { return reject(new Error(outputText || errorText || 'PowerShell image API request failed')); }
    });
  });
}

async function apiJson(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (!shouldUsePowerShellApiFallback(url, error)) throw error;
      const fallback = await powershellJsonRequest(url, options, timeoutMs);
      const text = fallback.body || '';
      let body;
      try { body = JSON.parse(text); } catch { body = { error: { message: text || `HTTP ${fallback.status}` } }; }
      if (fallback.status < 200 || fallback.status >= 300) throw new Error(body?.error?.message || body?.message || text || `HTTP ${fallback.status}`);
      return body;
    }
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { error: { message: text || `HTTP ${response.status}` } }; }
    if (!response.ok) throw new Error(body?.error?.message || body?.message || text || `HTTP ${response.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function billableLlmJson(url, options = {}, timeoutMs = 120000, metadata = {}) {
  const reservation = await billing.reserve(currentWorkspaceId(), 'llm', metadata);
  try {
    const body = await apiJson(url, options, timeoutMs);
    await billing.commit(reservation);
    return body;
  } catch (error) {
    await billing.release(reservation).catch(() => {});
    throw error;
  }
}

function chatContentToResponses(content, role = 'user') {
  const items = Array.isArray(content) ? content : [{ type: 'text', text: String(content || '') }];
  return items.map(item => {
    if (item?.type === 'image_url') {
      const imageUrl = typeof item.image_url === 'string' ? item.image_url : item.image_url?.url;
      return { type: 'input_image', image_url: String(imageUrl || '') };
    }
    const text = item?.text ?? item?.content ?? '';
    return { type: role === 'assistant' ? 'output_text' : 'input_text', text: String(text) };
  });
}

function chatPayloadToResponses(payload = {}) {
  const next = {
    model: String(payload.model || ''),
    input: (payload.messages || []).map(message => ({
      role: String(message?.role || 'user'),
      content: chatContentToResponses(message?.content, message?.role)
    })),
    store: false,
    stream: false
  };
  const maximumTokens = Number(payload.max_output_tokens ?? payload.max_completion_tokens ?? payload.max_tokens);
  if (Number.isFinite(maximumTokens) && maximumTokens > 0) next.max_output_tokens = Math.round(maximumTokens);
  if (Number.isFinite(Number(payload.temperature))) next.temperature = Number(payload.temperature);
  return next;
}

function responsesOutputText(body = {}) {
  if (typeof body.output_text === 'string') return body.output_text.trim();
  const values = [];
  for (const output of Array.isArray(body.output) ? body.output : []) {
    for (const content of Array.isArray(output?.content) ? output.content : []) {
      const text = typeof content?.text === 'string' ? content.text : content?.text?.value;
      if (typeof text === 'string' && text.trim()) values.push(text.trim());
    }
  }
  return values.join('\n').trim();
}

function normalizeAnalysisResponse(body, wireApi) {
  if (wireApi !== 'responses') return body;
  return {
    ...body,
    choices: [{ message: { content: responsesOutputText(body) } }]
  };
}

function analysisContentToString(content) {
  if (typeof content === 'string') return content.trim();
  if (content == null) return '';
  if (Array.isArray(content)) {
    return content.map(item => analysisContentToString(item)).filter(Boolean).join('\n').trim();
  }
  if (typeof content === 'object') {
    const candidates = [
      content.text,
      content.value,
      content.content,
      content.message,
      content.output_text,
      content?.text?.value
    ];
    for (const candidate of candidates) {
      const value = analysisContentToString(candidate);
      if (value) return value;
    }
  }
  return '';
}

async function analysisApiJson(api, chatPayload, timeoutMs, metadata = null) {
  const wireApi = normalizeAnalysisWireApi(api.analysisWireApi, 'chat_completions');
  const pathName = wireApi === 'responses' ? '/responses' : '/chat/completions';
  const payload = wireApi === 'responses' ? chatPayloadToResponses(chatPayload) : chatPayload;
  const options = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${api.analysisKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  };
  const body = metadata
    ? await billableLlmJson(apiEndpoint(api.baseUrl, pathName), options, timeoutMs, metadata)
    : await apiJson(apiEndpoint(api.baseUrl, pathName), options, timeoutMs);
  return normalizeAnalysisResponse(body, wireApi);
}

function randomDelay(minimumMs, maximumMs, signal = null) {
  const minimum = Math.max(0, Math.trunc(minimumMs));
  const maximum = Math.max(minimum, Math.trunc(maximumMs));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('任务已停止'));
    const timer = setTimeout(resolve, minimum + Math.floor(Math.random() * (maximum - minimum + 1)));
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer);
      reject(new Error('任务已停止'));
    }, { once: true });
  });
}

function isRetryableImageApiFailure(status, value) {
  const numericStatus = Number(status) || 0;
  if ([408, 409, 425, 429].includes(numericStatus) || numericStatus >= 500) return true;
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  return /system_cpu_overloaded|cpu overloaded|temporar(?:y|ily) unavailable|upstream service|server is busy|service unavailable|rate limit|too many requests|try again|timeout/i.test(text);
}

function retryableImageApiMessage(attempt, status, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  const reason = text.trim().slice(0, 180) || `HTTP ${status}`;
  return `第 ${attempt} 次请求返回临时错误：${reason}`;
}

async function imageApiJsonWithRetry(url, optionsOrFactory = {}, timeoutMs = 120000) {
  let lastError = '';
  for (let attempt = 1; attempt <= CPU_OVERLOAD_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const preOptions = typeof optionsOrFactory === 'function' ? null : optionsOrFactory;
    await randomDelay(IMAGE_API_STAGGER_MIN_MS, IMAGE_API_STAGGER_MAX_MS, preOptions?.signal || null);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let externalSignal = null;
    let abortFromExternal = null;
    try {
      const options = typeof optionsOrFactory === 'function' ? await optionsOrFactory() : optionsOrFactory;
      externalSignal = options?.signal || null;
      abortFromExternal = () => controller.abort();
      if (externalSignal?.aborted) controller.abort();
      else externalSignal?.addEventListener?.('abort', abortFromExternal, { once: true });
      const { signal: _ignoredSignal, _powershellMultipart, ...fetchOptions } = options || {};
      let response;
      try {
        response = await fetch(url, { ...fetchOptions, signal: controller.signal });
      } catch (error) {
        if (!_powershellMultipart || !shouldUsePowerShellApiFallback(url, error)) throw error;
        const fallback = await powershellMultipartJsonRequest(url, {
          headers: fetchOptions.headers || {},
          ..._powershellMultipart
        }, timeoutMs);
        const fallbackText = fallback.body || '';
        let fallbackBody;
        try { fallbackBody = JSON.parse(fallbackText); } catch { fallbackBody = { error: { message: fallbackText || `HTTP ${fallback.status}` } }; }
        if (fallback.status >= 200 && fallback.status < 300) return fallbackBody;
        if (isRetryableImageApiFailure(fallback.status, fallbackText || fallbackBody) && attempt < CPU_OVERLOAD_MAX_ATTEMPTS) {
          lastError = retryableImageApiMessage(attempt, fallback.status, fallbackText || fallbackBody);
          await randomDelay(CPU_OVERLOAD_RETRY_MIN_MS, CPU_OVERLOAD_RETRY_MAX_MS, null);
          continue;
        }
        throw new Error(fallbackBody?.error?.message || fallbackBody?.message || fallbackText || `HTTP ${fallback.status}`);
      }
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { error: { message: text || `HTTP ${response.status}` } }; }
      if (response.ok) return body;
      if (isRetryableImageApiFailure(response.status, text || body) && attempt < CPU_OVERLOAD_MAX_ATTEMPTS) {
        lastError = retryableImageApiMessage(attempt, response.status, text || body);
        await randomDelay(CPU_OVERLOAD_RETRY_MIN_MS, CPU_OVERLOAD_RETRY_MAX_MS, externalSignal);
        continue;
      }
      throw new Error(body?.error?.message || body?.message || text || `HTTP ${response.status}`);
    } catch (error) {
      if (!/AbortError|fetch failed|network|socket|ECONN|ENOTFOUND|EAI_AGAIN|temporar(?:y|ily) unavailable|upstream service|server is busy|service unavailable|rate limit|too many requests/i.test(`${error?.name || ''} ${error?.message || error}`)) throw error;
      lastError = `第 ${attempt} 次请求超时或网络异常：${error?.message || error}`;
      if (attempt >= CPU_OVERLOAD_MAX_ATTEMPTS) throw new Error(`${lastError}\n已重新发起 ${CPU_OVERLOAD_MAX_ATTEMPTS} 次新请求，仍未成功。`);
      await randomDelay(IMAGE_API_STAGGER_MIN_MS, IMAGE_API_STAGGER_MAX_MS, externalSignal);
    } finally {
      if (externalSignal && abortFromExternal) externalSignal.removeEventListener?.('abort', abortFromExternal);
      clearTimeout(timer);
    }
  }
  throw new Error(lastError || 'API 重试次数已用完。');
}

async function generateImage(prompt, imagePaths, options = {}) {
  const api = requireApiConfig('image');
  return imageApiSlots.use(async () => {
    const reservation = await billing.reserve(currentWorkspaceId(), 'image', {
      description: options.billingDescription || '图片生成',
      reference: options.billingReference || ''
    });
    try {
      const body = await imageApiJsonWithRetry(apiEndpoint(api.baseUrl, '/images/edits'), async () => {
        if (options.signal?.aborted) throw new Error('任务已停止');
        const fields = [
          { name: 'model', value: api.imageModel },
          { name: 'prompt', value: String(prompt || '') },
          { name: 'n', value: '1' },
          { name: 'size', value: options.size || '1024x1024' },
          { name: 'quality', value: options.quality || 'high' },
          { name: 'response_format', value: api.responseFormat || 'url' }
        ];
        const files = [];
        for (const file of imagePaths) {
          if (!isImagePath(file)) throw new Error(`涓嶆敮鎸佺殑鍥剧墖鏍煎紡锛?{path.basename(file)}`);
          files.push({
            name: 'image',
            path: file,
            fileName: path.basename(file),
            contentType: imageMimeType(file)
          });
        }
        const form = new FormData();
        for (const field of fields) form.set(field.name, String(field.value));
        for (const file of imagePaths) {
          if (!isImagePath(file)) throw new Error(`不支持的图片格式：${path.basename(file)}`);
          const bytes = await fsp.readFile(file);
          form.append('image', new Blob([bytes], { type: imageMimeType(file) }), path.basename(file));
        }
        return {
          method: 'POST',
          headers: { Authorization: `Bearer ${api.imageKey}` },
          body: form,
          signal: options.signal,
          _powershellMultipart: { fields, files }
        };
      }, (api.requestTimeoutSeconds || 300) * 1000);
      const result = extractImageResult(body);
      let bytes;
      if (result.type === 'base64') bytes = Buffer.from(result.value, 'base64');
      else {
        const response = await fetch(result.value);
        if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
      }
      await billing.commit(reservation);
      return bytes;
    } catch (error) {
      await billing.release(reservation).catch(() => {});
      throw error;
    }
  });
}

async function nextTaskFolder(config) {
  const outputRoot = config.outputPath || defaultConfig().outputPath;
  await fsp.mkdir(outputRoot, { recursive: true });
  const today = new Date();
  const prefix = `${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}-`;
  const entries = await fsp.readdir(outputRoot, { withFileTypes: true }).catch(() => []);
  let serial = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
    .map(entry => Number(entry.name.slice(prefix.length)) || 0)
    .reduce((maximum, value) => Math.max(maximum, value), 0) + 1;
  let folder = path.join(outputRoot, `${prefix}${String(serial).padStart(4, '0')}`);
  while (true) {
    try {
      await fsp.mkdir(folder);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      serial += 1;
      folder = path.join(outputRoot, `${prefix}${String(serial).padStart(4, '0')}`);
    }
  }
  return folder;
}

async function readJsonFile(file, fallback = null) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeJsonFile(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

async function writeTaskSource(folder, task, generationMode) {
  const templateRelativePaths = [...new Set((Array.isArray(task.templateRelativePaths)
    ? task.templateRelativePaths
    : task.templateRelativePath ? [task.templateRelativePath] : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))];
  const source = {
    productPath: task.productPath || '',
    printPath: task.printPath || '',
    templateFolderPath: task.templateFolderPath || '',
    templateRelativePaths,
    generationMode: generationMode || task.generationMode || 'master',
    taskNumber: Number(task.taskNumber || 0),
    note: task.note || '',
    createdAt: new Date().toISOString(),
    status: '待人工筛图'
  };
  const paths = metadataPaths(folder);
  await Promise.all([
    writeJsonFile(paths.macSource, toMacSourceMetadata(source, { status: '待人工筛图', createdAt: source.createdAt })),
    writeJsonFile(paths.wpfSource, toWpfSourceMetadata(source))
  ]);
}

async function readOperationLogs(folder) {
  const raw = await readJsonFile(metadataPaths(folder).operationLog, []);
  return normalizeOperationLogs(raw);
}

async function addOperationLog(folder, message) {
  const logs = appendOperationLog(await readOperationLogs(folder), { folderName: path.basename(folder), message });
  await writeJsonFile(metadataPaths(folder).operationLog, toWpfOperationLogs(logs));
  return logs;
}

function resolveInside(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, String(relativePath || ''));
  if (!isSameOrChildPath(resolvedRoot, resolved)) throw new Error('模板相对路径无效');
  return resolved;
}

async function listTemplateImagePaths(templateRoot) {
  const rootStat = await fsp.stat(templateRoot).catch(() => null);
  if (!rootStat?.isDirectory()) throw new Error('套图文件夹不存在');
  const files = [];
  async function walk(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
    entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }));
    for (const entry of entries) {
      if (entry.name === '.caishen-template-cache' || entry.name === '.caishen-meta') continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && isImagePath(fullPath)) files.push(fullPath);
    }
  }
  await walk(templateRoot);
  return files;
}

async function buildTemplateJobs(templateRoot, outputRoot = templateRoot) {
  return (await listTemplateImagePaths(templateRoot)).map(templatePath => {
    const relativePath = path.relative(templateRoot, templatePath);
    return {
      templateRoot,
      templatePath,
      relativePath,
      outputRoot,
      outputPath: path.join(outputRoot, relativePath),
      sectionName: path.basename(path.dirname(relativePath))
    };
  });
}

async function templateAnalysisForJob(job) {
  const cache = templateCachePaths(job.templateRoot, job.relativePath);
  const analysis = await readValidTemplateAnalysisCache({ cacheFile: cache.analysisFile, templateImagePath: job.templatePath });
  const value = analysis || JSON.stringify(createFallbackTemplateAnalysis());
  return { cache, analysis: value, summary: parseTemplateAnalysisSummary(value), cached: Boolean(analysis) };
}

function templateAnalysisStatusFile(job) {
  return `${templateCachePaths(job.templateRoot, job.relativePath).analysisFile}.status.json`;
}

async function writeTemplateAnalysisStatus(job, value) {
  return writeJsonFile(templateAnalysisStatusFile(job), {
    relativePath: job.relativePath,
    updatedAt: new Date().toISOString(),
    ...value
  });
}

async function ensureMaskFromRegions(job, regions) {
  if (!regions?.length) return '';
  const cache = templateCachePaths(job.templateRoot, job.relativePath);
  if (fs.existsSync(cache.maskFile)) return cache.maskFile;
  const metadata = await sharp(job.templatePath).metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!width || !height) return '';
  const mask = rasterizeMask({ width, height, regions, strokes: [] });
  const png = await sharp(Buffer.from(mask), { raw: { width, height, channels: 1 } }).png().toBuffer();
  await fsp.mkdir(path.dirname(cache.maskFile), { recursive: true });
  await Promise.all([fsp.writeFile(cache.maskFile, png), fsp.writeFile(cache.cleanMaskFile, png)]);
  return cache.maskFile;
}

async function collectTemplateItems(templateRoot) {
  const jobs = await buildTemplateJobs(templateRoot);
  const items = [];
  for (const job of jobs) {
    const { cache, summary, cached } = await templateAnalysisForJob(job);
    const stat = await fsp.stat(job.templatePath).catch(() => null);
    const version = stat ? `${Math.trunc(stat.mtimeMs)}-${stat.size}` : '1';
    const recordedStatus = await readJsonFile(templateAnalysisStatusFile(job), {});
    const analysisStatus = cached
      ? 'success'
      : recordedStatus.status === 'failed' || recordedStatus.status === 'running'
        ? recordedStatus.status
        : 'idle';
    items.push({
      relativePath: job.relativePath,
      templatePath: job.templatePath,
      path: job.templatePath,
      name: path.basename(job.templatePath),
      folder: path.relative(templateRoot, path.dirname(job.templatePath)) || '根目录',
      templateUrl: `${imageUrl(job.templatePath)}?v=${version}`,
      url: `${imageUrl(job.templatePath)}?v=${version}`,
      thumbnailUrl: thumbnailUrl(job.templatePath, 480, version),
      previewUrl: thumbnailUrl(job.templatePath, 1200, version),
      action: summary.action,
      confidence: summary.confidence,
      reason: summary.reason,
      replaceArea: summary.replaceArea,
      forbiddenArea: summary.forbiddenArea,
      regions: summary.regions,
      maskUrl: fs.existsSync(cache.maskFile) ? imageUrl(cache.maskFile) : '',
      analysisPending: !cached,
      analysisStatus,
      analysisError: analysisStatus === 'failed' ? String(recordedStatus.error || 'AI 分析失败') : '',
      analysisAttempts: Number(recordedStatus.attempts || 0)
    });
  }
  return { jobs, items };
}

async function listTemplates(templateRoot) {
  const { items } = await collectTemplateItems(templateRoot);
  return items;
}

async function templateFolderImageSummary(root) {
  let count = 0;
  let previewFile = '';
  async function walk(directory, depth) {
    if (depth > 24) return;
    let entries = [];
    try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch { return; }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1);
      else if (entry.isFile() && isImagePath(file)) {
        count += 1;
        if (!previewFile) previewFile = file;
      }
    }
  }
  await walk(root, 0);
  if (!previewFile) return { count, preview: null };
  const stat = await fsp.stat(previewFile).catch(() => null);
  const version = stat ? `${Math.trunc(stat.mtimeMs)}-${stat.size}` : '1';
  return {
    count,
    preview: {
      name: path.basename(previewFile),
      thumbnailUrl: thumbnailUrl(previewFile, 480, version),
      previewUrl: thumbnailUrl(previewFile, 1200, version),
      url: `${imageUrl(previewFile)}?v=${version}`
    }
  };
}

async function listTemplateFolders() {
  const libraryRoot = path.join(currentWorkspaceRoot(), 'assets', 'template');
  let collections = [];
  try { collections = await fsp.readdir(libraryRoot, { withFileTypes: true }); } catch { return []; }
  const folders = [];
  for (const collection of collections) {
    if (!collection.isDirectory() || collection.name.startsWith('.')) continue;
    const collectionRoot = path.join(libraryRoot, collection.name);
    let children = [];
    try { children = await fsp.readdir(collectionRoot, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      if (!child.isDirectory() || child.name.startsWith('.')) continue;
      const folder = path.join(collectionRoot, child.name);
      const [summary, stat] = await Promise.all([
        templateFolderImageSummary(folder),
        fsp.stat(folder).catch(() => null)
      ]);
      folders.push({
        id: `${collection.name}/${child.name}`,
        name: child.name,
        path: folder,
        count: summary.count,
        preview: summary.preview,
        modifiedAt: stat?.mtimeMs || 0
      });
    }
  }
  return folders.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }) || right.modifiedAt - left.modifiedAt);
}

async function deleteTemplateFolder(folderValue) {
  const libraryRoot = path.resolve(currentWorkspaceRoot(), 'assets', 'template');
  const folder = path.resolve(String(folderValue || ''));
  const relative = path.relative(libraryRoot, folder);
  const segments = relative.split(path.sep).filter(Boolean);
  if (!relative || !isSameOrChildPath(libraryRoot, folder) || segments.length !== 2) {
    throw new Error('只能删除已导入的套图文件夹');
  }
  const stat = await fsp.lstat(folder).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('套图文件夹不存在或已被删除');
  const summary = await templateFolderImageSummary(folder);
  await fsp.rm(folder, { recursive: true, force: true });
  const collectionRoot = path.dirname(folder);
  if (!(await fsp.readdir(collectionRoot).catch(() => [])).length) await fsp.rmdir(collectionRoot).catch(() => {});
  return { path: folder, deleted: true, count: summary.count };
}

function summarizeTemplatePreparation(folder, items, extra = {}) {
  const previewItem = items.find(item => item.action === 'replace_print') || items[0] || null;
  const counts = {
    replacePrint: items.filter(item => item.action === 'replace_print').length,
    copyTemplate: items.filter(item => item.action === 'copy_template').length,
    skipCopy: items.filter(item => item.action === 'skip_copy').length,
    manualCheck: items.filter(item => item.action === 'manual_check').length
  };
  const pending = items.filter(item => item.analysisPending).length;
  return {
    folder,
    total: items.length,
    cached: items.length - pending,
    pending,
    ready: items.length > 0 && pending === 0,
    generationReady: items.length > 0 && pending === 0 && counts.manualCheck === 0,
    counts,
    preview: previewItem ? {
      name: previewItem.name,
      relativePath: previewItem.relativePath,
      thumbnailUrl: previewItem.thumbnailUrl,
      previewUrl: previewItem.previewUrl,
      url: previewItem.url
    } : null,
    ...extra
  };
}

async function getTemplatePreparation(folderValue) {
  const folder = String(folderValue || '');
  const { items } = await collectTemplateItems(folder);
  return summarizeTemplatePreparation(folder, items);
}

async function waitForTemplateWarmup(folder, timeoutMs = 10 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (warmingTemplateFolders.has(folder) && Date.now() < deadline) await randomDelay(400, 400);
  if (warmingTemplateFolders.has(folder)) throw new Error('套图自动识别仍在执行，请稍后重试。');
}

async function prepareTemplateFolder(folderValue) {
  const folder = String(folderValue || '');
  if (!folder || !fs.existsSync(folder)) throw new Error('套图文件夹不存在');
  await waitForTemplateWarmup(folder);
  const { jobs } = await collectTemplateItems(folder);
  if (!jobs.length) return summarizeTemplatePreparation(folder, [], { analyzed: 0, reused: 0, failed: 0 });
  const missing = [];
  for (const job of jobs) {
    if (!(await templateAnalysisForJob(job)).cached) missing.push(job);
  }
  const results = missing.length ? await runWithConcurrency(missing, 3, analyzeTemplateJob) : [];
  const failed = results.filter(result => !result.ok);
  const { items } = await collectTemplateItems(folder);
  return summarizeTemplatePreparation(folder, items, {
    analyzed: results.length - failed.length,
    reused: jobs.length - missing.length,
    failed: failed.length,
    failures: failed.slice(0, 10).map(result => result.error?.message || String(result.error || '识别失败'))
  });
}

async function saveTemplateConfiguration(payload) {
  const folder = String(payload?.folder || '');
  const jobs = await buildTemplateJobs(folder);
  const byRelative = new Map(jobs.map(job => [job.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN'), job]));
  for (const item of payload?.items || []) {
    const key = String(item.relativePath || '').replaceAll('\\', '/').toLocaleLowerCase('zh-CN');
    const job = byRelative.get(key);
    if (!job) throw new Error(`模板不存在：${item.relativePath}`);
    const analysis = createManualTemplateAnalysis({
      action: item.action,
      reason: item.reason,
      replaceArea: item.replaceArea,
      forbiddenArea: item.forbiddenArea,
      regions: item.regions
    });
    const cache = templateCachePaths(folder, job.relativePath);
    await writeTemplateAnalysisCache({
      cacheFile: cache.analysisFile,
      templateRoot: folder,
      templateImagePath: job.templatePath,
      relativeTemplatePath: job.relativePath,
      analysis: JSON.stringify(analysis),
      manualOverride: true
    });
    await ensureMaskFromRegions(job, analysis.replace_regions);
    await writeTemplateAnalysisStatus(job, { status: 'success', source: 'manual', attempts: 0, error: '' });
  }
  return listTemplates(folder);
}

async function analyzeTemplateJob(job, options = {}) {
  const api = requireApiConfig('analysis');
  const prompt = await getPromptValue('templateAnalysis');
  const body = await analysisApiJson(api, {
    model: api.analysisModel,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: options.imageDataUrl || await imageAsAnalysisDataUrl(job.templatePath) } }
      ]
    }],
    max_tokens: 700
  }, (api.requestTimeoutSeconds || 300) * 1000, { description: '套图模板 AI 分析', reference: job.relativePath });
  const choice = body?.choices?.[0] || {};
  const content = choice?.message?.content ?? choice?.delta?.content ?? choice?.text ?? body?.output_text ?? body?.content;
  const analysis = analysisContentToString(content);
  if (!analysis) {
    const fallbackCache = templateCachePaths(job.templateRoot, job.relativePath);
    const fallback = createManualTemplateAnalysis({
      action: 'manual_check',
      reason: 'AI 接口已返回但没有可读取的分析文本，请人工确认。',
      replaceArea: '不确定',
      forbiddenArea: '背景、文字、墙面、地面、柜脚、把手、抽屉内侧、柜门内侧、包装、留白等非可印花面板区域',
      regions: []
    });
    await writeTemplateAnalysisCache({
      cacheFile: fallbackCache.analysisFile,
      templateRoot: job.templateRoot,
      templateImagePath: job.templatePath,
      relativeTemplatePath: job.relativePath,
      analysis: JSON.stringify(fallback),
      manualOverride: false
    });
    return parseTemplateAnalysisSummary(fallback);
  }
  const cache = templateCachePaths(job.templateRoot, job.relativePath);
  await writeTemplateAnalysisCache({
    cacheFile: cache.analysisFile,
    templateRoot: job.templateRoot,
    templateImagePath: job.templatePath,
    relativeTemplatePath: job.relativePath,
    analysis,
    manualOverride: false
  });
  const summary = parseTemplateAnalysisSummary(analysis);
  await ensureMaskFromRegions(job, summary.regions);
  return summary;
}

async function analyzeTemplateJobWithRetry(job, retries = 3, onProgress = async () => {}) {
  const maximumAttempts = Math.max(1, Number(retries) + 1);
  let lastError;
  await writeTemplateAnalysisStatus(job, { status: 'running', attempts: 0, error: '' });
  let imageDataUrl;
  try { imageDataUrl = await imageAsAnalysisDataUrl(job.templatePath); }
  catch (error) {
    const message = `图片预处理失败：${error?.message || error}`;
    await writeTemplateAnalysisStatus(job, { status: 'failed', source: 'ai', attempts: 0, error: message });
    return { ok: false, relativePath: job.relativePath, attempts: 0, error: message };
  }
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    await onProgress({ phase: 'analyzing', relativePath: job.relativePath, attempt, maximumAttempts });
    try {
      const summary = await analyzeTemplateJob(job, { imageDataUrl });
      await writeTemplateAnalysisStatus(job, { status: 'success', source: 'ai', attempts: attempt, error: '' });
      return { ok: true, relativePath: job.relativePath, attempts: attempt, summary };
    } catch (error) {
      lastError = error;
      if (attempt < maximumAttempts) {
        await onProgress({ phase: 'retrying', relativePath: job.relativePath, attempt, maximumAttempts, error: error?.message || String(error) });
        await randomDelay(ANALYSIS_RETRY_BASE_MS * attempt, ANALYSIS_RETRY_BASE_MS * 2 * attempt);
      }
    }
  }
  const message = lastError?.message || String(lastError || 'AI 分析失败');
  await writeTemplateAnalysisStatus(job, { status: 'failed', source: 'ai', attempts: maximumAttempts, error: message });
  return { ok: false, relativePath: job.relativePath, attempts: maximumAttempts, error: message };
}

async function analyzeTemplateItems(payload = {}, options = {}) {
  const folder = String(payload.folder || '');
  if (!folder || !fs.existsSync(folder)) throw new Error('套图文件夹不存在');
  const requested = new Set((payload.relativePaths || []).map(value => String(value).replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
  if (!requested.size) throw new Error('请先选择需要 AI 分析的图片');
  const jobs = (await buildTemplateJobs(folder)).filter(job => requested.has(job.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
  if (!jobs.length) throw new Error('没有找到需要分析的套图图片');
  const concurrency = Math.min(jobs.length, crypto.randomInt(2, 6));
  let completed = 0;
  let failed = 0;
  const report = typeof options.reportProgress === 'function' ? options.reportProgress : async () => {};
  await report({ phase: 'queued', current: 0, total: jobs.length, failed: 0, concurrency, message: `已排队 ${jobs.length} 张，并发 ${concurrency}` });
  const results = await runWithConcurrency(jobs, concurrency, job => analyzeTemplateJobWithRetry(job, 3, async progress => {
    await report({ ...progress, current: completed, total: jobs.length, failed, concurrency, message: progress.phase === 'retrying' ? `分析失败，正在自动重试：${job.relativePath}` : `正在分析：${job.relativePath}` });
  }).then(async result => {
    completed += 1;
    if (!result.ok) failed += 1;
    await report({
      phase: completed === jobs.length ? 'completed' : 'analyzing',
      current: completed,
      total: jobs.length,
      failed,
      concurrency,
      completedRelativePath: job.relativePath,
      completedStatus: result.ok ? 'success' : 'failed',
      message: result.ok ? `已完成 ${completed}/${jobs.length}` : `分析失败：${job.relativePath}`
    });
    return result;
  }));
  const values = results.map(result => result.value).filter(Boolean);
  return {
    total: jobs.length,
    completed,
    failed,
    concurrency,
    failures: values.filter(result => !result.ok).map(result => ({ relativePath: result.relativePath, error: result.error, attempts: result.attempts })),
    items: await listTemplates(folder)
  };
}

async function analyzeTemplateFolder(folder) {
  if (warmingTemplateFolders.has(folder)) throw new Error('当前套图正在后台分析，请稍后重新打开配置窗口。');
  const jobs = await buildTemplateJobs(folder);
  const results = await runWithConcurrency(jobs, 3, analyzeTemplateJob);
  const failed = results.filter(result => !result.ok);
  if (failed.length === jobs.length && jobs.length) throw failed[0].error;
  return listTemplates(folder);
}

async function ensureTemplateAnalysisForJob(job) {
  const current = await templateAnalysisForJob(job);
  if (current.cached) return current;
  await analyzeTemplateJob(job);
  return templateAnalysisForJob(job);
}

function startTemplateAnalysisWarmup(folder, knownJobs = null) {
  if (!folder || warmingTemplateFolders.has(folder)) return;
  warmingTemplateFolders.add(folder);
  void (async () => {
    const jobs = knownJobs || await buildTemplateJobs(folder);
    const missing = [];
    for (const job of jobs) {
      if (!(await templateAnalysisForJob(job)).cached) missing.push(job);
    }
    if (missing.length) await runWithConcurrency(missing, 2, analyzeTemplateJob);
  })().catch(() => {}).finally(() => warmingTemplateFolders.delete(folder));
}

async function analyzeProductProfile(productPath) {
  if (!productPath || !fs.existsSync(productPath)) return normalizeProductProfile({});
  const api = requireApiConfig('analysis');
  const response = await analysisApiJson(api, buildProductProfileAnalysisRequest({
    model: api.analysisModel,
    imageDataUrl: await imageAsDataUrl(productPath),
    prompt: await getPromptValue('productProfileAnalysis')
  }), (api.requestTimeoutSeconds || 300) * 1000, { description: '商品图片理解', reference: path.basename(productPath) });
  return parseProductProfileChatResponse(response);
}

async function ensureTemplateProductProfile(templateFolderPath, productPath = '') {
  const file = getTemplateProductProfileFile(templateFolderPath);
  let profile = await readProductProfileFile(file);
  if (!profile) {
    profile = normalizeProductProfile({});
    await writeProductProfileFile(file, profile);
  }
  if (!profile.dimensions && productPath && fs.existsSync(productPath)) {
    try {
      const detected = await analyzeProductProfile(productPath);
      if (detected.dimensions) {
        profile.dimensions = detected.dimensions;
        await writeProductProfileFile(file, profile);
      }
    } catch {}
  }
  return profile;
}

async function ensureTaskProductProfile(outputRoot, source) {
  const file = getTaskProductProfileFile(outputRoot);
  const profileStat = await fsp.stat(file).catch(() => null);
  const productStat = source.productPath ? await fsp.stat(source.productPath).catch(() => null) : null;
  if (!shouldRefreshTaskProductProfile({
    profileExists: Boolean(profileStat),
    productExists: Boolean(productStat),
    profileLastWriteMs: profileStat?.mtimeMs,
    productLastWriteMs: productStat?.mtimeMs
  })) return readProductProfileFile(file);
  let profile = normalizeProductProfile({});
  if (productStat) {
    try { profile = await analyzeProductProfile(source.productPath); } catch {}
  }
  await writeJsonFile(file, createTaskProductProfilePayload(profile, {
    sourceProductPath: source.productPath,
    sourceProductLastWriteUtc: productStat?.mtime?.toISOString?.() || '',
    updatedAt: new Date().toISOString()
  }));
  return profile;
}

async function saveTemplateProductProfile(payload) {
  const folder = String(payload?.folder || '');
  if (!folder || !fs.existsSync(folder)) throw new Error('套图文件夹不存在');
  const profile = normalizeProductProfile(payload?.profile || {});
  if (!profile.dimensions && !profile.material) throw new Error('至少填写尺寸或材质');
  await writeProductProfileFile(getTemplateProductProfileFile(folder), profile);
  return profile;
}

async function saveTemplateMask(payload) {
  const folder = String(payload?.folder || '');
  const relativePath = String(payload?.relativePath || '');
  const templatePath = resolveInside(folder, relativePath);
  if (!fs.existsSync(templatePath) || !isImagePath(templatePath)) throw new Error('模板图片不存在');
  const match = String(payload?.maskDataUrl || '').match(/^data:image\/png;base64,(.+)$/);
  if (!match) throw new Error('蒙版数据无效');
  const cache = templateCachePaths(folder, relativePath);
  const bytes = Buffer.from(match[1], 'base64');
  await fsp.mkdir(path.dirname(cache.maskFile), { recursive: true });
  await Promise.all([fsp.writeFile(cache.maskFile, bytes), fsp.writeFile(cache.cleanMaskFile, bytes)]);
  return { maskFile: cache.maskFile, maskUrl: imageUrl(cache.maskFile), regions: payload?.regions || [] };
}

function templateOutputSize(job) {
  return job.sectionName.includes('3：4') ? '1024x1536' : '1024x1024';
}

function containsAny(value, candidates) {
  const text = String(value || '').toLocaleLowerCase('zh-CN');
  return candidates.some(candidate => text.includes(String(candidate).toLocaleLowerCase('zh-CN')));
}

function resolveActionWithProductProfile(action, templateAnalysis, productProfile, job) {
  const pathText = String(job?.relativePath || '');
  const templateText = `${pathText}\n${String(templateAnalysis || '')}`;
  const isPureInfoPage = containsAny(templateText, ['包装', '运输', '物流', '安装', '售后', '买家须知', '纯文字', '服务承诺', '注意事项', '装饰横幅', '品牌底图']);
  if (action === 'copy_template') {
    if (/"needs_master_product"\s*:\s*false/i.test(String(templateAnalysis || ''))) return 'copy_template';
    if (containsAny(pathText, ['sku', '尺寸', '参数', '规格'])) return 'generate_dimension_sheet';
    if (containsAny(pathText, ['细节', '局部', '特写', '边角', '台面', '门板', '纹理', '五金', '厚度', '工艺'])) return 'generate_detail_showcase';
    if (containsAny(pathText, ['材质', '板材', '色卡'])) return 'generate_material_sheet';
    if (!isPureInfoPage) return 'generate_product_scene';
  }
  if (action === 'generate_dimension_sheet' && !normalizeProductProfile(productProfile).dimensions) return 'generate_dimension_sheet';
  if (action === 'generate_material_sheet' && !normalizeProductProfile(productProfile).material) return 'generate_material_sheet';
  return action;
}

async function replaceOutputFile(outputPath, writeNext) {
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const extension = path.extname(outputPath);
  const stem = path.basename(outputPath, extension);
  const nonce = crypto.randomUUID();
  const nextPath = path.join(path.dirname(outputPath), `.${stem}.caishen-next-${nonce}${extension}`);
  const backupPath = path.join(path.dirname(outputPath), `.${stem}.caishen-old-${nonce}.bak`);
  let backedUp = false;
  try {
    await writeNext(nextPath);
    if (fs.existsSync(outputPath)) {
      await fsp.rename(outputPath, backupPath);
      backedUp = true;
    }
    await fsp.rename(nextPath, outputPath);
    if (backedUp) {
      backedUp = false;
      await fsp.rm(backupPath, { force: true }).catch(() => {});
    }
  } catch (error) {
    await fsp.rm(nextPath, { force: true }).catch(() => {});
    if (backedUp && !fs.existsSync(outputPath)) {
      await fsp.rename(backupPath, outputPath);
      backedUp = false;
    }
    throw error;
  } finally {
    if (!backedUp) await fsp.rm(backupPath, { force: true }).catch(() => {});
  }
}

async function writeTemplateSizedImage(job, bytes) {
  const metadata = await sharp(job.templatePath).metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  let image = sharp(bytes);
  if (width && height) image = image.resize(width, height, { fit: 'cover', position: 'centre' });
  const extension = path.extname(job.outputPath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') image = image.jpeg({ quality: 94 });
  else image = image.png();
  await replaceOutputFile(job.outputPath, nextPath => image.toFile(nextPath));
}

async function readSourceMetadata(folder) {
  const paths = metadataPaths(folder);
  const value = await readJsonFile(paths.wpfSource, null) || await readJsonFile(paths.macSource, {});
  return normalizeSourceMetadata(value);
}

async function writeTemplateAudit(job, value) {
  await writeJsonFile(metadataPaths(job.outputRoot, job.relativePath).templateAudit, value);
}

async function auditGeneratedTemplate(masterImage, job, templateAnalysis) {
  const api = requireApiConfig('analysis');
  const [firstPromptTemplate, recheckPromptTemplate] = await Promise.all([
    getPromptValue('templateAudit'),
    getPromptValue('templateAuditRecheck')
  ]);
  const common = {
    templateAnalysis,
    masterImageDataUrl: await imageAsDataUrl(masterImage),
    templateImageDataUrl: await imageAsDataUrl(job.templatePath),
    generatedImageDataUrl: await imageAsDataUrl(job.outputPath)
  };
  let first;
  let rawText = '';
  try {
    const response = await analysisApiJson(api,
      buildTemplateAuditPayload({ ...common, model: api.analysisModel, promptTemplate: firstPromptTemplate }),
      (api.requestTimeoutSeconds || 300) * 1000,
      { description: '生成结果 AI 质检', reference: job.relativePath });
    rawText = String(response?.choices?.[0]?.message?.content || '').trim();
    first = parseTemplateAuditResult(rawText);
  } catch (error) {
    first = { passed: true, reason: '审核接口不可用，保留生成结果。', retryInstruction: '', rawText: JSON.stringify({ passed: true, reason: `审核接口不可用，保留生成结果：${error.message}`, retry_instruction: '' }) };
  }
  let final = first;
  if (isInvalidAuditRequestingProductReplacement(first)) {
    final = { passed: true, reason: '审核误判：审核意见要求替换母版商品，已按母版唯一标准保留结果。', retryInstruction: '', rawText: JSON.stringify({ passed: true, reason: '审核误判：审核意见要求替换母版商品，已按母版唯一标准保留结果。', retry_instruction: '' }) };
  } else if (!first.passed) {
    try {
      const response = await analysisApiJson(api,
        buildTemplateAuditRecheckPayload({ ...common, model: api.analysisModel, firstAudit: first, promptTemplate: recheckPromptTemplate }),
        (api.requestTimeoutSeconds || 300) * 1000,
        { description: '生成结果 AI 复核', reference: job.relativePath });
      const content = String(response?.choices?.[0]?.message?.content || '').trim();
      const recheck = parseTemplateAuditResult(content);
      final = isInvalidAuditRequestingProductReplacement(recheck)
        ? { passed: true, reason: '复核通过：审核意见要求替换母版商品，已按母版唯一标准保留结果。', retryInstruction: '', rawText: content }
        : { ...recheck, rawText: content };
    } catch {
      final = first;
    }
  }
  const output = final.rawText?.trim() || rawText || JSON.stringify({ passed: final.passed, reason: final.reason, retry_instruction: final.retryInstruction || '' });
  const auditFile = metadataPaths(job.outputRoot, job.relativePath).templateAudit;
  await fsp.mkdir(path.dirname(auditFile), { recursive: true });
  await fsp.writeFile(auditFile, output, 'utf8');
  return final;
}

async function generateTemplateJob(job, source, config, options = {}) {
  const { analysis } = await ensureTemplateAnalysisForJob(job);
  let action = resolveGenerationAction(analysis);
  let profile = null;
  if (source.generationMode !== 'template_print') {
    profile = await loadProductProfileForJob({ outputRoot: job.outputRoot, templateFolderPath: source.templateFolderPath });
    action = resolveActionWithProductProfile(action, analysis, profile, job);
  }
  const paths = metadataPaths(job.outputRoot, job.relativePath);
  await fsp.rm(paths.manualReview, { force: true }).catch(() => {});
  if (action === 'manual_check') {
    await writeTemplateAudit(job, { passed: false, reason: '模板分析需要人工确认，未自动生成。', retry_instruction: '请人工确认可替换印花区域后再单独重生成此图。', action });
    await fsp.mkdir(path.dirname(paths.manualReview), { recursive: true });
    await fsp.writeFile(paths.manualReview, analysis, 'utf8');
    throw new Error(`需要人工确认：${job.relativePath}`);
  }
  if (action === 'skip_copy') {
    await writeTemplateAudit(job, { passed: true, reason: '已按模板配置跳过，不自动生成。', retry_instruction: '', action });
    return { action, outputPath: '' };
  }
  if (action === 'copy_template') {
    await replaceOutputFile(job.outputPath, nextPath => fsp.copyFile(job.templatePath, nextPath));
    await writeTemplateAudit(job, { passed: true, reason: source.generationMode === 'template_print' ? '模板换印花直接复制：copy_template' : '已按模板配置直接复制：copy_template', retry_instruction: '', action });
    return { action, outputPath: job.outputPath };
  }

  let prompt;
  let imagePaths;
  if (source.generationMode === 'template_print') {
    if (!source.printPath || !fs.existsSync(source.printPath)) throw new Error('原始印花图不存在');
    prompt = renderPromptTemplate(await getPromptValue('templatePrint'), {
      templateAnalysis: analysis,
      templatePath: job.relativePath
    });
    imagePaths = [job.templatePath, source.printPath];
  } else {
    const masterImage = (await fsp.readdir(job.outputRoot).catch(() => [])).map(name => path.join(job.outputRoot, name)).find(file => isImagePath(file) && path.basename(file, path.extname(file)) === '母版图');
    if (!masterImage || !fs.existsSync(masterImage)) throw new Error('母版图不存在');
    prompt = renderPromptTemplate(await getPromptValue('templateMigration'), {
      templateAnalysis: analysis,
      productProfile: toPromptText(profile),
      action,
      retryInstruction: options.extraInstruction
        ? `上一次 AI 审核未通过，本次必须修正：${String(options.extraInstruction).trim()}`
        : '',
      templatePath: job.relativePath
    });
    imagePaths = [masterImage];
  }
  if (options.extraInstruction && source.generationMode === 'template_print') prompt += `\n\n本次运营补充要求：${String(options.extraInstruction).trim()}`;
  if (options.includePreviousResult && fs.existsSync(job.outputPath)) imagePaths.push(job.outputPath);
  const bytes = await generateImage(prompt, imagePaths, {
    size: templateOutputSize(job),
    quality: config.imageQuality || 'high',
    billingDescription: options.extraInstruction ? '套图图片重新生成' : '套图换印花生图',
    billingReference: job.relativePath
  });
  await writeTemplateSizedImage(job, bytes);
  await fsp.rm(paths.templateAudit, { force: true }).catch(() => {});
  return { action, outputPath: job.outputPath };
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = { ok: true, value: await worker(items[index], index) }; }
      catch (error) { results[index] = { ok: false, error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, items.length)) }, run));
  return results;
}

async function generateTemplateSetForFolder(folder, onlyMissing = true, relativePaths = null, options = {}) {
  const source = await readSourceMetadata(folder);
  if (!source.templateFolderPath || !fs.existsSync(source.templateFolderPath)) throw new Error('任务缺少套图文件夹');
  const config = await loadConfig();
  if (source.generationMode !== 'template_print') await ensureTaskProductProfile(folder, source);
  let jobs = await buildTemplateJobs(source.templateFolderPath, folder);
  const selectedPaths = relativePaths?.length ? relativePaths : source.templateRelativePaths;
  if (selectedPaths?.length) {
    const wanted = new Set(selectedPaths.map(value => String(value).replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
    jobs = jobs.filter(job => wanted.has(job.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
    if (!jobs.length) throw new Error('选中的套图图片不存在或已被移除。');
  }
  if (onlyMissing) jobs = jobs.filter(job => !fs.existsSync(job.outputPath));
  let progressWrite = Promise.resolve();
  const publishProgress = progress => {
    const next = {
      folder,
      phase: progress.phase || 'generating',
      current: Math.max(0, Number(progress.current) || 0),
      total: Math.max(0, Number(progress.total) || jobs.length),
      percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
      apiGenerated: Math.max(0, Number(progress.apiGenerated) || 0),
      copied: Math.max(0, Number(progress.copied) || 0),
      skipped: Math.max(0, Number(progress.skipped) || 0),
      failed: Math.max(0, Number(progress.failed) || 0),
      pending: Math.max(0, Number(progress.pending) || 0),
      message: String(progress.message || ''),
      updatedAt: new Date().toISOString()
    };
    progressWrite = progressWrite.then(async () => {
      await writeJsonFile(metadataPaths(folder).generationProgress, next);
      if (typeof options.reportProgress === 'function') await options.reportProgress(next);
    });
    return progressWrite;
  };
  if (!jobs.length) {
    if (!onlyMissing && !selectedPaths?.length) throw new Error('套图文件夹里没有可用图片。');
    const summary = { total: 0, current: 0, percent: 100, apiGenerated: 0, copied: 0, skipped: 0, failed: 0, pending: 0 };
    await publishProgress({ ...summary, phase: 'completed', message: '没有需要处理的图片' });
    return { folder, generated: 0, failures: [], summary };
  }
  const startLabel = options.initial ? '开始生成套图' : onlyMissing ? '开始补生成缺失套图' : '开始重新生成整套图';
  await addOperationLog(folder, `${startLabel}：${jobs.length} 张`);
  const live = { total: jobs.length, current: 0, apiGenerated: 0, copied: 0, skipped: 0, failed: 0 };
  const liveFailures = [];
  await publishProgress({ ...live, phase: 'preparing', message: `准备处理 ${jobs.length} 张图片` });
  const results = await runWithConcurrency(jobs, IMAGE_API_CONCURRENCY, async job => {
    try {
      if (options.signal?.aborted) throw new Error('任务已停止');
      const result = await generateTemplateJob(job, source, config, { signal: options.signal });
      if (result.action === 'skip_copy') live.skipped += 1;
      else if (result.action === 'copy_template') live.copied += 1;
      else live.apiGenerated += 1;
      return result;
    } catch (error) {
      live.failed += 1;
      liveFailures.push(`${job.relativePath}: ${error?.message || error}`);
      await writeJsonFile(metadataPaths(folder).generationErrors, {
        updated_at: new Date().toISOString(),
        count: liveFailures.length,
        failures: liveFailures.slice()
      });
      throw error;
    } finally {
      live.current += 1;
      await publishProgress({
        ...live,
        phase: 'generating',
        percent: Math.round(live.current / live.total * 100),
        message: `正在处理 ${live.current}/${live.total}：API 生成 ${live.apiGenerated}，直接复制 ${live.copied}，跳过 ${live.skipped}`
      });
    }
  });
  const failures = results.map((result, index) => result.ok ? null : `${jobs[index].relativePath}: ${result.error?.message || result.error}`).filter(Boolean);
  let rejected = 0;
  if (!failures.length && source.generationMode !== 'template_print' && config.auditMode === 'quality') {
    const masterImage = (await fsp.readdir(folder).catch(() => [])).map(name => path.join(folder, name)).find(file => isImagePath(file) && path.basename(file, path.extname(file)) === '母版图');
    const auditJobs = [];
    const productProfile = await loadProductProfileForJob({ outputRoot: folder, templateFolderPath: source.templateFolderPath });
    for (const job of jobs) {
      if (!fs.existsSync(job.outputPath)) continue;
      const { analysis } = await templateAnalysisForJob(job);
      const action = resolveActionWithProductProfile(resolveGenerationAction(analysis), analysis, productProfile, job);
      if (!['copy_template', 'skip_copy', 'manual_check'].includes(action)) auditJobs.push({ job, analysis });
    }
    if (masterImage && auditJobs.length) {
      await addOperationLog(folder, `开始 AI 质检：${auditJobs.length} 张`);
      await publishProgress({ ...live, phase: 'auditing', percent: 100, message: `图片处理完成，正在 AI 质检 ${auditJobs.length} 张` });
      const audits = await runWithConcurrency(auditJobs, 10, item => auditGeneratedTemplate(masterImage, item.job, item.analysis));
      rejected = audits.filter(result => !result.ok || result.value?.passed === false).length;
    }
  }
  if (failures.length) {
    await writeJsonFile(metadataPaths(folder).generationErrors, { updated_at: new Date().toISOString(), count: failures.length, failures });
    await addOperationLog(folder, `套图生成完成，但有 ${failures.length} 张失败：${failures.slice(0, 3).join('；')}`);
  } else {
    await fsp.rm(metadataPaths(folder).generationErrors, { force: true }).catch(() => {});
    const breakdown = `API 生成 ${live.apiGenerated} 张，直接复制 ${live.copied} 张，跳过 ${live.skipped} 张`;
    await addOperationLog(folder, rejected > 0 ? `套图处理完成：${breakdown}，AI 不通过 ${rejected} 张` : `套图处理完成：${breakdown}，待人工确认`);
  }
  const summary = {
    total: live.total,
    current: live.current,
    percent: 100,
    apiGenerated: live.apiGenerated,
    copied: live.copied,
    skipped: live.skipped,
    failed: live.failed,
    pending: 0
  };
  await publishProgress({
    ...summary,
    phase: failures.length ? 'completed_with_errors' : 'completed',
    message: failures.length
      ? `处理完成，${failures.length} 张失败`
      : `处理完成：API 生成 ${summary.apiGenerated}，直接复制 ${summary.copied}，跳过 ${summary.skipped}`
  });
  return { folder, generated: jobs.length - failures.length, failures, rejected, summary };
}

async function regenerateSingleTemplate(payload, options = {}) {
  const folder = String(payload?.folder || '');
  const source = await readSourceMetadata(folder);
  const job = await findReviewJob(folder, payload?.relativePath);
  const config = await loadConfig();
  if (source.generationMode !== 'template_print') await ensureTaskProductProfile(folder, source);
  const auditFile = metadataPaths(folder, job.relativePath).templateAudit;
  const auditText = await fsp.readFile(auditFile, 'utf8').catch(() => '');
  const audit = parseTemplateAuditResult(auditText);
  const extraInstruction = String(payload?.extraInstruction || audit.retryInstruction || '').trim();
  await addOperationLog(folder, `开始重新生成单张：${job.relativePath}${extraInstruction ? '（含修正要求）' : ''}`);
  const generated = await generateTemplateJob(job, source, config, {
    extraInstruction,
    includePreviousResult: Boolean(payload?.includePreviousResult),
    signal: options.signal
  });
  if (source.generationMode !== 'template_print'
      && config.auditMode === 'quality'
      && generated.outputPath
      && !['copy_template', 'skip_copy', 'manual_check'].includes(generated.action)) {
    const masterImage = (await fsp.readdir(folder).catch(() => []))
      .map(name => path.join(folder, name))
      .find(file => isImagePath(file) && path.basename(file, path.extname(file)) === '母版图');
    if (masterImage) {
      const { analysis } = await templateAnalysisForJob(job);
      await auditGeneratedTemplate(masterImage, job, analysis);
    }
  }
  const generationErrorsFile = metadataPaths(folder).generationErrors;
  const generationErrors = await readJsonFile(generationErrorsFile, {});
  const failurePrefix = `${job.relativePath}:`;
  const remainingFailures = (Array.isArray(generationErrors?.failures) ? generationErrors.failures : [])
    .map(String)
    .filter(message => !message.startsWith(failurePrefix));
  if (remainingFailures.length) {
    await writeJsonFile(generationErrorsFile, { ...generationErrors, updated_at: new Date().toISOString(), count: remainingFailures.length, failures: remainingFailures });
  } else await fsp.rm(generationErrorsFile, { force: true }).catch(() => {});
  await addOperationLog(folder, `重新生成完成：${job.relativePath}`);
  return { folder, relativePath: job.relativePath, outputPath: job.outputPath };
}

async function regenerateMasterForReviewFolder(folderValue) {
  const folder = String(folderValue || '');
  const source = await readSourceMetadata(folder);
  if (!source.productPath || !fs.existsSync(source.productPath) || !source.printPath || !fs.existsSync(source.printPath)) {
    throw new Error('当前文件夹没有找到原始品类图和印花图记录。');
  }
  await addOperationLog(folder, '开始重新生成母版图');
  const result = await generateMaster({
    taskNumber: source.taskNumber,
    productPath: source.productPath,
    printPath: source.printPath,
    templateFolderPath: source.templateFolderPath,
    generationMode: 'master',
    note: source.note || ''
  });
  await addOperationLog(folder, `重新生成母版图完成，新任务：${path.basename(result.folder)}`);
  return result;
}

async function generateDirectTemplateTask(task, options = {}) {
  if (!task?.printPath || !fs.existsSync(task.printPath)) throw new Error('印花图不存在');
  if (!task?.templateFolderPath || !fs.existsSync(task.templateFolderPath)) throw new Error('套图文件夹不存在');
  const config = await loadConfig();
  if (typeof options.reportProgress === 'function') {
    await options.reportProgress({ phase: 'preparing', current: 0, total: 0, percent: 0, message: '正在创建任务目录…' });
  }
  const folder = await nextTaskFolder(config);
  await fsp.mkdir(folder, { recursive: true });
  await writeTaskSource(folder, task, 'template_print');
  const selectedPaths = Array.isArray(task.templateRelativePaths)
    ? task.templateRelativePaths
    : task.templateRelativePath ? [task.templateRelativePath] : null;
  const result = await generateTemplateSetForFolder(folder, false, selectedPaths, { ...options, initial: true });
  if (result.failures.length) throw new Error(`有 ${result.failures.length} 张失败：${result.failures[0]}`);
  return { folder, outputPath: folder, url: '', summary: result.summary };
}

async function generateTask(task, options = {}) {
  if (task?.generationMode !== 'template_print') return generateMaster(task, options);
  if (typeof options.reportProgress === 'function') {
    await options.reportProgress({ phase: 'queued', current: 0, total: 0, percent: 0, message: '已进入套图处理队列' });
  }
  return generateDirectTemplateTask(task, options);
}

async function generateMaster(task, options = {}) {
  if (!task?.productPath || !fs.existsSync(task.productPath)) throw new Error('品类款式图不存在');
  if (!task?.printPath || !fs.existsSync(task.printPath)) throw new Error('印花图不存在');
  if (!task?.templateFolderPath || !fs.existsSync(task.templateFolderPath)) throw new Error('套图文件夹不存在');
  const config = await loadConfig();
  if (typeof options.reportProgress === 'function') {
    await options.reportProgress({ phase: 'generating', current: 0, total: 1, percent: 10, apiGenerated: 0, copied: 0, skipped: 0, failed: 0, message: '正在生成母版图…' });
  }
  const folder = await nextTaskFolder(config);
  await fsp.mkdir(folder, { recursive: true });
  await writeTaskSource(folder, task, 'master');
  ensureTemplateProductProfile(task.templateFolderPath, task.productPath).catch(() => {});
  const prompt = applyMasterPromptTemplate(await getPromptValue('masterGeneration'), task, config.categoriesPath);
  const bytes = await generateImage(prompt, [task.productPath, task.printPath], {
    size: config.imageSize || '1024x1024',
    quality: config.imageQuality || 'high',
    billingDescription: '母版图生成',
    billingReference: task.id || path.basename(task.productPath)
  });
  const outputPath = path.join(folder, '母版图.png');
  await fsp.writeFile(outputPath, bytes);
  await addOperationLog(folder, `生成母版图完成：${path.basename(outputPath)}`);
  const summary = { total: 1, current: 1, percent: 100, apiGenerated: 1, copied: 0, skipped: 0, failed: 0, pending: 0 };
  if (typeof options.reportProgress === 'function') {
    await options.reportProgress({ ...summary, folder, phase: 'completed', message: '母版图生成完成' });
  }
  return { folder, outputPath, url: imageUrl(outputPath), summary };
}

async function reviewFolders() {
  const config = await loadConfig();
  const outputRoot = config.outputPath || defaultConfig().outputPath;
  const entries = await fsp.readdir(outputRoot, { withFileTypes: true }).catch(() => []);
  const folders = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folder = path.join(outputRoot, entry.name);
    const images = await scanImages(folder, '', 80);
    const source = await readSourceMetadata(folder);
    const paths = metadataPaths(folder);
    const review = normalizeReviewMetadata(await readJsonFile(paths.macReview, {}));
    const legacyReviewImages = new Map(review.images.map(image => [String(image.relativePath || '').replaceAll('\\', '/').toLocaleLowerCase('zh-CN'), image]));
    const jobs = [];
    if (source.templateFolderPath && fs.existsSync(source.templateFolderPath)) {
      const selectedPaths = new Set((source.templateRelativePaths || []).map(value => String(value).replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
      const templateJobs = (await buildTemplateJobs(source.templateFolderPath, folder))
        .filter(job => !selectedPaths.size || selectedPaths.has(job.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
      for (const job of templateJobs) {
        const jobPaths = metadataPaths(folder, job.relativePath);
        let manualReview = await readJsonFile(jobPaths.manualReview, {});
        let audit = await readJsonFile(jobPaths.templateAudit, {});
        const legacyImage = legacyReviewImages.get(job.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN'));
        if (!Object.keys(manualReview || {}).length && legacyImage?.manualStatus) manualReview = { status: legacyImage.manualStatus, updatedAt: legacyImage.reviewedAt };
        if (!Object.keys(audit || {}).length && legacyImage?.auditStatus) audit = { status: legacyImage.auditStatus };
        const { summary } = await templateAnalysisForJob(job);
        const record = {
          relativePath: job.relativePath,
          templateImagePath: job.templatePath,
          outputPath: job.outputPath,
          outputExists: fs.existsSync(job.outputPath),
          manualReview,
          audit,
          generationAction: summary.action
        };
        const rawStatus = deriveImageStatus(record, config.auditMode);
        const status = rawStatus === '人工通过' ? '已通过'
          : rawStatus === '人工不通过' || rawStatus === '审核不通过' ? 'AI不通过'
            : rawStatus === '直接套模板-自动通过' ? '直接套模板'
              : rawStatus;
        const templateModifiedAt = (await fsp.stat(job.templatePath).catch(() => null))?.mtimeMs || 0;
        const outputModifiedAt = record.outputExists ? (await fsp.stat(job.outputPath).catch(() => null))?.mtimeMs || 0 : 0;
        jobs.push({
          ...record,
          status,
          action: summary.action,
          templateUrl: `${imageUrl(job.templatePath)}?v=${encodeURIComponent(templateModifiedAt)}`,
          outputUrl: record.outputExists ? `${imageUrl(job.outputPath)}?v=${encodeURIComponent(outputModifiedAt)}` : '',
          outputModifiedAt
        });
      }
    }
    if (!images.length && !jobs.length) continue;
    const stat = await fsp.stat(folder);
    const masterImage = images.find(image => path.basename(image.path, path.extname(image.path)) === '母版图') || null;
    const generationErrors = await readJsonFile(paths.generationErrors, {});
    const generationFailures = Array.isArray(generationErrors?.failures) ? generationErrors.failures.map(String) : [];
    for (const job of jobs) {
      const prefix = `${job.relativePath}:`;
      const failure = generationFailures.find(message => message.startsWith(prefix));
      job.generationError = failure ? failure.slice(prefix.length).trim() : '';
      if (job.generationError && !job.outputUrl) job.status = '生成失败';
    }
    const storedProgress = await readJsonFile(paths.generationProgress, {});
    const derivedProgress = summarizeGenerationProgress(jobs, generationErrors?.count || 0);
    const runningPhases = new Set(['queued', 'preparing', 'generating', 'auditing']);
    const taskRunning = runningPhases.has(String(storedProgress?.phase || ''));
    const generationProgress = {
      ...derivedProgress,
      ...(storedProgress && typeof storedProgress === 'object' ? storedProgress : {}),
      total: derivedProgress.total,
      current: taskRunning ? Math.min(derivedProgress.total, Math.max(0, Number(storedProgress.current) || 0)) : derivedProgress.current,
      percent: taskRunning ? Math.max(0, Math.min(100, Number(storedProgress.percent) || 0)) : derivedProgress.percent,
      pending: taskRunning ? Math.max(0, derivedProgress.total - (Number(storedProgress.current) || 0)) : derivedProgress.pending,
      phase: String(storedProgress?.phase || (derivedProgress.pending || derivedProgress.failed ? 'attention' : 'completed')),
      message: String(storedProgress?.message || '')
    };
    const folderRecord = {
      folder,
      name: entry.name,
      source,
      review,
      jobs,
      images,
      masterExists: Boolean(masterImage),
      templateAvailable: Boolean(source.templateFolderPath && fs.existsSync(source.templateFolderPath)),
      legacyStatus: review.status || source.status,
      progress: taskRunning ? (generationProgress.message || '正在处理套图') : '',
      taskRunning,
      logs: await readOperationLogs(folder),
      modifiedAt: stat.mtimeMs
    };
    folders.push({
      folder,
      name: entry.name,
      images,
      jobs,
      source,
      logs: folderRecord.logs,
      masterImage,
      masterStatus: masterImage ? '母版已生成' : '',
      status: deriveFolderStatus(folderRecord, config.auditMode),
      generationProgress,
      modifiedAt: stat.mtimeMs
    });
  }
  return folders.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

function titleLibraryRecordCount(library) {
  const records = library?.records || library?.Records;
  return Array.isArray(records) ? records.length : 0;
}

async function readFirstTitleFromWorkbook(file) {
  if (!fs.existsSync(file)) return '';
  try {
    const workbook = XLSX.readFile(file);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = worksheet ? XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' }) : [];
    return String(rows?.[1]?.[2] || '').trim();
  } catch {
    return '';
  }
}

async function writeTitlesWorkbook(file, category, titles) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.rm(file, { force: true });
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(createTitleWorkbookRows(category, titles, localDisplayTimestamp()));
  worksheet['!cols'] = [{ wch: 8 }, { wch: 16 }, { wch: 56 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(workbook, worksheet, '标题');
  XLSX.writeFile(workbook, file);
  return file;
}

async function listReadyTitleTasks() {
  const config = await loadConfig();
  const ready = (await reviewFolders()).filter(isFolderReadyForTitle);
  const tasks = [];
  for (const item of ready) {
    const category = getTitleCategoryForReviewFolder({
      folder: item.folder,
      templateFolderPath: item.source?.templateFolderPath,
      detailSetsPath: config.detailSetsPath,
      directoryExists: candidate => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()
    });
    const library = await loadCategoryTitleLibrary(category);
    const titleFile = path.join(item.folder, '标题.xlsx');
    const hasTitle = fs.existsSync(titleFile);
    tasks.push({
      folder: item.folder,
      name: item.name,
      imageCount: item.jobs.length,
      category,
      libraryAvailable: titleLibraryRecordCount(library) > 0,
      libraryRecordCount: titleLibraryRecordCount(library),
      hasTitle,
      titleFile,
      firstTitle: hasTitle ? await readFirstTitleFromWorkbook(titleFile) : '',
      modifiedAt: item.modifiedAt
    });
  }
  return tasks;
}

async function generateTitleForTask(folderValue) {
  const folder = String(folderValue || '');
  if (!folder || !fs.existsSync(folder)) throw new Error('任务文件夹不存在');
  const task = (await listReadyTitleTasks()).find(item => path.resolve(item.folder) === path.resolve(folder));
  if (!task) throw new Error('任务图片尚未全部通过，不能生成标题');
  const library = await loadCategoryTitleLibrary(task.category);
  if (!library || titleLibraryRecordCount(library) === 0) throw new Error(`缺少 ${task.category} 关键词库，请先导入。`);

  const profile = await readProductProfileFile(getTaskProductProfileFile(folder)) || normalizeProductProfile({});
  const stateFile = path.join(metadataPaths(folder).metadataFolder, 'title-generation-state.json');
  const nextState = advanceTitleGenerationState(await readJsonFile(stateFile, {}));
  await writeJsonFile(stateFile, nextState);
  const title = generateTaobaoTitle(task.category, library, profile, nextState.Count);
  await writeTitlesWorkbook(task.titleFile, task.category, [title]);
  return { ...task, hasTitle: true, firstTitle: title };
}

async function findReviewJob(folder, relativePath) {
  const source = await readSourceMetadata(folder);
  if (!source.templateFolderPath || !fs.existsSync(source.templateFolderPath)) throw new Error('任务缺少套图文件夹');
  const wanted = String(relativePath || '').replaceAll('\\', '/').toLocaleLowerCase('zh-CN');
  const selectedPaths = new Set((source.templateRelativePaths || []).map(value => String(value).replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
  const job = (await buildTemplateJobs(source.templateFolderPath, folder)).find(item => {
    const normalized = item.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN');
    return normalized === wanted && (!selectedPaths.size || selectedPaths.has(normalized));
  });
  if (!job) throw new Error(`未找到套图图片：${relativePath}`);
  return job;
}

async function setTemplateManualStatus(payload) {
  const folder = String(payload?.folder || '');
  if (!folder || !fs.existsSync(folder)) throw new Error('任务文件夹不存在');
  const job = await findReviewJob(folder, payload?.relativePath);
  const status = payload?.status === '人工不通过' ? '人工不通过' : '人工通过';
  const updatedAt = new Date().toISOString();
  const paths = metadataPaths(folder, job.relativePath);
  await writeJsonFile(paths.manualReview, toWpfManualReviewState(status, updatedAt));
  const reviewPaths = metadataPaths(folder);
  const current = normalizeReviewMetadata(await readJsonFile(reviewPaths.macReview, {}));
  const images = current.images.filter(image => image.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN') !== job.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN'));
  images.push({ relativePath: job.relativePath, outputPath: job.outputPath, outputExists: fs.existsSync(job.outputPath), manualStatus: status, reviewedAt: updatedAt });
  await writeJsonFile(reviewPaths.macReview, toMacReviewMetadata(current, { images, reviewedAt: updatedAt }));
  await addOperationLog(folder, `${status === '人工通过' ? '人工标记通过' : '人工标记不通过'}：${job.relativePath}`);
  return true;
}

async function approveReviewFolder(folder, allowSkip = false) {
  if (!folder || !fs.existsSync(folder)) throw new Error('任务文件夹不存在');
  const source = await readSourceMetadata(folder);
  if (!source.templateFolderPath || !fs.existsSync(source.templateFolderPath)) {
    await writeJsonFile(metadataPaths(folder).macReview, { status: '已通过', reviewedAt: new Date().toISOString() });
    await addOperationLog(folder, '人工通过任务');
    return { approved: true, changed: 0 };
  }
  const selectedPaths = new Set((source.templateRelativePaths || []).map(value => String(value).replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
  const jobs = (await buildTemplateJobs(source.templateFolderPath, folder))
    .filter(job => !selectedPaths.size || selectedPaths.has(job.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
  const actionableJobs = [];
  for (const job of jobs) {
    const { summary } = await templateAnalysisForJob(job);
    if (summary.action !== 'skip_copy') actionableJobs.push(job);
  }
  const missing = actionableJobs.filter(job => !fs.existsSync(job.outputPath));
  if (missing.length) {
    await addOperationLog(folder, `批量通过任务列表：还有 ${missing.length} 张未生成，未归档`);
    if (allowSkip) return { approved: false, missing: missing.length };
    throw new Error(`还有 ${missing.length} 张套图未生成`);
  }
  const updatedAt = new Date().toISOString();
  for (const job of actionableJobs) await writeJsonFile(metadataPaths(folder, job.relativePath).manualReview, toWpfManualReviewState('人工通过', updatedAt));
  const images = actionableJobs.map(job => ({ relativePath: job.relativePath, outputPath: job.outputPath, outputExists: true, manualStatus: '人工通过', reviewedAt: updatedAt }));
  await writeJsonFile(metadataPaths(folder).macReview, toMacReviewMetadata({ status: '已通过' }, { status: '已通过', reviewedAt: updatedAt, images }));
  await addOperationLog(folder, `批量通过任务列表：已标记 ${actionableJobs.length} 张图片为通过，并归档任务`);
  return { approved: true, changed: actionableJobs.length };
}

async function batchApproveReviewFolders(folders) {
  const results = [];
  for (const folder of [...new Set((folders || []).map(String))]) results.push({ folder, ...(await approveReviewFolder(folder, true)) });
  return results;
}

async function deleteReviewFolders(folders) {
  const outputRoot = path.resolve((await loadConfig()).outputPath || currentDefaultOutputRoot());
  const existing = [...new Set((folders || []).map(String))].filter(folder => {
    const resolved = path.resolve(folder);
    return fs.existsSync(resolved) && resolved !== outputRoot && isSameOrChildPath(outputRoot, resolved);
  });
  let deleted = 0;
  for (const folder of existing) {
    await fsp.rm(folder, { recursive: true, force: true });
    deleted += 1;
  }
  return deleted;
}


async function resetConfig() {
  await fsp.rm(configFile(), { force: true });
  return saveConfig(defaultConfig());
}

async function generateFree(payload = {}, options = {}) {
  if (!payload.sourcePath || !fs.existsSync(payload.sourcePath)) throw new Error('请选择源图片');
  if (!String(payload.prompt || '').trim()) throw new Error('请输入生图提示词');
  const config = await loadConfig();
  const folder = path.join(config.outputPath || currentDefaultOutputRoot(), '自由生图');
  await fsp.mkdir(folder, { recursive: true });
  const outputPath = path.join(folder, `自由生图_${localFileTimestamp()}.png`);
  await fsp.writeFile(outputPath, await generateImage(String(payload.prompt).trim(), [payload.sourcePath], {
    size: config.imageSize || '1024x1024',
    quality: config.imageQuality || 'auto',
    billingDescription: '自由生图',
    billingReference: path.basename(payload.sourcePath),
    signal: options.signal
  }));
  return { outputPath, url: imageUrl(outputPath) };
}

async function saveTitleSetup(payload = {}) {
  const library = await loadTitleLibrary();
  if (!library) throw new Error('请先导入关键词表');
  library.prefixRoots = parseTitlePrefixRoots(payload.prefixes || '');
  library.prefixRoot = library.prefixRoots[0] || '';
  library.requiredRoots = parseTitlePrefixRoots(payload.requiredRoots || []);
  if (!library.prefixRoots.length) throw new Error('至少填写一个标题开头词根');
  await saveCategoryTitleLibrary(library);
  return saveTitleLibrary(library);
}

async function generateTitles(payload = {}) {
  const library = await loadTitleLibrary();
  if (!library) throw new Error('请先导入关键词表');
  const prefixRoots = parseTitlePrefixRoots(payload.prefixes || library.prefixRoots || []);
  const requiredRoots = parseTitlePrefixRoots(payload.requiredRoots || library.requiredRoots || []);
  if (!prefixRoots.length) throw new Error('请先填写至少一个标题开头词根');
  library.prefixRoots = prefixRoots;
  library.prefixRoot = prefixRoots[0];
  library.requiredRoots = requiredRoots;
  const generationState = await loadTitleGenerationState();
  generationState.nextIndexes ||= generationState.NextIndexes || {};
  const key = titleGenerationStateKey(library, prefixRoots);
  const startVariantIndex = Number(generationState.nextIndexes[key]) > 0 ? Number(generationState.nextIndexes[key]) : 1;
  const generated = generateStandaloneTitles({ library, prefixRoots, count: payload.count, startVariantIndex });
  generationState.nextIndexes[key] = generated.nextVariantIndex;
  await saveTitleGenerationState(generationState);
  await saveCategoryTitleLibrary(library);
  await saveTitleLibrary(library);
  return generated.titles;
}

async function exportTitles(payload = {}) {
  const titles = (payload.titles || []).map(String).filter(Boolean);
  if (!titles.length) throw new Error('请先选择要导出的标题');
  const fileName = `${safeFileName(payload.category || '批量')}_标题_${localFileTimestamp()}.xlsx`;
  const file = path.join(app.getPath('downloads'), fileName);
  await writeTitlesWorkbook(file, payload.category || '', titles);
  return file;
}

async function initializeRuntime() {
  await Promise.all([
    fsp.mkdir(currentUserDataRoot(), { recursive: true }),
    fsp.mkdir(currentDefaultOutputRoot(), { recursive: true }),
    fsp.mkdir(path.join(currentWorkspaceRoot(), 'exports'), { recursive: true })
  ]);
  await Promise.all([loadConfig(), loadApiSettings()]);
}

const runtimeExports = {
  DATA_ROOT,
  analyzeProductProfile,
  analyzeTemplateItems,
  analyzeTemplateFolder,
  apiSettingsStatus,
  approveReviewFolder,
  batchApproveReviewFolders,
  billing,
  deleteTemplateFolder,
  deleteReviewFolders,
  exportTitles,
  fileFromToken,
  fileToken,
  generateFree,
  generateTask,
  generateTemplateSetForFolder,
  generateTitleForTask,
  generateTitles,
  getTemplatePreparation,
  imageUrl,
  importTitleLibrary,
  initializeRuntime,
  isOutputPath,
  isWorkspacePath,
  listReadyTitleTasks,
  listTemplateFolders,
  listTemplates,
  loadApiSettings,
  loadConfig,
  loadPromptSettings,
  loadTemplateProductProfile,
  loadTitleLibrary,
  publicTitleLibrary,
  runWithWorkspace,
  prepareTemplateFolder,
  regenerateMasterForReviewFolder,
  regenerateSingleTemplate,
  resetConfig,
  resetPromptSetting,
  reviewFolders,
  saveConfig,
  saveApiSettings,
  savePromptSetting,
  saveTemplateConfiguration,
  saveTemplateMask,
  saveTemplateProductProfile,
  saveTitleSetup,
  scanImages,
  setTemplateManualStatus,
  testAnalysisApi,
  testApiSettings
};

Object.defineProperties(runtimeExports, {
  OUTPUT_ROOT: { enumerable: true, get: currentDefaultOutputRoot },
  USER_DATA_ROOT: { enumerable: true, get: currentUserDataRoot },
  WORKSPACE_ID: { enumerable: true, get: currentWorkspaceId },
  WORKSPACE_ROOT: { enumerable: true, get: currentWorkspaceRoot }
});

module.exports = runtimeExports;

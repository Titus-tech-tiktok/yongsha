function rpc(method, ...args) {
  return fetch('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  }).then(async response => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `请求失败：HTTP ${response.status}`);
    return body.data;
  });
}

async function authRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：HTTP ${response.status}`);
  return body.data;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function createClientId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function runJob(method, args = [], clientKey = '', onProgress = () => {}) {
  const response = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args, clientKey })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `任务提交失败：HTTP ${response.status}`);
  const jobId = body.data?.id;
  if (!jobId) throw new Error('服务端没有返回任务编号');
  onProgress(body.data?.progress || {}, body.data || {});
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const currentResponse = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
    const currentBody = await currentResponse.json().catch(() => ({}));
    if (!currentResponse.ok) throw new Error(currentBody.error || `任务查询失败：HTTP ${currentResponse.status}`);
    const job = currentBody.data;
    onProgress(job?.progress || {}, job || {});
    if (job?.status === 'completed') {
      window.dispatchEvent(new CustomEvent('caishen:billing-changed'));
      return job.result;
    }
    if (job?.status === 'failed') {
      window.dispatchEvent(new CustomEvent('caishen:billing-changed'));
      throw new Error(job.error || '后台任务执行失败');
    }
    await sleep(1000);
  }
  throw new Error('后台任务仍在执行，请稍后到对应页面刷新结果');
}

async function cancelJob(jobId) {
  if (!jobId) return null;
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `停止任务失败：HTTP ${response.status}`);
  return body.data;
}

function pickFiles({ accept = '', directory = false, multiple = false } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple || directory;
    if (directory) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    }
    input.onchange = () => resolve([...input.files || []]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

function assetFileEntry(file, relativePath = '') {
  return { file, relativePath: String(relativePath || file?.webkitRelativePath || file?.name || '').replaceAll('\\', '/') };
}

async function readDroppedEntry(entry, parent = '') {
  if (!entry) return [];
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [assetFileEntry(file, `${parent}${file.name}`)];
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const children = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map(child => readDroppedEntry(child, `${parent}${entry.name}/`)));
  return nested.flat();
}

async function filesFromDrop(dataTransfer) {
  const items = [...(dataTransfer?.items || [])];
  const entries = items.map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  const files = entries.length
    ? (await Promise.all(entries.map(entry => readDroppedEntry(entry)))).flat()
    : [...(dataTransfer?.files || [])].map(file => assetFileEntry(file));
  return files.filter(item => supportedImagePattern.test(item.file?.name || item.relativePath));
}

async function chooseAssetFiles() {
  return (await pickFiles({ accept: 'image/*', multiple: true })).map(file => assetFileEntry(file));
}

async function addAssetFiles(key, root, entries = []) {
  const valid = entries.filter(item => item?.file && supportedImagePattern.test(item.file.name || item.relativePath));
  if (!valid.length) throw new Error('请选择支持的图片文件');
  let currentRoot = root || '';
  let added = 0;
  let skipped = 0;
  const batchSize = 200;
  for (let start = 0; start < valid.length; start += batchSize) {
    const batch = valid.slice(start, start + batchSize);
    const form = new FormData();
    form.append('root', currentRoot);
    form.append('relativePaths', JSON.stringify(batch.map(item => item.relativePath || item.file.name)));
    for (const item of batch) form.append('files', item.file, item.file.name);
    const result = await responseJson(await fetch(`/api/assets/files/${assetKindFromKey(key)}`, { method: 'POST', body: form }), '添加素材失败');
    currentRoot = result.root;
    added += Number(result.added) || 0;
    skipped += Number(result.skipped) || 0;
  }
  return { root: currentRoot, added, skipped };
}

async function deleteAssetFiles(key, root, paths) {
  return responseJson(await fetch(`/api/assets/files/${assetKindFromKey(key)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, paths })
  }), '删除素材失败');
}

const stagedAssetFolders = new Map();
const supportedImagePattern = /\.(jpe?g|png|webp|bmp|gif|tiff?)$/i;

function assetKindFromKey(key) {
  return key === 'categoriesPath' ? 'product' : key === 'printsPath' ? 'print' : 'template';
}

function stagedRelativePath(file, rootName) {
  const value = String(file.webkitRelativePath || file.name || '').replaceAll('\\', '/');
  const parts = value.split('/').filter(Boolean);
  if (parts[0] === rootName) parts.shift();
  return parts.join('/') || file.name;
}

async function stageAssetFolder(key) {
  const selected = await pickFiles({ accept: 'image/*', directory: true, multiple: true });
  if (!selected.length) return null;
  const firstPath = String(selected[0].webkitRelativePath || selected[0].name).replaceAll('\\', '/');
  const rootName = firstPath.split('/').filter(Boolean)[0] || '素材';
  const files = selected
    .filter(file => supportedImagePattern.test(file.name))
    .map(file => ({ file, relativePath: stagedRelativePath(file, rootName) }))
    .filter(item => key !== 'printsPath' || !item.relativePath.includes('/'));
  if (!files.length) throw new Error('选择的文件夹里没有支持的图片');
  const stage = {
    key,
    kind: assetKindFromKey(key),
    rootName,
    files,
    totalBytes: files.reduce((total, item) => total + item.file.size, 0)
  };
  stagedAssetFolders.set(key, stage);
  return { key, rootName, count: files.length, totalBytes: stage.totalBytes };
}

async function responseJson(response, fallbackMessage) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `${fallbackMessage}：HTTP ${response.status}`);
  return body.data ?? body;
}

async function syncAssetFolder(key, currentRoot, onProgress = () => {}) {
  const stage = stagedAssetFolders.get(key);
  if (!stage) throw new Error('请先选择需要扫描的文件夹');
  onProgress({ phase: 'compare', current: 0, total: stage.files.length, message: '正在对比本地素材库…' });
  const prepared = await responseJson(await fetch(`/api/assets/sync/prepare/${stage.kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentRoot: currentRoot || '',
      rootName: stage.rootName,
      files: stage.files.map(item => ({
        name: item.file.name,
        relativePath: item.relativePath,
        size: item.file.size,
        lastModified: item.file.lastModified
      }))
    })
  }), '扫描准备失败');

  const needed = new Set(prepared.neededRelativePaths || []);
  const pending = stage.files.filter(item => needed.has(item.relativePath));
  const batchSize = 40;
  let uploaded = 0;
  onProgress({ phase: 'upload', current: 0, total: pending.length, skipped: prepared.skipped, message: pending.length ? '开始导入新增和变化素材…' : '素材没有变化' });
  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    const form = new FormData();
    for (const item of batch) form.append('files', item.file, item.file.name);
    form.append('relativePaths', JSON.stringify(batch.map(item => item.relativePath)));
    form.append('lastModified', JSON.stringify(batch.map(item => item.file.lastModified)));
    await responseJson(await fetch(`/api/assets/sync/upload/${encodeURIComponent(prepared.sessionId)}`, { method: 'POST', body: form }), '素材上传失败');
    uploaded += batch.length;
    onProgress({ phase: 'upload', current: uploaded, total: pending.length, skipped: prepared.skipped, message: `正在导入 ${uploaded}/${pending.length}` });
  }
  const result = await responseJson(await fetch(`/api/assets/sync/finish/${encodeURIComponent(prepared.sessionId)}`, { method: 'POST' }), '完成扫描失败');
  onProgress({ phase: 'done', current: result.count, total: result.count, skipped: result.skipped, uploaded: result.uploaded, message: '扫描完成' });
  return result;
}

async function uploadFolder(kind) {
  const files = await pickFiles({ directory: true, multiple: true });
  if (!files.length) return '';
  const form = new FormData();
  for (const file of files) form.append('files', file, file.name);
  form.append('relativePaths', JSON.stringify(files.map(file => file.webkitRelativePath || file.name)));
  const response = await fetch(`/api/upload/folder/${kind}`, { method: 'POST', body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `上传失败：HTTP ${response.status}`);
  return body.root;
}

async function uploadSingle(endpoint, accept) {
  const [file] = await pickFiles({ accept });
  if (!file) return null;
  const form = new FormData();
  form.append('file', file, file.name);
  const response = await fetch(endpoint, { method: 'POST', body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `上传失败：HTTP ${response.status}`);
  return body;
}

function downloadFrom(url) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function openWorkspacePath(target, kind) {
  const popup = kind === 'folder' ? window.open('about:blank', '_blank') : null;
  try {
    const url = await rpc('getFileLink', target, kind);
    if (kind === 'folder') {
      if (popup) popup.location.href = url;
      else window.location.href = url;
    } else downloadFrom(url);
  } catch (error) {
    popup?.close();
    throw error;
  }
}

async function downloadWorkspaceFolder(target) {
  const url = await rpc('getFileLink', target, 'zip');
  downloadFrom(url);
}

window.caishen = {
  authStatus: () => authRequest('/api/auth/status'),
  bootstrapAccount: payload => authRequest('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify(payload) }),
  login: payload => authRequest('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => authRequest('/api/auth/logout', { method: 'POST' }),
  listUsers: () => authRequest('/api/auth/users'),
  createUser: payload => authRequest('/api/auth/users', { method: 'POST', body: JSON.stringify(payload) }),
  setUserActive: (id, active) => authRequest(`/api/auth/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  updateUser: (id, payload) => authRequest(`/api/auth/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  getBillingSummary: () => authRequest('/api/billing/me'),
  getBillingAdmin: () => authRequest('/api/billing/admin'),
  saveBillingRules: payload => authRequest('/api/billing/rules', { method: 'PUT', body: JSON.stringify(payload) }),
  adjustBillingBalance: payload => authRequest('/api/billing/adjust', { method: 'POST', body: JSON.stringify(payload) }),
  clearBillingLedger: () => authRequest('/api/billing/ledger', { method: 'DELETE' }),
  cancelJob,
  getConfig: () => rpc('getConfig'),
  getApiSettings: () => rpc('getApiSettings'),
  saveApiSettings: payload => rpc('saveApiSettings', payload),
  testApiSettings: payload => rpc('testApiSettings', payload),
  testAnalysisApi: payload => rpc('testAnalysisApi', payload),
  saveConfig: config => rpc('saveConfig', config),
  resetConfig: () => rpc('resetConfig'),
  getPromptSettings: () => rpc('getPromptSettings'),
  savePromptSetting: (id, value) => rpc('savePromptSetting', id, value),
  resetPromptSetting: id => rpc('resetPromptSetting', id),
  stageAssetFolder,
  syncAssetFolder,
  chooseAssetFiles,
  filesFromDrop,
  addAssetFiles,
  deleteAssetFiles,
  chooseFolder: async (currentPath, key) => {
    if (key === 'outputPath') return currentPath || (await rpc('getConfig')).outputPath;
    const kind = key === 'categoriesPath' ? 'product' : key === 'printsPath' ? 'print' : 'template';
    return uploadFolder(kind);
  },
  chooseImage: async () => uploadSingle('/api/upload/image', 'image/*'),
  listImages: (root, query) => rpc('listImages', root, query),
  listTemplateFolders: () => rpc('listTemplateFolders'),
  deleteTemplateFolder: folder => rpc('deleteTemplateFolder', folder),
  generateTask: (task, onProgress) => runJob('generateTask', [task], `${task?.id || createClientId()}:${task?.runAttempt || 1}`, onProgress),
  listTemplates: folder => rpc('listTemplates', folder),
  getTemplatePreparation: folder => rpc('getTemplatePreparation', folder),
  prepareTemplates: folder => runJob('prepareTemplates', [folder]),
  saveTemplateConfig: payload => rpc('saveTemplateConfig', payload),
  analyzeTemplates: folder => runJob('analyzeTemplates', [folder]),
  analyzeTemplateItems: (payload, onProgress) => runJob('analyzeTemplateItems', [payload], `template-analysis:${Date.now()}:${createClientId()}`, onProgress),
  analyzeTemplateItemWithReference: (payload, onProgress) => runJob('analyzeTemplateItemWithReference', [payload], `template-reference-analysis:${Date.now()}:${createClientId()}`, onProgress),
  saveTemplateMask: payload => rpc('saveTemplateMask', payload),
  getProductProfile: folder => rpc('getProductProfile', folder),
  analyzeProductProfile: path => runJob('analyzeProductProfile', [path]),
  saveProductProfile: payload => rpc('saveProductProfile', payload),
  generateFree: payload => runJob('generateFree', [payload]),
  listReviews: () => rpc('listReviews'),
  approveReview: folder => rpc('approveReview', folder),
  setReviewStatus: payload => rpc('setReviewStatus', payload),
  generateTemplates: (payload, onProgress) => runJob('generateTemplates', [payload], `review-generation:${Date.now()}:${createClientId()}`, onProgress),
  regenerateMaster: folder => runJob('regenerateMaster', [folder]),
  regenerateTemplate: payload => runJob('regenerateTemplate', [payload]),
  batchApproveReviews: folders => rpc('batchApproveReviews', folders),
  deleteReviews: folders => rpc('deleteReviews', folders),
  revealFile: file => openWorkspacePath(file, 'file'),
  openFolder: folder => openWorkspacePath(folder, 'folder'),
  downloadFolder: folder => downloadWorkspaceFolder(folder),
  copyText: text => navigator.clipboard.writeText(String(text || '')),
  getTitleLibrary: () => rpc('getTitleLibrary'),
  importTitleLibrary: async () => (await uploadSingle('/api/upload/title-library', '.xlsx,.csv'))?.data || null,
  listReadyTitleTasks: () => rpc('listReadyTitleTasks'),
  generateTitleForTask: folder => rpc('generateTitleForTask', folder),
  saveTitleSetup: payload => rpc('saveTitleSetup', payload),
  generateTitles: payload => rpc('generateTitles', payload),
  exportTitles: async payload => {
    const file = await rpc('exportTitles', payload);
    if (file) await openWorkspacePath(file, 'file');
    return file;
  }
};

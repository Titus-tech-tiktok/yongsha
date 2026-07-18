const QUEUE_STORAGE_KEY = 'caishen-web-task-queue-v1';
const TEMPLATE_MASTER_CANDIDATES_STORAGE_KEY = 'caishen-web-template-master-candidates-v1';
const ASSET_PREVIEW_SIZE_STORAGE_KEY = 'caishen-web-asset-preview-sizes-v1';
const REVIEW_VIEWED_STORAGE_KEY = 'caishen-web-viewed-review-jobs-v1';
const REVIEW_REGENERATION_RECORDS_STORAGE_KEY = 'caishen-web-review-regeneration-records-v1';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'caishen-web-sidebar-collapsed-v1';
let storageScope = 'anonymous';
const scopedStorageKey = key => `${key}:${storageScope}`;

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

function loadStoredQueue() {
  try {
    const items = JSON.parse(localStorage.getItem(scopedStorageKey(QUEUE_STORAGE_KEY)) || '[]');
    if (!Array.isArray(items)) return [];
    return items.filter(item => item && item.id && item.printPath).map(item => ({
      ...item,
      selected: item.selected !== false,
      status: ['排队中', '生成中'].includes(item.status) ? '未开始' : (item.status || '未开始'),
      error: ['排队中', '生成中'].includes(item.status) ? '页面曾关闭，将继续查询原后台任务。' : (item.error || '')
    }));
  } catch {
    return [];
  }
}

function persistQueue() {
  try { localStorage.setItem(scopedStorageKey(QUEUE_STORAGE_KEY), JSON.stringify(state.queue.slice(-500))); } catch {}
}

function loadStoredTemplateMasterCandidates() {
  try {
    const items = JSON.parse(localStorage.getItem(scopedStorageKey(TEMPLATE_MASTER_CANDIDATES_STORAGE_KEY)) || '[]');
    if (!Array.isArray(items)) return [];
    return items.filter(item => item && item.id && (item.masterReferencePath || item.printPath || item.masterImagePath)).map(item => ({
      ...item,
      selected: Boolean(item.selected),
      masterStatus: ['生成中', '重新生成'].includes(item.masterStatus)
        ? (item.masterImagePath ? '已生成' : '未生成')
        : (item.masterStatus || '未生成'),
      masterProgress: ['生成中', '重新生成'].includes(item.masterStatus) ? null : (item.masterProgress || null),
      masterError: ['生成中', '重新生成'].includes(item.masterStatus) ? '页面曾关闭，请重新生成母版。' : (item.masterError || '')
    })).slice(-200);
  } catch {
    return [];
  }
}

function persistTemplateMasterCandidates() {
  try { localStorage.setItem(scopedStorageKey(TEMPLATE_MASTER_CANDIDATES_STORAGE_KEY), JSON.stringify(state.templateMasterCandidates.slice(-200))); } catch {}
}

function loadStoredAssetPreviewSizes() {
  try {
    const saved = JSON.parse(localStorage.getItem(scopedStorageKey(ASSET_PREVIEW_SIZE_STORAGE_KEY)) || '{}');
    return {
      printsPath: Math.max(110, Math.min(240, Number(saved.printsPath) || 138)),
      detailSetsPath: Math.max(110, Math.min(240, Number(saved.detailSetsPath) || 138))
    };
  } catch {
    return { printsPath: 138, detailSetsPath: 138 };
  }
}

function persistAssetPreviewSizes() {
  try { localStorage.setItem(scopedStorageKey(ASSET_PREVIEW_SIZE_STORAGE_KEY), JSON.stringify(state.assetPreviewSizes)); } catch {}
}

function loadViewedReviewJobs() {
  try {
    const saved = JSON.parse(localStorage.getItem(scopedStorageKey(REVIEW_VIEWED_STORAGE_KEY)) || '[]');
    return new Set(Array.isArray(saved) ? saved.map(String).slice(-3000) : []);
  } catch {
    return new Set();
  }
}

function persistViewedReviewJobs() {
  try { localStorage.setItem(scopedStorageKey(REVIEW_VIEWED_STORAGE_KEY), JSON.stringify([...state.viewedReviewJobs].slice(-3000))); } catch {}
}

function loadReviewRegenerationRecords() {
  try {
    const saved = JSON.parse(localStorage.getItem(scopedStorageKey(REVIEW_REGENERATION_RECORDS_STORAGE_KEY)) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter(record => record && record.id && record.folder && record.relativePath).slice(-300);
  } catch {
    return [];
  }
}

function persistReviewRegenerationRecords() {
  try { localStorage.setItem(scopedStorageKey(REVIEW_REGENERATION_RECORDS_STORAGE_KEY), JSON.stringify(state.reviewRegenerationRecords.slice(-300))); } catch {}
}

const state = {
  currentUser: null,
  teamUsers: [],
  billingSummary: null,
  billingAdmin: null,
  billingAdminFilter: '',
  config: null,
  products: [],
  prints: [],
  productFolder: '',
  printFolder: '',
  selectedProduct: null,
  selectedPrint: null,
  queue: [],
  queueGroupExpanded: new Set(),
  templateItems: [],
  taskTemplateItems: [],
  templateFolders: [],
  taskTemplateFolderView: '',
  selectedTaskTemplatePaths: new Set(),
  templateMasterCandidates: [],
  activeTemplateMasterCandidateId: '',
  taskSourceTab: 'template',
  taskTemplateSelectionScope: '',
  taskTemplateExpandedGroups: new Set(),
  taskTemplateSort: 'name-asc',
  printSort: 'name-asc',
  templateFilter: 'all',
  templatePreparation: null,
  templatePreparing: false,
  reviews: [],
  activeReview: null,
  reviewTaskActivated: false,
  activeReviewGenerationJobId: '',
  stopGenerationRequested: false,
  reviewLogFilter: 'all',
  viewedReviewJobs: new Set(),
  reviewRegenerationRecords: [],
  regeneratingReviewJobs: new Set(),
  selectedReviewFolders: new Set(),
  reviewRegenerationDialog: null,
  freeSource: null,
  freeResult: null,
  titleLibrary: null,
  readyTitleTasks: [],
  generatedTitles: [],
  generatedTitleCategory: '',
  selectedTitleIndexes: new Set(),
  requiredTitleRoots: new Set(),
  taobaoPublishSettings: null,
  taobaoPublishTasks: [],
  activeTaobaoPublishTaskId: '',
  activeTaobaoCategoryId: '',
  promptSettings: null,
  activePromptId: '',
  freePromptDefaultApplied: false,
  apiSettings: null,
  modelPackageSettings: null,
  selectedModelPackageId: '',
  allowAdminPromptView: false,
  apiConcurrencySettings: null,
  imageApiModels: [],
  analysisApiModels: [],
  apiModelChannel: 'image',
  selectedApiModelId: '',
  settingsTab: 'general',
  billingCustomDays: 30,
  assetStages: {},
  assetPreviewKey: 'detailSetsPath',
  templateFolderView: '',
  assetPreviewItems: [],
  assetPreviewCache: new Map(),
  assetPreviewLoadId: 0,
  assetPreviewSizes: { printsPath: 138, detailSetsPath: 138 },
  assetTemplateFilter: 'all',
  selectedAssetPaths: new Set(),
  assetUploading: false,
  assetAnalysisProgress: new Map(),
  assetAnalysisRunning: 0,
  activeTemplatePath: ''
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let toastTimer;
let productSearchTimer;
let printSearchTimer;
let reviewRefreshTimer;
let currentPage = 'tasks';
const promptSaveTimers = new Map();

function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = 'toast'; }, 3200);
}

function applySidebarCollapsed(collapsed) {
  const shell = $('#appShell');
  if (!shell) return;
  shell.classList.toggle('sidebar-collapsed', Boolean(collapsed));
  const button = $('#sidebarToggleButton');
  if (button) {
    button.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    button.setAttribute('aria-label', collapsed ? '展开边栏' : '隐藏边栏');
    button.title = collapsed ? '展开边栏' : '隐藏边栏';
    button.textContent = collapsed ? '›' : '‹';
  }
  const logo = $('.brand img');
  if (logo) logo.title = '庞大科技';
  try { localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0'); } catch {}
}

function loadSidebarCollapsed() {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'; } catch { return false; }
}

function errorText(error) {
  return error?.message || String(error || '未知错误');
}

let authBootstrapMode = false;

function showAuthGate(bootstrapRequired = false) {
  authBootstrapMode = bootstrapRequired;
  $('#authGate').hidden = false;
  $('#appShell').hidden = true;
  $('#authDisplayNameField').hidden = !bootstrapRequired;
  $('#authEyebrow').textContent = bootstrapRequired ? '首次使用' : '团队账号';
  $('#authTitle').textContent = bootstrapRequired ? '创建管理员账号' : '登录自己的工作区';
  $('#authDescription').textContent = bootstrapRequired
    ? '这个管理员会继续使用当前已有素材，并可为其他美工创建独立账号。'
    : '每位美工的素材、任务、提示词和输出配置互相独立。';
  $('#authSubmitButton').textContent = bootstrapRequired ? '创建并进入' : '登录';
  $('#authHint').textContent = bootstrapRequired ? '请记住管理员账号和密码。' : '账号由管理员在系统设置中创建。';
  $('#authHint').classList.remove('error');
  $('#authPassword').autocomplete = bootstrapRequired ? 'new-password' : 'current-password';
  requestAnimationFrame(() => $('#authUsername').focus());
}

function applyCurrentUser(user) {
  state.currentUser = user;
  storageScope = user.id;
  state.queue = loadStoredQueue();
  state.templateMasterCandidates = loadStoredTemplateMasterCandidates();
  state.viewedReviewJobs = loadViewedReviewJobs();
  state.reviewRegenerationRecords = loadReviewRegenerationRecords();
  state.assetPreviewSizes = loadStoredAssetPreviewSizes();
  $('#currentUserName').textContent = user.displayName || user.username;
  $('#currentUserName').title = `${user.username} · ${roleLabel(user.role)}`;
  $('#promptSettingsNav').hidden = !canViewPrompts();
  $('[data-settings-tab="general"]').hidden = user.role === 'admin';
  $('#apiSettingsTab').hidden = !isTeamAdmin();
  const apiTabStatus = $('#apiTabStatus');
  $('#apiSettingsTab').firstChild.textContent = isSuperAdmin() ? 'API 设置 ' : '模型选择 ';
  if (apiTabStatus) apiTabStatus.textContent = '未配置';
  $('#billingSettingsTab').hidden = !isSuperAdmin();
  $('#teamSettingsTab').hidden = !isTeamAdmin();
  $('#newUserRoleLabel').hidden = !isSuperAdmin();
  $('#authGate').hidden = true;
  $('#appShell').hidden = false;
}

async function submitAuth(event) {
  event.preventDefault();
  const button = $('#authSubmitButton');
  const payload = {
    username: $('#authUsername').value.trim(),
    password: $('#authPassword').value,
    displayName: $('#authDisplayName').value.trim()
  };
  button.disabled = true;
  button.textContent = authBootstrapMode ? '正在创建…' : '正在登录…';
  try {
    if (authBootstrapMode) await window.caishen.bootstrapAccount(payload);
    else await window.caishen.login(payload);
    window.location.reload();
  } catch (error) {
    $('#authHint').textContent = errorText(error);
    $('#authHint').classList.add('error');
    button.disabled = false;
    button.textContent = authBootstrapMode ? '创建并进入' : '登录';
  }
}

async function logout() {
  try { await window.caishen.logout(); } finally { window.location.reload(); }
}

function openChangePasswordModal() {
  $('#changePasswordModal').hidden = false;
  $('#changePasswordForm').reset();
  $('#changePasswordStatus').className = '';
  $('#changePasswordStatus').textContent = '密码仅用于当前登录账号。';
  requestAnimationFrame(() => $('#currentPasswordInput').focus());
}

function closeChangePasswordModal() {
  $('#changePasswordModal').hidden = true;
}

async function submitChangePassword(event) {
  event.preventDefault();
  const currentPassword = $('#currentPasswordInput').value;
  const newPassword = $('#newPasswordInput').value;
  const confirmPassword = $('#confirmPasswordInput').value;
  if (newPassword !== confirmPassword) {
    $('#changePasswordStatus').className = 'error';
    $('#changePasswordStatus').textContent = '两次输入的新密码不一致';
    return;
  }
  const button = $('#submitChangePasswordButton');
  button.disabled = true;
  button.textContent = '保存中…';
  $('#changePasswordStatus').className = 'saving';
  $('#changePasswordStatus').textContent = '正在修改密码…';
  try {
    await window.caishen.changePassword({ currentPassword, newPassword });
    $('#changePasswordStatus').className = 'saved';
    $('#changePasswordStatus').textContent = '密码已修改';
    toast('密码已修改');
    setTimeout(closeChangePasswordModal, 450);
  } catch (error) {
    $('#changePasswordStatus').className = 'error';
    $('#changePasswordStatus').textContent = errorText(error);
  } finally {
    button.disabled = false;
    button.textContent = '保存新密码';
  }
}

const BILLING_AMOUNT_SCALE = 1000000;

function formatUsdAmount(amount = 0) {
  const fixed = Number(amount || 0).toFixed(6);
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed.includes('.') ? trimmed.replace(/(\.\d)$/, '$10') : `${trimmed}.00`;
}

function formatMoney(minor = 0) {
  return `$${formatUsdAmount(Math.max(0, Number(minor) || 0) / BILLING_AMOUNT_SCALE)}`;
}

function formatDurationMs(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}小时${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`;
  if (minutes) return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  return `${seconds}秒`;
}

function formatLocalDateTime(value) {
  if (!value) return '';
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function reviewElapsedMs(summary, running = false) {
  if (Number(summary.elapsedMs) > 0) return Number(summary.elapsedMs);
  if (!summary.startedAt) return 0;
  const started = new Date(summary.startedAt).getTime();
  if (!Number.isFinite(started)) return 0;
  if (running) return Math.max(0, Date.now() - started);
  if (summary.completedAt) {
    const completed = new Date(summary.completedAt).getTime();
    return Number.isFinite(completed) ? Math.max(0, completed - started) : 0;
  }
  return 0;
}

function normalizeProgressMessage(message = '') {
  return String(message || '').replaceAll('等待上游恢复', '生图接口等待重试');
}

function roleLabel(role) {
  return { superadmin: '超级管理员', admin: '管理员', member: '成员' }[role] || '成员';
}

function isSuperAdmin() {
  return state.currentUser?.role === 'superadmin';
}

function isTeamAdmin() {
  return ['superadmin', 'admin'].includes(state.currentUser?.role);
}

function canManagePrompts() {
  return isSuperAdmin();
}

function canViewPrompts() {
  return canManagePrompts() || (state.currentUser?.role === 'admin' && state.allowAdminPromptView);
}

function feeRangeLabel(minorMin = 0, minorMax = 0) {
  const min = Math.max(0, Number(minorMin) || 0);
  const max = Math.max(min, Number(minorMax) || min);
  return min === max ? formatMoney(min) : `${formatMoney(min)}-${formatMoney(max)}`;
}

function moneyInputToMinor(value, label) {
  const text = String(value || '').trim();
  if (!/^\d+(?:\.\d{0,6})?$/.test(text)) throw new Error(`${label}金额最多支持 6 位小数`);
  const [whole, fraction = ''] = text.split('.');
  const major = Number(whole);
  if (!Number.isSafeInteger(major) || major > 1000000) throw new Error(`${label}金额无效`);
  const minor = major * BILLING_AMOUNT_SCALE + Number(fraction.padEnd(6, '0'));
  if (!Number.isSafeInteger(minor)) throw new Error(`${label}金额无效`);
  return minor;
}

function moneyMinorToInput(minor = 0) {
  return formatUsdAmount((Number(minor) || 0) / BILLING_AMOUNT_SCALE);
}

function billingKindName(kind) {
  return { image: '成功生图', llm: '语言模型调用', adjustment: '账户充值到账', transfer: '账户划拨' }[kind] || '费用记录';
}

function renderBillingLedger(entries = [], userMap = new Map()) {
  if (!entries.length) return '<div class="empty-inline">暂无费用流水</div>';
  return entries.map(entry => {
    const amount = Number(entry.amountMinor) || 0;
    const user = userMap.get(entry.workspaceId);
    const owner = user ? `${user.displayName || user.username} · ` : '';
    const label = entry.description || (entry.kind === 'adjustment' && amount < 0 ? '算力余额扣减' : billingKindName(entry.kind));
    return `<div class="billing-ledger-row"><div><b>${escapeHtml(label)}</b><span>${escapeHtml(owner + billingKindName(entry.kind))}${entry.reference ? ` · ${escapeHtml(entry.reference)}` : ''}</span><small>${escapeHtml(new Date(entry.createdAt).toLocaleString('zh-CN', { hour12: false }))}</small></div><div class="billing-ledger-amount ${amount >= 0 ? 'credit' : 'debit'}">${amount >= 0 ? '+' : '-'}${formatMoney(Math.abs(amount))}</div></div>`;
  }).join('');
}

function renderBillingSpendTotals(summary) {
  const totals = summary?.spendTotals || {};
  const customDays = Math.max(1, Math.min(3660, Number(summary?.customSpendDays || state.billingCustomDays) || 30));
  const customValue = totals[String(customDays)] ?? totals[customDays] ?? 0;
  return [
    `<div class="billing-rate-item"><span>今日费用</span><b>${formatMoney(totals['1'] || 0)}</b></div>`,
    `<div class="billing-rate-item"><span>7日费用</span><b>${formatMoney(totals['7'] || 0)}</b></div>`,
    `<div class="billing-rate-item"><span>30天费用</span><b>${formatMoney(totals['30'] || 0)}</b></div>`,
    `<label class="billing-rate-item billing-custom-days"><span>自定义时长费用</span><div><input id="billingCustomDaysInput" type="number" min="1" max="3660" step="1" value="${customDays}" aria-label="自定义统计天数"><em>天</em></div><b>${formatMoney(customValue)}</b></label>`
  ].join('');
}

function renderBillingSummary() {
  const summary = state.billingSummary;
  if (!summary) return;
  $('#currentBalance').textContent = formatMoney(summary.account?.balanceMinor);
  $('#currentBillingHint').textContent = '点击查看算力余额明细';
  $('#billingDetailSummary').textContent = `当前可用算力余额 ${formatMoney(summary.account?.availableMinor)}${summary.account?.reservedMinor ? `，任务预占 ${formatMoney(summary.account.reservedMinor)}` : ''}`;
  $('#billingDetailRates').innerHTML = renderBillingSpendTotals(summary);
  $('#billingDetailRates').hidden = false;
  $('#billingDetailList').innerHTML = renderBillingLedger(summary.transactions || []);
  const customInput = $('#billingCustomDaysInput');
  if (customInput) {
    customInput.onchange = async () => {
      state.billingCustomDays = Math.max(1, Math.min(3660, Number(customInput.value) || 30));
      await loadBillingSummary();
    };
  }
}

async function loadBillingSummary() {
  try {
    state.billingSummary = await window.caishen.getBillingSummary(state.billingCustomDays);
    renderBillingSummary();
  } catch (error) {
    $('#currentBalance').textContent = '读取失败';
    $('#currentBillingHint').textContent = errorText(error);
  }
}

async function openBillingDetail() {
  $('#billingDetailModal').hidden = false;
  await loadBillingSummary();
}

function closeBillingDetail() {
  $('#billingDetailModal').hidden = true;
}

function apiTestErrorText(error) {
  const text = errorText(error);
  if (/token_expired|authentication token is expired/i.test(text)) return '上游登录 Token 已过期，请在 API 服务端重新登录后再测试。';
  if (/status=401|HTTP 401|unauthorized/i.test(text)) return '接口认证失败，请检查 API 密钥或上游登录状态。';
  return text;
}

function bindImageHoverPreview() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const preview = $('#imageHoverPreview');
  const previewImage = $('#imageHoverPreviewImage');
  const caption = $('#imageHoverPreviewCaption');
  let sourceImage = null;
  let positionFrame = 0;
  let positionAnimation = null;

  const positionBesideSource = () => {
    cancelAnimationFrame(positionFrame);
    positionFrame = requestAnimationFrame(() => {
      if (!sourceImage?.isConnected) return;
      const sourceRect = sourceImage.getBoundingClientRect();
      const previewRect = preview.getBoundingClientRect();
      const edge = 16;
      const gap = 14;
      const rightSpace = window.innerWidth - sourceRect.right - gap - edge;
      const leftSpace = sourceRect.left - gap - edge;
      let placement = 'right';
      let left;
      let top;

      if (rightSpace >= previewRect.width) {
        left = sourceRect.right + gap;
        top = sourceRect.top + (sourceRect.height - previewRect.height) / 2;
      } else if (leftSpace >= previewRect.width) {
        placement = 'left';
        left = sourceRect.left - previewRect.width - gap;
        top = sourceRect.top + (sourceRect.height - previewRect.height) / 2;
      } else {
        const bottomSpace = window.innerHeight - sourceRect.bottom - gap - edge;
        const topSpace = sourceRect.top - gap - edge;
        placement = bottomSpace >= topSpace ? 'bottom' : 'top';
        left = sourceRect.left + (sourceRect.width - previewRect.width) / 2;
        top = placement === 'bottom'
          ? sourceRect.bottom + gap
          : sourceRect.top - previewRect.height - gap;
      }

      left = Math.max(edge, Math.min(left, window.innerWidth - previewRect.width - edge));
      top = Math.max(edge, Math.min(top, window.innerHeight - previewRect.height - edge));
      positionAnimation?.cancel();
      positionAnimation = preview.animate(
        [{ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }],
        { duration: 0, fill: 'forwards' }
      );
      preview.dataset.placement = placement;
      preview.classList.remove('positioning');
    });
  };

  const hide = () => {
    cancelAnimationFrame(positionFrame);
    positionAnimation?.cancel();
    positionAnimation = null;
    sourceImage = null;
    preview.classList.remove('show', 'positioning');
    preview.setAttribute('aria-hidden', 'true');
  };

  document.addEventListener('mouseover', event => {
    const image = event.target.closest?.('img');
    if (!image || image.closest('.brand') || image.closest('#imageHoverPreview')) return;
    const source = image.dataset.previewSrc || image.currentSrc || image.src;
    if (!source) return;
    sourceImage = image;
    previewImage.src = source;
    previewImage.alt = image.alt || '图片放大预览';
    caption.textContent = image.alt || '图片放大预览';
    preview.classList.add('show', 'positioning');
    preview.setAttribute('aria-hidden', 'false');
    positionBesideSource();
  });

  document.addEventListener('mouseout', event => {
    if (event.target === sourceImage && event.relatedTarget !== sourceImage) hide();
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  previewImage.addEventListener('load', () => { if (sourceImage) positionBesideSource(); });
}

function parseTitlePrefixRoots(value) {
  const seen = new Set();
  return String(value || '').split(/[\s,，、;；/\\|]+/).map(root => root.replace(/[\s,，。；;、|/\\]+/g, '').trim()).filter(root => {
    const key = root.toLocaleUpperCase('zh-CN');
    if (!root || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shortPath(value) {
  if (!value) return '尚未配置';
  const parts = value.split('/').filter(Boolean);
  return parts.length > 4 ? `…/${parts.slice(-4).join('/')}` : value;
}

function setPage(name) {
  if (name === 'prompts' && !canViewPrompts()) name = 'settings';
  if (name === 'settings') {
    if (state.currentUser?.role === 'admin' && state.settingsTab === 'general') state.settingsTab = 'api';
    else if (state.settingsTab === 'api' && !isTeamAdmin()) state.settingsTab = 'general';
    else if (state.settingsTab === 'billing' && !isSuperAdmin()) state.settingsTab = 'general';
    else if (state.settingsTab === 'team' && !isTeamAdmin()) state.settingsTab = 'general';
  }
  const nextPage = $(`#page-${name}`);
  if (!nextPage || (name === currentPage && nextPage.classList.contains('active'))) return;
  currentPage = name;
  if (name !== 'review') {
    clearTimeout(reviewRefreshTimer);
    reviewRefreshTimer = null;
  } else {
    state.activeReview = null;
    state.reviewTaskActivated = false;
  }
  $$('.nav-item').forEach(button => {
    const active = button.dataset.page === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $$('.page').forEach(page => page.classList.toggle('active', page.id === `page-${name}`));
  requestAnimationFrame(() => {
    if (currentPage !== name) return;
    if (name === 'review') loadReviews({ silent: state.reviews.length > 0 });
    if (name === 'titles') loadTitlePage();
    if (name === 'taobao-publish') loadTaobaoPublishPage();
    if (name === 'prompts' && canViewPrompts() && !state.promptSettings) loadPromptSettings();
    if (name === 'assets') loadAssetLibraryPreview(state.assetPreviewKey, { preserveSelection: true });
    if (name === 'settings' && isTeamAdmin() && !state.modelPackageSettings) loadModelPackageSettings();
    if (name === 'settings' && isSuperAdmin() && !state.apiSettings) loadApiSettings();
  });
}

function setTaskSourceTab(tab) {
  state.taskSourceTab = tab === 'print' ? 'print' : 'template';
  const layout = $('#page-tasks .task-layout');
  if (layout) layout.classList.toggle('template-source-print-active', state.taskSourceTab === 'print');
  $$('.template-source-tabs [data-template-source-tab]').forEach(button => {
    const active = button.dataset.templateSourceTab === state.taskSourceTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

async function chooseFolder(key) {
  const selected = await window.caishen.chooseFolder(state.config?.[key], key);
  if (!selected) return;
  state.config[key] = selected;
  if (key === 'categoriesPath') state.productFolder = '';
  if (key === 'printsPath') state.printFolder = '';
  if (key === 'detailSetsPath') state.templatePreparation = null;
  state.config = await window.caishen.saveConfig(state.config);
  renderConfig();
  if (key === 'categoriesPath' || key === 'printsPath') await loadAssets(key);
  if (key === 'detailSetsPath') {
    state.templateFolderView = selected;
    state.taskTemplateFolderView = selected;
    await loadTemplateFolders();
    await loadTemplatePreparation({ autoPrepare: true });
  }
}

function renderConfig() {
  $('#operatorCode').value = state.config.operatorCode || 'ys';
  const fields = [
    ['categoriesPath', '#categoriesPathLabel', null],
    ['printsPath', '#printsPathLabel', '#settingPrintsPath'],
    ['detailSetsPath', null, '#settingDetailSetsPath']
  ];
  for (const [key, primary, settings] of fields) {
    const label = shortPath(state.config[key]);
    if (primary) { $(primary).textContent = label; $(primary).title = state.config[key] || ''; }
    if (settings) {
      $(settings).textContent = label;
      $(settings).title = state.config[key] || '';
    }
  }
  const outputInput = $('#settingOutputPathInput');
  if (outputInput && document.activeElement !== outputInput) outputInput.value = state.config.outputPath || state.config.defaultOutputPath || '';
  $('#settingWorkspaceRoot').textContent = shortPath(state.config.defaultOutputPath || '');
  $('#settingWorkspaceRoot').title = state.config.defaultOutputPath || '';
  $('#settingOutputPathHint').textContent = `填写主电脑可访问的绝对路径，建议使用单独文件夹。新任务按套图原目录和文件名输出；重新生成覆盖同名文件。`;
  $('#taskTemplatePath').textContent = state.config.detailSetsPath ? String(state.config.detailSetsPath).split(/[\\/]/).filter(Boolean).pop() : '尚未选择套图文件夹';
  $('#taskTemplatePath').title = state.config.detailSetsPath || '';
  $$('.audit-button').forEach(button => button.classList.toggle('active', button.dataset.audit === state.config.auditMode));
  $('#auditModeStatus').textContent = state.config.auditMode === 'quality'
    ? '当前：质检模式，生成后执行 AI 审核。'
    : '当前：省钱模式，生成后交给人工确认。';
  renderTemplateWorkflow();
}

function normalizeLocalPath(value = '') {
  return String(value || '').replaceAll('\\', '/').replace(/\/+$/, '').toLocaleLowerCase('zh-CN');
}

function isClientSubPath(root, candidate) {
  const base = normalizeLocalPath(root);
  const target = normalizeLocalPath(candidate);
  return Boolean(base && target && (target === base || target.startsWith(`${base}/`)));
}

async function sanitizeConfigWorkspacePaths() {
  if (!state.config?.workspaceRoot) return;
  let changed = false;
  for (const key of ['categoriesPath', 'printsPath', 'detailSetsPath']) {
    if (state.config[key] && !isClientSubPath(state.config.workspaceRoot, state.config[key])) {
      state.config[key] = '';
      changed = true;
    }
  }
  if (changed) state.config = await window.caishen.saveConfig(state.config);
}

function currentTemplateFolderView() {
  return state.templateFolderView || state.config?.detailSetsPath || 'all';
}

function currentTaskTemplateFolderView() {
  return state.taskTemplateFolderView || state.config?.detailSetsPath || 'all';
}

function templateFolderName(folderPath) {
  return state.templateFolders.find(folder => folder.path === folderPath)?.name
    || String(folderPath || '').split(/[\\/]/).filter(Boolean).pop()
    || '未选择';
}

function templateFolderPathForItem(item) {
  return item?.templateFolderPath || state.config?.detailSetsPath || '';
}

function masterReferenceFromItem(item) {
  if (!item) return null;
  return {
    masterReferencePath: item.path || '',
    masterReferenceName: item.name || '',
    masterReferenceThumbnailUrl: item.thumbnailUrl || item.url || '',
    masterReferencePreviewUrl: item.previewUrl || item.url || '',
    masterReferenceRelativePath: item.relativePath || ''
  };
}

function templateMasterCandidateKey(referencePath, printPath) {
  return `${referencePath || ''}|${printPath || ''}`;
}

function templateMasterPrintFields(print) {
  return print ? {
    printPath: print.path,
    printName: print.name,
    printThumbnailUrl: print.thumbnailUrl || print.url || '',
    printPreviewUrl: print.previewUrl || print.url || ''
  } : {
    printPath: '',
    printName: '',
    printThumbnailUrl: '',
    printPreviewUrl: ''
  };
}

function createEmptyTemplateMasterCandidate(extra = {}) {
  return {
    id: createClientId(),
    key: '',
    generationMode: 'template_print',
    productPath: '',
    templateFolderPath: state.config?.detailSetsPath || currentTaskTemplateFolderView() || '',
    masterReferencePath: '',
    masterReferenceName: '',
    masterReferenceThumbnailUrl: '',
    masterReferencePreviewUrl: '',
    masterReferenceRelativePath: '',
    masterImagePath: '',
    masterImageUrl: '',
    masterImagePreviewUrl: '',
    masterStatus: '未生成',
    masterError: '',
    masterProgress: null,
    masterRunAttempt: 0,
    ...templateMasterPrintFields(null),
    ...extra
  };
}

function templateMasterCandidateFromItem(item, print = state.selectedPrint) {
  if (!item) return null;
  const reference = masterReferenceFromItem(item);
  return {
    ...createEmptyTemplateMasterCandidate({
      ...reference,
      ...templateMasterPrintFields(print),
      templateFolderPath: templateFolderPathForItem(item)
    })
  };
}

function templateMasterCandidateForPath(path) {
  return state.templateMasterCandidates.find(candidate => candidate.masterReferencePath === path);
}

function activeTemplateMasterCandidate() {
  return state.templateMasterCandidates.find(candidate => candidate.id === state.activeTemplateMasterCandidateId) || null;
}

function clearTemplateMasterGeneratedImage(candidate) {
  if (!candidate) return;
  candidate.masterImagePath = '';
  candidate.masterImageUrl = '';
  candidate.masterImagePreviewUrl = '';
  candidate.masterStatus = '未生成';
  candidate.masterError = '';
  candidate.masterProgress = null;
}

function upsertTemplateMasterCandidateFromItem(item) {
  const candidate = templateMasterCandidateFromItem(item);
  if (!candidate) return null;
  candidate.selected = true;
  state.templateMasterCandidates.push(candidate);
  persistTemplateMasterCandidates();
  toast(candidate.printPath
    ? `已创建母版任务：${candidate.masterReferenceName} + ${candidate.printName}`
    : `已创建母版任务：${candidate.masterReferenceName}，等待选择印花`);
  return candidate;
}

function lastIncompleteTemplateMasterCandidate() {
  for (let index = state.templateMasterCandidates.length - 1; index >= 0; index -= 1) {
    const candidate = state.templateMasterCandidates[index];
    if (!candidate.masterReferencePath || !candidate.printPath) return candidate;
  }
  return null;
}

function addTemplateMasterReference(item) {
  if (!item) return null;
  const active = activeTemplateMasterCandidate();
  if (active) {
    Object.assign(active, masterReferenceFromItem(item), {
      templateFolderPath: templateFolderPathForItem(item)
    });
    clearTemplateMasterGeneratedImage(active);
    active.selected = true;
    persistTemplateMasterCandidates();
    toast(`已更新母版底图：${active.masterReferenceName || ''}`);
    return active;
  }
  const incomplete = lastIncompleteTemplateMasterCandidate();
  if (incomplete && !incomplete.masterReferencePath) {
    Object.assign(incomplete, masterReferenceFromItem(item), {
      templateFolderPath: templateFolderPathForItem(item),
    });
    clearTemplateMasterGeneratedImage(incomplete);
    incomplete.selected = true;
    persistTemplateMasterCandidates();
    toast(incomplete.printPath
      ? `已补齐母版底图：${incomplete.masterReferenceName} + ${incomplete.printName}`
      : `已补齐母版底图：${incomplete.masterReferenceName}`);
    return incomplete;
  }
  return upsertTemplateMasterCandidateFromItem(item);
}

function addTemplateMasterPrint(print) {
  if (!print) return null;
  const active = activeTemplateMasterCandidate();
  if (active) {
    Object.assign(active, templateMasterPrintFields(print));
    clearTemplateMasterGeneratedImage(active);
    active.selected = true;
    persistTemplateMasterCandidates();
    toast(`已更新印花：${active.printName || ''}`);
    return active;
  }
  const incomplete = lastIncompleteTemplateMasterCandidate();
  if (incomplete && !incomplete.printPath) {
    Object.assign(incomplete, templateMasterPrintFields(print), {
    });
    clearTemplateMasterGeneratedImage(incomplete);
    incomplete.selected = true;
    persistTemplateMasterCandidates();
    toast(incomplete.masterReferencePath
      ? `已补齐印花：${incomplete.masterReferenceName} + ${incomplete.printName}`
      : `已加入印花：${incomplete.printName}，等待选择母版底图`);
    return incomplete;
  }
  const candidate = createEmptyTemplateMasterCandidate(templateMasterPrintFields(print));
  candidate.selected = true;
  state.templateMasterCandidates.push(candidate);
  persistTemplateMasterCandidates();
  toast(`已创建母版任务：${candidate.printName}，等待选择母版底图`);
  return candidate;
}

function removeTemplateMasterCandidate(id) {
  const index = state.templateMasterCandidates.findIndex(candidate => candidate.id === id);
  if (index < 0) return;
  const [candidate] = state.templateMasterCandidates.splice(index, 1);
  if (state.activeTemplateMasterCandidateId === id) state.activeTemplateMasterCandidateId = '';
  persistTemplateMasterCandidates();
  renderTemplateWorkflow();
  toast(`已移除母版底图：${candidate.masterReferenceName || ''}`);
}

function selectedTemplateMasterCandidates() {
  return state.templateMasterCandidates.filter(candidate => candidate.selected);
}

function selectAllTemplateMasterCandidates(selected = true) {
  state.templateMasterCandidates.forEach(candidate => { candidate.selected = selected; });
  persistTemplateMasterCandidates();
  renderTemplateWorkflow();
}

function removeSelectedTemplateMasterCandidates() {
  const selected = selectedTemplateMasterCandidates();
  if (!selected.length) return toast('请先勾选要删除的母版任务', true);
  const selectedIds = new Set(selected.map(candidate => candidate.id));
  state.templateMasterCandidates = state.templateMasterCandidates.filter(candidate => !selectedIds.has(candidate.id));
  if (selectedIds.has(state.activeTemplateMasterCandidateId)) state.activeTemplateMasterCandidateId = '';
  persistTemplateMasterCandidates();
  renderTemplateWorkflow();
  toast(`已删除 ${selected.length} 个母版任务`);
}

function templateMasterCandidateHasImage(candidate) {
  return Boolean(candidate?.masterImagePath) && !['生成中', '重新生成'].includes(candidate?.masterStatus);
}

function syncTemplateMasterCandidateToQueuedTasks(candidate) {
  if (!candidate?.id) return;
  for (const task of state.queue) {
    if (task.masterCandidateId !== candidate.id) continue;
    if (!['未开始', '失败'].includes(task.status)) continue;
    Object.assign(task, {
      masterReferencePath: candidate.masterReferencePath || '',
      masterReferenceName: candidate.masterReferenceName || '',
      masterReferenceThumbnailUrl: candidate.masterReferenceThumbnailUrl || '',
      masterReferencePreviewUrl: candidate.masterReferencePreviewUrl || '',
      masterReferenceRelativePath: candidate.masterReferenceRelativePath || '',
      masterImagePath: candidate.masterImagePath || '',
      masterImageUrl: candidate.masterImageUrl || '',
      masterImagePreviewUrl: candidate.masterImagePreviewUrl || '',
      masterStatus: candidate.masterStatus || '已生成',
      masterError: '',
      masterProgress: null
    });
  }
  persistQueue();
}

function resetTaskMaster(task, reference = null) {
  if (reference) Object.assign(task, reference);
  task.masterImagePath = '';
  task.masterImageUrl = '';
  task.masterImagePreviewUrl = '';
  task.masterStatus = '未生成';
  task.masterError = '';
  task.masterProgress = null;
}

function templateTaskHasMaster(task) {
  return task?.generationMode !== 'template_print'
    || (Boolean(task.masterImagePath) && !['生成中', '重新生成'].includes(task.masterStatus));
}

function relatedTemplatePrintTasks(sourceTask) {
  if (!sourceTask) return [];
  return state.queue.filter(task => task.generationMode === 'template_print'
    && task.printPath === sourceTask.printPath
    && task.templateFolderPath === sourceTask.templateFolderPath
    && (!sourceTask.batchId || task.batchId === sourceTask.batchId));
}

function syncTaskMasterToRelatedTasks(sourceTask) {
  for (const task of relatedTemplatePrintTasks(sourceTask)) {
    Object.assign(task, {
      masterReferencePath: sourceTask.masterReferencePath || '',
      masterReferenceName: sourceTask.masterReferenceName || '',
      masterReferenceThumbnailUrl: sourceTask.masterReferenceThumbnailUrl || '',
      masterReferencePreviewUrl: sourceTask.masterReferencePreviewUrl || '',
      masterImagePath: sourceTask.masterImagePath || '',
      masterImageUrl: sourceTask.masterImageUrl || '',
      masterImagePreviewUrl: sourceTask.masterImagePreviewUrl || '',
      masterStatus: sourceTask.masterStatus || '未生成',
      masterError: sourceTask.masterError || '',
      masterProgress: sourceTask.masterProgress || null
    });
  }
}

function applyMasterReferenceToQueuedTasks(reference) {
  return reference;
}

function expandTemplateTaskGroupToFullSet(task) {
  if (!task || task.generationMode !== 'template_print') return 0;
  const folderItems = state.taskTemplateItems.filter(item => item.action === 'replace_print' && templateFolderPathForItem(item) === task.templateFolderPath);
  if (!folderItems.length) return 0;
  const existing = new Set(state.queue
    .filter(item => item.generationMode === 'template_print' && item.templateFolderPath === task.templateFolderPath && item.printPath === task.printPath)
    .map(item => item.templateRelativePath));
  const missing = folderItems.filter(item => !existing.has(item.relativePath));
  if (!missing.length) return 0;
  let taskNumber = state.queue.reduce((maximum, item) => Math.max(maximum, Number(item.taskNumber) || 0), 0) + 1;
  const reference = task.masterReferencePath ? {
    masterReferencePath: task.masterReferencePath,
    masterReferenceName: task.masterReferenceName,
    masterReferenceThumbnailUrl: task.masterReferenceThumbnailUrl,
    masterReferencePreviewUrl: task.masterReferencePreviewUrl,
    masterReferenceRelativePath: task.masterReferenceRelativePath || ''
  } : {};
  const batchId = task.batchId || createClientId();
  task.batchId = batchId;
  state.queue.push(...missing.map(item => ({
    printPath: task.printPath,
    printName: task.printName,
    printThumbnailUrl: task.printThumbnailUrl || '',
    printPreviewUrl: task.printPreviewUrl || '',
    generationMode: 'template_print',
    note: task.note || '',
    selected: task.selected,
    status: '未开始',
    error: '',
    ...reference,
    masterImagePath: task.masterImagePath || '',
    masterImageUrl: task.masterImageUrl || '',
    masterImagePreviewUrl: task.masterImagePreviewUrl || '',
    masterStatus: task.masterStatus || '未生成',
    masterError: task.masterError || '',
    masterProgress: task.masterProgress || null,
    id: createClientId(),
    batchId,
    taskNumber: taskNumber++,
    productPath: '',
    productName: item.name,
    productThumbnailUrl: item.thumbnailUrl || item.url || '',
    productPreviewUrl: item.previewUrl || item.url || '',
    templateFolderPath: task.templateFolderPath,
    templateRelativePath: item.relativePath,
    templatePreviewName: item.name,
    templateThumbnailUrl: item.thumbnailUrl || item.url || '',
    templatePreviewUrl: item.previewUrl || item.url || ''
  })));
  return missing.length;
}

function annotateTemplateItems(items, folder) {
  return (items || []).map(item => ({
    ...item,
    templateFolderPath: folder.path,
    templateFolderName: folder.name
  }));
}

function sortByName(items, direction = 'name-asc', selector = item => item.name) {
  const multiplier = direction === 'name-desc' ? -1 : 1;
  return [...(items || [])].sort((left, right) =>
    multiplier * String(selector(left) || '').localeCompare(String(selector(right) || ''), 'zh-CN', { numeric: true })
  );
}

async function listTemplateItemsForCurrentView() {
  const view = currentTemplateFolderView();
  if (!state.templateFolders.length) return [];
  const folders = view === 'all'
    ? state.templateFolders
    : state.templateFolders.filter(folder => folder.path === view);
  if (!folders.length) return [];
  const results = await Promise.all(folders.map(async folder => annotateTemplateItems(await window.caishen.listTemplates(folder.path), folder)));
  return sortByName(results.flat(), 'name-asc', item => `${item.templateFolderName || ''}/${item.relativePath || item.name || ''}`);
}

async function listTaskTemplateItemsForCurrentView() {
  const view = currentTaskTemplateFolderView();
  if (!state.templateFolders.length) return [];
  const folders = view === 'all'
    ? state.templateFolders
    : state.templateFolders.filter(folder => folder.path === view);
  if (!folders.length) return [];
  const results = await Promise.all(folders.map(async folder => annotateTemplateItems(await window.caishen.listTemplates(folder.path), folder)));
  return sortByName(results.flat(), state.taskTemplateSort, item => `${item.templateFolderName || ''}/${item.relativePath || item.name || ''}`);
}

async function listTaskTemplateItemsForFolder(folderPath) {
  const folder = state.templateFolders.find(item => item.path === folderPath) || { path: folderPath, name: templateFolderName(folderPath) };
  return annotateTemplateItems(await window.caishen.listTemplates(folder.path), folder);
}

async function refreshTemplateMasterReference(candidate) {
  if (!candidate?.templateFolderPath) return candidate;
  const currentItems = state.taskTemplateItems.some(item => templateFolderPathForItem(item) === candidate.templateFolderPath)
    ? state.taskTemplateItems
    : await listTaskTemplateItemsForFolder(candidate.templateFolderPath);
  const match = currentItems.find(item =>
    templateFolderPathForItem(item) === candidate.templateFolderPath
    && candidate.masterReferenceRelativePath
    && item.relativePath === candidate.masterReferenceRelativePath
  ) || currentItems.find(item =>
    templateFolderPathForItem(item) === candidate.templateFolderPath
    && candidate.masterReferenceName
    && item.name === candidate.masterReferenceName
  );
  if (!match) return candidate;
  Object.assign(candidate, masterReferenceFromItem(match), {
    templateFolderPath: templateFolderPathForItem(match)
  });
  persistTemplateMasterCandidates();
  return candidate;
}

function taskTemplateRootKey(folderPath) {
  return `root:${folderPath}`;
}

function taskTemplateGroupName(item) {
  const normalized = String(item.relativePath || '').replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '根目录';
}

function taskTemplateGroupKey(folderPath, groupName) {
  return `group:${folderPath}:${groupName}`;
}

function taskTemplateTreeData(items = state.taskTemplateItems) {
  const roots = new Map();
  for (const item of items.filter(entry => entry.action === 'replace_print')) {
    const folderPath = templateFolderPathForItem(item);
    if (!roots.has(folderPath)) roots.set(folderPath, {
      path: folderPath,
      name: item.templateFolderName || templateFolderName(folderPath),
      items: [],
      groups: new Map()
    });
    const root = roots.get(folderPath);
    const groupName = taskTemplateGroupName(item);
    root.items.push(item);
    if (!root.groups.has(groupName)) root.groups.set(groupName, []);
    root.groups.get(groupName).push(item);
  }
  return [...roots.values()];
}

function syncTaskTemplateSelection({ reset = false } = {}) {
  const eligible = state.taskTemplateItems.filter(item => item.action === 'replace_print');
  const validPaths = new Set(eligible.map(item => item.path));
  const scope = currentTaskTemplateFolderView();
  if (reset || state.taskTemplateSelectionScope !== scope) {
    state.selectedTaskTemplatePaths = new Set(validPaths);
    state.taskTemplateSelectionScope = scope;
    state.taskTemplateExpandedGroups = new Set(taskTemplateTreeData(eligible).map(root => taskTemplateRootKey(root.path)));
    return;
  }
  state.selectedTaskTemplatePaths = new Set([...state.selectedTaskTemplatePaths].filter(path => validPaths.has(path)));
}

function taskTemplateSelectionMark(items) {
  const selected = items.filter(item => state.selectedTaskTemplatePaths.has(item.path)).length;
  return selected === items.length ? '✓' : selected ? '—' : '';
}

function renderTaskTemplateTree(items, taskViewAll) {
  const sortedItems = sortByName(items, state.taskTemplateSort, item => `${taskViewAll ? item.templateFolderName || '' : ''}/${item.relativePath || item.name || ''}`);
  return `<div class="task-template-flat-grid" role="list">${sortedItems.map(item => {
    const sameReferenceCount = state.templateMasterCandidates.filter(candidate => candidate.masterReferencePath === item.path).length;
    const group = taskViewAll ? item.templateFolderName || templateFolderName(templateFolderPathForItem(item)) : taskTemplateGroupName(item);
    return `<button class="task-template-image" type="button" data-task-template-image="${escapeHtml(item.path)}" title="${escapeHtml(item.relativePath)}" role="listitem">
      <span class="task-template-image-check">${sameReferenceCount ? sameReferenceCount : ''}</span>
      <img loading="lazy" decoding="async" src="${escapeHtml(item.thumbnailUrl || item.url)}" data-preview-src="${escapeHtml(item.previewUrl || item.url)}" alt="${escapeHtml(item.name)}">
      <span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(group)} · ${escapeHtml(item.relativePath)}</small></span>
    </button>`;
  }).join('')}</div>`;
}

function renderTemplateFolders() {
  const browser = $('#templateFolderBrowser');
  if (!browser) return;
  const activePath = state.config?.detailSetsPath || '';
  const view = currentTemplateFolderView();
  const allCount = state.templateFolders.reduce((total, folder) => total + Number(folder.count || 0), 0);
  $('#settingDetailSetsPath').textContent = state.templateFolders.length
    ? `已导入 ${state.templateFolders.length} 个文件夹${activePath ? ` · 当前：${state.templateFolders.find(item => item.path === activePath)?.name || '未选择'}` : ''}`
    : '尚未导入套图文件夹';
  $('#settingDetailSetsPath').title = activePath;
  const folders = sortByName(state.templateFolders, state.taskTemplateSort, folder => folder.name);
  browser.innerHTML = folders.length ? [`<div class="template-folder-card template-folder-all${view === 'all' ? ' active' : ''}" title="显示所有已导入文件夹的图片"><button class="template-folder-select" type="button" data-template-folder-view="all" aria-pressed="${view === 'all'}"><span class="template-all-icon" aria-hidden="true"></span><span><b>全部文件夹</b><small>${allCount} 张图片 · ${state.templateFolders.length} 个文件夹</small></span></button></div>`, ...folders.map(folder => {
    const active = view === folder.path;
    const current = folder.path === activePath;
    const preview = folder.preview?.thumbnailUrl
      ? `<img loading="lazy" decoding="async" src="${escapeHtml(folder.preview.thumbnailUrl)}" data-preview-src="${escapeHtml(folder.preview.previewUrl || folder.preview.url)}" alt="${escapeHtml(folder.name)}">`
      : '<span class="template-folder-icon" aria-hidden="true"></span>';
    return `<div class="template-folder-card${active ? ' active' : ''}${current ? ' current' : ''}" title="${escapeHtml(folder.path)}"><button class="template-folder-select" type="button" data-template-folder="${escapeHtml(folder.path)}" aria-pressed="${active}">${preview}<span><b>${escapeHtml(folder.name)}</b><small>${folder.count} 张图片${current ? ' · 当前使用' : ''}</small></span></button><button class="template-folder-delete" type="button" data-delete-template-folder="${escapeHtml(folder.path)}" aria-label="删除套图文件夹 ${escapeHtml(folder.name)}" title="删除此文件夹">删除</button></div>`;
  })].join('') : '<div class="template-folder-empty"><b>还没有套图文件夹</b><span>点击“导入新文件夹”，后续可以继续追加其他文件夹。</span></div>';
}

async function loadTemplateFolders() {
  try {
    state.templateFolders = await window.caishen.listTemplateFolders();
    const validPaths = new Set(state.templateFolders.map(folder => folder.path));
    if (!state.templateFolders.length) {
      state.templateFolderView = '';
      state.taskTemplateFolderView = '';
      state.templateItems = [];
      state.taskTemplateItems = [];
      state.templatePreparation = null;
      state.selectedTaskTemplatePaths.clear();
      state.taskTemplateExpandedGroups.clear();
      state.templateMasterCandidates = [];
      state.activeTemplateMasterCandidateId = '';
      state.assetPreviewCache.delete('detailSetsPath');
      persistTemplateMasterCandidates();
      renderTemplateWorkflow();
    }
    if (!state.templateFolderView) state.templateFolderView = validPaths.has(state.config?.detailSetsPath) ? state.config.detailSetsPath : 'all';
    else if (state.templateFolderView !== 'all' && !validPaths.has(state.templateFolderView)) {
      state.templateFolderView = validPaths.has(state.config?.detailSetsPath) ? state.config.detailSetsPath : 'all';
    }
    if (!state.taskTemplateFolderView) state.taskTemplateFolderView = validPaths.has(state.config?.detailSetsPath) ? state.config.detailSetsPath : 'all';
    else if (state.taskTemplateFolderView !== 'all' && !validPaths.has(state.taskTemplateFolderView)) {
      state.taskTemplateFolderView = validPaths.has(state.config?.detailSetsPath) ? state.config.detailSetsPath : 'all';
    }
    renderTemplateFolders();
    return state.templateFolders;
  } catch (error) {
    state.templateFolders = [];
    $('#templateFolderBrowser').innerHTML = `<div class="template-folder-empty">${escapeHtml(errorText(error))}</div>`;
    return [];
  }
}

async function selectTemplateFolder(folderPath) {
  if (!folderPath) return;
  state.templateFolderView = folderPath;
  state.taskTemplateFolderView = folderPath;
  state.assetTemplateFilter = 'all';
  state.selectedAssetPaths.clear();
  if (folderPath === state.config?.detailSetsPath) {
    renderTemplateFolders();
    await loadAssetLibraryPreview('detailSetsPath', { force: true });
    return toast(`正在查看套图：${state.templateFolders.find(item => item.path === folderPath)?.name || '当前文件夹'}`);
  }
  state.config.detailSetsPath = folderPath;
  state.templatePreparation = null;
  state.templateItems = [];
  state.config = await window.caishen.saveConfig(state.config);
  renderConfig();
  renderTemplateFolders();
  await Promise.all([
    loadTemplatePreparation(),
    loadAssetLibraryPreview('detailSetsPath', { force: true })
  ]);
  toast(`已切换套图：${state.templateFolders.find(item => item.path === folderPath)?.name || '当前文件夹'}`);
}

async function showAllTemplateFolders() {
  state.templateFolderView = 'all';
  state.assetTemplateFilter = 'all';
  state.selectedAssetPaths.clear();
  renderTemplateFolders();
  await loadAssetLibraryPreview('detailSetsPath', { force: true });
  toast(`正在显示全部 ${state.templateFolders.length} 个套图文件夹`);
}

function renderTaskTemplateFolderList() {
  const container = $('#taskTemplateFolderList');
  const activePath = state.config?.detailSetsPath || '';
  const view = currentTaskTemplateFolderView();
  const allCount = state.templateFolders.reduce((total, folder) => total + Number(folder.count || 0), 0);
  const folders = sortByName(state.templateFolders, state.taskTemplateSort, folder => folder.name);
  container.innerHTML = folders.length ? [`<button class="task-template-folder-option task-template-folder-all${view === 'all' ? ' active' : ''}" type="button" data-task-template-folder="all" aria-pressed="${view === 'all'}"><span class="template-all-icon" aria-hidden="true"></span><span><b>全部文件夹</b><small>${state.templateFolders.length} 个文件夹 · 共 ${allCount} 张图片</small></span><strong>${view === 'all' ? '当前查看' : '查看'}</strong></button>`, ...folders.map(folder => {
    const active = view === folder.path;
    const current = folder.path === activePath;
    const preview = folder.preview?.thumbnailUrl
      ? `<img loading="lazy" decoding="async" src="${escapeHtml(folder.preview.thumbnailUrl)}" data-preview-src="${escapeHtml(folder.preview.previewUrl || folder.preview.url)}" alt="${escapeHtml(folder.name)}">`
      : '<span class="template-folder-icon" aria-hidden="true"></span>';
    return `<button class="task-template-folder-option${active ? ' active' : ''}${current ? ' current' : ''}" type="button" data-task-template-folder="${escapeHtml(folder.path)}" aria-pressed="${active}">${preview}<span><b>${escapeHtml(folder.name)}</b><small>${folder.count} 张图片${current ? ' · 任务使用中' : ''}</small></span><strong>${active ? '当前查看' : current ? '任务使用' : '选择'}</strong></button>`;
  })].join('') : '<div class="empty-state"><b>还没有套图文件夹</b><span>请先到素材资产页面导入套图模板。</span></div>';
}

async function openTaskTemplateFolderModal() {
  $('#taskTemplateFolderModal').hidden = false;
  $('#taskTemplateFolderList').innerHTML = '<div class="empty-inline">正在读取套图文件夹…</div>';
  await loadTemplateFolders();
  renderTaskTemplateFolderList();
}

function closeTaskTemplateFolderModal() {
  $('#taskTemplateFolderModal').hidden = true;
}

async function chooseTaskTemplateFolder(folderPath) {
  if (!folderPath) return;
  closeTaskTemplateFolderModal();
  state.activeTemplateMasterCandidateId = '';
  if (folderPath === 'all') {
    state.taskTemplateFolderView = 'all';
    state.taskTemplateItems = await listTaskTemplateItemsForCurrentView();
    syncTaskTemplateSelection({ reset: true });
    renderTemplateWorkflow();
    return toast(`正在查看全部 ${state.templateFolders.length} 个套图文件夹`);
  }
  state.taskTemplateFolderView = folderPath;
  if (folderPath === state.config.detailSetsPath) {
    await loadTemplatePreparation();
    return toast('已刷新当前套图文件夹');
  }
  await selectTemplateFolder(folderPath);
}

async function deleteTemplateFolder(folderPath) {
  const folder = state.templateFolders.find(item => item.path === folderPath);
  if (!folder) return toast('套图文件夹不存在或已被删除', true);
  const runningTasks = state.queue.filter(task => task.templateFolderPath === folderPath && task.status === '生成中').length;
  if (runningTasks) return toast('该套图正在生成任务，完成后才能删除', true);
  const pendingTasks = state.queue.filter(task => task.templateFolderPath === folderPath).length;
  const analyzing = [...state.assetAnalysisProgress.keys()].some(file => file === folderPath || file.startsWith(`${folderPath}/`));
  if (analyzing) return toast('该套图正在进行 AI 分析，完成后才能删除', true);
  const taskNotice = pendingTasks ? `\n同时会移除使用该套图的 ${pendingTasks} 个待生成任务。` : '';
  if (!window.confirm(`确定删除套图文件夹“${folder.name}”及其中 ${folder.count} 张图片吗？${taskNotice}\n此操作不可撤销。`)) return;
  try {
    await window.caishen.deleteTemplateFolder(folderPath);
    state.queue = state.queue.filter(task => task.templateFolderPath !== folderPath);
    state.templateMasterCandidates = state.templateMasterCandidates.filter(candidate => candidate.templateFolderPath !== folderPath);
    persistTemplateMasterCandidates();
    state.assetPreviewCache.delete('detailSetsPath');
    state.selectedAssetPaths.clear();
    state.templatePreparation = null;
    state.templateItems = [];
    state.assetTemplateFilter = 'all';
    await loadTemplateFolders();
    if (state.config.detailSetsPath === folderPath) {
      state.config.detailSetsPath = state.templateFolders[0]?.path || '';
      state.config = await window.caishen.saveConfig(state.config);
      renderConfig();
      if (state.config.detailSetsPath) await loadTemplatePreparation();
    }
    if (state.assetPreviewKey === 'detailSetsPath') await loadAssetLibraryPreview('detailSetsPath', { force: true });
    renderTemplateFolders();
    renderQueue();
    toast(`已删除套图文件夹“${folder.name}”${pendingTasks ? `，并移除 ${pendingTasks} 个待生成任务` : ''}`);
  } catch (error) {
    toast(errorText(error), true);
    await loadTemplateFolders();
  }
}

function renderTemplateWorkflow() {
  if (!state.config) return;
  const hasTemplateFolders = state.templateFolders.length > 0;
  const folderReady = Boolean(state.config.detailSetsPath && hasTemplateFolders);
  const plan = state.templatePreparation;
  const analysisReady = Boolean(plan?.generationReady);
  const selectedTasks = state.queue.filter(task => task.selected);
  const runnableTasks = selectedTasks.length ? selectedTasks : state.queue;
  const allCompleted = runnableTasks.length > 0 && runnableTasks.every(task => task.status === '已完成');
  const runningTasks = runnableTasks.filter(task => ['排队中', '生成中'].includes(task.status));
  const individuallySelectedTemplates = runnableTasks.length > 0 && runnableTasks.every(task => task.generationMode === 'template_print' && task.templateRelativePath);

  const templatePreview = $('#taskTemplatePreview');
  const taskView = currentTaskTemplateFolderView();
  const taskViewAll = taskView === 'all';
  const activeFolderName = templateFolderName(state.config.detailSetsPath);
  const replaceItems = state.taskTemplateItems.filter(item => item.action === 'replace_print');
  $('#taskTemplateScopeLabel').textContent = hasTemplateFolders ? (taskViewAll ? '浏览范围' : '当前文件夹') : '当前文件夹';
  $('#taskTemplatePath').textContent = hasTemplateFolders ? (taskViewAll ? '全部文件夹' : templateFolderName(taskView)) : '尚未导入套图文件夹';
  $('#taskTemplatePath').title = hasTemplateFolders ? (taskViewAll ? state.templateFolders.map(folder => folder.name).join('、') : taskView) : '';
  $('#taskTemplateFolderHint').textContent = !hasTemplateFolders
    ? '请先到素材资产导入套图文件夹'
    : taskViewAll
      ? `当前显示 ${replaceItems.length} 张 · 默认整套任务文件夹：${activeFolderName}`
      : `当前显示 ${replaceItems.length} 张，可点击任意图片创建母版卡`;
  const candidateSignature = state.templateMasterCandidates.map(candidate => `${candidate.id}:${candidate.masterReferencePath}:${candidate.printPath}:${candidate.masterImagePath}:${candidate.masterStatus}:${candidate.selected ? 1 : 0}:${state.activeTemplateMasterCandidateId === candidate.id ? 1 : 0}`).join('|');
  const previewSignature = `${taskView}|${state.config.detailSetsPath || ''}|masters:${candidateSignature}|${replaceItems.map(item => `${item.path}:${item.thumbnailUrl || item.url}:${state.selectedTaskTemplatePaths.has(item.path)}`).join('|')}|${[...state.taskTemplateExpandedGroups].sort().join('|')}`;
  if (templatePreview.dataset.previewSignature !== previewSignature) {
    templatePreview.dataset.previewSignature = previewSignature;
    templatePreview.innerHTML = replaceItems.length
      ? renderTaskTemplateTree(replaceItems, taskViewAll)
      : `<div class="empty-state"><b>${folderReady ? '没有“换印花”图片' : '选择一个套图文件夹'}</b><span>${folderReady ? '请到素材资产中运行 AI 分析或调整图片动作。' : '点击右上角“更换文件夹”进行选择。'}</span></div>`;
  }

  $('#generateAllButton').textContent = runningTasks.length ? '正在生成…' : allCompleted ? '查看筛图结果' : '开始生成';
  $('#generateAllButton').disabled = state.templatePreparing || Boolean(runningTasks.length) || !runnableTasks.length || (!allCompleted && !analysisReady && !individuallySelectedTemplates);
  $('#masterCandidateCount').textContent = `${state.templateMasterCandidates.length} 项`;
  renderTemplateMasterWorkflow();
}

function renderTemplateMasterWorkflow() {
  const panel = $('#templateMasterWorkflow');
  if (!panel) return;
  const candidates = state.templateMasterCandidates;
  const cards = candidates.map(candidate => {
    const progress = candidate.masterProgress || {};
    const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
    const running = ['生成中', '重新生成'].includes(candidate.masterStatus);
    const canCreate = templateMasterCandidateHasImage(candidate);
    const complete = Boolean(candidate.masterReferencePath && candidate.printPath);
    const active = state.activeTemplateMasterCandidateId === candidate.id;
    return `<section class="template-master-card${candidate.selected ? ' is-selected' : ''}${active ? ' is-editing' : ''}" data-template-master-candidate="${escapeHtml(candidate.id)}">
      <div class="template-master-card-head">
        <label class="template-master-check"><input type="checkbox" data-template-master-select="${escapeHtml(candidate.id)}"${candidate.selected ? ' checked' : ''}><span aria-hidden="true"></span><b>${escapeHtml(candidate.masterReferenceName || candidate.printName || '母版任务')}</b></label>
        <div class="template-master-head-actions">
          <button class="secondary mini" type="button" data-template-master-edit="${escapeHtml(candidate.id)}">${active ? '编辑中' : '编辑'}</button>
          <button class="link-danger" type="button" data-template-master-remove="${escapeHtml(candidate.id)}"${running ? ' disabled' : ''}>删除</button>
        </div>
      </div>
      <div class="template-master-flow">
        ${queuePreviewFigure(candidate.masterReferenceThumbnailUrl || '', candidate.masterReferencePreviewUrl || '', candidate.masterReferenceName || '等待底图', '母版底图')}
        <span class="queue-preview-plus" aria-hidden="true">+</span>
        ${queuePreviewFigure(candidate.printThumbnailUrl || '', candidate.printPreviewUrl || '', candidate.printName || '等待印花', '印花')}
        <span class="queue-preview-plus" aria-hidden="true">→</span>
        ${queuePreviewFigure(candidate.masterImageUrl || candidate.masterImagePreviewUrl || '', candidate.masterImagePreviewUrl || candidate.masterImageUrl || '', candidate.masterImagePath ? '已生成母版' : '未生成母版', '母版图')}
      </div>
      <div class="template-master-copy">
        <span>底图：${escapeHtml(candidate.masterReferenceRelativePath || candidate.masterReferenceName || '待选择')}</span>
        <span>印花：${escapeHtml(candidate.printName || '待选择')}</span>
        <span>整套文件夹：${escapeHtml(templateFolderName(candidate.templateFolderPath || currentTaskTemplateFolderView()))} · ${state.taskTemplateItems.filter(item => item.action === 'replace_print' && templateFolderPathForItem(item) === (candidate.templateFolderPath || currentTaskTemplateFolderView())).length || state.taskTemplateItems.filter(item => item.action === 'replace_print').length} 张</span>
        ${running ? `<div class="queue-progress"><div><span>${escapeHtml(progress.message || '正在生成母版图…')}</span><b>${percent}%</b></div><progress max="100" value="${percent}"></progress></div>` : candidate.masterError ? `<span class="status error">${escapeHtml(candidate.masterError)}</span>` : ''}
        <button class="secondary" type="button" data-template-master-generate="${escapeHtml(candidate.id)}"${running || !complete ? ' disabled' : ''}>${candidate.masterImagePath ? '重新生成母版' : '生成母版'}</button>
        <button class="primary" type="button" data-template-master-create="${escapeHtml(candidate.id)}"${canCreate ? '' : ' disabled'}>开始生成整套</button>
      </div>
    </section>`;
  }).join('');
  panel.innerHTML = cards || '<div class="template-master-empty"><b>还没有母版任务</b><span>点击左侧底图或中间印花即可创建任务卡；顺序不限。</span></div>';
  const generateButton = $('#generateAllMastersButton');
  if (generateButton) {
    const selected = selectedTemplateMasterCandidates();
    const runnable = selected.filter(candidate => candidate.masterReferencePath && candidate.printPath && !['生成中', '重新生成'].includes(candidate.masterStatus));
    generateButton.disabled = !runnable.length;
    generateButton.textContent = runnable.length ? `生成选中母版（${runnable.length}）` : '生成选中母版';
  }
  const createAllButton = $('#createTasksFromAllMastersButton');
  if (createAllButton) {
    const selected = selectedTemplateMasterCandidates();
    const ready = selected.filter(templateMasterCandidateHasImage).length;
    createAllButton.disabled = !ready;
    createAllButton.textContent = ready ? `开始选中整套（${ready}）` : '开始选中整套';
  }
}

async function loadTemplatePreparation({ autoPrepare = false } = {}) {
  const folder = state.config?.detailSetsPath || '';
  if (!folder) {
    state.templatePreparation = null;
    state.taskTemplateItems = [];
    state.selectedTaskTemplatePaths.clear();
    state.taskTemplateSelectionScope = '';
    renderTemplateWorkflow();
    return null;
  }
  try {
    const [preparation, items] = await Promise.all([
      window.caishen.getTemplatePreparation(folder),
      listTaskTemplateItemsForCurrentView()
    ]);
    state.templatePreparation = preparation;
    state.taskTemplateItems = items;
    syncTaskTemplateSelection();
    renderTemplateWorkflow();
    if (autoPrepare && state.templatePreparation.pending > 0) return prepareCurrentTemplateFolder();
    return state.templatePreparation;
  } catch (error) {
    state.templatePreparation = null;
    state.taskTemplateItems = [];
    renderTemplateWorkflow();
    toast(errorText(error), true);
    return null;
  }
}

async function prepareCurrentTemplateFolder() {
  const folder = state.config?.detailSetsPath || '';
  if (!folder || state.templatePreparing) return null;
  state.templatePreparing = true;
  renderTemplateWorkflow();
  try {
    state.templatePreparation = await window.caishen.prepareTemplates(folder);
    state.taskTemplateItems = await listTaskTemplateItemsForCurrentView();
    syncTaskTemplateSelection();
    const failed = Number(state.templatePreparation.failed || 0);
    toast(failed ? `识别完成，${failed} 张失败，请查看配置` : `套图识别完成：${state.templatePreparation.total} 张`, failed > 0);
    return state.templatePreparation;
  } catch (error) {
    toast(errorText(error), true);
    return null;
  } finally {
    state.templatePreparing = false;
    renderTemplateWorkflow();
  }
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function assetStageStatusElement(key) {
  const selector = key === 'printsPath' ? '#assetStagePrintsPath' : '#assetStageDetailSetsPath';
  return $(selector);
}

async function stageAssetFolder(key) {
  try {
    const stage = await window.caishen.stageAssetFolder(key);
    if (!stage) return;
    state.assetStages[key] = stage;
    assetStageStatusElement(key).textContent = key === 'detailSetsPath'
      ? `正在导入新文件夹“${stage.rootName}”：${stage.count} 张图片，共 ${formatBytes(stage.totalBytes)}。`
      : `正在扫描“${stage.rootName}”：${stage.count} 张图片，共 ${formatBytes(stage.totalBytes)}。`;
    $(`[data-sync-asset="${key}"]`).disabled = false;
    toast(`已读取 ${stage.count} 张图片，正在${key === 'detailSetsPath' ? '导入' : '扫描'}`);
    await syncAssetFolder(key);
  } catch (error) { toast(errorText(error), true); }
}

function updateAssetScanProgress(progress = {}) {
  const panel = $('#assetScanProgress');
  if (progress.phase === 'done') {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $('#assetScanProgressTitle').textContent = progress.phase === 'done' ? '扫描完成' : '正在扫描素材';
  $('#assetScanProgressText').textContent = progress.message || '';
  const total = Math.max(0, Number(progress.total) || 0);
  const current = Math.max(0, Number(progress.current) || 0);
  $('#assetScanProgressBar').value = total ? Math.min(100, Math.round(current / total * 100)) : progress.phase === 'compare' ? 8 : 100;
}

async function syncAssetFolder(key) {
  const button = $(`[data-sync-asset="${key}"]`);
  if (!state.assetStages[key]) return toast('请先选择需要扫描的文件夹', true);
  button.disabled = true;
  button.textContent = key === 'detailSetsPath' ? '导入中…' : '扫描中…';
  try {
    const result = await window.caishen.syncAssetFolder(key, key === 'detailSetsPath' ? '' : state.config[key], updateAssetScanProgress);
    state.config[key] = result.root;
    if (key === 'detailSetsPath') {
      state.templatePreparation = null;
      state.templateFolderView = result.root;
      state.taskTemplateFolderView = result.root;
    }
    state.config = await window.caishen.saveConfig(state.config);
    renderConfig();
    assetStageStatusElement(key).textContent = `扫描完成：共 ${result.count} 张，新增或更新 ${result.uploaded} 张，跳过 ${result.skipped} 张。`;
    if (key === 'categoriesPath') state.productFolder = '';
    if (key === 'printsPath') state.printFolder = '';
    if (key === 'categoriesPath' || key === 'printsPath') await loadAssets(key);
    if (key === 'detailSetsPath') {
      await loadTemplateFolders();
      await loadTemplatePreparation();
    }
    state.assetPreviewKey = key;
    await loadAssetLibraryPreview(key, { force: true });
    if (key === 'detailSetsPath') delete state.assetStages[key];
    toast(key === 'detailSetsPath' ? `已导入套图文件夹“${result.name}”：${result.count} 张` : `素材扫描完成：新增或更新 ${result.uploaded} 张`);
  } catch (error) {
    $('#assetScanProgressTitle').textContent = '扫描失败';
    $('#assetScanProgressText').textContent = errorText(error);
    toast(errorText(error), true);
  } finally {
    button.disabled = !state.assetStages[key];
    button.textContent = key === 'detailSetsPath' ? '开始导入' : '开始扫描';
  }
}

function renderAssetSelectionState() {
  const count = state.selectedAssetPaths.size;
  const viewingAllTemplates = state.assetPreviewKey === 'detailSetsPath' && currentTemplateFolderView() === 'all';
  const visiblePaths = visibleAssetPreviewItems().map(item => item.path);
  const allVisibleSelected = visiblePaths.length > 0 && visiblePaths.every(path => state.selectedAssetPaths.has(path));
  $('#assetSelectedCount').textContent = count ? `已选择 ${count} 张` : '支持拖拽添加 · 未选择';
  $('#selectAllAssetsButton').textContent = allVisibleSelected ? '取消全选' : '全选';
  $('#selectAllAssetsButton').disabled = visiblePaths.length === 0 || state.assetUploading;
  const canBatchAnalyze = state.assetPreviewKey === 'detailSetsPath' && count > 1;
  $('#batchAnalyzeAssetsButton').hidden = !canBatchAnalyze;
  $('#batchAnalyzeAssetsButton').disabled = !canBatchAnalyze || state.assetAnalysisRunning;
  $('#batchAnalyzeAssetsButton').textContent = state.assetAnalysisRunning ? '批量分析中…' : `批量 AI 分析${count ? `（${count}）` : ''}`;
  $('#deleteSelectedAssetsButton').disabled = count === 0 || state.assetUploading || state.assetAnalysisRunning;
  $('#addAssetFilesButton').disabled = state.assetUploading || viewingAllTemplates;
  $('#addAssetFilesButton').title = viewingAllTemplates ? '请先选择一个具体套图文件夹，再添加图片' : '';
}

function toggleAllVisibleAssets() {
  if (state.assetUploading) return;
  const visiblePaths = visibleAssetPreviewItems().map(item => item.path);
  if (!visiblePaths.length) return;
  const allSelected = visiblePaths.every(path => state.selectedAssetPaths.has(path));
  for (const path of visiblePaths) {
    if (allSelected) state.selectedAssetPaths.delete(path);
    else state.selectedAssetPaths.add(path);
  }
  renderAssetManagementGrid();
}

const ASSET_TEMPLATE_FILTERS = [
  ['all', '全部'],
  ['replace_print', '换印花'],
  ['copy_original', '保留原图'],
  ['exclude', '不输出'],
  ['manual_check', '人工确认'],
  ['needs_analysis', '未完成分析']
];

function normalizeTemplateUiAction(action) {
  if (action === 'copy_template') return 'copy_original';
  if (action === 'skip_copy') return 'exclude';
  return action || 'manual_check';
}

function assetItemAnalysisStatus(item) {
  const progress = state.assetAnalysisProgress.get(item.path);
  return progress?.status || item.analysisStatus || (item.analysisPending ? 'idle' : 'success');
}

function assetItemAnalyzed(item) {
  return assetItemAnalysisStatus(item) === 'success' && !item.analysisPending;
}

function filteredAssetPreviewItems() {
  if (state.assetPreviewKey !== 'detailSetsPath' || state.assetTemplateFilter === 'all') return state.assetPreviewItems;
  if (state.assetTemplateFilter === 'needs_analysis') return state.assetPreviewItems.filter(item => !assetItemAnalyzed(item));
  return state.assetPreviewItems.filter(item => assetItemAnalyzed(item) && normalizeTemplateUiAction(item.action) === state.assetTemplateFilter);
}

function visibleAssetPreviewItems() {
  return filteredAssetPreviewItems().slice(0, 160);
}

function renderAssetTemplateFilters() {
  const filter = $('#assetTemplateFilter');
  const template = state.assetPreviewKey === 'detailSetsPath';
  filter.hidden = !template;
  if (!template) return;
  const counts = Object.fromEntries(ASSET_TEMPLATE_FILTERS.map(([value]) => [value, 0]));
  counts.all = state.assetPreviewItems.length;
  for (const item of state.assetPreviewItems) {
    const action = normalizeTemplateUiAction(item.action);
    if (assetItemAnalyzed(item) && counts[action] !== undefined) counts[action] += 1;
    else if (!assetItemAnalyzed(item)) counts.needs_analysis += 1;
  }
  filter.querySelector('div').innerHTML = ASSET_TEMPLATE_FILTERS.map(([value, label]) => `<button class="asset-filter-button${state.assetTemplateFilter === value ? ' active' : ''}${value === 'needs_analysis' && counts[value] ? ' attention' : ''}" type="button" data-asset-template-filter="${value}" aria-pressed="${state.assetTemplateFilter === value}"><span>${label}</span><b>${counts[value]}</b></button>`).join('');
}

function renderAssetManagementGrid() {
  const grid = $('#assetManagementGrid');
  const filtered = filteredAssetPreviewItems();
  const visible = filtered.slice(0, 160);
  const validPaths = new Set(state.assetPreviewItems.map(item => item.path));
  state.selectedAssetPaths = new Set([...state.selectedAssetPaths].filter(path => validPaths.has(path)));
  renderAssetTemplateFilters();
  if (state.assetPreviewKey === 'detailSetsPath' && state.assetTemplateFilter !== 'all') {
    $('#assetPreviewSummary').textContent = `当前显示 ${filtered.length} / ${state.assetPreviewItems.length} 张`;
  }
  grid.innerHTML = visible.length
    ? visible.map(item => {
      const selected = state.selectedAssetPaths.has(item.path);
      const template = state.assetPreviewKey === 'detailSetsPath';
      const progress = state.assetAnalysisProgress.get(item.path);
      const analysisStatus = assetItemAnalysisStatus(item);
      const analyzed = assetItemAnalyzed(item);
      const actionLabel = ({ replace_print: '换印花', copy_original: '保留原图', exclude: '不输出', manual_check: '人工确认' })[normalizeTemplateUiAction(item.action)] || '待确认';
      const statusText = analysisStatus === 'queued' ? '等待 AI 分析'
        : analysisStatus === 'running' ? `AI 分析中${progress?.attempt ? ` · 第 ${progress.attempt} 次` : ''}`
          : analysisStatus === 'failed' ? `分析失败 · 点击 AI 分析重试${item.analysisAttempts ? `（已尝试 ${item.analysisAttempts} 次）` : ''}`
            : analysisStatus === 'success' ? `已分析 · ${actionLabel}` : '尚未分析 · 请先运行 AI 分析';
      const attentionClass = template && !analyzed ? analysisStatus === 'failed' ? ' analysis-failed' : ' needs-analysis' : '';
      const attentionBadge = template && !analyzed && !['queued', 'running'].includes(analysisStatus)
        ? `<span class="asset-analysis-alert ${analysisStatus === 'failed' ? 'failed' : ''}">${analysisStatus === 'failed' ? '分析失败' : '未分析'}</span>` : '';
      return `<article class="asset-management-card${selected ? ' selected' : ''}${template ? ' template-asset-card' : ''}${attentionClass}" data-asset-path="${escapeHtml(item.path)}" title="${escapeHtml(item.path)}">${attentionBadge}
        <button class="asset-card-select" type="button" data-asset-select aria-pressed="${selected}"><span class="asset-select-mark">${selected ? '✓' : ''}</span><img loading="lazy" decoding="async" src="${escapeHtml(item.thumbnailUrl || item.url)}" data-preview-src="${escapeHtml(item.previewUrl || item.url)}" alt="${escapeHtml(item.name)}"><span class="asset-card-caption"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(template && currentTemplateFolderView() === 'all' ? `${item.templateFolderName || '套图'} · ${item.folder}` : item.folder)}</small></span></button>
        ${template ? `<div class="asset-analysis-actions"><button class="secondary" type="button" data-template-ai="${escapeHtml(item.path)}"${progress ? ' disabled' : ''}>${progress ? '分析中…' : 'AI 分析'}</button><button class="secondary" type="button" data-template-result="${escapeHtml(item.path)}">分析结果</button></div><small class="asset-analysis-status ${analysisStatus}" title="${escapeHtml(item.analysisError || '')}">${escapeHtml(statusText)}</small>` : ''}
      </article>`;
    }).join('')
    : state.assetPreviewItems.length && state.assetPreviewKey === 'detailSetsPath'
      ? '<div class="empty-inline asset-empty-drop"><b>当前筛选没有图片</b><span>切换其他动作或选择“全部”。</span></div>'
      : '<div class="empty-inline asset-empty-drop"><b>拖入图片即可添加</b><span>也可以点击右上角“添加文件”。</span></div>';
  renderAssetSelectionState();
}

function resetAssetManagementScroll() {
  const grid = $('#assetManagementGrid');
  if (!grid) return;
  grid.scrollTop = 0;
  requestAnimationFrame(() => { grid.scrollTop = 0; });
}

async function refreshAssetConsumers(key) {
  if (key === 'categoriesPath') {
    state.productFolder = '';
    await loadAssets(key);
  } else if (key === 'printsPath') {
    state.printFolder = '';
    await loadAssets(key);
  } else {
    state.templatePreparation = null;
    await loadTemplateFolders();
    await loadTemplatePreparation();
  }
  renderSelection();
}

async function importAssetEntries(entries) {
  if (state.assetUploading || !entries?.length) return;
  const key = state.assetPreviewKey;
  const addButton = $('#addAssetFilesButton');
  state.assetUploading = true;
  addButton.disabled = true;
  addButton.textContent = '添加中…';
  $('#selectAllAssetsButton').disabled = true;
  $('#deleteSelectedAssetsButton').disabled = true;
  $('#assetPreviewSummary').textContent = `正在添加 ${entries.length} 张图片…`;
  try {
    const result = await window.caishen.addAssetFiles(key, state.config[key], entries);
    if (result.root !== state.config[key]) {
      state.config[key] = result.root;
      state.config = await window.caishen.saveConfig(state.config);
      renderConfig();
    }
    await refreshAssetConsumers(key);
    await loadAssetLibraryPreview(key, { preserveSelection: true, force: true });
    toast(`已添加 ${result.added} 张素材${result.skipped ? `，跳过 ${result.skipped} 个文件` : ''}`);
  } catch (error) {
    toast(errorText(error), true);
    await loadAssetLibraryPreview(key, { preserveSelection: true, force: true });
  } finally {
    state.assetUploading = false;
    addButton.disabled = false;
    addButton.textContent = '添加文件';
    renderAssetSelectionState();
  }
}

async function chooseAndAddAssetFiles() {
  if (state.assetPreviewKey === 'detailSetsPath' && currentTemplateFolderView() === 'all') return toast('请先选择一个具体套图文件夹，再添加图片', true);
  const entries = await window.caishen.chooseAssetFiles();
  if (entries.length) await importAssetEntries(entries);
}

async function deleteSelectedAssets() {
  const paths = [...state.selectedAssetPaths];
  if (!paths.length) return toast('请先选择需要删除的素材', true);
  if (!window.confirm(`确定删除选中的 ${paths.length} 张素材吗？此操作会删除服务器工作区中的图片。`)) return;
  const key = state.assetPreviewKey;
  const button = $('#deleteSelectedAssetsButton');
  button.disabled = true;
  button.textContent = '删除中…';
  $('#selectAllAssetsButton').disabled = true;
  try {
    let deleted = 0;
    if (key === 'detailSetsPath') {
      const groups = new Map();
      for (const item of state.assetPreviewItems.filter(item => state.selectedAssetPaths.has(item.path))) {
        const root = templateFolderPathForItem(item);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(item.path);
      }
      for (const [root, groupPaths] of groups) {
        const result = await window.caishen.deleteAssetFiles(key, root, groupPaths);
        deleted += Number(result.deleted || 0);
      }
    } else {
      const result = await window.caishen.deleteAssetFiles(key, state.config[key], paths);
      deleted = Number(result.deleted || 0);
    }
    if (state.selectedProduct && state.selectedAssetPaths.has(state.selectedProduct.path)) state.selectedProduct = null;
    if (state.selectedPrint && state.selectedAssetPaths.has(state.selectedPrint.path)) state.selectedPrint = null;
    state.selectedAssetPaths.clear();
    await refreshAssetConsumers(key);
    await loadAssetLibraryPreview(key, { force: true });
    toast(`已删除 ${deleted} 张素材`);
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    button.textContent = '删除选中';
    renderAssetSelectionState();
  }
}

async function loadAssetLibraryPreview(key = 'printsPath', { preserveSelection = false, force = false } = {}) {
  if (!state.config) return;
  if (!['printsPath', 'detailSetsPath'].includes(key)) key = 'printsPath';
  const previousKey = state.assetPreviewKey;
  const shouldResetScroll = key !== previousKey || force || !preserveSelection;
  if (key !== previousKey || !preserveSelection) state.selectedAssetPaths.clear();
  state.assetPreviewKey = key;
  const loadId = ++state.assetPreviewLoadId;
  const labels = { printsPath: '印花素材', detailSetsPath: '套图模板' };
  $$('.asset-preview-tabs [data-asset-preview]').forEach(button => {
    const active = button.dataset.assetPreview === key;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('[data-asset-source]').forEach(panel => { panel.hidden = panel.dataset.assetSource !== key; });
  $('#assetPreviewTitle').textContent = labels[key] || '素材内容';
  const grid = $('#assetManagementGrid');
  if (shouldResetScroll) resetAssetManagementScroll();
  const previewSize = state.assetPreviewSizes[key] || 138;
  $('#assetManagementPreviewSize').value = String(previewSize);
  grid.style.setProperty('--asset-management-card-size', `${previewSize}px`);
  const templateView = key === 'detailSetsPath' ? currentTemplateFolderView() : '';
  const root = key === 'detailSetsPath'
    ? templateView === 'all' ? `all:${state.templateFolders.map(folder => folder.path).join('|')}` : templateView
    : state.config[key];
  if (!root) {
    state.assetPreviewItems = [];
    state.assetPreviewCache.set(key, { root: '', items: state.assetPreviewItems });
    $('#assetPreviewSummary').textContent = '尚未配置素材库';
    renderAssetManagementGrid();
    return;
  }
  const cached = state.assetPreviewCache.get(key);
  if (!force && cached?.root === root) {
    const alreadyRendered = previousKey === key
      && state.assetPreviewItems === cached.items
      && grid.childElementCount > 0
      && !grid.querySelector('.empty-inline');
    state.assetPreviewItems = cached.items;
    if (key === 'detailSetsPath') state.templateItems = cached.items;
    const visible = cached.items.slice(0, 160);
    $('#assetPreviewSummary').textContent = `${key === 'detailSetsPath' && templateView === 'all' ? `${state.templateFolders.length} 个文件夹 · ` : ''}共 ${cached.items.length} 张${cached.items.length > visible.length ? `，当前显示前 ${visible.length} 张` : ''}`;
    if (alreadyRendered) renderAssetSelectionState();
    else renderAssetManagementGrid();
    return;
  }
  grid.innerHTML = '<div class="empty-inline">正在读取素材…</div>';
  try {
    const items = key === 'detailSetsPath'
      ? await listTemplateItemsForCurrentView()
      : await window.caishen.listImages(root, '');
    state.assetPreviewCache.set(key, { root, items });
    if (loadId !== state.assetPreviewLoadId || state.assetPreviewKey !== key) return;
    state.assetPreviewItems = items;
    if (key === 'detailSetsPath') state.templateItems = items;
    if (currentPage !== 'assets') return;
    const visible = items.slice(0, 160);
    $('#assetPreviewSummary').textContent = `${key === 'detailSetsPath' && templateView === 'all' ? `${state.templateFolders.length} 个文件夹 · ` : ''}共 ${items.length} 张${items.length > visible.length ? `，当前显示前 ${visible.length} 张` : ''}`;
    renderAssetManagementGrid();
  } catch (error) {
    if (loadId !== state.assetPreviewLoadId || state.assetPreviewKey !== key || currentPage !== 'assets') return;
    $('#assetPreviewSummary').textContent = '读取失败';
    grid.innerHTML = `<div class="empty-inline">${escapeHtml(errorText(error))}</div>`;
    renderAssetSelectionState();
  }
}

async function loadAssets(key, query = '') {
  const isProduct = key === 'categoriesPath';
  const grid = $(isProduct ? '#productGrid' : '#printGrid');
  grid.innerHTML = '<div class="empty-inline">正在扫描素材…</div>';
  try {
    const items = await window.caishen.listImages(state.config[key], query);
    if (isProduct) state.products = items; else state.prints = items;
    renderAssets(isProduct ? 'product' : 'print');
  } catch (error) {
    grid.innerHTML = `<div class="empty-inline">${escapeHtml(errorText(error))}</div>`;
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function normalizedRelativePath(value = '') {
  return String(value || '').replaceAll('\\', '/').toLocaleLowerCase('zh-CN');
}

function reviewRegenerationReferenceCandidates(item, currentJob) {
  const current = normalizedRelativePath(currentJob?.relativePath);
  return (item?.jobs || [])
    .filter(job => job?.outputUrl && normalizedRelativePath(job.relativePath) !== current)
    .filter(job => {
      const action = normalizeTemplateUiAction(job.action);
      return action !== 'exclude' && action !== 'copy_original';
    })
    .map(job => ({
      relativePath: job.relativePath,
      outputUrl: job.outputUrl,
      templateUrl: job.templateUrl,
      status: job.status || ''
    }));
}

function closeReviewRegenerationDialog(result = null) {
  const dialog = state.reviewRegenerationDialog;
  if (!dialog) return;
  state.reviewRegenerationDialog = null;
  dialog.element.remove();
  dialog.resolve(result);
}

function openReviewRegenerationDialog(item, job) {
  if (state.reviewRegenerationDialog) closeReviewRegenerationDialog(null);
  const candidates = reviewRegenerationReferenceCandidates(item, job);
  const element = document.createElement('div');
  element.className = 'review-regenerate-modal-backdrop';
  element.innerHTML = `<section class="review-regenerate-modal" role="dialog" aria-modal="true" aria-labelledby="reviewRegenerateTitle">
    <header>
      <div><span>REGENERATE</span><h2 id="reviewRegenerateTitle">重新生成图片</h2><p>当前图片：${escapeHtml(job.relativePath)}</p></div>
      <button class="icon-button" type="button" data-review-regenerate-close aria-label="关闭">×</button>
    </header>
    <div class="review-regenerate-body">
      <label class="review-regenerate-field"><b>本次额外要求</b><textarea data-review-regenerate-note rows="4" placeholder="例如：印花只能覆盖柜门面板，不能盖住黑色边框、台面、侧板、柜脚和场景物品。"></textarea></label>
      <label class="review-regenerate-check"><input type="checkbox" data-review-regenerate-previous ${job.outputUrl ? '' : 'disabled'}>参考当前这张不合格结果，只修正问题</label>
      <div class="review-regenerate-reference">
        <div><b>可选参考结果图</b><span>只参考印花落位和黑边保留方式，不复制参考图的构图或尺寸。</span></div>
        <div class="review-regenerate-reference-list">
          <label class="review-regenerate-reference-card selected">
            <input type="radio" name="review-regenerate-reference" value="" checked>
            <span>不使用其他参考图</span>
          </label>
          ${candidates.map(candidate => `<label class="review-regenerate-reference-card">
            <input type="radio" name="review-regenerate-reference" value="${escapeHtml(candidate.relativePath)}">
            <img src="${escapeHtml(candidate.outputUrl)}" data-preview-src="${escapeHtml(candidate.outputUrl)}" alt="${escapeHtml(candidate.relativePath)} 参考结果">
            <span><b>${escapeHtml(candidate.relativePath)}</b><small>${escapeHtml(candidate.status || '已生成')}</small></span>
          </label>`).join('')}
        </div>
      </div>
    </div>
    <footer><button class="secondary" type="button" data-review-regenerate-cancel>取消</button><button class="primary" type="button" data-review-regenerate-submit>提交重新生成</button></footer>
  </section>`;
  document.body.appendChild(element);
  const promise = new Promise(resolve => { state.reviewRegenerationDialog = { element, resolve }; });
  element.addEventListener('click', event => {
    if (event.target === element || event.target.closest('[data-review-regenerate-close], [data-review-regenerate-cancel]')) {
      closeReviewRegenerationDialog(null);
      return;
    }
    const card = event.target.closest('.review-regenerate-reference-card');
    if (card) {
      element.querySelectorAll('.review-regenerate-reference-card').forEach(item => item.classList.remove('selected'));
      card.classList.add('selected');
      const input = card.querySelector('input[type="radio"]');
      if (input) input.checked = true;
    }
    if (event.target.closest('[data-review-regenerate-submit]')) {
      const reference = element.querySelector('input[name="review-regenerate-reference"]:checked')?.value || '';
      closeReviewRegenerationDialog({
        extraInstruction: element.querySelector('[data-review-regenerate-note]')?.value || '',
        includePreviousResult: Boolean(element.querySelector('[data-review-regenerate-previous]')?.checked),
        referenceResultRelativePath: reference
      });
    }
  });
  return promise;
}

function renderAssetFolders(type, items) {
  const isProduct = type === 'product';
  const selectedFolder = isProduct ? state.productFolder : state.printFolder;
  const folders = [...new Set(items.map(item => item.folder).filter(folder => folder && folder !== '根目录'))]
    .sort((left, right) => (isProduct || state.printSort !== 'name-desc' ? 1 : -1) * left.localeCompare(right, 'zh-CN', { numeric: true }));
  const list = $(isProduct ? '#productFolderList' : '#printFolderList');
  list.innerHTML = [`<button class="asset-folder-button${selectedFolder ? '' : ' active'}" data-asset-folder="" data-folder-type="${type}">全部素材</button>`, ...folders.map(folder => `<button class="asset-folder-button${selectedFolder === folder ? ' active' : ''}" data-asset-folder="${escapeHtml(folder)}" data-folder-type="${type}" title="${escapeHtml(folder)}">${escapeHtml(folder)}</button>`)].join('');
  $(isProduct ? '#productFolderLabel' : '#printFolderLabel').textContent = selectedFolder || '全部文件夹';
}

function renderAssets(type) {
  const isProduct = type === 'product';
  const allItems = isProduct ? state.products : state.prints;
  const selectedFolder = isProduct ? state.productFolder : state.printFolder;
  const matchingItems = selectedFolder ? allItems.filter(item => item.folder === selectedFolder || item.folder.startsWith(`${selectedFolder}/`)) : allItems;
  const items = sortByName(matchingItems, isProduct ? 'name-asc' : state.printSort, item => item.name).slice(0, 240);
  const selected = isProduct ? state.selectedProduct : state.selectedPrint;
  const grid = $(isProduct ? '#productGrid' : '#printGrid');
  renderAssetFolders(type, allItems);
  if (!items.length) {
    grid.innerHTML = `<div class="empty-inline">${state.config[isProduct ? 'categoriesPath' : 'printsPath'] ? '没有找到支持的图片' : '先选择素材文件夹'}</div>`;
    return;
  }
  grid.innerHTML = items.map(item => `<button class="asset-card${selected?.path === item.path ? ' selected' : ''}" data-type="${type}" data-index="${allItems.indexOf(item)}" title="${escapeHtml(item.path)}"><img loading="lazy" decoding="async" src="${escapeHtml(item.thumbnailUrl || item.url)}" data-preview-src="${escapeHtml(item.previewUrl || item.url)}" alt="${escapeHtml(item.name)}"><span>${escapeHtml(item.name)}</span></button>`).join('')
    + (matchingItems.length > items.length ? `<div class="empty-inline">当前显示前 ${items.length} 张，请使用搜索或左侧文件夹缩小范围。</div>` : '');
}

function renderSelection() {
  $('#selectedProduct').innerHTML = `<span>款式</span><b>${escapeHtml(state.selectedProduct?.name || '未选择')}</b>`;
  $('#selectedPrint').innerHTML = `<span>印花</span><b>${escapeHtml(state.selectedPrint?.name || '未选择')}</b>`;
  renderTemplateWorkflow();
}

function updateGenerationModeUi() {
  const direct = $('#generationMode').value === 'template_print';
  $('.task-layout').classList.toggle('template-print-mode', direct);
  $('#generationModeHint').textContent = direct
    ? '母版任务卡生成完成后，可直接开始对应套图文件夹的整套任务。'
    : '先生成母版图，再到人工筛图生成套图。';
  $('#addTaskButton').textContent = direct ? '按母版卡生成整套任务' : '加入排队任务';
  renderTemplateWorkflow();
}

function addTask(silent = false) {
  const generationMode = $('#generationMode').value;
  if (!state.selectedPrint) return toast('请先选择印花图', true);
  if (generationMode === 'master' && !state.selectedProduct) return toast('母版模式需要先选择款式图', true);
  if (!state.config.detailSetsPath) return toast('请先选择套图文件夹', true);
  const baseTaskNumber = state.queue.reduce((maximum, task) => Math.max(maximum, Number(task.taskNumber) || 0), 0) + 1;
  const batchId = createClientId();
  const note = $('#taskNote').value.trim();
  const common = {
    printPath: state.selectedPrint.path,
    printName: state.selectedPrint.name,
    printThumbnailUrl: state.selectedPrint.thumbnailUrl || state.selectedPrint.url || '',
    printPreviewUrl: state.selectedPrint.previewUrl || state.selectedPrint.url || '',
    generationMode,
    note,
    selected: true,
    status: '未开始',
    error: ''
  };
  let tasks = [];
  if (generationMode === 'template_print') {
    const readyCandidates = state.templateMasterCandidates.filter(candidate => candidate.printPath === state.selectedPrint.path && templateMasterCandidateHasImage(candidate));
    if (readyCandidates.length === 1) return createTemplateTasksFromMasterCandidate(readyCandidates[0].id, { silent });
    if (readyCandidates.length > 1) return toast('请在对应母版任务卡里点击“开始生成整套”', true);
    return toast('请先创建并生成一张母版任务卡', true);
  } else {
    tasks = [{
      ...common,
      id: createClientId(),
      taskNumber: baseTaskNumber,
      productPath: state.selectedProduct?.path || '',
      productName: state.selectedProduct?.name || '模板原款',
      productThumbnailUrl: state.selectedProduct?.thumbnailUrl || state.selectedProduct?.url || '',
      productPreviewUrl: state.selectedProduct?.previewUrl || state.selectedProduct?.url || '',
      templateFolderPath: state.config.detailSetsPath || '',
      templatePreviewName: state.templatePreparation?.preview?.name || '',
      templateThumbnailUrl: state.templatePreparation?.preview?.thumbnailUrl || '',
      templatePreviewUrl: state.templatePreparation?.preview?.previewUrl || state.templatePreparation?.preview?.url || ''
    }];
  }
  if (!tasks.length) return toast('这些套图与印花已经在待生成列表中', true);
  state.queue.push(...tasks);
  if (tasks[0]?.generationMode === 'template_print') state.queueGroupExpanded.add(queueGroupKey(tasks[0]));
  $('#taskNote').value = '';
  renderQueue();
  if (!silent) toast(`已加入 ${tasks.length} 个待生成任务`);
  return tasks.length;
}

function createTemplateTasksFromMasterCandidate(candidateId, { silent = false } = {}) {
  const candidate = state.templateMasterCandidates.find(item => item.id === candidateId);
  if (!candidate) return toast('母版候选不存在', true);
  if (!templateMasterCandidateHasImage(candidate)) return toast('请先生成这张母版图', true);
  const candidateFolder = candidate.templateFolderPath || currentTaskTemplateFolderView();
  const templates = state.taskTemplateItems.filter(item => item.action === 'replace_print' && templateFolderPathForItem(item) === candidateFolder);
  if (!templates.length) return toast('当前套图范围内没有需要换印花的图片', true);
  const existing = new Set(state.queue.map(task => `${task.templateFolderPath}|${task.templateRelativePath || ''}|${task.printPath}|${task.masterCandidateId || task.masterImagePath || ''}`));
  const batchId = createClientId();
  const note = $('#taskNote').value.trim();
  const baseTaskNumber = state.queue.reduce((maximum, task) => Math.max(maximum, Number(task.taskNumber) || 0), 0) + 1;
  const tasks = templates.filter(item => !existing.has(`${templateFolderPathForItem(item)}|${item.relativePath}|${candidate.printPath}|${candidate.id}`)).map((item, index) => ({
    printPath: candidate.printPath,
    printName: candidate.printName,
    printThumbnailUrl: candidate.printThumbnailUrl || '',
    printPreviewUrl: candidate.printPreviewUrl || '',
    generationMode: 'template_print',
    note,
    selected: true,
    status: '未开始',
    error: '',
    masterCandidateId: candidate.id,
    masterReferencePath: candidate.masterReferencePath || '',
    masterReferenceName: candidate.masterReferenceName || '',
    masterReferenceThumbnailUrl: candidate.masterReferenceThumbnailUrl || '',
    masterReferencePreviewUrl: candidate.masterReferencePreviewUrl || '',
    masterReferenceRelativePath: candidate.masterReferenceRelativePath || '',
    masterImagePath: candidate.masterImagePath || '',
    masterImageUrl: candidate.masterImageUrl || '',
    masterImagePreviewUrl: candidate.masterImagePreviewUrl || '',
    masterStatus: candidate.masterStatus || '已生成',
    masterError: '',
    masterProgress: null,
    id: createClientId(),
    batchId,
    taskNumber: baseTaskNumber + index,
    productPath: '',
    productName: item.name,
    productThumbnailUrl: item.thumbnailUrl || item.url || '',
    productPreviewUrl: item.previewUrl || item.url || '',
    templateFolderPath: templateFolderPathForItem(item),
    templateRelativePath: item.relativePath,
    templatePreviewName: item.name,
    templateThumbnailUrl: item.thumbnailUrl || item.url || '',
    templatePreviewUrl: item.previewUrl || item.url || ''
  }));
  if (!tasks.length) return toast('这张母版图对应的整套任务已经在待生成列表中', true);
  state.queue.push(...tasks);
  state.queueGroupExpanded.add(queueGroupKey(tasks[0]));
  $('#taskNote').value = '';
  renderQueue();
  if (!silent) toast(`已用母版图创建 ${tasks.length} 个整套任务`);
  return tasks.length;
}

async function ensureTaskTemplateItemsForCandidate(candidate) {
  const folder = candidate?.templateFolderPath || '';
  if (!folder) return;
  const hasFolderItems = state.taskTemplateItems.some(item => templateFolderPathForItem(item) === folder);
  if (hasFolderItems) return;
  state.taskTemplateItems = await window.caishen.listTemplates(folder);
  state.taskTemplateFolderView = folder;
  syncTaskTemplateSelection({ reset: true });
}

function selectQueueTasksForMasterCandidates(candidateIds) {
  const ids = new Set(Array.isArray(candidateIds) ? candidateIds : [candidateIds]);
  let selected = 0;
  state.queue.forEach(task => {
    const match = ids.has(task.masterCandidateId) && task.status !== '已完成';
    task.selected = match;
    if (match) selected += 1;
  });
  return selected;
}

async function startTemplateSetFromMasterCandidate(candidateId) {
  const candidate = state.templateMasterCandidates.find(item => item.id === candidateId);
  if (!candidate) return toast('母版任务不存在', true);
  if (!templateMasterCandidateHasImage(candidate)) return toast('请先生成母版图', true);
  await ensureTaskTemplateItemsForCandidate(candidate);
  createTemplateTasksFromMasterCandidate(candidateId, { silent: true });
  const selected = selectQueueTasksForMasterCandidates(candidateId);
  renderQueue();
  if (!selected) return toast('这张母版对应的整套任务已生成完成，去人工筛图查看结果', true);
  await generateQueue({ redirectOnStart: true });
}

async function startTemplateSetsFromAllMasters() {
  const selectedMasters = selectedTemplateMasterCandidates();
  if (!selectedMasters.length) return toast('请先勾选要开始的母版任务', true);
  const ready = selectedMasters.filter(templateMasterCandidateHasImage);
  if (!ready.length) return toast('选中的任务还没有已生成母版图', true);
  for (const candidate of ready) {
    await ensureTaskTemplateItemsForCandidate(candidate);
    createTemplateTasksFromMasterCandidate(candidate.id, { silent: true });
  }
  const selectedTasks = selectQueueTasksForMasterCandidates(ready.map(candidate => candidate.id));
  renderQueue();
  if (!selectedTasks) return toast('全部已生成母版对应的整套任务都已完成', true);
  await generateQueue({ notifyOnStart: true });
}

async function generateAllTemplateMasterCandidates() {
  const selected = selectedTemplateMasterCandidates();
  if (!selected.length) return toast('请先勾选要生成的母版任务', true);
  await runClientConcurrency(selected, await apiBatchConcurrencyLimit(selected.length), refreshTemplateMasterReference);
  const runnable = selected.filter(candidate =>
    candidate.masterReferencePath
    && candidate.printPath
    && !['生成中', '重新生成'].includes(candidate.masterStatus)
  );
  if (!runnable.length) return toast('没有可生成的母版任务卡', true);
  await runClientConcurrency(runnable, await apiBatchConcurrencyLimit(runnable.length), candidate => generateTemplateMasterCandidate(candidate.id));
}

async function apiBatchConcurrencyLimit(total = Infinity) {
  if (!state.apiConcurrencySettings) {
    try {
      state.apiConcurrencySettings = await window.caishen.getApiConcurrencySettings();
    } catch {
      state.apiConcurrencySettings = { imageInitialConcurrency: 8, imageMaxConcurrency: 8, imageStartIntervalMs: 500 };
    }
  }
  const configured = Number(state.apiConcurrencySettings?.imageMaxConcurrency);
  const max = Math.min(50, Math.max(1, Math.trunc(Number.isFinite(configured) ? configured : 8)));
  const count = Number(total);
  return Number.isFinite(count) ? Math.min(max, Math.max(1, Math.trunc(count))) : max;
}

async function runClientConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const results = new Array(list.length);
  let cursor = 0;
  async function run() {
    while (cursor < list.length) {
      const index = cursor++;
      results[index] = await worker(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, Number(limit) || 1), list.length) }, run));
  return results;
}

function queueTaskPreviews(task) {
  const print = state.prints.find(item => item.path === task.printPath);
  const product = state.products.find(item => item.path === task.productPath);
  const currentTemplate = task.templateFolderPath === state.templatePreparation?.folder
    ? state.templatePreparation?.preview : null;
  const templateMode = task.generationMode === 'template_print';
  return {
    sourceName: templateMode
      ? task.templatePreviewName || currentTemplate?.name || '套图模板'
      : task.productName || product?.name || '款式图',
    sourceThumbnailUrl: templateMode
      ? task.templateThumbnailUrl || currentTemplate?.thumbnailUrl || ''
      : task.productThumbnailUrl || product?.thumbnailUrl || product?.url || '',
    sourcePreviewUrl: templateMode
      ? task.templatePreviewUrl || currentTemplate?.previewUrl || currentTemplate?.url || ''
      : task.productPreviewUrl || product?.previewUrl || product?.url || '',
    printThumbnailUrl: task.printThumbnailUrl || print?.thumbnailUrl || print?.url || '',
    printPreviewUrl: task.printPreviewUrl || print?.previewUrl || print?.url || ''
  };
}

function queuePreviewFigure(url, previewUrl, name, label) {
  const content = url
    ? `<img loading="lazy" decoding="async" src="${escapeHtml(url)}" data-preview-src="${escapeHtml(previewUrl || url)}" alt="${escapeHtml(name)}">`
    : `<span class="queue-preview-placeholder">${escapeHtml(label)}</span>`;
  return `<figure class="queue-preview-figure">${content}<figcaption>${escapeHtml(label)}</figcaption></figure>`;
}

function queueGroupKey(task) {
  return task.generationMode === 'template_print' && task.batchId && task.templateRelativePath
    ? `batch:${task.batchId}:${task.templateFolderPath}`
    : `task:${task.id}`;
}

function queueGroupTitle(tasks) {
  const folder = tasks.find(item => item.result?.folder)?.result?.folder
    || tasks.find(item => item.progress?.folder)?.progress?.folder
    || '';
  if (folder) return shortPath(folder);
  const firstNumber = Math.min(...tasks.map(item => Number(item.taskNumber) || 0).filter(Boolean));
  if (Number.isFinite(firstNumber)) return `批量任务 ${String(firstNumber).padStart(4, '0')}`;
  return tasks[0]?.printName || '批量任务';
}

function queueGroupStatus(tasks) {
  const running = tasks.filter(task => ['排队中', '生成中'].includes(task.status)).length;
  const failed = tasks.filter(task => task.status === '失败').length;
  const completed = tasks.filter(task => task.status === '已完成').length;
  if (running) return '任务进行中';
  if (failed) return '有失败';
  if (completed === tasks.length) return '已完成';
  return '未开始';
}

function renderQueueItem(task, index) {
  const previews = queueTaskPreviews(task);
  const progress = task.progress || {};
  const summary = task.result?.summary || {};
  const total = Math.max(0, Number(progress.total) || 0);
  const current = Math.max(0, Number(progress.current) || 0);
  const percent = total ? Math.min(100, Math.round(current / total * 100)) : Math.max(0, Number(progress.percent) || 0);
  const completedSummary = task.status === '已完成' && Number(summary.total)
    ? task.templateRelativePath ? '当前套图生成完成' : `API 生成 ${summary.apiGenerated || 0} · 直接复制 ${summary.copied || 0} · 跳过 ${summary.skipped || 0}`
    : '';
  const progressMarkup = ['排队中', '生成中'].includes(task.status)
    ? `<div class="queue-progress"><div><span>${escapeHtml(progress.message || (task.status === '排队中' ? '等待服务器处理' : '正在处理…'))}</span><b>${total ? `${current}/${total}` : `${percent}%`}</b></div><progress max="100" value="${percent}"></progress></div>`
    : completedSummary ? `<div class="queue-result-summary">${escapeHtml(completedSummary)}</div>` : '';
  const previewPair = task.generationMode === 'template_print'
    ? `<div class="queue-preview-pair">${queuePreviewFigure(task.masterImageUrl || task.masterImagePreviewUrl || '', task.masterImagePreviewUrl || task.masterImageUrl || '', task.masterImagePath ? '已生成母版' : '未生成母版', '母版图')}<span class="queue-preview-plus" aria-hidden="true">+</span>${queuePreviewFigure(previews.sourceThumbnailUrl, previews.sourcePreviewUrl, previews.sourceName, '套图页')}</div>`
    : `<div class="queue-preview-pair">${queuePreviewFigure(previews.sourceThumbnailUrl, previews.sourcePreviewUrl, previews.sourceName, '款式')}<span class="queue-preview-plus" aria-hidden="true">+</span>${queuePreviewFigure(previews.printThumbnailUrl, previews.printPreviewUrl, task.printName, '印花')}</div>`;
  const templateControl = task.templateRelativePath ? '' : `<div class="queue-template-row"><span>已选择套图</span><button class="secondary" data-queue-template-index="${index}">更换套图</button></div>`;
  return `<div class="queue-item" data-queue-index="${index}"><div class="queue-item-head"><input type="checkbox" aria-label="选择任务 ${index + 1}" title="勾选后参与批量操作" data-queue-select="${index}"${task.selected ? ' checked' : ''}><b>${String(index + 1).padStart(2, '0')} · ${escapeHtml(task.productName)}</b><button class="queue-delete-button" type="button" data-queue-delete="${index}"${task.status === '生成中' ? ' disabled title="生成中的任务暂不能删除"' : ''}>删除</button></div><div class="queue-item-body">${previewPair}<div class="queue-item-copy"><span>${task.generationMode === 'template_print' ? '母版迁移到套图页' : '母版生成'}</span>${templateControl}${progressMarkup}<span class="status${task.status === '失败' ? ' error' : ''}">${escapeHtml(task.error || task.status)}</span></div></div></div>`;
}

function renderQueue() {
  persistQueue();
  const list = $('#queueList');
  $('#queueCount').textContent = `${state.queue.length} 项`;
  $('#queueManageDetails').hidden = state.queue.length === 0;
  if (!state.queue.length) {
    list.innerHTML = '<div class="empty-inline">选择套图文件夹或单张图片，再点击印花创建任务。</div>';
    renderTemplateWorkflow();
    return;
  }
  const groups = new Map();
  state.queue.forEach((task, index) => {
    const key = queueGroupKey(task);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ task, index });
  });
  list.innerHTML = [...groups.entries()].map(([key, entries]) => {
    if (entries.length === 1) return renderQueueItem(entries[0].task, entries[0].index);
    const tasks = entries.map(entry => entry.task);
    const expanded = state.queueGroupExpanded.has(key);
    const selectedCount = tasks.filter(task => task.selected).length;
    const runningCount = tasks.filter(task => ['排队中', '生成中'].includes(task.status)).length;
    const completedCount = tasks.filter(task => task.status === '已完成').length;
    const failedCount = tasks.filter(task => task.status === '失败').length;
    const progress = tasks.find(task => task.progress?.total)?.progress || {};
    const total = Math.max(tasks.length, Number(progress.total) || 0);
    const current = Math.max(0, Number(progress.current) || completedCount || 0);
    const percent = total ? Math.min(100, Math.round(current / total * 100)) : 0;
    const details = expanded ? `<div class="queue-group-items">${entries.map(entry => renderQueueItem(entry.task, entry.index)).join('')}</div>` : '';
    return `<section class="queue-group${expanded ? ' expanded' : ''}" data-queue-group="${escapeHtml(key)}"><div class="queue-group-head"><input type="checkbox" aria-label="选择整组任务" data-queue-group-select="${escapeHtml(key)}"${selectedCount === tasks.length ? ' checked' : ''}><button type="button" class="queue-group-toggle" data-queue-group-toggle="${escapeHtml(key)}" aria-expanded="${expanded}"><span>${expanded ? '▾' : '▸'}</span><b>${escapeHtml(queueGroupTitle(tasks))}</b><small>${escapeHtml(queueGroupStatus(tasks))} · ${tasks.length} 张</small></button></div><div class="queue-group-summary"><span>处理中 ${runningCount}/${tasks.length}</span><span>完成 ${completedCount}</span><span>失败 ${failedCount}</span></div><progress max="100" value="${percent}"></progress>${details}</section>`;
  }).join('');
  renderTemplateWorkflow();
}

function deleteQueueTask(index) {
  const task = state.queue[index];
  if (!task) return;
  if (task.status === '生成中') return toast('任务正在生成，完成后才能删除', true);
  state.queue.splice(index, 1);
  renderQueue();
  toast(`已删除任务：${task.printName || task.productName}`);
}

async function applyCurrentTemplateFolderToQueue(selectedOnly) {
  try {
    let folder = state.config?.detailSetsPath || '';
    if (!folder) {
      const selected = await window.caishen.chooseFolder('', 'detailSetsPath');
      if (!selected) return;
      state.config.detailSetsPath = selected;
      state.config = await window.caishen.saveConfig(state.config);
      renderConfig();
      folder = state.config.detailSetsPath || selected;
      await loadTemplatePreparation({ autoPrepare: true });
    }
    const tasks = selectedOnly ? state.queue.filter(task => task.selected) : state.queue;
    if (!tasks.length) return toast(selectedOnly ? '请先勾选要套用的任务' : '当前没有任务', true);
    for (const task of tasks) {
      task.templateFolderPath = folder;
      task.templatePreviewName = state.templatePreparation?.preview?.name || '';
      task.templateThumbnailUrl = state.templatePreparation?.preview?.thumbnailUrl || '';
      task.templatePreviewUrl = state.templatePreparation?.preview?.previewUrl || state.templatePreparation?.preview?.url || '';
      if (task.generationMode === 'template_print') resetTaskMaster(task);
    }
    renderQueue();
    toast(`已将当前套图套用到${selectedOnly ? '选中' : '全部'} ${tasks.length} 个任务`);
  } catch (error) {
    toast(errorText(error), true);
  }
}

async function changeQueueTaskTemplate(index) {
  const task = state.queue[index];
  if (!task) return;
  try {
    const selected = await window.caishen.chooseFolder(task.templateFolderPath || state.config?.detailSetsPath || '', 'detailSetsPath');
    if (!selected) return;
    task.templateFolderPath = selected;
    state.config.detailSetsPath = selected;
    state.templatePreparation = null;
    state.config = await window.caishen.saveConfig(state.config);
    renderConfig();
    await loadTemplatePreparation({ autoPrepare: true });
    await loadTemplateFolders();
    task.templatePreviewName = state.templatePreparation?.preview?.name || '';
    task.templateThumbnailUrl = state.templatePreparation?.preview?.thumbnailUrl || '';
    task.templatePreviewUrl = state.templatePreparation?.preview?.previewUrl || state.templatePreparation?.preview?.url || '';
    if (task.generationMode === 'template_print') resetTaskMaster(task);
    renderQueue();
    toast(`任务 ${String(task.taskNumber || index + 1).padStart(4, '0')} 已更换套图`);
  } catch (error) {
    toast(errorText(error), true);
  }
}

async function generateQueueTaskMaster(index) {
  const task = state.queue[index];
  if (!task || task.generationMode !== 'template_print') return;
  if (!task.printPath) return toast('请先选择印花图', true);
  if (!task.masterReferencePath) {
    if (!task.masterReferencePath) return toast('没有找到可用于生成母版的参考图', true);
  }
  task.masterRunAttempt = Math.max(0, Number(task.masterRunAttempt) || 0) + 1;
  task.masterStatus = task.masterImagePath ? '重新生成' : '生成中';
  task.masterError = '';
  task.masterProgress = { phase: 'queued', percent: 0, message: '等待生成母版图' };
  syncTaskMasterToRelatedTasks(task);
  renderQueue();
  try {
    const result = await window.caishen.generateTemplateMaster(task, progress => {
      task.masterProgress = { ...(task.masterProgress || {}), ...(progress || {}) };
      task.masterStatus = task.masterImagePath ? '重新生成' : '生成中';
      syncTaskMasterToRelatedTasks(task);
      renderQueue();
    });
    task.masterImagePath = result?.outputPath || '';
    task.masterImageUrl = result?.url || '';
    task.masterImagePreviewUrl = result?.url || '';
    task.masterReferencePath = result?.referencePath || task.masterReferencePath || '';
    task.masterReferenceName = result?.referenceName || task.masterReferenceName || '';
    task.masterStatus = '已生成';
    task.masterError = '';
    task.masterProgress = { ...(task.masterProgress || {}), phase: 'completed', percent: 100, message: '母版图生成完成' };
    syncTaskMasterToRelatedTasks(task);
    renderQueue();
    toast('母版图已生成，可开始正式生成');
  } catch (error) {
    task.masterStatus = task.masterImagePath ? '已生成' : '未生成';
    task.masterError = errorText(error);
    task.masterProgress = { ...(task.masterProgress || {}), phase: 'failed', message: task.masterError };
    syncTaskMasterToRelatedTasks(task);
    renderQueue();
    toast(task.masterError, true);
  }
}

async function generateTemplateMasterCandidate(candidateId) {
  const candidate = state.templateMasterCandidates.find(item => item.id === candidateId);
  if (!candidate) return toast('母版候选不存在', true);
  if (!candidate.printPath) return toast('请先选择印花图', true);
  await refreshTemplateMasterReference(candidate);
  if (!candidate.masterReferencePath) return toast('请先选择母版底图', true);
  candidate.masterRunAttempt = Math.max(0, Number(candidate.masterRunAttempt) || 0) + 1;
  candidate.masterStatus = candidate.masterImagePath ? '重新生成' : '生成中';
  candidate.masterError = '';
  candidate.masterProgress = { phase: 'queued', percent: 0, message: '等待生成母版图' };
  persistTemplateMasterCandidates();
  renderTemplateWorkflow();
  try {
    const result = await window.caishen.generateTemplateMaster(candidate, progress => {
      candidate.masterProgress = { ...(candidate.masterProgress || {}), ...(progress || {}) };
      candidate.masterStatus = candidate.masterImagePath ? '重新生成' : '生成中';
      persistTemplateMasterCandidates();
      renderTemplateWorkflow();
    });
    candidate.masterImagePath = result?.outputPath || '';
    candidate.masterImageUrl = result?.url || '';
    candidate.masterImagePreviewUrl = result?.url || '';
    candidate.masterReferencePath = result?.referencePath || candidate.masterReferencePath || '';
    candidate.masterReferenceName = result?.referenceName || candidate.masterReferenceName || '';
    candidate.masterStatus = '已生成';
    candidate.masterError = '';
    candidate.masterProgress = { ...(candidate.masterProgress || {}), phase: 'completed', percent: 100, message: '母版图生成完成' };
    syncTemplateMasterCandidateToQueuedTasks(candidate);
    persistTemplateMasterCandidates();
    renderQueue();
    renderTemplateWorkflow();
    toast('母版图已生成，可以创建整套任务');
  } catch (error) {
    candidate.masterStatus = candidate.masterImagePath ? '已生成' : '未生成';
    candidate.masterError = errorText(error);
    candidate.masterProgress = { ...(candidate.masterProgress || {}), phase: 'failed', message: candidate.masterError };
    persistTemplateMasterCandidates();
    renderTemplateWorkflow();
    toast(candidate.masterError, true);
  }
}

async function generateQueue(options = {}) {
  state.stopGenerationRequested = false;
  const selected = state.queue.filter(task => task.selected);
  let source = selected.length ? selected : state.queue;
  if (source.length && source.every(task => task.status === '已完成')) {
    setPage('review');
    return;
  }
  const incompleteTemplateTask = source.find(task => {
    if (task.generationMode !== 'template_print') return false;
    const fullCount = state.taskTemplateItems.filter(item => item.action === 'replace_print' && templateFolderPathForItem(item) === task.templateFolderPath).length;
    const queuedCount = state.queue.filter(item => item.generationMode === 'template_print' && item.templateFolderPath === task.templateFolderPath && item.printPath === task.printPath).length;
    return fullCount > queuedCount;
  });
  if (incompleteTemplateTask) {
    const fullCount = state.taskTemplateItems.filter(item => item.action === 'replace_print' && templateFolderPathForItem(item) === incompleteTemplateTask.templateFolderPath).length;
    const queuedCount = state.queue.filter(item => item.generationMode === 'template_print' && item.templateFolderPath === incompleteTemplateTask.templateFolderPath && item.printPath === incompleteTemplateTask.printPath).length;
    if (window.confirm(`当前任务只包含 ${queuedCount}/${fullCount} 张换印花图片，是否补齐为整套后再生成？`)) {
      const added = expandTemplateTaskGroupToFullSet(incompleteTemplateTask);
      if (added) {
        toast(`已补齐 ${added} 张整套任务`);
        renderQueue();
        source = selected.length ? state.queue.filter(task => task.selected) : state.queue;
      }
    }
  }
  const pending = source.filter(task => task.status === '未开始' || task.status === '失败');
  if (!pending.length) return toast('没有待生成任务', true);
  const missingMaster = pending.filter(task => task.generationMode === 'template_print' && !templateTaskHasMaster(task));
  const runnable = pending.filter(templateTaskHasMaster);
  if (!runnable.length) return toast('请先为任务生成母版图', true);
  if (missingMaster.length) toast(`已跳过 ${missingMaster.length} 个未生成母版的任务`);
  if (runnable.some(task => task.generationMode === 'template_print' && !task.templateRelativePath) && !state.templatePreparation?.ready) {
    return toast(state.templatePreparation?.counts?.manualCheck ? '套图中还有需要人工确认的图片，请先查看识别结果' : '请先完成套图自动识别', true);
  }
  $('#generateAllButton').disabled = true;
  runnable.forEach(task => {
    const continuing = task.error === '页面曾关闭，将继续查询原后台任务。';
    if (!continuing) task.runAttempt = Math.max(0, Number(task.runAttempt) || 0) + 1;
    task.status = '排队中';
    task.error = '';
    task.progress = { phase: 'queued', current: 0, total: 0, percent: 0, message: '等待服务器处理' };
  });
  renderQueue();
  if (options.redirectOnStart) {
    toast('已开始生成整套，正在跳转到人工筛图页面查看进度');
    setPage('review');
  } else if (options.notifyOnStart) {
    toast('已开始生成整套任务，可以到人工筛图页面查看进度');
  }
  const grouped = new Map();
  for (const task of runnable) {
    const groupKey = queueGroupKey(task);
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push(task);
  }
  const taskGroups = [...grouped.values()];
  for (let groupIndex = 0; groupIndex < taskGroups.length; groupIndex += 1) {
    if (state.stopGenerationRequested) {
      taskGroups.slice(groupIndex).flat().forEach(item => {
        if (item.status === '排队中') {
          item.status = '未开始';
          item.progress = { ...(item.progress || {}), phase: 'stopped', message: '已停止，重新点击生成后再处理' };
        }
      });
      renderQueue();
      break;
    }
    const tasks = taskGroups[groupIndex];
    const task = tasks[0];
    const payload = tasks.length > 1
      ? { ...task, templateRelativePaths: tasks.map(item => item.templateRelativePath).filter(Boolean) }
      : { ...task, templateRelativePaths: task.templateRelativePath ? [task.templateRelativePath] : [] };
    tasks.forEach(item => { item.status = '生成中'; });
    renderQueue();
    try {
      const result = await window.caishen.generateTask(payload, progress => {
        tasks.forEach(item => {
          item.progress = { ...(item.progress || {}), ...(progress || {}) };
          item.status = item.progress.phase === 'queued' ? '排队中' : '生成中';
        });
        renderQueue();
      });
      tasks.forEach(item => {
        item.result = result;
        item.status = '已完成';
        item.progress = { ...(item.progress || {}), ...(result?.summary || {}), phase: 'completed', percent: 100, message: '处理完成' };
      });
    } catch (error) {
      tasks.forEach(item => {
        item.status = '失败';
        item.error = errorText(error);
        item.progress = { ...(item.progress || {}), phase: 'failed', message: item.error };
      });
      if (state.stopGenerationRequested || /手动停止|强制停止/.test(errorText(error))) {
        state.stopGenerationRequested = true;
      }
    }
    renderQueue();
  }
  if (state.stopGenerationRequested) {
    runnable.forEach(item => {
      if (item.status === '排队中') {
        item.status = '未开始';
        item.progress = { ...(item.progress || {}), phase: 'stopped', message: '已停止，重新点击生成后再处理' };
      }
    });
    renderQueue();
  }
  $('#generateAllButton').disabled = false;
  const failed = runnable.filter(task => task.status === '失败').length;
  const uniqueResults = new Map();
  for (const task of runnable) {
    if (!task.result) continue;
    uniqueResults.set(task.result.folder || task.id, task.result);
  }
  const totals = [...uniqueResults.values()].reduce((result, taskResult) => {
    const summary = taskResult.summary || {};
    result.apiGenerated += Number(summary.apiGenerated) || 0;
    result.copied += Number(summary.copied) || 0;
    result.skipped += Number(summary.skipped) || 0;
    return result;
  }, { apiGenerated: 0, copied: 0, skipped: 0 });
  toast(failed
    ? `任务结束，${failed} 个失败，可修正后重试`
    : `处理完成：API 生成 ${totals.apiGenerated}，直接复制 ${totals.copied}，跳过 ${totals.skipped}。点击“查看筛图结果”继续。`, failed > 0);
  renderTemplateWorkflow();
}

function reviewGenerationSummary(item) {
  const saved = item?.generationProgress || {};
  if (Number(saved.total) > 0) return {
    total: Number(saved.total) || 0,
    current: Number(saved.current) || 0,
    percent: Number(saved.percent) || 0,
    apiGenerated: Number(saved.apiGenerated) || 0,
    copied: Number(saved.copied) || 0,
    skipped: Number(saved.skipped) || 0,
    failed: Number(saved.failed) || 0,
    waitingUpstream: Number(saved.waitingUpstream) || 0,
    pending: Number(saved.pending) || 0,
    billingCostMinor: Number(saved.billingCostMinor) || 0,
    phase: saved.phase || 'completed',
    message: normalizeProgressMessage(saved.message || ''),
    startedAt: saved.startedAt || '',
    completedAt: saved.completedAt || '',
    elapsedMs: Number(saved.elapsedMs) || 0,
    updatedAt: saved.updatedAt || '',
    activeRelativePath: saved.activeRelativePath || ''
  };
  const jobs = item?.jobs || [];
  const summary = { total: jobs.length, current: 0, percent: 0, apiGenerated: 0, copied: 0, skipped: 0, failed: 0, waitingUpstream: 0, pending: 0, billingCostMinor: 0, phase: 'completed', message: '', startedAt: '', completedAt: '', elapsedMs: 0, updatedAt: '', activeRelativePath: '' };
  for (const job of jobs) {
    const action = normalizeTemplateUiAction(job.action);
    if (job.status === '已跳过' || action === 'exclude') summary.skipped += 1;
    else if (!job.outputUrl) summary.pending += 1;
    else if (job.status === '直接套模板' || action === 'copy_original') summary.copied += 1;
    else summary.apiGenerated += 1;
  }
  summary.current = summary.total - summary.pending;
  summary.percent = summary.total ? Math.round(summary.current / summary.total * 100) : 0;
  summary.phase = summary.pending ? 'attention' : 'completed';
  return summary;
}

function renderReviewGenerationControls() {
  const stopButton = $('#stopReviewGenerationButton');
  if (!stopButton) return;
  stopButton.disabled = false;
  stopButton.textContent = '强制停止全部任务';
}

async function stopCurrentReviewGeneration() {
  const button = $('#stopReviewGenerationButton');
  button.disabled = true;
  button.textContent = '正在停止…';
  try {
    const result = await window.caishen.cancelActiveJobs();
    state.stopGenerationRequested = true;
    state.activeReviewGenerationJobId = '';
    toast(Number(result?.count) > 0 ? `已强制停止 ${result.count} 个后台任务` : '已发送停止指令，当前没有排队或运行中的后台任务');
    await loadReviews();
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    renderReviewGenerationControls();
  }
}

async function downloadSelectedReviewFolders() {
  const selected = [...state.selectedReviewFolders];
  const folders = selected.length ? selected : (state.reviewTaskActivated && state.activeReview ? [state.activeReview.folder] : []);
  if (!folders.length) return toast('请先选择要下载的任务', true);
  try {
    toast(folders.length > 1 ? `开始下载 ${folders.length} 个任务 ZIP` : '开始下载当前任务 ZIP');
    for (const folder of folders) {
      await window.caishen.downloadFolder(folder);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } catch (error) {
    toast(errorText(error), true);
  }
}

function scheduleReviewRefresh() {
  clearTimeout(reviewRefreshTimer);
  reviewRefreshTimer = null;
  const running = state.reviews.some(item => ['queued', 'preparing', 'generating', 'auditing', 'running'].includes(reviewGenerationSummary(item).phase));
  if (currentPage === 'review' && running) {
    reviewRefreshTimer = setTimeout(() => loadReviews({ silent: true }), 1500);
  }
}

function friendlyGenerationError(value) {
  const message = String(value || '').trim();
  const lower = message.toLocaleLowerCase('en-US');
  if (!message) return '';
  if (lower.includes('upstream image generation is busy') || lower.includes('server is busy')) return '生图服务繁忙，请稍后重新生成';
  if (lower.includes('token') && (lower.includes('expired') || lower.includes('invalid'))) return 'API 登录已过期，请先到系统设置检查连接';
  if (lower.includes('401') || lower.includes('unauthorized')) return 'API 认证失败，请检查密钥或登录状态';
  if (lower.includes('timeout') || lower.includes('timed out')) return '生成等待超时，可以稍后重新生成';
  if (lower.includes('econnrefused') || lower.includes('fetch failed')) return '暂时无法连接生图服务';
  return message.length > 90 ? `${message.slice(0, 90)}…` : message;
}

function reviewJobTrackingState(job, running) {
  if (job.regenerating) return { key: 'pending', label: '重新生成中', detail: `正在重新生成图片：${job.relativePath || ''}` };
  if (job.generationError && !job.outputUrl) return { key: 'failed', label: '生成失败', detail: friendlyGenerationError(job.generationError) };
  if (job.status === '已跳过' || normalizeTemplateUiAction(job.action) === 'exclude') return { key: 'completed', label: '已跳过', detail: '按套图规则不输出此图' };
  if (job.outputUrl) return { key: 'completed', label: '生成完成', detail: job.status === '已通过' ? '已通过人工确认' : '点击查看并确认图片' };
  if (running) return { key: 'pending', label: '生成中', detail: '正在等待生成结果' };
  return { key: 'pending', label: '待处理', detail: '尚未生成，可单独重新生成' };
}

function reviewJobActionKey(item, job) {
  return `${item?.folder || ''}\u0000${job?.relativePath || ''}`;
}

function reviewJobViewedKey(item, job) {
  return `${item?.folder || ''}\u0000${job?.relativePath || ''}\u0000${Number(job?.outputModifiedAt) || 0}\u0000${job?.generationError || ''}`;
}

function reviewJobMatchKey(item, job) {
  return `${item?.folder || ''}\u0000${normalizedRelativePath(job?.relativePath)}`;
}

function markReviewJobViewed(item, job) {
  const key = reviewJobViewedKey(item, job);
  if (!key || state.viewedReviewJobs.has(key)) return;
  state.viewedReviewJobs.add(key);
  persistViewedReviewJobs();
}

function markReviewItemViewed(item) {
  let changed = false;
  (item?.jobs || []).forEach(job => {
    const key = reviewJobViewedKey(item, job);
    if (key && !state.viewedReviewJobs.has(key)) {
      state.viewedReviewJobs.add(key);
      changed = true;
    }
  });
  if (changed) persistViewedReviewJobs();
}

function formatRegenerationAttempt(value) {
  const number = Number(value) || 1;
  const zh = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  if (number > 0 && number <= 10) return `第${zh[number]}次`;
  return `第${number}次`;
}

function createReviewRegenerationRecord(item, job) {
  const matchKey = reviewJobMatchKey(item, job);
  const attempt = state.reviewRegenerationRecords.filter(record => `${record.folder || ''}\u0000${normalizedRelativePath(record.relativePath)}` === matchKey).length + 1;
  const record = {
    id: createClientId(),
    folder: item.folder,
    relativePath: job.relativePath,
    attempt,
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.reviewRegenerationRecords.push(record);
  state.reviewRegenerationRecords = state.reviewRegenerationRecords.slice(-300);
  persistReviewRegenerationRecords();
  return record;
}

function updateReviewRegenerationRecord(record, status) {
  if (!record?.id) return;
  const target = state.reviewRegenerationRecords.find(item => item.id === record.id);
  if (!target) return;
  target.status = status;
  target.updatedAt = new Date().toISOString();
  persistReviewRegenerationRecords();
}

function renderReviewStagePreservingScroll() {
  const stage = $('#reviewStage');
  const top = stage ? stage.scrollTop : 0;
  renderReviewStage();
  if (stage) stage.scrollTop = top;
}

function renderReviewTrackingLog(item, summary, running) {
  const jobs = item?.jobs || [];
  const activeRelativePath = normalizedRelativePath(summary?.activeRelativePath);
  const jobEntries = jobs.map((job, index) => ({
    job: { ...job, regenerating: state.regeneratingReviewJobs.has(reviewJobActionKey(item, job)) || (running && activeRelativePath && normalizedRelativePath(job.relativePath) === activeRelativePath) },
    index,
    type: 'job',
    state: reviewJobTrackingState({ ...job, regenerating: state.regeneratingReviewJobs.has(reviewJobActionKey(item, job)) || (running && activeRelativePath && normalizedRelativePath(job.relativePath) === activeRelativePath) }, running),
    viewed: state.viewedReviewJobs.has(reviewJobViewedKey(item, job))
  }));
  const regenerationEntries = state.reviewRegenerationRecords
    .filter(record => record.folder === item?.folder)
    .slice()
    .reverse()
    .map((record, recordIndex) => {
      const index = jobs.findIndex(job => normalizedRelativePath(job.relativePath) === normalizedRelativePath(record.relativePath));
      const job = jobs[index] || { relativePath: record.relativePath };
      const status = record.status === 'failed' ? 'failed' : record.status === 'completed' ? 'completed' : 'pending';
      const label = record.status === 'failed' ? '重新生成失败' : record.status === 'completed' ? '重新生成完成' : '重新生成中';
      const updated = formatLocalDateTime(record.updatedAt || record.createdAt);
      return {
        job,
        index,
        record,
        recordIndex,
        type: 'regeneration',
        state: {
          key: status,
          label,
          detail: `${formatRegenerationAttempt(record.attempt)} · ${updated ? `更新 ${updated}` : '等待结果'}`
        },
        viewed: index >= 0 ? state.viewedReviewJobs.has(reviewJobViewedKey(item, job)) : true
      };
    });
  const entries = [...regenerationEntries, ...jobEntries];
  const stateRank = entry => entry.state.key === 'pending' ? 0 : entry.state.key === 'failed' ? 1 : 2;
  const counts = entries.reduce((result, entry) => {
    result[entry.state.key] += 1;
    if (!entry.viewed) result.unread += 1;
    return result;
  }, { completed: 0, failed: 0, pending: 0, unread: 0 });
  const activeFilter = ['all', 'unread', 'completed', 'failed', 'pending'].includes(state.reviewLogFilter) ? state.reviewLogFilter : 'all';
  const visible = activeFilter === 'all'
    ? entries.slice().sort((left, right) => stateRank(left) - stateRank(right) || left.index - right.index)
    : activeFilter === 'unread' ? entries.filter(entry => !entry.viewed) : entries.filter(entry => entry.state.key === activeFilter);
  const logs = item.logs?.length
    ? item.logs.map(log => ({ time: log.time || log.Time || '', message: log.message || log.Message || '' }))
    : [{ time: '', message: `${item.status}：${item.name}` }];
  const filterButton = (key, label, count) => `<button type="button" class="review-log-filter${activeFilter === key ? ' active' : ''}" data-review-log-filter="${key}">${label}<b>${count}</b></button>`;
  const jobTimeText = entry => {
    if (entry.type === 'regeneration') return '';
    if (entry.job.regenerating) {
      const updated = formatLocalDateTime(summary.updatedAt || Date.now());
      return updated ? `更新 ${updated}` : '';
    }
    if (entry.job.outputModifiedAt) {
      const completed = formatLocalDateTime(Number(entry.job.outputModifiedAt));
      return completed ? `完成 ${completed}` : '';
    }
    const reviewedAt = entry.job.manualReview?.updatedAt || entry.job.reviewedAt || '';
    if (reviewedAt) {
      const reviewed = formatLocalDateTime(reviewedAt);
      return reviewed ? `确认 ${reviewed}` : '';
    }
    if (running && activeRelativePath && normalizedRelativePath(entry.job.relativePath) === activeRelativePath) {
      const updated = formatLocalDateTime(summary.updatedAt || Date.now());
      return updated ? `更新 ${updated}` : '';
    }
    if ((running || entry.state.key === 'pending') && summary.updatedAt) {
      const updated = formatLocalDateTime(summary.updatedAt);
      return updated ? `更新 ${updated}` : '';
    }
    return '';
  };
  const items = visible.length
    ? visible.map(entry => {
      const timeText = jobTimeText(entry);
      const detail = timeText ? `${entry.state.detail} · ${timeText}` : entry.state.detail;
      const title = entry.type === 'regeneration'
        ? `重新生成 ${entry.job.relativePath} ${formatRegenerationAttempt(entry.record?.attempt)}`
        : entry.job.relativePath;
      const data = entry.index >= 0 ? ` data-review-log-job="${entry.index}"` : '';
      return `<button type="button" class="review-track-item ${entry.type === 'regeneration' ? 'regeneration ' : ''}${entry.state.key} ${entry.viewed ? 'viewed' : 'unread'}"${data} title="跳转到 ${escapeHtml(entry.job.relativePath)}"><i aria-hidden="true"></i><span><b>${escapeHtml(title)}</b><small>${escapeHtml(detail)}</small></span><span class="review-track-badges"><em>${escapeHtml(entry.state.label)}</em><u>${entry.viewed ? '已查看' : '未查看'}</u></span></button>`;
    }).join('')
    : '<div class="review-track-empty">当前筛选没有图片</div>';
  const history = logs.slice().reverse().slice(0, 20).map(log => `<div class="review-log-entry"><span>${escapeHtml(log.time ? new Date(log.time).toLocaleString('zh-CN', { hour12: false }) : '')}</span><div>${escapeHtml(log.message)}</div></div>`).join('');
  const summaryTimes = [
    summary.startedAt ? `开始 ${formatLocalDateTime(summary.startedAt)}` : '',
    summary.completedAt ? `完成 ${formatLocalDateTime(summary.completedAt)}` : '',
    !summary.completedAt && summary.updatedAt ? `更新 ${formatLocalDateTime(summary.updatedAt)}` : ''
  ].filter(Boolean).join(' · ');
  $('#reviewOperationLog').innerHTML = `<div class="review-log-summary"><b>${running ? '当前任务正在处理' : counts.failed ? '当前任务需要处理' : '当前任务处理完成'}</b><span>${summary.current}/${summary.total} 张已处理</span><small>完成 ${counts.completed} · 失败 ${counts.failed} · 待处理 ${counts.pending} · 未查看 ${counts.unread}${summary.billingCostMinor ? ` · 成本 ${formatMoney(summary.billingCostMinor)}` : ''}${summaryTimes ? ` · ${escapeHtml(summaryTimes)}` : ''}</small></div><div class="review-log-filters">${filterButton('all', '当前任务全部', entries.length)}${filterButton('unread', '未查看', counts.unread)}${filterButton('completed', '完成', counts.completed)}${filterButton('failed', '失败', counts.failed)}${filterButton('pending', '待处理', counts.pending)}</div><div class="review-track-list">${items}</div><details class="review-log-history"><summary>查看当前任务记录</summary>${history}</details>`;
}

function renderEmptyReviewTrackingLog() {
  const log = $('#reviewOperationLog');
  if (!log) return;
  state.reviewLogFilter = 'all';
  log.innerHTML = '<div class="review-track-empty">请先点击左侧任务卡片</div>';
}

async function loadReviews({ silent = false } = {}) {
  if (!silent) $('#reviewList').innerHTML = '<div class="empty-inline">正在读取结果…</div>';
  try {
    state.reviews = await window.caishen.listReviews();
    if (state.reviewTaskActivated && state.activeReview) {
      state.activeReview = state.reviews.find(item => item.folder === state.activeReview.folder) || null;
    }
    state.selectedReviewFolders = new Set([...state.selectedReviewFolders].filter(folder => state.reviews.some(item => item.folder === folder)));
    const visible = visibleReviewEntries();
    if (!state.reviewTaskActivated || !visible.some(({ item }) => item.folder === state.activeReview?.folder)) {
      state.activeReview = null;
      state.reviewTaskActivated = false;
    }
    renderReviewList();
    if (silent) renderReviewStagePreservingScroll();
    else renderReviewStage();
    renderReviewGenerationControls();
    scheduleReviewRefresh();
  } catch (error) {
    toast(errorText(error), true);
    renderReviewGenerationControls();
    scheduleReviewRefresh();
  }
}

function visibleReviewEntries() {
  const query = ($('#reviewSearch')?.value || '').trim().toLocaleLowerCase('zh-CN');
  const filter = $('#reviewFilter')?.value || '全部图片';
  return state.reviews.map((item, index) => ({ item, index })).filter(({ item }) => {
    if (query && !item.name.toLocaleLowerCase('zh-CN').includes(query)) return false;
    const jobs = item.jobs || [];
    const reviewableJobs = jobs.filter(job => job.status !== '已跳过');
    const fullyApproved = reviewableJobs.length > 0 && reviewableJobs.every(job => job.status === '已通过');
    if (filter === '已通过') return fullyApproved;
    return filter === '全部图片' || item.status === filter || jobs.some(job => job.status === filter);
  });
}

function pendingReviewQueueEntries() {
  const query = ($('#reviewSearch')?.value || '').trim().toLocaleLowerCase('zh-CN');
  const filter = $('#reviewFilter')?.value || '全部图片';
  if (filter !== '全部图片' && filter !== '待生成') return [];
  const grouped = new Map();
  for (const task of state.queue) {
    if (task.generationMode !== 'template_print') continue;
    if (!['排队中', '生成中'].includes(task.status)) continue;
    if (task.result?.folder || task.progress?.folder) continue;
    const key = queueGroupKey(task);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(task);
  }
  return [...grouped.values()].map(tasks => {
    const title = queueGroupTitle(tasks);
    const running = tasks.some(task => task.status === '生成中');
    const selectedCount = tasks.filter(task => task.selected).length;
    const total = Math.max(1, tasks.length);
    const current = tasks.reduce((sum, task) => sum + (Number(task.progress?.current) || 0), 0);
    const progressTotal = tasks.reduce((sum, task) => sum + (Number(task.progress?.total) || 0), 0);
    const percent = progressTotal ? Math.min(100, Math.round(current / progressTotal * 100)) : running ? 5 : 0;
    return { title, running, selectedCount, total, percent };
  }).filter(entry => !query || entry.title.toLocaleLowerCase('zh-CN').includes(query));
}

function renderReviewList() {
  const visible = visibleReviewEntries();
  if (!state.reviewTaskActivated || (state.activeReview && !visible.some(({ item }) => item.folder === state.activeReview.folder))) {
    state.activeReview = null;
    state.reviewTaskActivated = false;
  }
  const pendingQueue = pendingReviewQueueEntries();
  const reviewMarkup = visible.length ? visible.map(({ item, index }) => {
    const summary = reviewGenerationSummary(item);
    const reviewableJobs = (item.jobs || []).filter(job => job.status !== '已跳过');
    const fullyApproved = reviewableJobs.length > 0 && reviewableJobs.every(job => job.status === '已通过');
    const running = ['queued', 'preparing', 'generating', 'auditing', 'running'].includes(summary.phase);
    const detail = running
      ? `处理中 ${summary.current}/${summary.total}`
      : fullyApproved
        ? `已人工筛过 · API ${summary.apiGenerated} · 复制 ${summary.copied} · 跳过 ${summary.skipped}`
        : `API ${summary.apiGenerated} · 复制 ${summary.copied} · 跳过 ${summary.skipped}`;
    const cost = summary.billingCostMinor ? ` · 成本 ${formatMoney(summary.billingCostMinor)}` : '';
    const elapsed = reviewElapsedMs(summary, running);
    const duration = elapsed ? ` · ${running ? '已用时' : '总耗时'} ${formatDurationMs(elapsed)}` : '';
    return `<div class="review-row${state.activeReview?.folder === item.folder ? ' active' : ''}${fullyApproved ? ' approved' : ''}"><input type="checkbox" data-review-select="${index}"${state.selectedReviewFolders.has(item.folder) ? ' checked' : ''}><button class="review-row-main" data-review-index="${index}"><b>${escapeHtml(item.name)}</b><span>${escapeHtml(fullyApproved ? '已人工筛过' : item.status)} · ${summary.total || item.images.length} 张${escapeHtml(duration)}</span><small>${escapeHtml(detail + cost)}</small><progress max="100" value="${Math.max(0, Math.min(100, summary.percent))}"></progress></button></div>`;
  }).join('') : '';
  const pendingMarkup = pendingQueue.length
    ? `<div class="review-queued-section"><span>待启动任务</span>${pendingQueue.map(entry => `<div class="review-row queued"><i aria-hidden="true"></i><div class="review-row-main"><b>${escapeHtml(entry.title)}</b><span>${entry.running ? '正在创建人工筛图任务' : '等待前序任务完成'} · ${entry.total} 张${entry.selectedCount ? ` · 已选 ${entry.selectedCount}` : ''}</span><small>系统会按任务卡片顺序启动，当前任务完成后自动处理。</small><progress max="100" value="${Math.max(0, Math.min(100, entry.percent))}"></progress></div></div>`).join('')}</div>`
    : '';
  $('#reviewList').innerHTML = reviewMarkup || pendingMarkup
    ? `${reviewMarkup}${pendingMarkup}`
    : '<div class="empty-inline">没有匹配的任务</div>';
}

function renderReviewStage() {
  const stage = $('#reviewStage');
  const item = state.activeReview;
  if (!state.reviewTaskActivated || !item) renderEmptyReviewTrackingLog();
  if (!state.reviewTaskActivated || !item) {
    stage.innerHTML = '<div class="empty-state"><b>选择一个任务</b><span>这里会显示任务内的母版和套图结果。</span></div>';
    return;
  }
  const summary = reviewGenerationSummary(item);
  let running = ['queued', 'preparing', 'generating', 'auditing', 'running'].includes(summary.phase);
  const needsAttention = summary.failed > 0 || summary.pending > 0;
  const noApiGeneration = !running && summary.total > 0 && summary.apiGenerated === 0 && (summary.copied > 0 || summary.skipped > 0);
  const jobs = item.jobs || [];
  const activeRegeneratingPath = normalizedRelativePath(summary.activeRelativePath);
  const isReviewJobRegenerating = job => state.regeneratingReviewJobs.has(reviewJobActionKey(item, job))
    || (running && activeRegeneratingPath && normalizedRelativePath(job.relativePath) === activeRegeneratingPath);
  const localRegenerating = jobs.filter(isReviewJobRegenerating).length;
  if (localRegenerating) {
    running = true;
    summary.phase = 'generating';
    summary.pending = Math.max(summary.pending, localRegenerating);
    summary.message = `正在重新生成 ${localRegenerating} 张图片，完成后会自动刷新`;
  }
  const imageMarkup = jobs.length
    ? jobs.map((job, index) => {
      const regenerating = isReviewJobRegenerating(job);
      const action = normalizeTemplateUiAction(job.action);
      const skipped = job.status === '已跳过' || action === 'exclude';
      const copied = !skipped && (job.status === '直接套模板' || action === 'copy_original');
      const resultLabel = job.generationError && !job.outputUrl ? '生成失败' : skipped ? '不输出' : copied ? '保留原图' : job.outputUrl ? '生成结果' : running ? '生成中' : '待生成';
      const displayResultLabel = regenerating ? '重新生成中' : resultLabel;
      const resultPreview = job.outputUrl
        ? `<img loading="lazy" decoding="async" src="${job.outputUrl}" data-preview-src="${job.outputUrl}" alt="${escapeHtml(job.relativePath)} 生成结果">`
        : `<div class="review-compare-placeholder${job.generationError ? ' failed' : running && !skipped ? ' running' : ''}"><span>${escapeHtml(job.generationError ? '生成失败' : skipped ? '按规则不输出' : running ? '正在生成' : '待生成')}</span>${running && !skipped && !job.generationError ? '<i aria-hidden="true"></i>' : ''}</div>`;
      const actions = skipped
        ? `<div class="review-image-actions review-image-skipped"><span>按套图规则不输出，不进入最终图片</span><button class="text-button" data-job-action="configure" data-job-index="${index}">检查规则</button></div>`
        : `<div class="review-image-actions"><button class="secondary" data-job-action="pass" data-job-index="${index}"${!job.outputUrl || regenerating ? ' disabled' : ''}>通过</button><button class="secondary danger-outline" data-job-action="reject" data-job-index="${index}"${!job.outputUrl || regenerating ? ' disabled' : ''}>不通过</button><button class="secondary" data-job-action="${copied ? 'configure' : 'regenerate'}" data-job-index="${index}"${regenerating ? ' disabled' : ''}>${regenerating ? '重新生成中' : copied ? '检查规则' : '重新生成'}</button></div>`;
      return `<figure class="review-image comparison${skipped ? ' skipped' : ''}${copied ? ' copied' : ''}${regenerating ? ' regenerating' : ''}" data-review-job="${index}"><div class="review-image-status"><b>${escapeHtml(job.relativePath)}</b><span>${escapeHtml(regenerating ? '重新生成中' : job.status)}</span></div><div class="review-compare"><div class="review-compare-side"><span>原套图模板</span><div class="review-compare-frame"><img loading="lazy" decoding="async" src="${job.templateUrl}" data-preview-src="${job.templateUrl}" alt="${escapeHtml(job.relativePath)} 原套图模板"></div></div><div class="review-compare-side result"><span>${escapeHtml(displayResultLabel)}</span><div class="review-compare-frame">${resultPreview}</div></div></div><figcaption>${regenerating ? '已提交重新生成，完成后会自动刷新右侧结果' : skipped ? '此图按规则不输出，不进入最终套图' : job.outputUrl ? (copied ? '原图直接复制，未调用 API' : '左侧原模板，右侧本次生成结果') : '生成完成后会在右侧自动显示结果'}</figcaption>${actions}</figure>`;
    }).join('')
    : item.images.map(image => `<figure class="review-image legacy"><img loading="lazy" decoding="async" src="${image.url}" data-preview-src="${image.url}" alt="${escapeHtml(image.name)}"><figcaption>${escapeHtml(image.name)}</figcaption></figure>`).join('');
  const master = item.masterImage ? `<section class="master-review-strip"><img src="${item.masterImage.url}" alt="母版图"><div><b>母版图</b><span>${escapeHtml(item.masterStatus || '母版已生成')}</span>${item.source?.generationMode !== 'template_print' ? '<button class="secondary" id="regenerateMasterButton">重新生成母版图</button>' : ''}</div></section>` : '';
  const progressTitle = running ? '正在处理套图' : needsAttention ? '套图处理完成，但有图片需要处理' : noApiGeneration ? '本任务没有调用生图 API' : '套图已生成，请逐张确认';
  const progressDetail = running
    ? (summary.message || (summary.waitingUpstream
      ? `生图接口等待重试 ${summary.waitingUpstream} 张，已处理 ${summary.current}/${summary.total} 张`
      : `已处理 ${summary.current}/${summary.total} 张，页面会自动刷新`))
    : noApiGeneration
      ? `套图识别规则将 ${summary.copied} 张判定为直接复制，${summary.skipped} 张判定为跳过，所以很快完成。`
      : needsAttention
        ? `失败 ${summary.failed} 张，待处理 ${summary.pending} 张。先处理异常图片，再确认整套。`
        : `共 ${summary.total} 张：API 生成 ${summary.apiGenerated}，直接复制 ${summary.copied}，跳过 ${summary.skipped}。`;
  const elapsed = reviewElapsedMs(summary, running);
  const durationMetric = elapsed ? `<span><i class="pending"></i>${running ? '已用时' : '总耗时'} <b>${formatDurationMs(elapsed)}</b></span>` : '';
  const progressCard = `<section class="review-progress-card${running ? ' running' : needsAttention || noApiGeneration ? ' attention' : ' complete'}"><div class="review-progress-head"><div><span>${running ? '生成进度' : '本次处理摘要'}</span><b>${escapeHtml(progressTitle)}</b><p>${escapeHtml(progressDetail)}</p></div><strong>${summary.current}/${summary.total}</strong></div><progress class="review-progress-track" aria-label="套图处理进度" max="${Math.max(1, summary.total)}" value="${Math.max(0, summary.current)}"></progress><div class="review-progress-metrics"><span><i class="api"></i>API 生成 <b>${summary.apiGenerated}</b></span><span><i class="copied"></i>直接复制 <b>${summary.copied}</b></span><span><i class="skipped"></i>跳过 <b>${summary.skipped}</b></span><span><i class="cost"></i>任务成本 <b>${formatMoney(summary.billingCostMinor)}</b></span>${durationMetric}${summary.waitingUpstream ? `<span><i class="waiting"></i>生图接口等待重试 <b>${summary.waitingUpstream}</b></span>` : ''}${summary.failed ? `<span><i class="failed"></i>失败 <b>${summary.failed}</b></span>` : ''}${summary.pending ? `<span><i class="pending"></i>待处理 <b>${summary.pending}</b></span>` : ''}</div>${noApiGeneration ? '<div class="review-progress-guidance"><span>如果原本期望替换印花，说明当前套图识别规则不符合预期。</span><button class="secondary" data-review-configure>返回检查套图规则</button></div>' : ''}</section>`;
  stage.innerHTML = `<div class="review-toolbar"><div><b>${escapeHtml(item.name)}</b><span class="index">${escapeHtml(item.status)}</span></div><div><button class="primary" id="approveReview"${running || needsAttention ? ' disabled' : ''}>确认整套通过</button></div></div>${progressCard}${master}<div class="review-images">${imageMarkup}</div>`;
  renderReviewTrackingLog(item, summary, running);
  stage.querySelectorAll('[data-review-job]').forEach((card, index) => {
    card.addEventListener('click', () => {
      if (!jobs[index]) return;
      markReviewJobViewed(item, jobs[index]);
      renderReviewTrackingLog(item, summary, running);
    });
  });
  stage.querySelectorAll('[data-review-configure]').forEach(button => {
    button.onclick = async () => {
      setPage('tasks');
      await loadTemplatePreparation();
      openTemplateConfig();
    };
  });
  if ($('#regenerateMasterButton')) $('#regenerateMasterButton').onclick = async () => {
    if (!window.confirm('确定重新生成当前母版图吗？')) return;
    try {
      const result = await window.caishen.regenerateMaster(item.folder);
      state.activeReview = result?.folder ? { folder: result.folder } : state.activeReview;
      toast(`母版图已重新生成：${result?.folder?.split('/').pop() || ''}`);
      await loadReviews();
    }
    catch (error) { toast(errorText(error), true); }
  };
  $('#approveReview').onclick = async () => {
    try {
      const result = await window.caishen.approveReview(item.folder);
      toast(result?.approved ? '任务已通过' : (result?.reason || '任务尚未满足通过条件'), !result?.approved);
      await loadReviews();
    } catch (error) { toast(errorText(error), true); }
  };
  stage.querySelectorAll('[data-job-action]').forEach(button => {
    button.onclick = async () => {
      const job = jobs[Number(button.dataset.jobIndex)];
      if (!job) return;
      markReviewJobViewed(item, job);
      renderReviewTrackingLog(item, summary, running);
      button.disabled = true;
      try {
        if (button.dataset.jobAction === 'configure') {
          setPage('tasks');
          await loadTemplatePreparation();
          openTemplateConfig();
          return;
        }
        if (button.dataset.jobAction === 'regenerate') {
          const regenerationOptions = await openReviewRegenerationDialog(item, job);
          if (!regenerationOptions) return;
          const regenExtraInstruction = regenerationOptions.extraInstruction || '';
          const regenIncludePreviousResult = Boolean(regenerationOptions.includePreviousResult);
          const regenReferenceResultRelativePath = regenerationOptions.referenceResultRelativePath || '';
          const reviewRegenerateKey = reviewJobActionKey(item, job);
          const regenerationRecord = createReviewRegenerationRecord(item, job);
          state.regeneratingReviewJobs.add(reviewRegenerateKey);
          renderReviewStagePreservingScroll();
          toast(`已提交重新生成：${job.relativePath} ${formatRegenerationAttempt(regenerationRecord.attempt)}`);
          await window.caishen.regenerateTemplate({ folder: item.folder, relativePath: job.relativePath, extraInstruction: regenExtraInstruction, includePreviousResult: regenIncludePreviousResult, referenceResultRelativePath: regenReferenceResultRelativePath }, progress => {
            if (!state.activeReview || state.activeReview.folder !== item.folder) return;
            updateReviewRegenerationRecord(regenerationRecord, 'running');
            state.activeReview.generationProgress = {
              ...(state.activeReview.generationProgress || {}),
              ...(progress || {}),
              phase: progress?.phase || 'generating',
              pending: Math.max(1, Number(progress?.pending) || 1),
              activeRelativePath: progress?.activeRelativePath || job.relativePath,
              message: progress?.message || `正在重新生成图片：${job.relativePath}`
            };
            renderReviewStagePreservingScroll();
          });
          state.regeneratingReviewJobs.delete(reviewRegenerateKey);
          updateReviewRegenerationRecord(regenerationRecord, 'completed');
          toast(`已重新生成：${job.relativePath}`);
          await loadReviews();
        } else {
          await window.caishen.setReviewStatus({ folder: item.folder, relativePath: job.relativePath, status: button.dataset.jobAction === 'pass' ? '人工通过' : '人工不通过' });
          toast(button.dataset.jobAction === 'pass' ? '已标记通过' : '已标记不通过');
        }
        await loadReviews();
      } catch (error) {
        const record = state.reviewRegenerationRecords.slice().reverse().find(itemRecord => itemRecord.folder === item.folder && normalizedRelativePath(itemRecord.relativePath) === normalizedRelativePath(job.relativePath) && itemRecord.status === 'running');
        updateReviewRegenerationRecord(record, 'failed');
        state.regeneratingReviewJobs.delete(reviewJobActionKey(item, job));
        if (state.activeReview?.folder === item.folder) renderReviewStage();
        toast(errorText(error), true);
      } finally {
        button.disabled = false;
      }
    };
  });
}

async function chooseFreeImage() {
  const image = await window.caishen.chooseImage();
  if (!image) return;
  state.freeSource = image;
  $('#freeSource').innerHTML = `<img src="${image.url}" alt="源图片">`;
}

async function generateFree() {
  if (!state.freeSource) return toast('请先选择源图片', true);
  const prompt = $('#freePrompt').value.trim();
  if (!prompt) return toast('请输入修改要求', true);
  $('#freeGenerateButton').disabled = true;
  $('#freeResult').innerHTML = '<div class="empty-state"><b>正在生成</b><span>请保持页面打开。</span></div>';
  try {
    state.freeResult = await window.caishen.generateFree({ sourcePath: state.freeSource.path, prompt });
    $('#freeResult').innerHTML = `<img src="${state.freeResult.url}" alt="生成结果">`;
    $('#freeResult img').onclick = () => window.caishen.revealFile(state.freeResult.outputPath);
    $('#revealFreeResultButton').disabled = false;
    toast('自由生图完成，点击结果即可下载');
  } catch (error) {
    $('#freeResult').innerHTML = `<div class="empty-state"><b>生成失败</b><span>${escapeHtml(errorText(error))}</span></div>`;
    toast(errorText(error), true);
  } finally {
    $('#freeGenerateButton').disabled = false;
  }
}

async function loadTitleLibrary() {
  try {
    state.titleLibrary = await window.caishen.getTitleLibrary();
    state.requiredTitleRoots = new Set(state.titleLibrary?.requiredRoots || []);
    renderTitleLibrary();
  } catch (error) {
    toast(errorText(error), true);
  }
}

async function loadReadyTitleTasks() {
  const list = $('#readyTitleTaskList');
  if (list) list.innerHTML = '<div class="title-empty-state"><span>02</span><b>正在读取任务</b><p>正在检查人工筛图结果和标题生成条件。</p></div>';
  try {
    state.readyTitleTasks = await window.caishen.listReadyTitleTasks();
    renderReadyTitleTasks();
  } catch (error) {
    state.readyTitleTasks = [];
    if (list) list.innerHTML = `<div class="title-empty-state error"><span>!</span><b>任务读取失败</b><p>${escapeHtml(errorText(error))}</p></div>`;
    $('#readyTitleTaskSummary').textContent = '读取失败';
  }
}

async function loadTitlePage() {
  await Promise.all([loadTitleLibrary(), loadReadyTitleTasks()]);
}

function renderReadyTitleTasks() {
  const list = $('#readyTitleTaskList');
  if (!list) return;
  $('#readyTitleTaskSummary').textContent = state.readyTitleTasks.length
    ? `${state.readyTitleTasks.length} 个任务已满足标题生成条件`
    : '人工筛图中全部图片通过后会出现在这里';
  list.innerHTML = state.readyTitleTasks.length
    ? state.readyTitleTasks.map((task, index) => `<article class="title-task-card" data-title-task-index="${index}"><div class="title-task-copy"><b>${escapeHtml(task.name)}</b><span>${task.imageCount} 张套图图片已通过；品类：${escapeHtml(task.category)}；${task.libraryAvailable ? `词库 ${task.libraryRecordCount} 条` : '缺少关键词库'}；${task.hasTitle ? '已生成标题.xlsx' : '未生成标题'}</span>${task.firstTitle ? `<strong>${escapeHtml(task.firstTitle)}</strong>` : ''}</div><div class="title-task-actions"><button class="primary" data-title-task-action="generate">${task.hasTitle ? '重新生成标题' : '生成标题'}</button>${task.hasTitle ? '<button class="secondary" data-title-task-action="open-title">下载标题</button>' : ''}<button class="secondary" data-title-task-action="open-folder">查看任务文件</button></div></article>`).join('')
    : '<div class="title-empty-state"><span>02</span><b>暂无可生成标题的任务</b><p>请先在“人工筛图”中完成套图审核；全部图片通过后，任务会自动出现在这里。</p></div>';
}

async function handleReadyTitleTaskAction(event) {
  const button = event.target.closest('[data-title-task-action]');
  const card = event.target.closest('[data-title-task-index]');
  if (!button || !card) return;
  const task = state.readyTitleTasks[Number(card.dataset.titleTaskIndex)];
  if (!task) return;
  if (button.dataset.titleTaskAction === 'open-title') return window.caishen.revealFile(task.titleFile);
  if (button.dataset.titleTaskAction === 'open-folder') return window.caishen.openFolder(task.folder);
  button.disabled = true;
  button.textContent = '生成中…';
  try {
    const result = await window.caishen.generateTitleForTask(task.folder);
    $('#titleLibraryStatus').textContent = `已生成：${result.name}`;
    await loadReadyTitleTasks();
    toast(`已生成 ${result.name}/标题.xlsx`);
  } catch (error) {
    toast(errorText(error), true);
    renderReadyTitleTasks();
  }
}

function renderTitleLibrary() {
  const library = state.titleLibrary;
  if (!library) {
    $('#titlePrefixes').value = '';
    $('#requiredRootPanel').innerHTML = '<span>请先导入关键词表。</span>';
    $('#titleLibraryStatus').textContent = '还没有导入关键词表。';
    return;
  }
  $('#titlePrefixes').value = (library.prefixRoots || []).join(' ');
  $('#requiredRootPanel').innerHTML = library.rootCandidates.length
    ? library.rootCandidates.map(root => `<label class="root-check"><input type="checkbox" data-required-root="${escapeHtml(root)}"${state.requiredTitleRoots.has(root) ? ' checked' : ''}><span>${escapeHtml(root)}</span></label>`).join('')
    : '<span>词库里没有可用词根。</span>';
  $('#titleLibraryStatus').textContent = `当前词库：${library.sourceFileName}，${library.recordCount} 条关键词；开头词根 ${library.prefixRoots?.length || 0} 个；必选词 ${state.requiredTitleRoots.size} 个。`;
}

async function importTitleLibrary() {
  try {
    const library = await window.caishen.importTitleLibrary();
    if (!library) return;
    state.titleLibrary = library;
    state.requiredTitleRoots = new Set(library.requiredRoots || []);
    renderTitleLibrary();
    await loadReadyTitleTasks();
    toast(`已导入 ${library.recordCount} 条关键词`);
  } catch (error) { toast(errorText(error), true); }
}

async function saveTitleSetup(showMessage = true) {
  try {
    state.titleLibrary = await window.caishen.saveTitleSetup({
      prefixes: $('#titlePrefixes').value,
      requiredRoots: [...state.requiredTitleRoots]
    });
    if (showMessage) toast('词根和必选词已保存');
    renderTitleLibrary();
  } catch (error) { toast(errorText(error), true); }
}

async function generateTitles() {
  try {
    const prefixRoots = parseTitlePrefixRoots($('#titlePrefixes').value);
    state.generatedTitles = await window.caishen.generateTitles({
      prefixes: $('#titlePrefixes').value,
      requiredRoots: [...state.requiredTitleRoots],
      count: $('#titleCount').value
    });
    state.generatedTitleCategory = prefixRoots.join('、');
    state.selectedTitleIndexes.clear();
    renderTitleResults();
    toast(`已生成 ${state.generatedTitles.length} 个标题`);
  } catch (error) { toast(errorText(error), true); }
}

function renderTitleResults() {
  const results = $('#titleResults');
  $('#titleActionBar').hidden = state.generatedTitles.length === 0;
  if (!state.generatedTitles.length) {
    results.innerHTML = '<div class="title-empty-state"><span>01</span><b>还没有生成标题</b><p>填写开头词根并选择必选词，然后点击上方“生成标题”。</p></div>';
    $('#titleSummary').textContent = '填写开头词根后点击“生成标题”。';
    return;
  }
  $('#titleSummary').textContent = `${state.generatedTitleCategory}：已生成 ${state.generatedTitles.length} 个标题，已选 ${state.selectedTitleIndexes.size} 个。点击标题会复制并选中；选择后可导出 Excel。`;
  results.innerHTML = state.generatedTitles.map((title, index) => `<div class="title-row${state.selectedTitleIndexes.has(index) ? ' selected' : ''}" data-title-index="${index}"><input class="title-select" type="checkbox"${state.selectedTitleIndexes.has(index) ? ' checked' : ''}><span>${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(title)}</b><span>${title.length}/30</span></div>`).join('');
}

async function exportSelectedTitles() {
  try {
    const titles = [...state.selectedTitleIndexes].sort((a, b) => a - b).map(index => state.generatedTitles[index]);
    const file = await window.caishen.exportTitles({ titles, category: state.generatedTitleCategory });
    if (file) toast(`已导出 ${titles.length} 个标题`);
  } catch (error) { toast(errorText(error), true); }
}

async function loadTaobaoPublishPage() {
  const list = $('#taobaoPublishTaskList');
  if (list) list.innerHTML = '<div class="title-empty-state"><span>淘</span><b>正在读取任务</b><p>正在同步人工筛图已通过任务。</p></div>';
  try {
    const data = await window.caishen.listTaobaoPublishTasks();
    state.taobaoPublishSettings = data.settings || null;
    state.taobaoPublishTasks = data.tasks || [];
    if (!state.activeTaobaoCategoryId) state.activeTaobaoCategoryId = state.taobaoPublishSettings?.categories?.[0]?.id || '';
    if (!state.activeTaobaoPublishTaskId && state.taobaoPublishTasks.length) state.activeTaobaoPublishTaskId = state.taobaoPublishTasks[0].id || state.taobaoPublishTasks[0].folder;
    renderTaobaoPublishPage();
  } catch (error) {
    state.taobaoPublishTasks = [];
    if (list) list.innerHTML = `<div class="title-empty-state error"><span>!</span><b>读取失败</b><p>${escapeHtml(errorText(error))}</p></div>`;
    toast(errorText(error), true);
  }
}

function taobaoStatusClass(status = '') {
  if (status === '已保存草稿') return 'complete';
  if (status === '失败') return 'failed';
  if (['等待插件接收', '插件已接收', '正在打开淘宝页面', '正在填写字段', '正在上传图片', '正在保存草稿'].includes(status)) return 'running';
  return 'idle';
}

function renderTaobaoCategoryList() {
  const list = $('#taobaoCategoryList');
  if (!list) return;
  const categories = state.taobaoPublishSettings?.categories || [];
  list.innerHTML = categories.length
    ? categories.map(category => `<button type="button" class="taobao-category-item${category.id === state.activeTaobaoCategoryId ? ' active' : ''}" data-taobao-category="${escapeHtml(category.id)}"><b>${escapeHtml(category.name)}</b><span>${escapeHtml(category.defaults?.publishUrl ? '已配置发布链接' : '待补发布链接')}</span></button>`).join('')
    : '<div class="empty-inline">暂无类目模板</div>';
}

function activeTaobaoCategory() {
  const categories = state.taobaoPublishSettings?.categories || [];
  return categories.find(category => category.id === state.activeTaobaoCategoryId) || categories[0] || null;
}

function renderTaobaoCategoryEditor() {
  const editor = $('#taobaoCategoryEditor');
  if (!editor) return;
  const category = activeTaobaoCategory();
  if (!category) {
    editor.innerHTML = '<div class="empty-inline">暂无类目模板</div>';
    return;
  }
  const defaults = category.defaults || {};
  editor.innerHTML = `<form class="taobao-template-form" id="taobaoCategoryTemplateForm">
    <b>${escapeHtml(category.name)}模板</b>
    <label>发布链接<input name="publishUrl" value="${escapeHtml(defaults.publishUrl || '')}" placeholder="淘宝后台发布页链接"></label>
    <label>价格<input name="price" value="${escapeHtml(defaults.price || '')}" placeholder="发布价格"></label>
    <label>库存<input name="stock" value="${escapeHtml(defaults.stock || '')}" placeholder="999"></label>
    <label>发货地<input name="shipFrom" value="${escapeHtml(defaults.shipFrom || '')}" placeholder="发货地"></label>
    <label>运费模板<input name="freightTemplate" value="${escapeHtml(defaults.freightTemplate || '')}" placeholder="运费模板名称"></label>
    <label>服务模板<input name="serviceTemplate" value="${escapeHtml(defaults.serviceTemplate || '')}" placeholder="服务模板名称"></label>
    <label>属性 JSON<textarea name="attributes" rows="4" placeholder='{"材质":"实木"}'>${escapeHtml(JSON.stringify(defaults.attributes || {}, null, 2))}</textarea></label>
    <label>选择器 JSON<textarea name="selectors" rows="4" placeholder='{"title":"input[name=title]"}'>${escapeHtml(JSON.stringify(defaults.selectors || {}, null, 2))}</textarea></label>
    <button type="submit" class="primary">保存类目模板</button>
  </form>`;
}

function parseJsonField(value, label) {
  const text = String(value || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be object');
    return parsed;
  } catch {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
}

async function saveActiveTaobaoCategoryTemplate(event) {
  event?.preventDefault();
  const category = activeTaobaoCategory();
  const form = $('#taobaoCategoryTemplateForm');
  if (!category || !form || !state.taobaoPublishSettings) return;
  const data = new FormData(form);
  const categories = (state.taobaoPublishSettings.categories || []).map(item => {
    if (item.id !== category.id) return item;
    return {
      ...item,
      defaults: {
        ...(item.defaults || {}),
        publishUrl: String(data.get('publishUrl') || '').trim(),
        price: String(data.get('price') || '').trim(),
        stock: String(data.get('stock') || '').trim(),
        shipFrom: String(data.get('shipFrom') || '').trim(),
        freightTemplate: String(data.get('freightTemplate') || '').trim(),
        serviceTemplate: String(data.get('serviceTemplate') || '').trim(),
        attributes: parseJsonField(data.get('attributes'), '属性 JSON'),
        selectors: parseJsonField(data.get('selectors'), '选择器 JSON')
      }
    };
  });
  try {
    state.taobaoPublishSettings = await window.caishen.saveTaobaoPublishSettings({
      ...state.taobaoPublishSettings,
      categories
    });
    toast('类目模板已保存');
    renderTaobaoPublishPage();
  } catch (error) {
    toast(errorText(error), true);
  }
}

function renderTaobaoTaskList() {
  const list = $('#taobaoPublishTaskList');
  if (!list) return;
  $('#taobaoPublishSummary').textContent = state.taobaoPublishTasks.length
    ? `${state.taobaoPublishTasks.length} 个任务可发布`
    : '暂无整套通过任务';
  list.innerHTML = state.taobaoPublishTasks.length
    ? state.taobaoPublishTasks.map(task => {
      const active = (task.id || task.folder) === state.activeTaobaoPublishTaskId;
      const statusClass = taobaoStatusClass(task.status);
      return `<article class="taobao-task-card${active ? ' active' : ''}" data-taobao-task="${escapeHtml(task.id || task.folder)}">
        <div><b>${escapeHtml(task.name)}</b><span>${escapeHtml(task.categoryName || '未选择类目')} · ${task.imageCount || 0} 张 · ${task.titleReady ? '标题已就绪' : '缺少标题'}</span></div>
        <em class="${statusClass}">${escapeHtml(task.status || '未配置')}</em>
      </article>`;
    }).join('')
    : '<div class="title-empty-state"><span>淘</span><b>暂无可发布任务</b><p>人工筛图整套通过后会自动同步到这里。</p></div>';
}

function renderTaobaoPublishDiagnostics(task) {
  const taskDetail = task?.detail && typeof task.detail === 'object' ? task.detail : {};
  const hasDetail = Object.keys(taskDetail).length > 0;
  if (!task?.failureReason && !hasDetail) return '';
  const rows = [
    ['当前步骤', taskDetail.step],
    ['页面地址', taskDetail.url],
    ['页面标题', taskDetail.title],
    ['保存确认', taskDetail.confirmation],
    ['保存时间', taskDetail.savedAt]
  ].filter(([, value]) => value != null && String(value).trim());
  const inputs = Array.isArray(taskDetail.fileInputs) ? taskDetail.fileInputs : [];
  const buttons = Array.isArray(taskDetail.visibleButtons) ? taskDetail.visibleButtons : [];
  return `<section class="taobao-diagnostics">
    <div class="taobao-diagnostics-head"><b>插件诊断</b>${hasDetail ? '<button type="button" id="copyTaobaoPublishDiagnosticsButton">复制诊断</button>' : ''}</div>
    ${task.failureReason ? `<p class="taobao-failure">${escapeHtml(task.failureReason)}</p>` : ''}
    ${rows.length ? `<dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>` : ''}
    ${inputs.length ? `<div class="taobao-diagnostics-block"><b>上传控件</b><pre>${escapeHtml(JSON.stringify(inputs, null, 2))}</pre></div>` : ''}
    ${buttons.length ? `<div class="taobao-diagnostics-block"><b>页面按钮</b><pre>${escapeHtml(buttons.join('\n'))}</pre></div>` : ''}
  </section>`;
}

async function copyTaobaoPublishDiagnostics() {
  const task = state.taobaoPublishTasks.find(item => (item.id || item.folder) === state.activeTaobaoPublishTaskId);
  if (!task) return toast('请先选择任务', true);
  await window.caishen.copyText(JSON.stringify({
    id: task.id,
    name: task.name,
    status: task.status,
    failureReason: task.failureReason,
    detail: task.detail || {}
  }, null, 2));
  toast('插件诊断已复制');
}

function renderTaobaoPublishDetail() {
  const detail = $('#taobaoPublishDetail');
  const title = $('#taobaoPublishDetailTitle');
  if (!detail || !title) return;
  const task = state.taobaoPublishTasks.find(item => (item.id || item.folder) === state.activeTaobaoPublishTaskId);
  if (!task) {
    title.textContent = '选择一个任务';
    detail.innerHTML = '<div class="empty-inline">选择左侧任务后查看标题、图片分类和发布状态。</div>';
    return;
  }
  title.textContent = task.name || '发布任务';
  const selectedCategoryId = task.categoryId || state.activeTaobaoCategoryId;
  const categories = state.taobaoPublishSettings?.categories || [];
  detail.innerHTML = `<div class="taobao-package-summary">
    <label>发布类目<select id="taobaoTaskCategorySelect">${categories.map(category => `<option value="${escapeHtml(category.id)}"${category.id === selectedCategoryId ? ' selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></label>
    <dl>
      <div><dt>标题</dt><dd>${escapeHtml(task.title || '未生成标题')}</dd></div>
      <div><dt>主图</dt><dd>${task.mainImageCount || 0} 张</dd></div>
      <div><dt>3:4 主图</dt><dd>${task.ratioImageCount || 0} 张</dd></div>
      <div><dt>详情图</dt><dd>${task.detailImageCount || 0} 张</dd></div>
      <div><dt>状态</dt><dd>${escapeHtml(task.status || '未配置')}</dd></div>
    </dl>
    ${renderTaobaoPublishDiagnostics(task)}
    <div class="taobao-publish-actions"><button class="primary" id="queueTaobaoPublishButton" type="button">发布到淘宝草稿</button><button class="secondary" id="openTaobaoTaskFolderButton" type="button">查看任务文件</button></div>
  </div>`;
}

function renderTaobaoPublishPage() {
  $('#taobaoPublishToken').textContent = state.taobaoPublishSettings?.token || '未生成';
  renderTaobaoCategoryList();
  renderTaobaoCategoryEditor();
  renderTaobaoTaskList();
  renderTaobaoPublishDetail();
}

async function queueActiveTaobaoPublishTask() {
  const task = state.taobaoPublishTasks.find(item => (item.id || item.folder) === state.activeTaobaoPublishTaskId);
  if (!task) return toast('请先选择任务', true);
  const categoryId = $('#taobaoTaskCategorySelect')?.value || state.activeTaobaoCategoryId || task.categoryId;
  try {
    await window.caishen.queueTaobaoPublishTask({ folder: task.folder, categoryId });
    toast('已提交，等待浏览器插件接收');
    await loadTaobaoPublishPage();
  } catch (error) {
    toast(errorText(error), true);
  }
}

const TEMPLATE_ACTIONS = [
  ['replace_print', '换印花'],
  ['copy_original', '保留原图'],
  ['exclude', '不输出'],
  ['manual_check', '人工确认']
];

function templateActionHint(action) {
  action = normalizeTemplateUiAction(action);
  if (action === 'replace_print') return '调用生图 API，用母版商品迁移到当前套图页面。';
  if (action === 'copy_original') return '直接复制原套图，不消耗生图 API。';
  if (action === 'exclude') return '不生成也不复制，最终套图不包含这张图。';
  return '暂不生成，等运营确认动作。';
}

function weakManualTemplateText(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  return ['不确定', '无', '没有', '模板分析失败', '需要人工确认', 'manual', 'uncertain', 'unknown', 'none']
    .some(token => text.includes(token));
}

function applyTemplateActionDefaults(item, card) {
  if (!item || item.action !== 'replace_print') return;
  if (weakManualTemplateText(item.reason)) item.reason = '运营手动确认该图需要替换家具留白面板印花。';
  if (weakManualTemplateText(item.replaceArea)) item.replaceArea = '运营确认的留白家具面板或柜门外表面。';
  if (weakManualTemplateText(item.forbiddenArea)) {
    item.forbiddenArea = '背景、文字、墙面、地面、柜脚、把手、边框、门缝、抽屉内侧、柜门内侧、包装和道具均保持不变。';
  }
  const reason = card.querySelector('[data-template-field="reason"]');
  const replaceArea = card.querySelector('[data-template-field="replaceArea"]');
  const forbiddenArea = card.querySelector('[data-template-field="forbiddenArea"]');
  if (reason) reason.value = item.reason;
  if (replaceArea) replaceArea.value = item.replaceArea;
  if (forbiddenArea) forbiddenArea.value = item.forbiddenArea;
}

async function openTemplateConfig() {
  if (!state.config.detailSetsPath) return toast('请先选择套图文件夹', true);
  setPage('assets');
  await loadAssetLibraryPreview('detailSetsPath');
  toast('请在每张套图下方查看或重新运行 AI 分析');
}

function closeTemplateConfig() {
  state.activeTemplatePath = '';
  $('#templateConfigModal').hidden = true;
}

function activeTemplateItem() {
  return state.templateItems.find(item => item.path === state.activeTemplatePath) || null;
}

function templateDirectoryKey(item) {
  const normalized = String(item?.relativePath || '').replaceAll('\\', '/');
  return normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
}

function templateNameTokens(value) {
  return new Set(String(value || '').toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/).filter(token => token.length >= 2));
}

function templateReferenceCandidates(item) {
  if (!item) return [];
  const activeFolder = templateDirectoryKey(item);
  const activeTokens = templateNameTokens(item.relativePath);
  return state.templateItems
    .filter(candidate => candidate.path !== item.path && normalizeTemplateUiAction(candidate.action) === 'replace_print')
    .map(candidate => {
      const candidateTokens = templateNameTokens(candidate.relativePath);
      let tokenMatches = 0;
      for (const token of activeTokens) if (candidateTokens.has(token)) tokenMatches += 1;
      const sameFolder = templateDirectoryKey(candidate) === activeFolder ? 1 : 0;
      const confidence = Number(candidate.confidence || 0);
      return { candidate, score: sameFolder * 100 + tokenMatches * 8 + confidence };
    })
    .sort((left, right) => right.score - left.score || String(left.candidate.relativePath).localeCompare(String(right.candidate.relativePath), 'zh-CN', { numeric: true }))
    .slice(0, 8)
    .map(entry => entry.candidate);
}

function renderTemplateReferencePanel(item) {
  const candidates = templateReferenceCandidates(item);
  if (!candidates.length) {
    return `<aside class="template-reference-panel"><div class="template-reference-head"><b>参考重析</b><span>暂无可参考的换印花图片。</span></div></aside>`;
  }
  return `<aside class="template-reference-panel">
    <div class="template-reference-head"><b>参考重析</b><span>参考图只帮助 AI 判断动作，不复制区域。</span></div>
    <div class="template-reference-list">
      ${candidates.map(candidate => `<article class="template-reference-card">
        <img src="${escapeHtml(candidate.thumbnailUrl || candidate.previewUrl || candidate.templateUrl)}" alt="${escapeHtml(candidate.relativePath)}">
        <div><b>${escapeHtml(candidate.name)}</b><span>${escapeHtml(candidate.relativePath)}</span><small>${escapeHtml(templateActionHint(candidate.action))}</small></div>
        <button class="secondary" type="button" data-reference-analysis="${escapeHtml(candidate.path)}">参考重析</button>
      </article>`).join('')}
    </div>
  </aside>`;
}

function renderTemplateAnalysisResult() {
  const item = activeTemplateItem();
  const container = $('#templateAnalysisResult');
  if (!item) {
    container.innerHTML = '<div class="empty-state"><b>没有找到这张套图</b><span>请关闭后刷新素材库。</span></div>';
    $('#templateConfigStatus').textContent = '分析结果不存在';
    $('#saveTemplateConfigButton').disabled = true;
    return;
  }
  const itemIndex = state.templateItems.indexOf(item);
  const failed = item.analysisStatus === 'failed';
  const pending = item.analysisPending && !failed;
  $('#templateConfigTitle').textContent = `分析结果 · ${item.name}`;
  $('#templateConfigPath').textContent = item.relativePath;
  $('#templateConfigStatus').textContent = failed
    ? `AI 分析失败：${item.analysisError || '请单独重新运行 AI 分析'}`
    : pending ? '这张图片尚未完成 AI 分析，可以直接修改并保存为人工配置。'
      : `已分析 · 置信度 ${Number(item.confidence || 0).toFixed(2)}`;
  $('#saveTemplateConfigButton').disabled = false;
  container.innerHTML = `<div class="template-result-layout">
    <figure><img src="${escapeHtml(item.previewUrl || item.templateUrl)}" alt="${escapeHtml(item.relativePath)}"><figcaption>${escapeHtml(item.relativePath)}</figcaption></figure>
    <div class="template-result-fields" data-template-index="${itemIndex}">
      <label class="template-result-action"><span>动作</span><select data-template-field="action">${TEMPLATE_ACTIONS.map(([value, label]) => `<option value="${value}"${normalizeTemplateUiAction(item.action) === value ? ' selected' : ''}>${label}</option>`).join('')}</select><small class="template-action-hint">${escapeHtml(templateActionHint(item.action))}</small></label>
      <label><span>图片理解</span><textarea rows="3" data-template-field="reason" placeholder="AI 对画面内容和用途的理解">${escapeHtml(item.reason)}</textarea></label>
      <label><span>生成目标</span><textarea rows="2" data-template-field="replaceArea" placeholder="这张图应如何使用母版商品">${escapeHtml(item.replaceArea)}</textarea></label>
      <label><span>不可修改</span><textarea rows="2" data-template-field="forbiddenArea" placeholder="人物、文字、背景等必须保留的区域">${escapeHtml(item.forbiddenArea)}</textarea></label>
    </div>
  </div>`;
  container.querySelector('.template-result-layout')?.insertAdjacentHTML('beforeend', renderTemplateReferencePanel(item));
}

async function openTemplateAnalysisResult(pathValue) {
  const path = String(pathValue || '');
  if (!path) return;
  if (!state.templateItems.some(item => item.path === path)) {
    await loadAssetLibraryPreview('detailSetsPath', { preserveSelection: true, force: true });
  }
  state.activeTemplatePath = path;
  $('#templateConfigModal').hidden = false;
  renderTemplateAnalysisResult();
}

async function saveTemplateConfig() {
  const item = activeTemplateItem();
  if (!item) return toast('没有可保存的分析结果', true);
  $('#saveTemplateConfigButton').disabled = true;
  try {
    const folder = templateFolderPathForItem(item);
    await window.caishen.saveTemplateConfig({
      folder,
      items: [{
        relativePath: item.relativePath,
        action: normalizeTemplateUiAction(item.action),
        reason: item.reason,
        replaceArea: item.replaceArea,
        forbiddenArea: item.forbiddenArea
      }]
    });
    state.assetPreviewCache.delete('detailSetsPath');
    await loadAssetLibraryPreview('detailSetsPath', { preserveSelection: true, force: true });
    renderTemplateAnalysisResult();
    if (folder === state.config.detailSetsPath) await loadTemplatePreparation();
    $('#templateConfigStatus').textContent = '分析结果已保存';
    toast('分析结果已保存');
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    $('#saveTemplateConfigButton').disabled = false;
  }
}

async function analyzeActiveTemplateWithReference(referencePath) {
  const item = activeTemplateItem();
  const reference = state.templateItems.find(candidate => candidate.path === referencePath);
  if (!item || !reference) return toast('请先选择参考图片。', true);
  if (normalizeTemplateUiAction(reference.action) !== 'replace_print') return toast('参考图必须已经识别为换印花。', true);
  const folder = templateFolderPathForItem(item);
  $('#templateConfigStatus').textContent = `正在参考“${reference.name}”重新分析`;
  state.assetAnalysisProgress.set(item.path, { status: 'running', attempt: 1 });
  renderAssetManagementGrid();
  try {
    await window.caishen.analyzeTemplateItemWithReference({
      folder,
      relativePath: item.relativePath,
      referenceRelativePath: reference.relativePath
    }, progress => {
      const attempt = Number(progress.attempt || 0);
      $('#templateConfigStatus').textContent = attempt
        ? `正在参考“${reference.name}”重新分析 · 第 ${attempt} 次`
        : `正在参考“${reference.name}”重新分析`;
    });
    state.assetPreviewCache.delete('detailSetsPath');
    await loadAssetLibraryPreview('detailSetsPath', { preserveSelection: true, force: true });
    const refreshed = state.templateItems.find(candidate => candidate.relativePath === item.relativePath && templateFolderPathForItem(candidate) === folder);
    if (refreshed) state.activeTemplatePath = refreshed.path;
    renderTemplateAnalysisResult();
    if (folder === state.config.detailSetsPath) await loadTemplatePreparation();
    $('#templateConfigStatus').textContent = '参考重析已完成';
    toast('参考重析已完成');
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    state.assetAnalysisProgress.delete(item.path);
    renderAssetManagementGrid();
    renderAssetSelectionState();
  }
}

async function runAssetTemplateAnalysis(paths) {
  const requested = new Set(paths);
  const selected = state.assetPreviewItems.filter(item => requested.has(item.path) && !state.assetAnalysisProgress.has(item.path));
  if (!selected.length) return toast('请先选择需要 AI 分析的套图', true);
  state.assetAnalysisRunning += 1;
  for (const item of selected) state.assetAnalysisProgress.set(item.path, { status: 'queued', attempt: 0 });
  renderAssetManagementGrid();
  try {
    const groups = new Map();
    for (const item of selected) {
      const folder = templateFolderPathForItem(item);
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder).push(item);
    }
    let finished = 0;
    let failed = 0;
    let maxConcurrency = 0;
    for (const [folder, group] of groups) {
      const byRelative = new Map(group.map(item => [item.relativePath, item.path]));
      const offset = finished;
      const result = await window.caishen.analyzeTemplateItems({
        folder,
        relativePaths: group.map(item => item.relativePath)
      }, progress => {
        const activePath = byRelative.get(progress.relativePath);
        if (activePath) state.assetAnalysisProgress.set(activePath, { status: 'running', attempt: progress.attempt || 0 });
        const completedPath = byRelative.get(progress.completedRelativePath);
        if (completedPath) state.assetAnalysisProgress.set(completedPath, { status: progress.completedStatus || 'success', attempt: 0 });
        if (currentPage === 'assets' && state.assetPreviewKey === 'detailSetsPath') {
          renderAssetManagementGrid();
          $('#assetPreviewSummary').textContent = `AI 分析进度 ${Math.min(selected.length, offset + Number(progress.current || 0))}/${selected.length}${failed + Number(progress.failed || 0) ? ` · 失败 ${failed + Number(progress.failed || 0)}` : ''}`;
        }
      });
      finished += Number(result.completed || group.length);
      failed += Number(result.failed || 0);
      maxConcurrency = Math.max(maxConcurrency, Number(result.concurrency || 0));
    }
    state.assetPreviewCache.delete('detailSetsPath');
    await loadAssetLibraryPreview('detailSetsPath', { preserveSelection: true, force: true });
    await loadTemplatePreparation();
    if (currentPage === 'assets' && state.assetPreviewKey === 'detailSetsPath') $('#assetPreviewSummary').textContent = `共 ${state.assetPreviewItems.length} 张 · 本次完成 ${finished} 张${failed ? `，失败 ${failed} 张` : ''} · 并发最高 ${maxConcurrency}`;
    toast(failed ? `AI 分析完成，${failed} 张失败，可单独重新运行` : `AI 分析完成：${finished} 张`, failed > 0);
  } catch (error) {
    toast(errorText(error), true);
    state.assetPreviewCache.delete('detailSetsPath');
    await loadAssetLibraryPreview('detailSetsPath', { preserveSelection: true, force: true }).catch(() => {});
  } finally {
    for (const item of selected) state.assetAnalysisProgress.delete(item.path);
    state.assetAnalysisRunning = Math.max(0, state.assetAnalysisRunning - 1);
    if (currentPage === 'assets') {
      renderAssetManagementGrid();
      renderAssetSelectionState();
    }
  }
}

function analyzeSelectedTemplateAssets() {
  return runAssetTemplateAnalysis([...state.selectedAssetPaths]);
}

async function runReviewGeneration(onlyMissing, folders) {
  state.stopGenerationRequested = false;
  const targets = Array.isArray(folders)
    ? [...new Set(folders)]
    : state.reviewTaskActivated && state.activeReview ? [state.activeReview.folder] : [];
  if (!targets.length) return toast('请先选择任务', true);
  const now = new Date().toISOString();
  const applyLocalProgress = (folder, update = {}) => {
    const review = state.reviews.find(item => item.folder === folder) || (state.activeReview?.folder === folder ? state.activeReview : null);
    if (!review) return;
    const existing = review.generationProgress || {};
    const total = Math.max(1, Number(update.total) || Number(existing.total) || review.jobs?.length || review.images?.length || 1);
    review.generationProgress = {
      ...existing,
      folder,
      total,
      current: Math.max(0, Number(update.current ?? existing.current) || 0),
      percent: Math.max(0, Math.min(100, Number(update.percent ?? existing.percent) || 0)),
      pending: Math.max(0, Number(update.pending ?? total) || 0),
      phase: update.phase || existing.phase || 'preparing',
      message: normalizeProgressMessage(update.message || existing.message || (onlyMissing ? '正在补生成缺失图片' : '正在重新生成整套图')),
      startedAt: update.startedAt || existing.startedAt || now,
      updatedAt: update.updatedAt || now,
      activeRelativePath: update.activeRelativePath || existing.activeRelativePath || ''
    };
    if (state.activeReview?.folder === folder) state.activeReview = review;
  };
  try {
    applyLocalProgress(targets[0], {
      phase: 'preparing',
      current: 0,
      percent: 0,
      pending: Math.max(1, state.reviews.find(item => item.folder === targets[0])?.jobs?.length || 1),
      message: onlyMissing ? '正在补生成缺失图片，任务已提交' : '正在重新生成整套图，任务已提交'
    });
    renderReviewList();
    renderReviewStagePreservingScroll();
    renderReviewGenerationControls();
    toast(onlyMissing ? '正在生成缺失套图' : '正在重新生成整套图');
    const results = await window.caishen.generateTemplates({ folders: targets, onlyMissing }, (_progress, job) => {
      const progress = _progress || {};
      const folder = progress.folder || targets[0];
      if (folder) {
        applyLocalProgress(folder, {
          ...progress,
          phase: progress.phase || (job?.status === 'queued' ? 'preparing' : 'generating'),
          message: progress.message || (onlyMissing ? '正在补生成缺失图片' : '正在重新生成整套图'),
          updatedAt: progress.updatedAt || new Date().toISOString()
        });
        renderReviewList();
        renderReviewStagePreservingScroll();
      }
      if (job?.id && ['queued', 'running'].includes(job.status)) {
        state.activeReviewGenerationJobId = job.id;
        renderReviewGenerationControls();
      }
    });
    state.activeReviewGenerationJobId = '';
    renderReviewGenerationControls();
    await loadReviews();
    const failures = (results || []).flatMap(result => result?.failures || []);
    if (failures.length) toast(`生成结束，${failures.length} 张失败：${failures[0]}`, true);
    else toast(onlyMissing ? '缺失套图生成完成' : '整套图重新生成完成');
  } catch (error) {
    state.activeReviewGenerationJobId = '';
    renderReviewGenerationControls();
    toast(errorText(error), true);
    await loadReviews();
  }
}

async function openProductProfile() {
  if (!state.config.detailSetsPath) return toast('请先选择套图文件夹', true);
  try {
    const profile = await window.caishen.getProductProfile(state.config.detailSetsPath);
    $('#profileDimensions').value = profile?.dimensions || '';
    $('#profileMaterial').value = profile?.material || '';
    $('#profileNotes').value = profile?.notes || '';
    $('#productProfilePath').textContent = `资料保存在：${state.config.detailSetsPath}/商品资料.json`;
    $('#analyzeProductProfileButton').disabled = !state.selectedProduct?.path;
    $('#productProfileModal').hidden = false;
  } catch (error) { toast(errorText(error), true); }
}

function closeProductProfile() {
  $('#productProfileModal').hidden = true;
}

async function analyzeProductProfileFromSelection() {
  if (!state.selectedProduct?.path) return toast('请先在母版模式选择一张品类图', true);
  $('#analyzeProductProfileButton').disabled = true;
  $('#analyzeProductProfileButton').textContent = '识别中…';
  try {
    const profile = await window.caishen.analyzeProductProfile(state.selectedProduct.path);
    if (profile?.dimensions) $('#profileDimensions').value = profile.dimensions;
    if (profile?.material) $('#profileMaterial').value = profile.material;
    toast(profile?.dimensions || profile?.material ? '商品资料识别完成' : '没有识别到明确尺寸或材质');
  } catch (error) { toast(errorText(error), true); }
  finally {
    $('#analyzeProductProfileButton').disabled = !state.selectedProduct?.path;
    $('#analyzeProductProfileButton').textContent = '从当前品类图 AI 识别';
  }
}

async function saveProductProfile() {
  try {
    await window.caishen.saveProductProfile({
      folder: state.config.detailSetsPath,
      profile: {
        dimensions: $('#profileDimensions').value.trim(),
        material: $('#profileMaterial').value.trim(),
        notes: $('#profileNotes').value.trim()
      }
    });
    closeProductProfile();
    toast('商品资料已保存');
  } catch (error) { toast(errorText(error), true); }
}

function activePrompt() {
  return state.promptSettings?.prompts?.find(item => item.id === state.activePromptId) || null;
}

function renderPromptSettingList() {
  const prompts = state.promptSettings?.prompts || [];
  $('#promptCount').textContent = `${prompts.length} 项`;
  $('#promptSettingList').innerHTML = prompts.length
    ? prompts.map(item => `<button class="prompt-setting-item${item.id === state.activePromptId ? ' active' : ''}" data-prompt-id="${escapeHtml(item.id)}"><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.group)}${item.customized ? '<em class="customized"> · 已修改</em>' : ''}</span></button>`).join('')
    : '<div class="empty-inline">没有可配置的提示词</div>';
}

function renderPromptEditor() {
  const prompt = activePrompt();
  const canEdit = canManagePrompts();
  $('#promptEditor').disabled = !prompt || !canEdit;
  $('#resetCurrentPromptButton').hidden = !canEdit;
  $('#resetAllPromptsButton').hidden = !canEdit;
  $('#resetCurrentPromptButton').disabled = !prompt || !prompt.customized || !canEdit;
  $('#promptEditorTitle').textContent = prompt?.title || '选择一条提示词';
  $('#promptEditorGroup').textContent = prompt?.group || 'PROMPT';
  $('#promptEditorDescription').textContent = prompt?.description || '左侧列出网站当前实际使用的固定提示词。';
  $('#promptEditor').value = prompt?.value || '';
  $('#promptCharacterCount').textContent = `${prompt?.value?.length || 0} 字`;
  const placeholders = prompt?.placeholders || [];
  $('#promptPlaceholderRow').hidden = placeholders.length === 0;
  $('#promptPlaceholderList').innerHTML = placeholders.map(value => `<code class="prompt-placeholder">${escapeHtml(value)}</code>`).join('');
  $('#promptSaveStatus').className = '';
  $('#promptSaveStatus').textContent = prompt
    ? canEdit
      ? (prompt.customized ? '已使用自定义内容' : '当前使用系统默认')
      : '只读查看'
    : '尚未选择';
}

function applyFreePromptDefault() {
  if (state.freePromptDefaultApplied || !state.promptSettings) return;
  const prompt = state.promptSettings.prompts.find(item => item.id === 'freeImageDefault');
  if (prompt?.value && !$('#freePrompt').value) $('#freePrompt').value = prompt.value;
  state.freePromptDefaultApplied = true;
}

async function loadPromptSettings() {
  if (!canViewPrompts()) return;
  try {
    state.promptSettings = await window.caishen.getPromptSettings();
    if (!state.activePromptId || !state.promptSettings.prompts.some(item => item.id === state.activePromptId)) {
      state.activePromptId = state.promptSettings.prompts[0]?.id || '';
    }
    renderPromptSettingList();
    renderPromptEditor();
    applyFreePromptDefault();
  } catch (error) {
    $('#promptSettingList').innerHTML = `<div class="empty-inline">${escapeHtml(errorText(error))}</div>`;
    toast(errorText(error), true);
  }
}

function selectPromptSetting(id) {
  if (!state.promptSettings?.prompts.some(item => item.id === id)) return;
  state.activePromptId = id;
  renderPromptSettingList();
  renderPromptEditor();
}

function schedulePromptSave(prompt, value) {
  if (!canManagePrompts()) {
    renderPromptEditor();
    return;
  }
  const previousValue = prompt.value;
  prompt.value = value;
  prompt.customized = true;
  if (prompt.id === 'freeImageDefault' && (!$('#freePrompt').value || $('#freePrompt').value === previousValue)) {
    $('#freePrompt').value = value;
  }
  $('#promptCharacterCount').textContent = `${value.length} 字`;
  $('#promptSaveStatus').className = 'saving';
  $('#promptSaveStatus').textContent = '等待自动保存…';
  renderPromptSettingList();
  clearTimeout(promptSaveTimers.get(prompt.id));
  promptSaveTimers.set(prompt.id, setTimeout(async () => {
    promptSaveTimers.delete(prompt.id);
    if (state.activePromptId === prompt.id) {
      $('#promptSaveStatus').className = 'saving';
      $('#promptSaveStatus').textContent = '正在保存…';
    }
    try {
      await window.caishen.savePromptSetting(prompt.id, value);
      if (state.activePromptId === prompt.id && activePrompt()?.value === value) {
        $('#promptSaveStatus').className = 'saved';
        $('#promptSaveStatus').textContent = '已自动保存 · 新任务立即生效';
        $('#resetCurrentPromptButton').disabled = false;
      }
    } catch (error) {
      if (state.activePromptId === prompt.id) {
        $('#promptSaveStatus').className = 'error';
        $('#promptSaveStatus').textContent = `保存失败：${errorText(error)}`;
      }
    }
  }, 650));
}

async function resetCurrentPrompt() {
  if (!canManagePrompts()) return toast('只有超级管理员可以修改提示词', true);
  const prompt = activePrompt();
  if (!prompt || !window.confirm(`确定将“${prompt.title}”恢复为系统默认吗？`)) return;
  clearTimeout(promptSaveTimers.get(prompt.id));
  promptSaveTimers.delete(prompt.id);
  try {
    state.promptSettings = await window.caishen.resetPromptSetting(prompt.id);
    renderPromptSettingList();
    renderPromptEditor();
    toast('已恢复系统默认提示词');
  } catch (error) { toast(errorText(error), true); }
}

async function resetAllPrompts() {
  if (!canManagePrompts()) return toast('只有超级管理员可以修改提示词', true);
  if (!window.confirm('确定将全部提示词恢复为系统默认吗？当前自定义内容会被清除。')) return;
  for (const timer of promptSaveTimers.values()) clearTimeout(timer);
  promptSaveTimers.clear();
  try {
    state.promptSettings = await window.caishen.resetPromptSetting('');
    state.activePromptId = state.promptSettings.prompts[0]?.id || '';
    renderPromptSettingList();
    renderPromptEditor();
    toast('全部提示词已恢复默认');
  } catch (error) { toast(errorText(error), true); }
}

function renderSettingsTabs(name = state.settingsTab) {
  if (state.currentUser?.role === 'admin' && name === 'general') name = 'api';
  else if (name === 'api' && !isTeamAdmin()) name = 'general';
  else if (name === 'billing' && !isSuperAdmin()) name = 'general';
  else if (name === 'team' && !isTeamAdmin()) name = 'general';
  state.settingsTab = name;
  $$('[data-settings-tab]').forEach(button => {
    const active = button.dataset.settingsTab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('[data-settings-panel]').forEach(panel => {
    panel.hidden = panel.dataset.settingsPanel !== name;
  });
  $('.settings-toolbar-actions').hidden = ['billing', 'team'].includes(name) || !isSuperAdmin();
  if (name === 'api' && isTeamAdmin()) {
    if (!isSuperAdmin()) renderApiSettings();
    loadModelPackageSettings();
  }
  if (name === 'team') loadTeamUsers();
  if (name === 'billing') loadBillingAdmin();
}

function renderBillingAdmin() {
  const data = state.billingAdmin;
  if (!data) return;
  const rules = data.rules || {};
  const users = data.users || [];
  if (state.billingAdminFilter && !users.some(user => user.id === state.billingAdminFilter)) state.billingAdminFilter = '';
  const filteredUsers = state.billingAdminFilter ? users.filter(user => user.id === state.billingAdminFilter) : users;
  const visibleWorkspaceIds = new Set(filteredUsers.map(user => user.workspaceId));
  const filteredTransactions = state.billingAdminFilter
    ? (data.transactions || []).filter(entry => visibleWorkspaceIds.has(entry.workspaceId))
    : (data.transactions || []);
  $('.billing-settings-grid').hidden = false;
  $('.billing-rule-card').hidden = !isSuperAdmin();
  $('#clearBillingLedgerButton').hidden = !isSuperAdmin();
  $('#billingEnabled').checked = rules.enabled === true;
  $('#billingImageFeeMin').value = moneyMinorToInput(rules.imageFeeMinMinor || 0);
  $('#billingImageFeeMax').value = moneyMinorToInput(rules.imageFeeMaxMinor || rules.imageFeeMinor || 0);
  $('#billingLlmFeeMin').value = moneyMinorToInput(rules.llmFeeMinMinor || 0);
  $('#billingLlmFeeMax').value = moneyMinorToInput(rules.llmFeeMaxMinor || rules.llmFeeMinor || 0);
  $('#billingDefaultBalance').value = moneyMinorToInput(rules.defaultBalanceMinor || 0);
  $('#billingStatusBadge').textContent = isSuperAdmin() ? (rules.enabled ? '计费中' : '未启用') : '余额查看';
  $('#billingStatusBadge').classList.toggle('ready', Boolean(rules.enabled));
  $('#billingUserFilter').innerHTML = `<option value="">全部人员</option>${users.map(user => `<option value="${escapeHtml(user.id)}"${user.id === state.billingAdminFilter ? ' selected' : ''}>${escapeHtml(user.displayName || user.username)} · ${roleLabel(user.role)}</option>`).join('')}`;
  $('#billingAccountCount').textContent = state.billingAdminFilter ? `${filteredUsers.length}/${users.length} 个账号` : `${users.length} 个账号`;
  $('#billingAccountList').innerHTML = filteredUsers.map(user => {
    const canAdjust = isSuperAdmin() || (state.currentUser?.role === 'admin' && user.role === 'member' && (!user.parentUserId || user.parentUserId === state.currentUser.id));
    return `
    <div class="billing-account-row" data-billing-user="${escapeHtml(user.id)}">
      <div class="billing-account-copy"><b>${escapeHtml(user.displayName || user.username)}${user.id === state.currentUser?.id ? '（当前）' : ''}</b><span>${escapeHtml(user.username)} · ${roleLabel(user.role)}${user.active ? '' : ' · 已停用'}</span></div>
      <div class="billing-account-balance">${formatMoney(user.billing?.balanceMinor)}</div>
      ${canAdjust ? `<div class="billing-adjust-controls"><input type="number" step="0.01" min="-${moneyMinorToInput(user.billing?.balanceMinor)}" placeholder="在此输入划拨金额" aria-label="调整金额"><button class="secondary" type="button" data-adjust-billing="${escapeHtml(user.id)}">确认调整</button></div>` : '<div class="billing-adjust-note">仅查看</div>'}
    </div>`;
  }).join('') || '<div class="empty-inline">没有符合筛选的账号</div>';
  const userMap = new Map(users.map(user => [user.workspaceId, user]));
  $('#billingLedgerList').innerHTML = renderBillingLedger(filteredTransactions, userMap);
}

async function loadBillingAdmin() {
  if (!isTeamAdmin()) return;
  try {
    state.billingAdmin = await window.caishen.getBillingAdmin();
    renderBillingAdmin();
  } catch (error) { toast(errorText(error), true); }
}

async function saveBillingRules() {
  if (!isSuperAdmin()) return toast('只有超级管理员可以修改计费规则', true);
  const button = $('#saveBillingRulesButton');
  button.disabled = true;
  button.textContent = '保存中…';
  try {
    await window.caishen.saveBillingRules({
      enabled: $('#billingEnabled').checked,
      imageFeeMinMinor: moneyInputToMinor($('#billingImageFeeMin').value, '成功生图最低扣费'),
      imageFeeMaxMinor: moneyInputToMinor($('#billingImageFeeMax').value, '成功生图最高扣费'),
      llmFeeMinMinor: moneyInputToMinor($('#billingLlmFeeMin').value, '语言模型最低扣费'),
      llmFeeMaxMinor: moneyInputToMinor($('#billingLlmFeeMax').value, '语言模型最高扣费'),
      defaultBalanceMinor: moneyInputToMinor($('#billingDefaultBalance').value, '初始算力余额')
    });
    await Promise.all([loadBillingAdmin(), loadBillingSummary()]);
    toast('计费规则已保存');
  } catch (error) { toast(errorText(error), true); }
  finally {
    button.disabled = false;
    button.textContent = '保存计费规则';
  }
}

async function clearBillingLedger() {
  if (!isSuperAdmin()) return toast('只有超级管理员可以清空费用流水', true);
  if (!window.confirm('确定清空全部费用流水吗？此操作只删除明细记录，不会修改任何账号算力余额。')) return;
  const button = $('#clearBillingLedgerButton');
  button.disabled = true;
  try {
    const result = await window.caishen.clearBillingLedger();
    await Promise.all([loadBillingAdmin(), loadBillingSummary()]);
    toast(`已清空 ${Number(result?.cleared || 0)} 条费用流水`);
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    button.disabled = false;
  }
}

async function adjustBillingBalance(button) {
  const row = button.closest('[data-billing-user]');
  const input = row?.querySelector('input');
  const amount = Number(input?.value);
  if (!Number.isFinite(amount) || amount === 0) return toast('请输入非零调整金额', true);
  if (!isSuperAdmin() && amount <= 0) return toast('管理员只能划拨正数算力余额', true);
  const amountMinor = Math.round(amount * BILLING_AMOUNT_SCALE);
  button.disabled = true;
  try {
    await window.caishen.adjustBillingBalance({
      userId: button.dataset.adjustBilling,
      amountMinor,
      amountUsd: amount,
      description: amountMinor > 0 ? '账户充值到账' : '算力余额扣减'
    });
    await Promise.all([loadBillingAdmin(), loadBillingSummary()]);
    toast(amountMinor > 0 ? '算力余额已充值' : '算力余额已扣减');
  } catch (error) {
    button.disabled = false;
    toast(errorText(error), true);
  }
}

function renderTeamUsers() {
  $('#teamUserCount').textContent = `${state.teamUsers.length} 人`;
  $('#teamUserList').innerHTML = state.teamUsers.length ? state.teamUsers.map(user => `
    <div class="team-user-row${user.active ? '' : ' inactive'}" data-team-user="${escapeHtml(user.id)}">
      <div><b>${escapeHtml(user.displayName || user.username)}${user.id === state.currentUser?.id ? '（当前）' : ''}</b><span>${escapeHtml(user.username)} · ${roleLabel(user.role)} · ${user.active ? '可登录' : '已停用'}${user.billing ? ` · 算力余额 ${formatMoney(user.billing.balanceMinor)}` : ''}</span></div>
      <div class="team-user-actions">
        ${user.id === state.currentUser?.id ? '' : `<button class="secondary" type="button" data-team-user-edit="${escapeHtml(user.id)}">编辑</button><button class="secondary${user.active ? ' danger-outline' : ''}" type="button" data-team-user-active="${escapeHtml(user.id)}" data-active="${user.active ? 'false' : 'true'}">${user.active ? '停用' : '恢复'}</button><button class="secondary danger-outline" type="button" data-team-user-delete="${escapeHtml(user.id)}">删除</button>`}
      </div>
      ${state.currentUser?.role === 'admin' && user.role === 'member' ? `<div class="team-transfer-controls"><input type="number" step="0.01" min="0.01" placeholder="划拨金额" aria-label="划拨金额"><button class="secondary" type="button" data-transfer-billing="${escapeHtml(user.id)}">划拨</button></div>` : ''}
    </div>`).join('') : '<div class="empty-inline">还没有团队账号</div>';
}

function normalizeTeamTransferInputs() {
  $$('.team-transfer-controls input').forEach(input => {
    input.step = '0.000001';
    input.min = '0.000001';
    input.placeholder = '在此输入划拨金额';
  });
}

async function loadTeamUsers() {
  if (!isTeamAdmin()) return;
  try {
    const [users, billing] = await Promise.all([window.caishen.listUsers(), window.caishen.getBillingAdmin().catch(() => null)]);
    const byId = new Map((billing?.users || []).map(user => [user.id, user.billing]));
    state.teamUsers = users.map(user => ({ ...user, billing: byId.get(user.id) }));
    renderTeamUsers();
    normalizeTeamTransferInputs();
  } catch (error) { toast(errorText(error), true); }
}

async function createTeamUser(event) {
  event.preventDefault();
  const button = $('#createUserButton');
  button.disabled = true;
  button.textContent = '创建中…';
  try {
    await window.caishen.createUser({
      displayName: $('#newUserDisplayName').value.trim(),
      username: $('#newUsername').value.trim(),
      password: $('#newUserPassword').value,
      role: isSuperAdmin() ? $('#newUserRole').value : 'member'
    });
    $('#createUserForm').reset();
    await loadTeamUsers();
    toast('团队账号已创建');
  } catch (error) { toast(errorText(error), true); }
  finally {
    button.disabled = false;
    button.textContent = '创建账号';
  }
}

async function toggleTeamUser(button) {
  button.disabled = true;
  try {
    await window.caishen.updateUser(button.dataset.teamUserActive, { active: button.dataset.active === 'true' });
    await loadTeamUsers();
  } catch (error) {
    button.disabled = false;
    toast(errorText(error), true);
  }
}

async function editTeamUser(id) {
  const user = state.teamUsers.find(item => item.id === id);
  if (!user) return;
  const displayName = window.prompt('修改姓名或昵称', user.displayName || user.username);
  if (displayName === null) return;
  const password = window.prompt('重置密码（留空表示不修改）', '');
  if (password === null) return;
  let role = user.role;
  if (isSuperAdmin() && user.role !== 'superadmin') {
    const nextRole = window.prompt('账号角色：admin 或 member', user.role);
    if (nextRole === null) return;
    role = String(nextRole).trim();
    if (!['admin', 'member'].includes(role)) return toast('角色只能填写 admin 或 member', true);
  }
  const payload = { displayName: displayName.trim(), role };
  if (password) payload.password = password;
  try {
    await window.caishen.updateUser(id, payload);
    await loadTeamUsers();
    toast('账号已更新');
  } catch (error) {
    toast(errorText(error), true);
  }
}

async function deleteTeamUser(id) {
  const user = state.teamUsers.find(item => item.id === id);
  if (!user || user.id === state.currentUser?.id) return;
  const name = user.displayName || user.username || '该账号';
  if (!window.confirm(`确定删除 ${name}？\n只删除登录账号，不删除素材和历史任务。`)) return;
  try {
    await window.caishen.deleteUser(id);
    await loadTeamUsers();
    toast('账号已删除');
  } catch (error) {
    toast(errorText(error), true);
  }
}

async function transferTeamBalance(button) {
  const row = button.closest('[data-team-user]');
  const input = row?.querySelector('.team-transfer-controls input');
  const amount = Number(input?.value);
  if (!Number.isFinite(amount) || amount <= 0) return toast('请输入大于 0 的划拨金额', true);
  button.disabled = true;
  try {
    await window.caishen.adjustBillingBalance({
      userId: button.dataset.transferBilling,
      amountMinor: Math.round(amount * BILLING_AMOUNT_SCALE),
      amountUsd: amount,
      description: '账户充值到账'
    });
    if (input) input.value = '';
    await Promise.all([loadTeamUsers(), loadBillingSummary()]);
    toast('算力余额已划拨');
  } catch (error) {
    button.disabled = false;
    toast(errorText(error), true);
  }
}

function defaultModelPackages() {
  const baseUrl = state.apiSettings?.baseUrl || '';
  const imageModel = state.apiSettings?.imageModel || 'gpt-image-2';
  const analysisModel = state.apiSettings?.analysisModel || 'gpt-5-3';
  const analysisWireApi = state.apiSettings?.analysisWireApi || 'chat_completions';
  return [
    { id: 'flagship', name: '旗舰版', description: '主推套餐，保持当前100%效率和质量', enabled: true, default: true, recommended: true, apiBaseUrl: baseUrl, modelId: imageModel, analysisApiBaseUrl: baseUrl, analysisModel, analysisWireApi, maxConcurrency: 30, startIntervalMs: 200, promptQuality: 'flagship', promptMode: 'full', userPromptPolicy: 'full', hiddenPrompt: '', analysisPrompt: '', imagePrompt: '', imagePriceMinMinor: 300000, imagePriceMaxMinor: 300000, analysisPriceMinMinor: 0, analysisPriceMaxMinor: 0, enableMasterReference: false, queuePriority: 10 },
    { id: 'fast', name: '快速版', description: '5分钱/张，低价留客，效果质量与标准版一致', enabled: true, default: false, recommended: false, apiBaseUrl: baseUrl, modelId: imageModel, analysisApiBaseUrl: baseUrl, analysisModel, analysisWireApi, maxConcurrency: 2, startIntervalMs: 1200, promptQuality: 'basic', promptMode: 'internal', userPromptPolicy: 'ignore', hiddenPrompt: '', analysisPrompt: '低价基础分析：只做必要判断，不做深度商业优化。', imagePrompt: '低价基础出图：效果目标约为旗舰版 30%，只完成核心生成，不做高级商业质感、复杂光影、材质精修和额外卖点补全。', imagePriceMinMinor: 50000, imagePriceMaxMinor: 50000, analysisPriceMinMinor: 50000, analysisPriceMaxMinor: 50000, queuePriority: 2 },
    { id: 'standard', name: '标准版', description: '7分钱/张，效果质量约为旗舰版30%', enabled: true, default: false, recommended: false, apiBaseUrl: baseUrl, modelId: imageModel, analysisApiBaseUrl: baseUrl, analysisModel, analysisWireApi, maxConcurrency: 3, startIntervalMs: 1000, promptQuality: 'standard', promptMode: 'hybrid', userPromptPolicy: 'partial', hiddenPrompt: '', analysisPrompt: '标准版分析：只保留必要理解和判断，不做旗舰版深度优化。', imagePrompt: '标准版出图：效果目标约为旗舰版 30%，做基础画面整理和必要生成，不做高级商业海报质感、复杂光影、材质精修、精细构图增强和额外卖点补全。', imagePriceMinMinor: 70000, imagePriceMaxMinor: 70000, analysisPriceMinMinor: 70000, analysisPriceMaxMinor: 70000, queuePriority: 5 }
  ];
}

function currentModelPackages() {
  const packages = isSuperAdmin()
    ? (state.apiSettings?.modelPackages || state.modelPackageSettings?.modelPackages || [])
    : (state.modelPackageSettings?.modelPackages || []);
  return Array.isArray(packages) ? packages : [];
}

function renderModelPackages() {
  const list = $('#modelPackageList');
  if (!list) return;
  const packages = currentModelPackages();
  const selected = state.selectedModelPackageId || state.modelPackageSettings?.selectedModelPackageId || packages.find(item => item.default)?.id || packages[0]?.id || '';
  state.selectedModelPackageId = selected;
  const selectedPackage = packages.find(item => item.id === selected);
  const packageStatusText = selectedPackage ? `当前：${selectedPackage.name}` : '未选择';
  const statusBadge = $('#apiStatusBadge');
  const tabStatus = $('#apiTabStatus');
  if (!isSuperAdmin()) {
    if (statusBadge) {
      statusBadge.textContent = packageStatusText;
      statusBadge.classList.toggle('ready', Boolean(selectedPackage));
    }
    if (tabStatus) {
      tabStatus.textContent = selectedPackage ? selectedPackage.name : '未选择';
      tabStatus.classList.toggle('ready', Boolean(selectedPackage));
    }
  }
  if ($('#addModelPackageButton')) $('#addModelPackageButton').hidden = true;
  $('#saveModelPackagesButton').hidden = !isSuperAdmin();
  $('#modelPackageUserActions').hidden = true;
  const packageDescription = $('#modelPackageDescription');
  if (packageDescription) {
    packageDescription.hidden = !isSuperAdmin();
    packageDescription.textContent = isSuperAdmin() ? '配置模型套餐' : '';
  }
  if (!packages.length) {
    list.innerHTML = isSuperAdmin()
      ? '<div class="empty-inline">固定套餐尚未初始化，请保存一次 API 设置。</div>'
      : '<div class="empty-inline">超级管理员还没有启用模型套餐。</div>';
    return;
  }
  if (!isSuperAdmin()) {
    list.innerHTML = packages.map(item => `
      <button class="model-package-choice${item.id === selected ? ' active' : ''}" type="button" data-select-model-package="${escapeHtml(item.id)}">
        <span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description || '可用模型')}</small></span>
        <em>${item.id === selected ? '当前使用' : item.recommended ? '推荐' : '可选'}</em>
      </button>`).join('');
    return;
  }
  list.innerHTML = packages.map((item, index) => `
    <article class="model-package-editor" data-model-package-index="${index}">
      <div class="model-package-editor-head">
        <div><b>${escapeHtml(item.name || `模型 ${index + 1}`)}</b><span>${escapeHtml(item.id || '')}${item.recommended ? ' · 推荐' : ''}${item.default ? ' · 默认' : ''}</span></div>
        <div class="inline-actions"><button class="secondary" type="button" data-select-model-package="${escapeHtml(item.id)}">${item.id === selected ? '当前使用' : '设为当前'}</button></div>
      </div>
      <div class="model-package-form-grid">
        <label>套餐编号<input data-package-field="id" value="${escapeHtml(item.id || '')}" spellcheck="false"></label>
        <label>管理员看到的名称<input data-package-field="name" value="${escapeHtml(item.name || '')}"></label>
        <label>管理员看到的说明<input data-package-field="description" value="${escapeHtml(item.description || '')}"></label>
        <label>生图模型 ID<input data-package-field="modelId" value="${escapeHtml(item.modelId || '')}" spellcheck="false"></label>
        <label>分析模型 ID<input data-package-field="analysisModel" value="${escapeHtml(item.analysisModel || state.apiSettings?.analysisModel || '')}" spellcheck="false"></label>
        <label>分析接口协议<select data-package-field="analysisWireApi"><option value="chat_completions">Chat Completions</option><option value="responses">Responses API</option></select></label>
        <label>生图 API 地址<input data-package-field="apiBaseUrl" value="${escapeHtml(item.apiBaseUrl || '')}" placeholder="${escapeHtml(state.apiSettings?.baseUrl || 'https://api.change2pro.com')}" spellcheck="false"></label>
        <label>生图 API Key<input data-package-field="apiKey" type="password" placeholder="${item.apiKeyConfigured ? `已保存：${escapeHtml(item.apiKeyMasked || '')}` : '留空使用全局 Image2 Key'}" autocomplete="new-password" spellcheck="false"></label>
        <label>分析 API 地址<input data-package-field="analysisApiBaseUrl" value="${escapeHtml(item.analysisApiBaseUrl || '')}" placeholder="${escapeHtml(state.apiSettings?.baseUrl || '留空使用全局地址')}" spellcheck="false"></label>
        <label>分析 API Key<input data-package-field="analysisApiKey" type="password" placeholder="${item.analysisApiKeyConfigured ? `已保存：${escapeHtml(item.analysisApiKeyMasked || '')}` : '留空使用全局分析 Key'}" autocomplete="new-password" spellcheck="false"></label>
        <label>最大并发<input data-package-field="maxConcurrency" type="number" min="1" max="50" step="1" value="${Number(item.maxConcurrency) || 1}"></label>
        <label>启动间隔 ms<input data-package-field="startIntervalMs" type="number" min="0" max="60000" step="100" value="${Number(item.startIntervalMs) || 0}"></label>
        <label>生图最低 / 张<div class="money-input"><span>$</span><input data-package-field="imagePriceMinMinor" type="number" min="0" step="0.000001" value="${moneyMinorToInput(item.imagePriceMinMinor ?? item.imagePriceMinor ?? 0)}"></div></label>
        <label>生图最高 / 张<div class="money-input"><span>$</span><input data-package-field="imagePriceMaxMinor" type="number" min="0" step="0.000001" value="${moneyMinorToInput(item.imagePriceMaxMinor ?? item.imagePriceMinor ?? 0)}"></div></label>
        <label>分析最低 / 次<div class="money-input"><span>$</span><input data-package-field="analysisPriceMinMinor" type="number" min="0" step="0.000001" value="${moneyMinorToInput(item.analysisPriceMinMinor ?? item.analysisPriceMinor ?? 0)}"></div></label>
        <label>分析最高 / 次<div class="money-input"><span>$</span><input data-package-field="analysisPriceMaxMinor" type="number" min="0" step="0.000001" value="${moneyMinorToInput(item.analysisPriceMaxMinor ?? item.analysisPriceMinor ?? 0)}"></div></label>
        <label>内部效果档位<select data-package-field="promptQuality"><option value="basic">低价版效果</option><option value="standard">标准版效果</option><option value="flagship">旗舰版效果</option><option value="custom">自定义效果</option></select></label>
      </div>
      <label class="model-package-prompt">分析内部提示词<textarea data-package-field="analysisPrompt" rows="4" spellcheck="false">${escapeHtml(item.analysisPrompt || '')}</textarea></label>
      <label class="model-package-prompt">生图内部提示词<textarea data-package-field="imagePrompt" rows="4" spellcheck="false">${escapeHtml(item.imagePrompt || item.hiddenPrompt || '')}</textarea></label>
      <div class="model-package-switches"><label><input data-package-field="enabled" type="checkbox"${item.enabled !== false ? ' checked' : ''}> 启用</label><label><input data-package-field="default" type="checkbox"${item.default ? ' checked' : ''}> 默认</label><label><input data-package-field="recommended" type="checkbox"${item.recommended ? ' checked' : ''}> 推荐</label>${item.id === 'flagship' ? `<label><input data-package-field="enableMasterReference" type="checkbox"${item.enableMasterReference ? ' checked' : ''}> 启用母版参考</label>` : ''}</div>
    </article>`).join('');
  packages.forEach((item, index) => {
    const row = list.querySelector(`[data-model-package-index="${index}"]`);
    if (!row) return;
    row.querySelector('[data-package-field="analysisWireApi"]').value = item.analysisWireApi || state.apiSettings?.analysisWireApi || 'chat_completions';
    row.querySelector('[data-package-field="promptQuality"]').value = item.promptQuality || 'standard';
  });
}

function collectModelPackagesFromForm() {
  return $$('.model-package-editor').map((row, index) => {
    const read = field => row.querySelector(`[data-package-field="${field}"]`);
    return {
      id: read('id')?.value.trim() || `model-${index + 1}`,
      name: read('name')?.value.trim() || `模型 ${index + 1}`,
      description: read('description')?.value.trim() || '',
      modelId: read('modelId')?.value.trim() || state.apiSettings?.imageModel || 'gpt-image-2',
      apiBaseUrl: read('apiBaseUrl')?.value.trim() || state.apiSettings?.baseUrl || '',
      apiKey: read('apiKey')?.value.trim() || '',
      analysisApiBaseUrl: read('analysisApiBaseUrl')?.value.trim() || state.apiSettings?.baseUrl || '',
      analysisApiKey: read('analysisApiKey')?.value.trim() || '',
      analysisModel: read('analysisModel')?.value.trim() || state.apiSettings?.analysisModel || 'gpt-5-3',
      analysisWireApi: read('analysisWireApi')?.value || state.apiSettings?.analysisWireApi || 'chat_completions',
      maxConcurrency: Number(read('maxConcurrency')?.value) || 1,
      startIntervalMs: Number(read('startIntervalMs')?.value) || 0,
      imagePriceMinMinor: moneyInputToMinor(read('imagePriceMinMinor')?.value || '0', '模型生图最低价格'),
      imagePriceMaxMinor: moneyInputToMinor(read('imagePriceMaxMinor')?.value || '0', '模型生图最高价格'),
      analysisPriceMinMinor: moneyInputToMinor(read('analysisPriceMinMinor')?.value || '0', '模型分析最低价格'),
      analysisPriceMaxMinor: moneyInputToMinor(read('analysisPriceMaxMinor')?.value || '0', '模型分析最高价格'),
      promptQuality: read('promptQuality')?.value || 'standard',
      promptMode: read('promptQuality')?.value === 'flagship' ? 'full' : 'internal',
      userPromptPolicy: read('promptQuality')?.value === 'flagship' ? 'full' : 'ignore',
      queuePriority: read('promptQuality')?.value === 'flagship' ? 10 : read('promptQuality')?.value === 'standard' ? 5 : 2,
      hiddenPrompt: '',
      analysisPrompt: read('analysisPrompt')?.value || '',
      imagePrompt: read('imagePrompt')?.value || '',
      enableMasterReference: read('enableMasterReference')?.checked === true,
      enabled: read('enabled')?.checked !== false,
      default: read('default')?.checked === true,
      recommended: read('recommended')?.checked === true
    };
  });
}

async function loadModelPackageSettings() {
  if (!isTeamAdmin()) return;
  try {
    state.modelPackageSettings = await window.caishen.getModelPackages();
    state.selectedModelPackageId = state.modelPackageSettings?.selectedModelPackageId || '';
    state.allowAdminPromptView = state.modelPackageSettings?.allowAdminPromptView === true;
    $('#promptSettingsNav').hidden = !canViewPrompts();
    if (isSuperAdmin()) renderModelPackages();
    else renderApiSettings();
  } catch (error) {
    toast(`读取模型失败：${errorText(error)}`, true);
  }
}

async function saveSelectedModelPackage() {
  if (!isTeamAdmin() || !state.selectedModelPackageId) return;
  try {
    state.modelPackageSettings = await window.caishen.saveSelectedModelPackage(state.selectedModelPackageId);
    renderModelPackages();
    toast('模型已切换');
  } catch (error) {
    toast(errorText(error), true);
  }
}

function addDefaultModelPackages() {
  if (!isSuperAdmin()) return;
  const packages = currentModelPackages();
  state.apiSettings = { ...(state.apiSettings || {}), modelPackages: packages.length ? [...packages, defaultModelPackages()[Math.min(packages.length, 2)]] : defaultModelPackages() };
  renderModelPackages();
}

async function saveModelPackages() {
  if (!isSuperAdmin()) return;
  const button = $('#saveModelPackagesButton');
  button.disabled = true;
  try {
    state.apiSettings = await window.caishen.saveApiSettings(apiSettingsPayload());
    state.modelPackageSettings = await window.caishen.getModelPackages();
    state.selectedModelPackageId = state.modelPackageSettings?.selectedModelPackageId || '';
    renderApiSettings();
    toast('模型套餐已保存');
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    button.disabled = false;
  }
}

function renderApiSettings() {
  const settings = state.apiSettings || {};
  const superAdmin = isSuperAdmin();
  const heading = $('.api-panel-head h2');
  const description = $('.api-panel-head p');
  const footnote = $('#apiSettingsFootnote span');
  const footnoteRow = $('#apiSettingsFootnote');
  if (!superAdmin) {
    if (heading) heading.textContent = '模型选择';
    if (description) {
      description.textContent = '';
      description.hidden = true;
    }
    if (footnoteRow) footnoteRow.hidden = true;
    $('.api-layout-grid').hidden = true;
    $('.api-advanced-settings').hidden = true;
    $('#modelPackageCard').hidden = false;
    renderModelPackages();
    return;
  }
  if (heading) heading.textContent = 'API 设置';
  if (description) {
    description.hidden = false;
    description.textContent = '配置连接、分配模型和图片输出规则。';
  }
  if (footnoteRow) footnoteRow.hidden = false;
  if (footnote) footnote.textContent = 'API 地址、模型和密钥修改后，后续新任务立即使用新配置。';
  $('.api-layout-grid').hidden = false;
  $('.api-advanced-settings').hidden = false;
  $('#modelPackageCard').hidden = false;
  $('#apiBaseUrl').value = settings.baseUrl || '';
  for (const channel of ['analysis', 'image']) {
    const input = $(`#${channel}ApiKey`);
    const configured = settings[`${channel}KeyConfigured`];
    input.value = '';
    input.type = 'password';
    input.placeholder = configured
      ? '留空则继续使用已保存密钥'
      : channel === 'analysis' ? '输入文字模型分组密钥' : '输入 Image2 分组密钥';
    $(`#${channel}ApiKeyHint`).textContent = configured
      ? `已安全保存：${settings[`${channel}KeyMasked`] || '已配置'}`
      : channel === 'analysis' ? '尚未保存文字密钥' : '尚未保存图片密钥';
  }
  $$('[data-toggle-secret]').forEach(button => { button.textContent = '显示'; });
  $('#imageModel').value = settings.imageModel || 'gpt-image-2';
  $('#analysisModel').value = settings.analysisModel || 'gpt-5-3';
  $('#analysisWireApi').value = settings.analysisWireApi || 'chat_completions';
  $('#apiResponseFormat').value = settings.responseFormat || 'url';
  $('#apiRequestTimeout').value = String(settings.requestTimeoutSeconds || 300);
  $('#imageInitialConcurrency').value = String(settings.imageInitialConcurrency || 8);
  $('#imageMaxConcurrency').value = String(settings.imageMaxConcurrency || 30);
  $('#imageStartIntervalMs').value = String(settings.imageStartIntervalMs ?? 500);
  $('#allowAdminPromptView').checked = settings.allowAdminPromptView === true;
  $('#imageSize').value = state.config?.imageSize || '1024x1024';
  $('#imageQuality').value = state.config?.imageQuality || 'auto';

  const statusText = settings.imageConfigured && settings.analysisConfigured
    ? '全部已配置'
    : settings.imageConfigured
      ? '仅 Image2 已配置'
      : settings.analysisConfigured
        ? '仅文字分析已配置'
        : '未配置';
  const statusBadge = $('#apiStatusBadge');
  statusBadge.textContent = statusText;
  statusBadge.classList.toggle('ready', Boolean(settings.imageConfigured || settings.analysisConfigured));
  const tabStatus = $('#apiTabStatus');
  tabStatus.textContent = statusText;
  tabStatus.classList.toggle('ready', Boolean(settings.imageConfigured || settings.analysisConfigured));
  renderModelPackages();
  renderApiModelList();
}

function apiModelMeta(model) {
  const parts = [model.object || 'model'];
  if (model.ownedBy) parts.push(model.ownedBy);
  if (model.created) {
    const milliseconds = model.created > 1e12 ? model.created : model.created * 1000;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) parts.push(date.toLocaleDateString('zh-CN'));
  }
  return parts.join(' · ');
}

function renderApiModelList() {
  const channel = state.apiModelChannel === 'analysis' ? 'analysis' : 'image';
  const models = channel === 'analysis' ? state.analysisApiModels : state.imageApiModels;
  const browser = $('#apiModelBrowser');
  browser.hidden = models.length === 0;
  $('#openAnalysisModelsButton').hidden = state.analysisApiModels.length === 0;
  $('#openImageModelsButton').hidden = state.imageApiModels.length === 0;
  $('#analysisModelOptions').innerHTML = state.analysisApiModels.map(model => `<option value="${escapeHtml(model.id)}"></option>`).join('');
  $('#imageModelOptions').innerHTML = state.imageApiModels.map(model => `<option value="${escapeHtml(model.id)}"></option>`).join('');
  if (!models.length) return;
  if (!models.some(model => model.id === state.selectedApiModelId)) {
    const configuredModel = channel === 'analysis' ? state.apiSettings?.analysisModel : state.apiSettings?.imageModel;
    const configured = models.find(model => model.id === configuredModel);
    state.selectedApiModelId = configured?.id || models[0].id;
  }
  const query = $('#apiModelSearch').value.trim().toLocaleLowerCase('zh-CN');
  const visibleModels = query
    ? models.filter(model => `${model.id} ${model.object} ${model.ownedBy}`.toLocaleLowerCase('zh-CN').includes(query))
    : models;
  $('#apiModelCount').textContent = query ? `${visibleModels.length} / ${models.length}` : `${models.length} 个`;
  $('#apiModelList').innerHTML = visibleModels.length ? visibleModels.map(model => `
    <button class="api-model-option${model.id === state.selectedApiModelId ? ' active' : ''}" type="button" data-api-model="${escapeHtml(model.id)}">
      <span><b>${escapeHtml(model.id)}</b><small>${escapeHtml(apiModelMeta(model))}</small></span><em>${model.id === state.selectedApiModelId ? '已选择' : '选择'}</em>
    </button>`).join('') : '<div class="empty-inline">没有匹配的模型</div>';
  $('#selectedApiModel').textContent = `当前选择：${state.selectedApiModelId}`;
  $('#applyApiModelButton').disabled = !state.selectedApiModelId;
}

function openApiModelModal(channel = 'image') {
  state.apiModelChannel = channel === 'analysis' ? 'analysis' : 'image';
  const models = state.apiModelChannel === 'analysis' ? state.analysisApiModels : state.imageApiModels;
  if (!models.length) return toast(`请先读取${state.apiModelChannel === 'analysis' ? '文字' : '图片'}模型列表`, true);
  state.selectedApiModelId = '';
  $('#apiModelModalTitle').textContent = state.apiModelChannel === 'analysis' ? '选择文字分析模型' : '选择 Image2 模型';
  $('#apiModelModalDescription').textContent = state.apiModelChannel === 'analysis'
    ? '只显示文字分析密钥所属分组返回的模型。'
    : '只显示 Image2 密钥所属分组返回的模型。';
  $('#apiModelModal').hidden = false;
  $('#apiModelSearch').focus();
  renderApiModelList();
}

function closeApiModelModal() {
  $('#apiModelModal').hidden = true;
}

function applySelectedApiModel() {
  if (!state.selectedApiModelId) return toast('请先选择一个模型', true);
  const target = state.apiModelChannel === 'analysis' ? 'analysis' : 'image';
  const label = target === 'image' ? '图片模型' : '分析模型';
  $(target === 'image' ? '#imageModel' : '#analysisModel').value = state.selectedApiModelId;
  closeApiModelModal();
  toast(`已设为${label}，保存设置后生效`);
}

async function loadApiSettings() {
  if (!isSuperAdmin()) return;
  try {
    const [apiSettings, modelPackageSettings] = await Promise.all([
      window.caishen.getApiSettings(),
      window.caishen.getModelPackages().catch(() => null)
    ]);
    state.apiSettings = apiSettings;
    state.allowAdminPromptView = apiSettings.allowAdminPromptView === true;
    state.modelPackageSettings = modelPackageSettings || state.modelPackageSettings;
    if (modelPackageSettings) state.allowAdminPromptView = modelPackageSettings.allowAdminPromptView === true;
    state.selectedModelPackageId = state.modelPackageSettings?.selectedModelPackageId || '';
    $('#promptSettingsNav').hidden = !canViewPrompts();
    renderApiSettings();
  } catch (error) {
    toast(`读取 API 设置失败：${errorText(error)}`, true);
  }
}

function apiSettingsPayload() {
  return {
    baseUrl: $('#apiBaseUrl').value.trim(),
    analysisApiKey: $('#analysisApiKey').value.trim(),
    imageApiKey: $('#imageApiKey').value.trim(),
    imageModel: $('#imageModel').value.trim(),
    analysisModel: $('#analysisModel').value.trim(),
    analysisWireApi: $('#analysisWireApi').value,
    responseFormat: $('#apiResponseFormat').value,
    requestTimeoutSeconds: Number($('#apiRequestTimeout').value),
    imageInitialConcurrency: Number($('#imageInitialConcurrency').value),
    imageMaxConcurrency: Number($('#imageMaxConcurrency').value),
    imageStartIntervalMs: Number($('#imageStartIntervalMs').value),
    allowAdminPromptView: $('#allowAdminPromptView')?.checked === true,
    modelPackages: collectModelPackagesFromForm()
  };
}

async function testApiConnection() {
  const button = $('#testApiButton');
  const row = button.closest('.api-test-row');
  row.classList.remove('success', 'error');
  $('#apiConnectionTitle').textContent = '模型接口检测中…';
  $('#apiConnectionStatus').textContent = '正在请求 GET /v1/models。';
  button.disabled = true;
  button.textContent = '测试中…';
  try {
    const result = await window.caishen.testApiSettings({ ...apiSettingsPayload(), channel: 'image' });
    state.imageApiModels = result.models || [];
    state.apiModelChannel = 'image';
    renderApiModelList();
    row.classList.add('success');
    $('#apiConnectionTitle').textContent = '模型接口正常';
    $('#apiConnectionStatus').textContent = `响应 ${result.latencyMs ?? 0} ms · 已读取 ${result.modelCount || 0} 个模型`;
    toast(result.modelCount ? `已获取 ${result.modelCount} 个模型` : '连接正常，但接口没有返回模型');
    if (result.modelCount) openApiModelModal('image');
  } catch (error) {
    row.classList.add('error');
    $('#apiConnectionTitle').textContent = '模型接口失败';
    $('#apiConnectionStatus').textContent = errorText(error);
    toast(errorText(error), true);
  } finally {
    button.disabled = false;
    button.textContent = '重新测试';
  }
}

async function testAnalysisModelsConnection() {
  const button = $('#testAnalysisModelsButton');
  const row = button.closest('.api-test-row');
  row.classList.remove('success', 'error');
  $('#analysisModelsTitle').textContent = '文字模型读取中…';
  $('#analysisModelsStatus').textContent = '正在使用文字分析密钥请求 GET /v1/models。';
  button.disabled = true;
  button.textContent = '读取中…';
  try {
    const result = await window.caishen.testApiSettings({ ...apiSettingsPayload(), channel: 'analysis' });
    state.analysisApiModels = result.models || [];
    state.apiModelChannel = 'analysis';
    renderApiModelList();
    row.classList.add('success');
    $('#analysisModelsTitle').textContent = '文字模型列表正常';
    $('#analysisModelsStatus').textContent = `响应 ${result.latencyMs ?? 0} ms · 已读取 ${result.modelCount || 0} 个模型`;
    toast(result.modelCount ? `已获取 ${result.modelCount} 个文字模型` : '连接正常，但接口没有返回文字模型');
    if (result.modelCount) openApiModelModal('analysis');
  } catch (error) {
    row.classList.add('error');
    $('#analysisModelsTitle').textContent = '文字模型读取失败';
    $('#analysisModelsStatus').textContent = errorText(error);
    toast(errorText(error), true);
  } finally {
    button.disabled = false;
    button.textContent = '重新读取';
  }
}

async function testAnalysisConnection() {
  const button = $('#testAnalysisApiButton');
  const row = button.closest('.api-test-row');
  row.classList.remove('success', 'error');
  $('#analysisConnectionTitle').textContent = '分析接口检测中…';
  $('#analysisConnectionStatus').textContent = $('#analysisWireApi').value === 'responses'
    ? '正在发送最小 Responses API 请求，不会生成图片。'
    : '正在发送最小 Chat Completions 请求，不会生成图片。';
  button.disabled = true;
  button.textContent = '测试中…';
  try {
    const payload = apiSettingsPayload();
    const models = await window.caishen.testApiSettings({ ...payload, channel: 'analysis' });
    state.analysisApiModels = models.models || [];
    state.apiModelChannel = 'analysis';
    renderApiModelList();
    const result = await window.caishen.testAnalysisApi(payload);
    row.classList.add('success');
    $('#analysisConnectionTitle').textContent = '分析接口正常';
    const protocol = result.wireApi === 'responses' ? 'Responses API' : 'Chat Completions';
    $('#analysisConnectionStatus').textContent = `${protocol} · ${result.model} · 响应 ${result.latencyMs ?? 0} ms${result.responsePreview ? ` · 返回 ${result.responsePreview}` : ''}`;
    toast('分析接口测试成功，套图识别可以使用');
  } catch (error) {
    const message = apiTestErrorText(error);
    row.classList.add('error');
    $('#analysisConnectionTitle').textContent = '分析接口失败';
    $('#analysisConnectionStatus').textContent = message;
    toast(message, true);
  } finally {
    button.disabled = false;
    button.textContent = '重新测试';
  }
}

async function saveSettings() {
  const button = $('#saveSettingsButton');
  button.disabled = true;
  button.textContent = '保存中…';
  try {
    if (state.settingsTab === 'api') {
      if (isSuperAdmin()) {
        state.apiSettings = await window.caishen.saveApiSettings(apiSettingsPayload());
        state.allowAdminPromptView = state.apiSettings.allowAdminPromptView === true;
        state.modelPackageSettings = await window.caishen.getModelPackages().catch(() => state.modelPackageSettings);
        if (state.modelPackageSettings) state.allowAdminPromptView = state.modelPackageSettings.allowAdminPromptView === true;
        state.selectedModelPackageId = state.modelPackageSettings?.selectedModelPackageId || '';
        $('#promptSettingsNav').hidden = !canViewPrompts();
        renderApiSettings();
        toast('API 和模型套餐已保存');
      }
      return;
    }
    state.config.operatorCode = $('#operatorCode').value.trim();
    state.config.outputPath = $('#settingOutputPathInput').value.trim();
    const canSaveSystemSettings = isSuperAdmin();
    if (canSaveSystemSettings) {
      state.config.imageSize = $('#imageSize').value;
      state.config.imageQuality = $('#imageQuality').value;
    }
    const apiPayload = canSaveSystemSettings ? apiSettingsPayload() : {};
    const shouldSaveApi = canSaveSystemSettings && Boolean(
      apiPayload.baseUrl
      || apiPayload.imageApiKey
      || apiPayload.analysisApiKey
      || apiPayload.modelPackages?.length
      || state.apiSettings?.imageKeyConfigured
      || state.apiSettings?.analysisKeyConfigured
    );
    if (shouldSaveApi) {
      state.apiSettings = await window.caishen.saveApiSettings(apiPayload);
      state.allowAdminPromptView = state.apiSettings.allowAdminPromptView === true;
      $('#promptSettingsNav').hidden = !canViewPrompts();
      state.apiConcurrencySettings = {
        imageInitialConcurrency: state.apiSettings.imageInitialConcurrency,
        imageMaxConcurrency: state.apiSettings.imageMaxConcurrency,
        imageStartIntervalMs: state.apiSettings.imageStartIntervalMs
      };
    }
    state.config = await window.caishen.saveConfig(state.config);
    renderConfig();
    if (canSaveSystemSettings) renderApiSettings();
    toast(shouldSaveApi ? '基础设置和 API 设置已保存' : '基础设置已保存');
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    button.disabled = false;
    button.textContent = '保存设置';
  }
}

async function resetSettings() {
  if (!window.confirm('确定重置系统设置吗？已上传的素材和素材映射会保留。')) return;
  const assetSettings = {
    categoriesPath: state.config.categoriesPath,
    printsPath: state.config.printsPath,
    detailSetsPath: state.config.detailSetsPath
  };
  state.config = await window.caishen.resetConfig();
  state.config = await window.caishen.saveConfig({ ...state.config, ...assetSettings });
  renderConfig();
  if (isSuperAdmin()) renderApiSettings();
  toast('基础设置已重置，API 和素材保持不变');
}

function bindEvents() {
  $('#logoutButton').onclick = logout;
  $('#changePasswordButton').onclick = openChangePasswordModal;
  $('#closeChangePasswordButton').onclick = closeChangePasswordModal;
  $('#cancelChangePasswordButton').onclick = closeChangePasswordModal;
  $('#changePasswordForm').onsubmit = submitChangePassword;
  $('#sidebarToggleButton').onclick = () => applySidebarCollapsed(!$('#appShell').classList.contains('sidebar-collapsed'));
  $('.topbar').onclick = event => {
    if ($('#appShell').classList.contains('sidebar-collapsed')) return;
    if (event.target.closest('button, .nav, .sidebar-finance, .brand')) return;
    applySidebarCollapsed(true);
  };
  $('#createUserForm').onsubmit = createTeamUser;
  $('#teamUserList').onclick = event => {
    const button = event.target.closest('[data-team-user-active]');
    if (button) return toggleTeamUser(button);
    const editButton = event.target.closest('[data-team-user-edit]');
    if (editButton) return editTeamUser(editButton.dataset.teamUserEdit);
    const deleteButton = event.target.closest('[data-team-user-delete]');
    if (deleteButton) return deleteTeamUser(deleteButton.dataset.teamUserDelete);
    const transferButton = event.target.closest('[data-transfer-billing]');
    if (transferButton) return transferTeamBalance(transferButton);
  };
  $$('.nav-item').forEach(button => button.onclick = () => setPage(button.dataset.page));
  $$('[data-page-link]').forEach(button => button.onclick = () => setPage(button.dataset.pageLink));
  $$('.template-source-tabs [data-template-source-tab]').forEach(button => button.onclick = () => setTaskSourceTab(button.dataset.templateSourceTab));
  $$('[data-choose]').forEach(button => button.onclick = () => chooseFolder(button.dataset.choose));
  $$('[data-stage-asset]').forEach(button => button.onclick = () => stageAssetFolder(button.dataset.stageAsset));
  $$('[data-sync-asset]').forEach(button => button.onclick = () => syncAssetFolder(button.dataset.syncAsset));
  $$('.asset-preview-tabs [data-asset-preview]').forEach(button => button.onclick = () => loadAssetLibraryPreview(button.dataset.assetPreview));
  $('#templateFolderBrowser').onclick = event => {
    const deleteButton = event.target.closest('[data-delete-template-folder]');
    if (deleteButton) return deleteTemplateFolder(deleteButton.dataset.deleteTemplateFolder);
    const allButton = event.target.closest('[data-template-folder-view="all"]');
    if (allButton) return showAllTemplateFolders().catch(error => toast(errorText(error), true));
    const button = event.target.closest('[data-template-folder]');
    if (button) selectTemplateFolder(button.dataset.templateFolder).catch(error => toast(errorText(error), true));
  };
  $('#changeTaskTemplateFolderButton').onclick = () => openTaskTemplateFolderModal().catch(error => toast(errorText(error), true));
  $('#closeTaskTemplateFolderModalButton').onclick = closeTaskTemplateFolderModal;
  $('#taskTemplateFolderModal').onclick = event => { if (event.target === $('#taskTemplateFolderModal')) closeTaskTemplateFolderModal(); };
  $('#taskTemplateFolderList').onclick = event => {
    const button = event.target.closest('[data-task-template-folder]');
    if (button) chooseTaskTemplateFolder(button.dataset.taskTemplateFolder).catch(error => toast(errorText(error), true));
  };
  $('#openTemplateAssetsButton').onclick = () => {
    closeTaskTemplateFolderModal();
    state.assetPreviewKey = 'detailSetsPath';
    state.templateFolderView = state.config.detailSetsPath || 'all';
    setPage('assets');
  };
  $('#taskTemplatePreview').onclick = event => {
    const toggle = event.target.closest('[data-task-tree-toggle]');
    if (toggle) {
      const key = toggle.dataset.taskTreeToggle;
      if (state.taskTemplateExpandedGroups.has(key)) state.taskTemplateExpandedGroups.delete(key);
      else state.taskTemplateExpandedGroups.add(key);
      return renderTemplateWorkflow();
    }
    const rootButton = event.target.closest('[data-task-tree-select-root]');
    const groupButton = event.target.closest('[data-task-tree-select-group]');
    const imageButton = event.target.closest('[data-task-template-image]');
    let items = [];
    if (rootButton) items = state.taskTemplateItems.filter(item => item.action === 'replace_print' && templateFolderPathForItem(item) === rootButton.dataset.taskTreeSelectRoot);
    else if (groupButton) items = state.taskTemplateItems.filter(item => item.action === 'replace_print' && taskTemplateGroupKey(templateFolderPathForItem(item), taskTemplateGroupName(item)) === groupButton.dataset.taskTreeSelectGroup);
    else if (imageButton) {
      addTemplateMasterReference(state.taskTemplateItems.find(item => item.path === imageButton.dataset.taskTemplateImage));
      return renderTemplateWorkflow();
    }
    if (!items.length) return;
    const allSelected = items.every(item => state.selectedTaskTemplatePaths.has(item.path));
    for (const item of items) {
      if (allSelected) state.selectedTaskTemplatePaths.delete(item.path);
      else state.selectedTaskTemplatePaths.add(item.path);
    }
    renderTemplateWorkflow();
  };
  $('#assetManagementPreviewSize').oninput = event => {
    const size = Math.max(110, Math.min(240, Number(event.target.value) || 138));
    state.assetPreviewSizes[state.assetPreviewKey] = size;
    $('#assetManagementGrid').style.setProperty('--asset-management-card-size', `${size}px`);
    persistAssetPreviewSizes();
  };
  $('#assetTemplateFilter').onclick = event => {
    const button = event.target.closest('[data-asset-template-filter]');
    if (!button) return;
    if (state.assetTemplateFilter === button.dataset.assetTemplateFilter) return;
    state.assetTemplateFilter = button.dataset.assetTemplateFilter;
    renderAssetManagementGrid();
    resetAssetManagementScroll();
  };
  $('#selectAllAssetsButton').onclick = toggleAllVisibleAssets;
  $('#batchAnalyzeAssetsButton').onclick = analyzeSelectedTemplateAssets;
  $('#addAssetFilesButton').onclick = chooseAndAddAssetFiles;
  $('#deleteSelectedAssetsButton').onclick = deleteSelectedAssets;
  $('#assetManagementGrid').onclick = event => {
    const analyzeButton = event.target.closest('[data-template-ai]');
    if (analyzeButton) return runAssetTemplateAnalysis([analyzeButton.dataset.templateAi]);
    const resultButton = event.target.closest('[data-template-result]');
    if (resultButton) return openTemplateAnalysisResult(resultButton.dataset.templateResult);
    const selectButton = event.target.closest('[data-asset-select]');
    const card = event.target.closest('[data-asset-path]');
    if (!selectButton || !card || state.assetUploading) return;
    const assetPath = card.dataset.assetPath;
    if (state.selectedAssetPaths.has(assetPath)) state.selectedAssetPaths.delete(assetPath);
    else state.selectedAssetPaths.add(assetPath);
    renderAssetManagementGrid();
  };
  $('#assetManagementGrid').ondragenter = event => {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
    event.preventDefault();
    $('#assetManagementGrid').classList.add('drag-active');
  };
  $('#assetManagementGrid').ondragover = event => {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  $('#assetManagementGrid').ondragleave = event => {
    if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove('drag-active');
  };
  $('#assetManagementGrid').ondrop = async event => {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-active');
    if (state.assetPreviewKey === 'detailSetsPath' && currentTemplateFolderView() === 'all') return toast('请先选择一个具体套图文件夹，再拖入图片', true);
    try {
      const entries = await window.caishen.filesFromDrop(event.dataTransfer);
      if (!entries.length) return toast('拖入内容中没有支持的图片', true);
      await importAssetEntries(entries);
    } catch (error) { toast(errorText(error), true); }
  };
  $('#addTaskButton').onclick = () => addTask(false);
  $('#selectAllMastersButton').onclick = () => selectAllTemplateMasterCandidates(true);
  $('#clearMasterSelectionButton').onclick = () => selectAllTemplateMasterCandidates(false);
  $('#deleteSelectedMastersButton').onclick = removeSelectedTemplateMasterCandidates;
  $('#generateAllMastersButton').onclick = generateAllTemplateMasterCandidates;
  $('#createTasksFromAllMastersButton').onclick = startTemplateSetsFromAllMasters;
  $('#templateMasterWorkflow').onclick = event => {
    const selectInput = event.target.closest('[data-template-master-select]');
    if (selectInput) {
      const candidate = state.templateMasterCandidates.find(item => item.id === selectInput.dataset.templateMasterSelect);
      if (candidate) {
        candidate.selected = selectInput.checked;
        persistTemplateMasterCandidates();
        renderTemplateWorkflow();
      }
      return;
    }
    const editButton = event.target.closest('[data-template-master-edit]');
    if (editButton) {
      const id = editButton.dataset.templateMasterEdit;
      state.activeTemplateMasterCandidateId = state.activeTemplateMasterCandidateId === id ? '' : id;
      const candidate = state.templateMasterCandidates.find(item => item.id === id);
      if (candidate) candidate.selected = true;
      persistTemplateMasterCandidates();
      renderTemplateWorkflow();
      return;
    }
    const removeButton = event.target.closest('[data-template-master-remove]');
    if (removeButton) return removeTemplateMasterCandidate(removeButton.dataset.templateMasterRemove);
    const generateButton = event.target.closest('[data-template-master-generate]');
    if (generateButton) return generateTemplateMasterCandidate(generateButton.dataset.templateMasterGenerate);
    const createButton = event.target.closest('[data-template-master-create]');
    if (createButton) return startTemplateSetFromMasterCandidate(createButton.dataset.templateMasterCreate);
  };
  $('#clearQueueButton').onclick = () => { state.queue = []; renderQueue(); };
  $('#duplicateQueueButton').onclick = () => {
    const selected = state.queue.filter(task => task.selected);
    if (!selected.length) return toast('请先选择要复制的任务', true);
    let taskNumber = state.queue.reduce((maximum, task) => Math.max(maximum, Number(task.taskNumber) || 0), 0) + 1;
    const duplicatedBatches = new Map();
    for (const task of selected) {
      if (task.batchId && !duplicatedBatches.has(task.batchId)) duplicatedBatches.set(task.batchId, createClientId());
      state.queue.push({
        ...task,
        id: createClientId(),
        batchId: task.batchId ? duplicatedBatches.get(task.batchId) : undefined,
        taskNumber: taskNumber++,
        selected: false,
        status: '未开始',
        error: '',
        result: null,
        progress: null
      });
    }
    renderQueue();
  };
  $('#deleteSelectedQueueButton').onclick = () => { state.queue = state.queue.filter(task => !task.selected); renderQueue(); };
  $('#selectAllQueueButton').onclick = () => { state.queue.forEach(task => { task.selected = true; }); renderQueue(); };
  $('#clearQueueSelectionButton').onclick = () => { state.queue.forEach(task => { task.selected = false; }); renderQueue(); };
  $('#applyTemplateToSelectedQueueButton').onclick = () => applyCurrentTemplateFolderToQueue(true);
  $('#applyTemplateToAllQueueButton').onclick = () => applyCurrentTemplateFolderToQueue(false);
  $('#queueList').onclick = event => {
    const groupToggle = event.target.closest('[data-queue-group-toggle]');
    if (groupToggle) {
      const key = groupToggle.dataset.queueGroupToggle;
      if (state.queueGroupExpanded.has(key)) state.queueGroupExpanded.delete(key);
      else state.queueGroupExpanded.add(key);
      renderQueue();
      return;
    }
    const deleteButton = event.target.closest('[data-queue-delete]');
    if (deleteButton) return deleteQueueTask(Number(deleteButton.dataset.queueDelete));
    const masterButton = event.target.closest('[data-queue-master-index]');
    if (masterButton) return generateQueueTaskMaster(Number(masterButton.dataset.queueMasterIndex));
    const button = event.target.closest('[data-queue-template-index]');
    if (button) changeQueueTaskTemplate(Number(button.dataset.queueTemplateIndex));
  };
  $('#queueList').onchange = event => {
    const groupInput = event.target.closest('[data-queue-group-select]');
    if (groupInput) {
      const key = groupInput.dataset.queueGroupSelect;
      state.queue.forEach(task => {
        if (queueGroupKey(task) === key) task.selected = groupInput.checked;
      });
      renderQueue();
      return;
    }
    const input = event.target.closest('[data-queue-select]');
    if (!input) return;
    const task = state.queue[Number(input.dataset.queueSelect)];
    if (task) task.selected = input.checked;
  };
  $('#generationMode').onchange = event => {
    updateGenerationModeUi();
  };
  $('#generateAllButton').onclick = generateQueue;
  $('#refreshReviewsButton').onclick = loadReviews;
  $('#openCurrentReviewButton').onclick = () => { if (state.activeReview) window.caishen.openFolder(state.activeReview.folder); else toast('请先选择任务', true); };
  $('#selectAllReviewButton').onclick = () => { visibleReviewEntries().forEach(({ item }) => state.selectedReviewFolders.add(item.folder)); renderReviewList(); };
  $('#clearReviewSelectionButton').onclick = () => { state.selectedReviewFolders.clear(); renderReviewList(); };
  $('#deleteSelectedReviewsButton').onclick = async () => {
    const folders = [...state.selectedReviewFolders];
    if (!folders.length) return toast('请先选择要删除的任务', true);
    if (!window.confirm(`确定删除 ${folders.length} 个任务？母版图、套图和审核记录会一起删除。`)) return;
    try {
      const deleted = await window.caishen.deleteReviews(folders);
      if (deleted) { state.selectedReviewFolders.clear(); await loadReviews(); toast(`已删除 ${deleted} 个任务`); }
    } catch (error) { toast(errorText(error), true); }
  };
  $('#generateMissingTemplatesButton').onclick = () => runReviewGeneration(true);
  $('#regenerateTemplateSetButton').onclick = () => runReviewGeneration(false);
  $('#batchGenerateMissingButton').onclick = () => runReviewGeneration(true, visibleReviewEntries().map(({ item }) => item.folder));
  $('#stopReviewGenerationButton').onclick = stopCurrentReviewGeneration;
  $('#downloadSelectedReviewsButton').onclick = downloadSelectedReviewFolders;
  $('#batchApproveReviewsButton').onclick = async () => {
    const folders = visibleReviewEntries().map(({ item }) => item.folder);
    if (!folders.length) return toast('当前没有可见任务', true);
    try {
      const results = await window.caishen.batchApproveReviews(folders);
      const approved = (results || []).filter(result => result.approved).length;
      if (approved) {
        const approvedFolders = new Set((results || []).filter(result => result.approved).map(result => result.folder));
        state.reviews.filter(item => approvedFolders.has(item.folder)).forEach(markReviewItemViewed);
      }
      await loadReviews();
      toast(approved ? `已通过 ${approved}/${folders.length} 个可见任务` : '当前可见任务均缺图，未完成归档', approved === 0);
    } catch (error) { toast(errorText(error), true); }
  };
  $('#chooseFreeImageButton').onclick = chooseFreeImage;
  $('#freeGenerateButton').onclick = generateFree;
  $('#generateTitlesButton').onclick = generateTitles;
  $('#importTitleLibraryButton').onclick = importTitleLibrary;
  $('#refreshTitleLibraryButton').onclick = loadTitlePage;
  $('#saveTitleSetupButton').onclick = () => saveTitleSetup(true);
  $('#selectAllTitlesButton').onclick = () => { state.generatedTitles.forEach((_, index) => state.selectedTitleIndexes.add(index)); renderTitleResults(); };
  $('#clearTitleSelectionButton').onclick = () => { state.selectedTitleIndexes.clear(); renderTitleResults(); };
  $('#exportTitlesButton').onclick = exportSelectedTitles;
  $('#readyTitleTaskList').onclick = handleReadyTitleTaskAction;
  if ($('#refreshTaobaoPublishButton')) $('#refreshTaobaoPublishButton').onclick = loadTaobaoPublishPage;
  if ($('#copyTaobaoPublishTokenButton')) $('#copyTaobaoPublishTokenButton').onclick = async () => {
    const token = state.taobaoPublishSettings?.token || '';
    if (!token) return toast('插件连接令牌未生成', true);
    await window.caishen.copyText(token);
    toast('插件连接令牌已复制');
  };
  if ($('#taobaoCategoryList')) $('#taobaoCategoryList').onclick = event => {
    const button = event.target.closest('[data-taobao-category]');
    if (!button) return;
    state.activeTaobaoCategoryId = button.dataset.taobaoCategory;
    renderTaobaoPublishPage();
  };
  if ($('#taobaoPublishTaskList')) $('#taobaoPublishTaskList').onclick = event => {
    const card = event.target.closest('[data-taobao-task]');
    if (!card) return;
    state.activeTaobaoPublishTaskId = card.dataset.taobaoTask;
    renderTaobaoPublishPage();
  };
  if ($('#taobaoPublishDetail')) $('#taobaoPublishDetail').onclick = event => {
    if (event.target.closest('#queueTaobaoPublishButton')) return queueActiveTaobaoPublishTask();
    if (event.target.closest('#copyTaobaoPublishDiagnosticsButton')) return copyTaobaoPublishDiagnostics();
    if (event.target.closest('#openTaobaoTaskFolderButton')) {
      const task = state.taobaoPublishTasks.find(item => (item.id || item.folder) === state.activeTaobaoPublishTaskId);
      if (task?.folder) return window.caishen.openFolder(task.folder);
      return toast('请先选择任务', true);
    }
  };
  if ($('#taobaoPublishDetail')) $('#taobaoPublishDetail').onchange = event => {
    if (!event.target.closest('#taobaoTaskCategorySelect')) return;
    state.activeTaobaoCategoryId = event.target.value;
    renderTaobaoCategoryList();
    renderTaobaoCategoryEditor();
  };
  if ($('#taobaoCategoryEditor')) $('#taobaoCategoryEditor').onsubmit = saveActiveTaobaoCategoryTemplate;
  $('#saveSettingsButton').onclick = saveSettings;
  $('#resetSettingsButton').onclick = resetSettings;
  $('#openBillingDetailButton').onclick = openBillingDetail;
  $('#closeBillingDetailButton').onclick = closeBillingDetail;
  $('#refreshBillingDetailButton').onclick = loadBillingSummary;
  $('#billingDetailModal').onclick = event => { if (event.target === $('#billingDetailModal')) closeBillingDetail(); };
  $('#saveBillingRulesButton').onclick = saveBillingRules;
  $('#refreshBillingButton').onclick = loadBillingAdmin;
  $('#clearBillingLedgerButton').onclick = clearBillingLedger;
  $('#billingUserFilter').onchange = event => {
    state.billingAdminFilter = String(event.target.value || '');
    renderBillingAdmin();
  };
  $('#billingAccountList').onclick = event => {
    const button = event.target.closest('[data-adjust-billing]');
    if (button) adjustBillingBalance(button);
  };
  $('#resetOutputPathButton').onclick = () => {
    $('#settingOutputPathInput').value = state.config.defaultOutputPath || state.config.outputPath || '';
  };
  $$('[data-settings-tab]').forEach(button => button.onclick = () => renderSettingsTabs(button.dataset.settingsTab));
  $('#testApiButton').onclick = testApiConnection;
  $('#testAnalysisModelsButton').onclick = testAnalysisModelsConnection;
  $('#testAnalysisApiButton').onclick = testAnalysisConnection;
  $('#apiSettingsForm').onsubmit = event => { event.preventDefault(); saveSettings(); };
  if ($('#addModelPackageButton')) $('#addModelPackageButton').onclick = () => {};
  $('#saveModelPackagesButton').onclick = saveModelPackages;
  $('#modelPackageList').onclick = event => {
    const choice = event.target.closest('[data-select-model-package]');
    if (choice) {
      state.selectedModelPackageId = choice.dataset.selectModelPackage;
      renderModelPackages();
      saveSelectedModelPackage();
      return;
    }
  };
  $('#apiModelList').onclick = event => {
    const button = event.target.closest('[data-api-model]');
    if (!button) return;
    state.selectedApiModelId = button.dataset.apiModel;
    renderApiModelList();
  };
  $('#apiModelSearch').oninput = renderApiModelList;
  $('#openImageModelsButton').onclick = () => openApiModelModal('image');
  $('#openAnalysisModelsButton').onclick = () => openApiModelModal('analysis');
  $('#closeApiModelModalButton').onclick = closeApiModelModal;
  $('#apiModelModal').onclick = event => { if (event.target === $('#apiModelModal')) closeApiModelModal(); };
  $('#applyApiModelButton').onclick = applySelectedApiModel;
  $$('[data-toggle-secret]').forEach(button => button.onclick = () => {
    const input = $(`#${button.dataset.toggleSecret}`);
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    button.textContent = visible ? '显示' : '隐藏';
  });
  $('#promptSettingList').onclick = event => {
    const button = event.target.closest('[data-prompt-id]');
    if (button) selectPromptSetting(button.dataset.promptId);
  };
  $('#promptEditor').oninput = event => {
    if (!canManagePrompts()) return;
    const prompt = activePrompt();
    if (prompt) schedulePromptSave(prompt, event.target.value);
  };
  $('#resetCurrentPromptButton').onclick = resetCurrentPrompt;
  $('#resetAllPromptsButton').onclick = resetAllPrompts;
  $('#revealFreeResultButton').onclick = () => { if (state.freeResult) window.caishen.revealFile(state.freeResult.outputPath); };
  $$('.audit-button').forEach(button => button.onclick = async () => {
    const previous = state.config.auditMode;
    state.config.auditMode = button.dataset.audit;
    renderConfig();
    try { state.config = await window.caishen.saveConfig(state.config); }
    catch (error) { state.config.auditMode = previous; renderConfig(); toast(errorText(error), true); }
  });
  $('#closeTemplateConfigButton').onclick = closeTemplateConfig;
  $('#saveTemplateConfigButton').onclick = saveTemplateConfig;
  const handleTemplateAnalysisFieldChange = event => {
    const field = event.target.dataset.templateField;
    const card = event.target.closest('[data-template-index]');
    if (!field || !card) return;
    const item = state.templateItems[Number(card.dataset.templateIndex)];
    if (!item) return;
    item[field] = field === 'action' ? normalizeTemplateUiAction(event.target.value) : event.target.value;
    if (field === 'action') {
      applyTemplateActionDefaults(item, card);
      card.querySelector('.template-action-hint').textContent = templateActionHint(item.action);
    }
  };
  $('#templateAnalysisResult').oninput = handleTemplateAnalysisFieldChange;
  $('#templateAnalysisResult').onchange = handleTemplateAnalysisFieldChange;
  $('#templateAnalysisResult').onclick = event => {
    const referenceButton = event.target.closest('[data-reference-analysis]');
    if (referenceButton) return analyzeActiveTemplateWithReference(referenceButton.dataset.referenceAnalysis);
  };
  $('#closeProductProfileButton').onclick = closeProductProfile;
  $('#cancelProductProfileButton').onclick = closeProductProfile;
  $('#saveProductProfileButton').onclick = saveProductProfile;
  $('#analyzeProductProfileButton').onclick = analyzeProductProfileFromSelection;
  $('#productGrid').onclick = event => {
    const card = event.target.closest('[data-type="product"]');
    if (!card) return;
    state.selectedProduct = state.products[Number(card.dataset.index)]; renderAssets('product'); renderSelection();
  };
  $('#printGrid').onclick = event => {
    const card = event.target.closest('[data-type="print"]');
    if (!card) return;
    state.selectedPrint = state.prints[Number(card.dataset.index)]; renderAssets('print'); renderSelection();
    if ($('#generationMode').value === 'template_print') {
      addTemplateMasterPrint(state.selectedPrint);
      renderTemplateWorkflow();
    }
  };
  $('#productFolderList').onclick = event => {
    const button = event.target.closest('[data-asset-folder]');
    if (!button) return;
    state.productFolder = button.dataset.assetFolder;
    renderAssets('product');
  };
  $('#printFolderList').onclick = event => {
    const button = event.target.closest('[data-asset-folder]');
    if (!button) return;
    state.printFolder = button.dataset.assetFolder;
    renderAssets('print');
  };
  $('#taskTemplateSort').onchange = async event => {
    state.taskTemplateSort = event.target.value === 'name-desc' ? 'name-desc' : 'name-asc';
    state.assetPreviewCache.delete('detailSetsPath');
    state.taskTemplateItems = await listTaskTemplateItemsForCurrentView();
    syncTaskTemplateSelection();
    renderTemplateFolders();
    renderTaskTemplateFolderList();
    renderTemplateWorkflow();
  };
  $('#printSort').onchange = event => {
    state.printSort = event.target.value === 'name-desc' ? 'name-desc' : 'name-asc';
    renderAssets('print');
  };
  if ($('#productPreviewSize')) $('#productPreviewSize').oninput = event => { $('#productGrid').style.setProperty('--asset-card-size', `${event.target.value}px`); };
  $('#reviewList').onclick = event => {
    const row = event.target.closest('[data-review-index]');
    if (!row) return;
    state.activeReview = state.reviews[Number(row.dataset.reviewIndex)];
    state.reviewTaskActivated = true;
    state.reviewLogFilter = 'all';
    renderReviewList(); renderReviewStage();
  };
  $('#reviewOperationLog').onclick = event => {
    const filterButton = event.target.closest('[data-review-log-filter]');
    if (filterButton) {
      state.reviewLogFilter = filterButton.dataset.reviewLogFilter;
      if (state.activeReview) {
        const summary = reviewGenerationSummary(state.activeReview);
        const running = ['queued', 'preparing', 'generating', 'auditing', 'running'].includes(summary.phase);
        renderReviewTrackingLog(state.activeReview, summary, running);
      }
      return;
    }
    const jobButton = event.target.closest('[data-review-log-job]');
    if (!jobButton) return;
    const jobIndex = Number(jobButton.dataset.reviewLogJob);
    const job = state.activeReview?.jobs?.[jobIndex];
    if (job) markReviewJobViewed(state.activeReview, job);
    const card = $('#reviewStage').querySelector(`[data-review-job="${jobIndex}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('log-target');
    requestAnimationFrame(() => card.classList.add('log-target'));
    clearTimeout(card._logTargetTimer);
    card._logTargetTimer = setTimeout(() => card.classList.remove('log-target'), 2600);
    const summary = reviewGenerationSummary(state.activeReview);
    renderReviewTrackingLog(state.activeReview, summary, ['queued', 'preparing', 'generating', 'auditing', 'running'].includes(summary.phase));
  };
  $('#reviewList').onchange = event => {
    const input = event.target.closest('[data-review-select]');
    if (!input) return;
    const item = state.reviews[Number(input.dataset.reviewSelect)];
    if (!item) return;
    if (input.checked) state.selectedReviewFolders.add(item.folder); else state.selectedReviewFolders.delete(item.folder);
    renderReviewList();
  };
  $('#requiredRootPanel').onchange = event => {
    const input = event.target.closest('[data-required-root]');
    if (!input) return;
    if (input.checked) state.requiredTitleRoots.add(input.dataset.requiredRoot);
    else state.requiredTitleRoots.delete(input.dataset.requiredRoot);
    $('#titleLibraryStatus').textContent = `当前词库：${state.titleLibrary?.sourceFileName || ''}，${state.titleLibrary?.recordCount || 0} 条关键词；已选择必选词 ${state.requiredTitleRoots.size} 个。`;
  };
  $('#titleResults').onclick = event => {
    const row = event.target.closest('[data-title-index]');
    if (!row) return;
    const index = Number(row.dataset.titleIndex);
    if (event.target.matches('input')) {
      if (event.target.checked) state.selectedTitleIndexes.add(index); else state.selectedTitleIndexes.delete(index);
    } else {
      state.selectedTitleIndexes.add(index);
      window.caishen.copyText(state.generatedTitles[index]);
      toast('标题已复制');
    }
    renderTitleResults();
  };
  $('#productSearch').oninput = event => { clearTimeout(productSearchTimer); productSearchTimer = setTimeout(() => loadAssets('categoriesPath', event.target.value), 300); };
  $('#printSearch').oninput = event => { clearTimeout(printSearchTimer); printSearchTimer = setTimeout(() => loadAssets('printsPath', event.target.value), 300); };
  $('#reviewSearch').oninput = () => { renderReviewList(); renderReviewStage(); };
  $('#reviewFilter').onchange = () => { renderReviewList(); renderReviewStage(); };
}

async function start() {
  $('#authForm').onsubmit = submitAuth;
  const authStatus = await window.caishen.authStatus();
  if (!authStatus.authenticated) {
    showAuthGate(authStatus.bootstrapRequired);
    return;
  }
  applyCurrentUser(authStatus.user);
  applySidebarCollapsed(loadSidebarCollapsed());
  setTaskSourceTab(state.taskSourceTab);
  window.addEventListener('caishen:billing-changed', loadBillingSummary);
  bindEvents();
  bindImageHoverPreview();
  updateGenerationModeUi();
  renderQueue();
  state.config = await window.caishen.getConfig();
  await sanitizeConfigWorkspacePaths();
  renderConfig();
  renderSettingsTabs();
  await loadTemplateFolders();
  const adminLoads = [
    ...(canViewPrompts() ? [loadPromptSettings()] : []),
    ...(isTeamAdmin() ? [loadModelPackageSettings()] : []),
    ...(isSuperAdmin() ? [loadApiSettings()] : [])
  ];
  await Promise.all([loadTitleLibrary(), loadTemplatePreparation(), loadBillingSummary(), ...adminLoads]);
  await Promise.all([loadAssets('categoriesPath'), loadAssets('printsPath')]);
  renderQueue();
}

start().catch(error => {
  showAuthGate(false);
  $('#authHint').textContent = `无法连接服务器：${errorText(error)}`;
  $('#authHint').classList.add('error');
});

'use strict';

const path = require('node:path');

const TASK_STATUS = Object.freeze({
  IDLE: '未开始',
  QUEUED: '排队中',
  RUNNING: '进行中',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消'
});

const MANUAL_REVIEW_STATUS = Object.freeze({
  APPROVED: '人工通过',
  REJECTED: '人工不通过'
});

const AUDIT_STATUS = Object.freeze({
  PENDING: '待审核',
  APPROVED: '审核通过',
  REJECTED: '审核不通过',
  DIRECT: '直接套模板-自动通过',
  SKIPPED: '已跳过'
});

const REVIEW_FILTERS = Object.freeze([
  '全部图片',
  '待生成',
  'AI不通过',
  '待人工确认',
  '已通过',
  '直接套模板'
]);

const TEMPLATE_IMAGE_FILTERS = new Set([
  '待生成',
  '未生成',
  'AI审核中',
  'AI不通过',
  '待人工确认',
  '人工不通过',
  '已通过',
  '直接套模板'
]);

const TASK_STATUS_ALIASES = new Map([
  ['', TASK_STATUS.IDLE],
  ['待生成', TASK_STATUS.IDLE],
  ['未开始', TASK_STATUS.IDLE],
  ['排队', TASK_STATUS.QUEUED],
  ['排队中', TASK_STATUS.QUEUED],
  ['生成中', TASK_STATUS.RUNNING],
  ['进行中', TASK_STATUS.RUNNING],
  ['任务进行中', TASK_STATUS.RUNNING],
  ['完成', TASK_STATUS.COMPLETED],
  ['已完成', TASK_STATUS.COMPLETED],
  ['失败', TASK_STATUS.FAILED],
  ['已失败', TASK_STATUS.FAILED],
  ['取消', TASK_STATUS.CANCELLED],
  ['已取消', TASK_STATUS.CANCELLED]
]);

function parseJsonObject(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizedKey(value) {
  return String(value || '').replace(/[_\-\s]/g, '').toLocaleLowerCase('en-US');
}

function field(source, ...names) {
  if (!source || typeof source !== 'object') return undefined;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(source, name)) return source[name];
  }
  const wanted = new Set(names.map(normalizedKey));
  for (const [key, value] of Object.entries(source)) {
    if (wanted.has(normalizedKey(key))) return value;
  }
  return undefined;
}

function stringValue(value, fallback = '') {
  return value == null ? fallback : String(value).trim();
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => stringValue(item)).filter(Boolean))];
}

function booleanValue(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLocaleLowerCase('en-US');
  if (['true', '1', 'yes', 'y'].includes(text)) return true;
  if (['false', '0', 'no', 'n'].includes(text)) return false;
  return fallback;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isoTime(value, fallback = '') {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function basenameAny(value) {
  const normalized = stringValue(value).replaceAll('\\', '/').replace(/\/+$/, '');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function normalizeTaskStatus(value) {
  const status = stringValue(value);
  return TASK_STATUS_ALIASES.get(status) || status || TASK_STATUS.IDLE;
}

function normalizeTask(value = {}) {
  const task = parseJsonObject(value);
  return {
    id: stringValue(field(task, 'id', 'Id')),
    taskNumber: Math.max(0, Math.trunc(numberValue(field(task, 'taskNumber', 'TaskNumber')))),
    modelPath: stringValue(field(task, 'modelPath', 'ModelPath')),
    productPath: stringValue(field(task, 'productPath', 'ProductPath')),
    productName: stringValue(field(task, 'productName', 'ProductName')),
    printPath: stringValue(field(task, 'printPath', 'PrintPath')),
    printName: stringValue(field(task, 'printName', 'PrintName')),
    templateFolderPath: stringValue(field(task, 'templateFolderPath', 'TemplateFolderPath')),
    templateRelativePaths: stringArray(field(task, 'templateRelativePaths', 'TemplateRelativePaths')),
    generationMode: stringValue(field(task, 'generationMode', 'GenerationMode'), 'master') || 'master',
    isSelected: booleanValue(field(task, 'isSelected', 'IsSelected')),
    status: normalizeTaskStatus(field(task, 'status', 'Status')),
    outputFolder: stringValue(field(task, 'outputFolder', 'OutputFolder')),
    masterImagePath: stringValue(field(task, 'masterImagePath', 'MasterImagePath')),
    error: stringValue(field(task, 'error', 'Error')),
    note: stringValue(field(task, 'note', 'Note')),
    result: field(task, 'result', 'Result') ?? null
  };
}

function nextTaskNumber(tasks) {
  return tasks.reduce((maximum, task) => Math.max(maximum, normalizeTask(task).taskNumber), 0) + 1;
}

function taskReadiness(value, options = {}) {
  const task = normalizeTask(value);
  const mode = options.generationMode || task.generationMode || 'master';
  const pathExists = typeof options.pathExists === 'function' ? options.pathExists : candidate => Boolean(candidate);
  const folderExists = typeof options.folderExists === 'function' ? options.folderExists : candidate => Boolean(candidate);
  if (!task.printPath || !pathExists(task.printPath)) return { ready: false, reason: '缺少印花图', task };
  if (mode !== 'template_print' && (!task.productPath || !pathExists(task.productPath))) {
    return { ready: false, reason: '缺少品类图', task };
  }
  if (!task.templateFolderPath || !folderExists(task.templateFolderPath)) {
    return { ready: false, reason: '缺少套图文件夹', task };
  }
  return { ready: true, reason: mode === 'template_print' ? '等待模板换印花' : '等待生成母版图', task };
}

function transitionTask(value, event, payload = {}) {
  const task = normalizeTask(value);
  const allowed = {
    queue: [TASK_STATUS.IDLE, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED],
    start: [TASK_STATUS.IDLE, TASK_STATUS.QUEUED, TASK_STATUS.FAILED],
    succeed: [TASK_STATUS.RUNNING],
    fail: [TASK_STATUS.RUNNING, TASK_STATUS.QUEUED],
    cancel: [TASK_STATUS.IDLE, TASK_STATUS.QUEUED, TASK_STATUS.RUNNING],
    reset: Object.values(TASK_STATUS)
  };
  if (!allowed[event]) throw new Error(`未知任务事件：${event}`);
  if (!allowed[event].includes(task.status)) throw new Error(`任务状态“${task.status}”不能执行“${event}”`);

  if (event === 'queue') return { ...task, status: TASK_STATUS.QUEUED, error: '' };
  if (event === 'start') return { ...task, status: TASK_STATUS.RUNNING, error: '' };
  if (event === 'succeed') {
    return {
      ...task,
      status: TASK_STATUS.COMPLETED,
      error: '',
      result: payload.result ?? task.result,
      outputFolder: stringValue(payload.outputFolder, task.outputFolder),
      masterImagePath: stringValue(payload.masterImagePath, task.masterImagePath)
    };
  }
  if (event === 'fail') return { ...task, status: TASK_STATUS.FAILED, error: stringValue(payload.error, '任务失败') };
  if (event === 'cancel') return { ...task, status: TASK_STATUS.CANCELLED, error: '' };
  return { ...task, status: TASK_STATUS.IDLE, error: '', result: null, outputFolder: '', masterImagePath: '' };
}

function selectAllTasks(tasks, selected = true) {
  return tasks.map(task => ({ ...normalizeTask(task), isSelected: Boolean(selected) }));
}

function deleteSelectedTasks(tasks) {
  return tasks.map(normalizeTask).filter(task => !task.isSelected);
}

function duplicateSelectedTasks(tasks, options = {}) {
  const normalized = tasks.map(normalizeTask);
  const originals = normalized.filter(task => task.isSelected);
  let taskNumber = nextTaskNumber(normalized);
  let sequence = 0;
  const createId = typeof options.createId === 'function'
    ? options.createId
    : () => `TASK-COPY-${Date.now()}-${++sequence}`;
  const copies = originals.map(task => ({
    ...task,
    id: createId(task),
    taskNumber: taskNumber++,
    isSelected: false,
    status: TASK_STATUS.IDLE,
    outputFolder: '',
    masterImagePath: '',
    error: '',
    result: null
  }));
  return [...normalized, ...copies];
}

function addCombinationTasks(tasks, productPaths, printPaths, options = {}) {
  const normalized = tasks.map(normalizeTask);
  const products = [...new Set((productPaths || []).map(stringValue).filter(Boolean))];
  const prints = [...new Set((printPaths || []).map(stringValue).filter(Boolean))];
  let taskNumber = nextTaskNumber(normalized);
  let sequence = 0;
  const createId = typeof options.createId === 'function'
    ? options.createId
    : () => `TASK-${Date.now()}-${++sequence}`;
  const existingPairs = new Set(normalized.map(task => `${task.productPath}\u0000${task.printPath}`.toLocaleLowerCase('en-US')));
  const added = [];
  for (const productPath of products) {
    for (const printPath of prints) {
      const key = `${productPath}\u0000${printPath}`.toLocaleLowerCase('en-US');
      if (existingPairs.has(key)) continue;
      existingPairs.add(key);
      added.push(normalizeTask({
        id: createId({ productPath, printPath }),
        taskNumber: taskNumber++,
        productPath,
        productName: basenameAny(productPath),
        printPath,
        printName: basenameAny(printPath),
        templateFolderPath: stringValue(options.templateFolderPath),
        generationMode: stringValue(options.generationMode, 'master'),
        note: stringValue(options.note),
        status: TASK_STATUS.IDLE
      }));
    }
  }
  return { tasks: [...normalized, ...added], added };
}

function selectedOrAllTasks(tasks) {
  const normalized = tasks.map(normalizeTask);
  const selected = normalized.filter(task => task.isSelected);
  return selected.length ? selected : normalized;
}

function planTaskGeneration(tasks, options = {}) {
  const candidates = selectedOrAllTasks(tasks);
  const runnable = [];
  const skipped = [];
  for (const task of candidates) {
    const readiness = taskReadiness(task, options);
    (readiness.ready ? runnable : skipped).push(readiness);
  }
  return { candidates, runnable: runnable.map(item => item.task), skipped, runnableCount: runnable.length, skippedCount: skipped.length };
}

function normalizeSourceMetadata(value = {}) {
  const source = parseJsonObject(value);
  return {
    schemaVersion: Math.max(1, Math.trunc(numberValue(field(source, 'schemaVersion', 'SchemaVersion'), 1))),
    modelPath: stringValue(field(source, 'modelPath', 'ModelPath')),
    productPath: stringValue(field(source, 'productPath', 'ProductPath')),
    printPath: stringValue(field(source, 'printPath', 'PrintPath')),
    templateFolderPath: stringValue(field(source, 'templateFolderPath', 'TemplateFolderPath')),
    templateRelativePaths: stringArray(field(source, 'templateRelativePaths', 'TemplateRelativePaths')),
    generationMode: stringValue(field(source, 'generationMode', 'GenerationMode'), 'master') || 'master',
    taskNumber: Math.max(0, Math.trunc(numberValue(field(source, 'taskNumber', 'TaskNumber')))),
    note: stringValue(field(source, 'note', 'Note')),
    status: stringValue(field(source, 'status', 'Status')),
    createdAt: isoTime(field(source, 'createdAt', 'CreatedAt'))
  };
}

function toMacSourceMetadata(value, options = {}) {
  const source = normalizeSourceMetadata(value);
  return {
    schemaVersion: Math.max(2, source.schemaVersion),
    modelPath: source.modelPath,
    productPath: source.productPath,
    printPath: source.printPath,
    templateFolderPath: source.templateFolderPath,
    templateRelativePaths: source.templateRelativePaths,
    generationMode: source.generationMode,
    taskNumber: source.taskNumber,
    note: source.note,
    status: stringValue(options.status, source.status || '待人工筛图'),
    createdAt: isoTime(options.createdAt, source.createdAt || new Date(0).toISOString())
  };
}

function toWpfSourceMetadata(value) {
  const source = normalizeSourceMetadata(value);
  return {
    ModelPath: source.modelPath,
    ProductPath: source.productPath,
    PrintPath: source.printPath,
    TemplateFolderPath: source.templateFolderPath,
    TemplateRelativePaths: source.templateRelativePaths,
    GenerationMode: source.generationMode,
    TaskNumber: source.taskNumber,
    CreatedAt: source.createdAt
  };
}

function normalizeManualStatus(value) {
  const status = stringValue(value);
  if (['通过', '已通过', '人工通过'].includes(status)) return MANUAL_REVIEW_STATUS.APPROVED;
  if (['不通过', '人工不通过'].includes(status)) return MANUAL_REVIEW_STATUS.REJECTED;
  return '';
}

function normalizeAuditStatus(value, options = {}) {
  const raw = parseJsonObject(value, null);
  const text = typeof value === 'string' ? value : raw ? JSON.stringify(raw) : '';
  const explicit = stringValue(raw ? field(raw, 'auditStatus', 'AuditStatus', 'status', 'Status') : value);
  if (explicit === AUDIT_STATUS.SKIPPED || /skip_copy|跳过/i.test(text)) return AUDIT_STATUS.SKIPPED;
  if (explicit === AUDIT_STATUS.DIRECT || /copy_template|直接复制|直接套模板/i.test(text)) return AUDIT_STATUS.DIRECT;
  if ([AUDIT_STATUS.APPROVED, 'AI通过'].includes(explicit)) return AUDIT_STATUS.APPROVED;
  if ([AUDIT_STATUS.REJECTED, 'AI不通过'].includes(explicit)) return AUDIT_STATUS.REJECTED;
  if ([AUDIT_STATUS.PENDING, 'AI审核中'].includes(explicit)) return AUDIT_STATUS.PENDING;
  if (raw) {
    const passed = field(raw, 'passed', 'Passed');
    if (passed === true || stringValue(passed).toLocaleLowerCase('en-US') === 'true') return AUDIT_STATUS.APPROVED;
    if (passed === false || stringValue(passed).toLocaleLowerCase('en-US') === 'false') return AUDIT_STATUS.REJECTED;
  }
  return options.outputExists ? AUDIT_STATUS.PENDING : '';
}

function normalizeReviewImage(value = {}, relativePath = '') {
  const image = parseJsonObject(value);
  const outputPath = stringValue(field(image, 'outputPath', 'OutputPath', 'path', 'Path'));
  const relative = stringValue(field(image, 'relativePath', 'RelativeTemplatePath', 'name', 'Name'), relativePath || basenameAny(outputPath));
  const explicitExists = field(image, 'outputExists', 'OutputExists', 'exists', 'Exists', 'generated', 'Generated');
  const outputExists = explicitExists == null
    ? Boolean(field(image, 'url', 'Url'))
    : booleanValue(explicitExists);
  const manualState = parseJsonObject(field(image, 'manualReview', 'ManualReview'), {});
  const manualStatus = normalizeManualStatus(
    field(image, 'manualStatus', 'ManualStatus') ?? field(manualState, 'status', 'Status') ?? field(image, 'result', 'Result')
  );
  const auditValue = field(image, 'audit', 'Audit', 'auditStatus', 'AuditStatus', 'auditRaw', 'AuditRaw');
  return {
    relativePath: relative,
    templateImagePath: stringValue(field(image, 'templateImagePath', 'TemplateImagePath')),
    outputPath,
    outputExists,
    isGenerating: booleanValue(field(image, 'isGenerating', 'IsGenerating')),
    isMaster: booleanValue(field(image, 'isMaster', 'IsMaster')) || /^母版图(?:\.|$)/i.test(relative || basenameAny(outputPath)),
    auditStatus: normalizeAuditStatus(auditValue, { outputExists }),
    manualStatus,
    reviewedAt: isoTime(field(image, 'reviewedAt', 'ReviewedAt') ?? field(manualState, 'updatedAt', 'UpdatedAt')),
    generationAction: stringValue(field(image, 'generationAction', 'GenerationAction', 'action', 'Action')),
    mainIndex: (() => {
      const index = numberValue(field(image, 'mainIndex', 'MainIndex'), NaN);
      return Number.isFinite(index) && index > 0 ? Math.trunc(index) : null;
    })(),
    result: stringValue(field(image, 'result', 'Result'), '未筛选') || '未筛选'
  };
}

function normalizeReviewMetadata(value = {}) {
  const review = parseJsonObject(value);
  const rawImages = field(review, 'images', 'Images', 'imageStates', 'ImageStates');
  let images = [];
  if (Array.isArray(rawImages)) {
    images = rawImages.map(item => normalizeReviewImage(item));
  } else if (rawImages && typeof rawImages === 'object') {
    images = Object.entries(rawImages).map(([relativePath, item]) => normalizeReviewImage(item, relativePath));
  }
  return {
    schemaVersion: Math.max(1, Math.trunc(numberValue(field(review, 'schemaVersion', 'SchemaVersion'), 1))),
    status: stringValue(field(review, 'status', 'Status')),
    reviewedAt: isoTime(field(review, 'reviewedAt', 'ReviewedAt', 'updatedAt', 'UpdatedAt')),
    images
  };
}

function toMacReviewMetadata(value, options = {}) {
  const review = normalizeReviewMetadata(value);
  const images = (options.images || review.images).map(normalizeReviewImage).map(image => ({
    relativePath: image.relativePath,
    outputPath: image.outputPath,
    outputExists: image.outputExists,
    auditStatus: image.auditStatus,
    manualStatus: image.manualStatus,
    reviewedAt: image.reviewedAt,
    mainIndex: image.mainIndex,
    result: image.result
  }));
  return {
    schemaVersion: Math.max(2, review.schemaVersion),
    status: stringValue(options.status, review.status),
    reviewedAt: isoTime(options.reviewedAt, review.reviewedAt),
    images
  };
}

function normalizeFolderRecord(value = {}) {
  const folder = parseJsonObject(value);
  const folderPath = stringValue(field(folder, 'folder', 'Folder', 'path', 'Path'));
  const source = normalizeSourceMetadata(field(folder, 'source', 'Source', 'sourceJson', 'SourceJson') || {});
  const review = normalizeReviewMetadata(field(folder, 'review', 'Review', 'reviewJson', 'ReviewJson') || {});
  const rawJobs = field(folder, 'jobs', 'Jobs', 'templateJobs', 'TemplateJobs');
  const rawImages = field(folder, 'images', 'Images');
  const images = Array.isArray(rawImages) ? rawImages.map(item => normalizeReviewImage(item)) : [];
  const jobs = Array.isArray(rawJobs)
    ? rawJobs.map(item => normalizeReviewImage(item))
    : review.images.length
      ? review.images
      : booleanValue(field(folder, 'imagesAreTemplateJobs', 'ImagesAreTemplateJobs'))
        ? images
        : [];
  const explicitMaster = field(folder, 'masterExists', 'MasterExists');
  const legacyStatus = review.status || source.status || stringValue(field(folder, 'legacyStatus', 'LegacyStatus', 'status', 'Status'));
  return {
    folder: folderPath,
    name: stringValue(field(folder, 'name', 'Name'), basenameAny(folderPath)),
    source,
    review,
    images,
    jobs,
    masterExists: explicitMaster == null
      ? [...jobs, ...images].some(job => job.isMaster && job.outputExists)
      : booleanValue(explicitMaster),
    templateAvailable: field(folder, 'templateAvailable', 'TemplateAvailable') == null
      ? Boolean(source.templateFolderPath)
      : booleanValue(field(folder, 'templateAvailable', 'TemplateAvailable')),
    progress: stringValue(field(folder, 'progress', 'Progress')),
    taskRunning: booleanValue(field(folder, 'taskRunning', 'TaskRunning')),
    isRead: booleanValue(field(folder, 'isRead', 'IsRead')),
    legacyStatus,
    modifiedAt: numberValue(field(folder, 'modifiedAt', 'ModifiedAt')),
    logs: normalizeOperationLogs(field(folder, 'logs', 'Logs'))
  };
}

function isQualityAuditMode(value) {
  return stringValue(value, 'saving').toLocaleLowerCase('en-US') === 'quality';
}

function deriveImageStatus(value, auditMode = 'saving') {
  const image = normalizeReviewImage(value);
  if (image.generationAction === 'skip_copy' || image.auditStatus === AUDIT_STATUS.SKIPPED) return AUDIT_STATUS.SKIPPED;
  if (!image.outputExists || image.isGenerating) return '待生成';
  if (image.manualStatus) return image.manualStatus;
  if (!isQualityAuditMode(auditMode) && image.auditStatus === AUDIT_STATUS.PENDING) return '待人工确认';
  return image.auditStatus || '待人工确认';
}

function matchesReviewFilter(value, filter = '全部图片', auditMode = 'saving') {
  const image = normalizeReviewImage(value);
  const skipped = image.generationAction === 'skip_copy' || image.auditStatus === AUDIT_STATUS.SKIPPED;
  const outputExists = image.outputExists;
  const manualStatus = image.manualStatus;
  const auditStatus = image.auditStatus;
  const savingPending = outputExists
    && !isQualityAuditMode(auditMode)
    && !manualStatus
    && auditStatus === AUDIT_STATUS.PENDING;
  if (filter === '待生成' || filter === '未生成') return !skipped && !outputExists;
  if (filter === 'AI审核中') {
    return outputExists && isQualityAuditMode(auditMode) && !manualStatus && auditStatus === AUDIT_STATUS.PENDING;
  }
  if (filter === 'AI不通过') return outputExists && auditStatus === AUDIT_STATUS.REJECTED;
  if (filter === '待人工确认') {
    return !manualStatus && (savingPending || [AUDIT_STATUS.APPROVED, AUDIT_STATUS.DIRECT, AUDIT_STATUS.REJECTED].includes(auditStatus));
  }
  if (filter === '人工不通过') return manualStatus === MANUAL_REVIEW_STATUS.REJECTED;
  if (filter === '已通过') return manualStatus === MANUAL_REVIEW_STATUS.APPROVED;
  if (filter === '直接套模板') return outputExists && auditStatus === AUDIT_STATUS.DIRECT;
  return true;
}

function isFullyManuallyApproved(value) {
  const folder = normalizeFolderRecord(value);
  if (folder.jobs.length) {
    return folder.jobs.every(job => job.generationAction === 'skip_copy'
      || job.auditStatus === AUDIT_STATUS.SKIPPED
      || (job.outputExists && job.manualStatus === MANUAL_REVIEW_STATUS.APPROVED));
  }
  return ['已通过', '套图已确认'].includes(folder.legacyStatus);
}

function isImageReadyForTitle(value) {
  const image = normalizeReviewImage(value);
  if (image.generationAction === 'skip_copy' || image.auditStatus === AUDIT_STATUS.SKIPPED) return true;
  if (!image.outputExists) return false;
  if (image.manualStatus === MANUAL_REVIEW_STATUS.APPROVED) return true;
  if (image.manualStatus === MANUAL_REVIEW_STATUS.REJECTED) return false;
  return [AUDIT_STATUS.APPROVED, AUDIT_STATUS.DIRECT].includes(image.auditStatus);
}

function isFolderReadyForTitle(value) {
  const folder = normalizeFolderRecord(value);
  return folder.jobs.length > 0 && folder.jobs.every(isImageReadyForTitle);
}

function deriveFolderStatus(value, auditMode = 'saving') {
  const folder = normalizeFolderRecord(value);
  if (folder.progress.startsWith('正在') || folder.taskRunning) return '任务进行中';

  // The early native Mac build has no template job metadata. Preserve its
  // folder-level .caishen-review.json status until it is migrated per image.
  if (!folder.jobs.length && !folder.source.templateFolderPath && folder.legacyStatus) return folder.legacyStatus;
  if (!folder.templateAvailable) return '套图未生成';
  if (folder.source.generationMode !== 'template_print' && !folder.masterExists) return '母版未生成';
  if (!folder.jobs.length) return '套图未生成';
  const actionableJobs = folder.jobs.filter(job => job.generationAction !== 'skip_copy' && job.auditStatus !== AUDIT_STATUS.SKIPPED);
  const generated = actionableJobs.filter(job => job.outputExists).length;
  if (!actionableJobs.length) return '待人工确认';
  if (generated === 0) return '套图未生成';
  if (generated < actionableJobs.length) return '套图部分生成';
  if (folder.jobs.some(job => job.manualStatus === MANUAL_REVIEW_STATUS.REJECTED)) return '部分人工不通过';
  if (folder.jobs.some(job => job.auditStatus === AUDIT_STATUS.REJECTED)) return '部分审核不通过';
  if (isQualityAuditMode(auditMode) && folder.jobs.some(job => job.auditStatus === AUDIT_STATUS.PENDING)) return 'AI审核中';
  return actionableJobs.every(job => job.manualStatus === MANUAL_REVIEW_STATUS.APPROVED) ? '套图已确认' : '待人工确认';
}

function summarizeGenerationProgress(values, failureCount = 0) {
  const jobs = (values || []).map(value => normalizeReviewImage(value));
  let apiGenerated = 0;
  let copied = 0;
  let skipped = 0;
  let missing = 0;
  for (const job of jobs) {
    if (job.generationAction === 'skip_copy' || job.auditStatus === AUDIT_STATUS.SKIPPED) {
      skipped += 1;
    } else if (!job.outputExists) {
      missing += 1;
    } else if (job.generationAction === 'copy_template' || job.auditStatus === AUDIT_STATUS.DIRECT) {
      copied += 1;
    } else {
      apiGenerated += 1;
    }
  }
  const failed = Math.min(missing, Math.max(0, Math.trunc(numberValue(failureCount))));
  const pending = Math.max(0, missing - failed);
  const total = jobs.length;
  const current = Math.min(total, apiGenerated + copied + skipped + failed);
  return {
    total,
    current,
    percent: total ? Math.round(current / total * 100) : 0,
    apiGenerated,
    copied,
    skipped,
    failed,
    pending
  };
}

function filterReviewFolders(values, options = {}) {
  const search = stringValue(options.search).toLocaleLowerCase('zh-CN');
  const filter = stringValue(options.filter, '全部图片') || '全部图片';
  const auditMode = options.auditMode || 'saving';
  return values
    .map(normalizeFolderRecord)
    .filter(folder => !search || folder.name.toLocaleLowerCase('zh-CN').includes(search))
    .filter(folder => filter === '已通过' ? isFullyManuallyApproved(folder) : !isFullyManuallyApproved(folder))
    .filter(folder => {
      if (TEMPLATE_IMAGE_FILTERS.has(filter)) {
        if (folder.jobs.length) return folder.jobs.some(job => matchesReviewFilter(job, filter, auditMode));
        return filter === '已通过' && isFullyManuallyApproved(folder);
      }
      if (filter === '全部图片') return true;
      return deriveFolderStatus(folder, auditMode) === filter || folder.legacyStatus === filter;
    });
}

function countImagesForFilter(values, filter, options = {}) {
  const folders = filterReviewFolders(values, { ...options, filter });
  return folders.reduce((total, folder) => total + folder.jobs.filter(job => filter === '全部图片' || matchesReviewFilter(job, filter, options.auditMode)).length, 0);
}

function normalizeSelection(value) {
  const items = value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
  return [...new Set(items.map(stringValue).filter(Boolean))];
}

function updateFolderSelection(selection, action, folders = []) {
  const selected = new Set(normalizeSelection(selection));
  const values = folders.map(item => typeof item === 'string' ? item : normalizeFolderRecord(item).folder).filter(Boolean);
  if (action === 'clear') return [];
  if (action === 'select-visible') values.forEach(folder => selected.add(folder));
  else if (action === 'deselect-visible') values.forEach(folder => selected.delete(folder));
  else if (action === 'toggle') values.forEach(folder => selected.has(folder) ? selected.delete(folder) : selected.add(folder));
  else if (action === 'prune') return [...selected].filter(folder => values.includes(folder));
  else throw new Error(`未知选择操作：${action}`);
  return [...selected];
}

function planSelectedFolderDeletion(selection, folders) {
  const selected = new Set(normalizeSelection(selection));
  const existing = folders.map(normalizeFolderRecord).filter(folder => selected.has(folder.folder));
  return {
    folders: existing.map(folder => folder.folder),
    count: existing.length,
    clearActiveFolder: activeFolder => existing.some(folder => folder.folder === activeFolder)
  };
}

function normalizeOperationLog(value = {}) {
  const log = parseJsonObject(value);
  return {
    time: isoTime(field(log, 'time', 'Time')),
    message: stringValue(field(log, 'message', 'Message')),
    isRead: booleanValue(field(log, 'isRead', 'IsRead'))
  };
}

function normalizeOperationLogs(value) {
  const logs = Array.isArray(value) ? value : Array.isArray(parseJsonObject(value, [])) ? parseJsonObject(value, []) : [];
  return logs.map(normalizeOperationLog).filter(log => log.message);
}

function appendOperationLog(logs, options = {}) {
  const folderName = stringValue(options.folderName);
  const message = stringValue(options.message);
  if (!message) return normalizeOperationLogs(logs);
  const prefix = folderName ? `[${folderName}]` : '';
  const normalizedMessage = prefix && !message.toLocaleLowerCase('zh-CN').startsWith(prefix.toLocaleLowerCase('zh-CN'))
    ? `${prefix} ${message}`
    : message;
  return [
    { time: isoTime(options.time, new Date().toISOString()), message: normalizedMessage, isRead: false },
    ...normalizeOperationLogs(logs)
  ]
    .sort((left, right) => Date.parse(right.time || 0) - Date.parse(left.time || 0))
    .slice(0, 120);
}

function markOperationLogRead(logs, target) {
  const normalized = normalizeOperationLogs(logs);
  const wanted = normalizeOperationLog(target);
  let changed = false;
  return normalized.map(log => {
    if (!changed && log.time === wanted.time && log.message === wanted.message) {
      changed = true;
      return { ...log, isRead: true };
    }
    return log;
  });
}

function toWpfOperationLogs(logs) {
  return normalizeOperationLogs(logs).map(log => ({ Time: log.time, Message: log.message, IsRead: log.isRead }));
}

function extractLogTargetPath(message) {
  const text = stringValue(message);
  if (!text) return '';
  const match = text.match(/(?:[\p{L}\p{N}_\-\s（）()]+[\\/])?[^，；：:\r\n]+?\.(?:jpe?g|png|webp|bmp|gif|tiff?)/iu);
  return match ? match[0].trim().replace(/^\[[^\]]+\]\s*/, '').replaceAll('\\', '/') : '';
}

function setManualDecision(value, relativePath, status, options = {}) {
  const folder = normalizeFolderRecord(value);
  const manualStatus = normalizeManualStatus(status);
  if (!manualStatus) throw new Error(`无效人工审核状态：${status}`);
  const wanted = stringValue(relativePath).replaceAll('\\', '/').toLocaleLowerCase('zh-CN');
  let found = false;
  const reviewedAt = isoTime(options.time, new Date().toISOString());
  const jobs = folder.jobs.map(job => {
    if (job.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN') !== wanted) return job;
    found = true;
    return { ...job, manualStatus, reviewedAt };
  });
  if (!found) throw new Error(`未找到套图图片：${relativePath}`);
  const label = manualStatus === MANUAL_REVIEW_STATUS.APPROVED ? '人工标记通过' : '人工标记不通过';
  return {
    ...folder,
    jobs,
    logs: appendOperationLog(folder.logs, { folderName: folder.name, message: `${label}：${relativePath}`, time: reviewedAt })
  };
}

function planBatchApproval(values) {
  return values.map(value => {
    const folder = normalizeFolderRecord(value);
    if (!folder.jobs.length) {
      return { folder: folder.folder, name: folder.name, action: 'skip', changed: [], missing: [], message: '批量通过任务列表：没有可确认的套图图片' };
    }
    const missing = folder.jobs.filter(job => !job.outputExists).map(job => job.relativePath);
    if (missing.length) {
      return { folder: folder.folder, name: folder.name, action: 'skip', changed: [], missing, message: `批量通过任务列表：还有 ${missing.length} 张未生成，未归档` };
    }
    const changed = folder.jobs.filter(job => job.manualStatus !== MANUAL_REVIEW_STATUS.APPROVED).map(job => job.relativePath);
    return {
      folder: folder.folder,
      name: folder.name,
      action: changed.length ? 'approve' : 'noop',
      changed,
      missing: [],
      message: changed.length
        ? `批量通过任务列表：已标记 ${changed.length} 张图片为通过，并归档任务`
        : '批量通过任务列表：任务已是全部通过状态'
    };
  });
}

function applyBatchApproval(value, options = {}) {
  const folder = normalizeFolderRecord(value);
  const plan = planBatchApproval([folder])[0];
  const time = isoTime(options.time, new Date().toISOString());
  if (plan.action === 'skip') {
    return { folder: { ...folder, logs: appendOperationLog(folder.logs, { folderName: folder.name, message: plan.message, time }) }, plan };
  }
  const jobs = folder.jobs.map(job => ({ ...job, manualStatus: MANUAL_REVIEW_STATUS.APPROVED, reviewedAt: job.manualStatus === MANUAL_REVIEW_STATUS.APPROVED ? job.reviewedAt : time }));
  const review = normalizeReviewMetadata({ ...folder.review, status: '已通过', reviewedAt: time, images: jobs });
  return {
    folder: {
      ...folder,
      jobs,
      review,
      legacyStatus: '已通过',
      logs: appendOperationLog(folder.logs, { folderName: folder.name, message: plan.message, time })
    },
    plan
  };
}

function planRegeneration(value, options = {}) {
  const folder = normalizeFolderRecord(value);
  const mode = options.mode || 'missing';
  if (mode === 'master') {
    const ready = Boolean(folder.source.productPath && folder.source.printPath);
    return {
      mode,
      ready,
      folder: folder.folder,
      source: folder.source,
      reason: ready ? '' : '当前文件夹没有找到原始品类图和印花图记录',
      message: ready ? '开始重新生成母版图' : '',
      resetManualReview: false,
      resetAudit: false
    };
  }
  if (mode === 'single') {
    const wanted = stringValue(options.relativePath).replaceAll('\\', '/').toLocaleLowerCase('zh-CN');
    const job = folder.jobs.find(item => item.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN') === wanted);
    if (!job) return { mode, ready: false, folder: folder.folder, jobs: [], reason: `未找到套图图片：${options.relativePath}` };
    const extraInstruction = stringValue(options.extraInstruction);
    const includePreviousResult = Boolean(options.includePreviousResult && job.outputExists);
    return {
      mode,
      ready: true,
      folder: folder.folder,
      jobs: [job],
      extraInstruction,
      includePreviousResult,
      resetManualReview: true,
      resetAudit: true,
      message: `开始${job.outputExists ? '重生成' : '生成'}单张：${job.relativePath}${extraInstruction ? '（含本次备注）' : ''}${includePreviousResult ? '（参考上一张结果）' : ''}`
    };
  }
  if (!['missing', 'all'].includes(mode)) throw new Error(`未知重生成模式：${mode}`);
  const jobs = mode === 'missing' ? folder.jobs.filter(job => !job.outputExists) : folder.jobs;
  const label = mode === 'missing' ? '正在复刻本任务' : '正在重新生成整套图';
  return {
    mode,
    ready: jobs.length > 0,
    folder: folder.folder,
    jobs,
    reason: jobs.length ? '' : mode === 'missing' ? '没有未生成图片' : '套图文件夹无图片',
    message: jobs.length ? `${label}：${jobs.length} 张` : '',
    resetManualReview: true,
    resetAudit: true
  };
}

function applyRegenerationStart(value, planOrOptions = {}, options = {}) {
  const folder = normalizeFolderRecord(value);
  const plan = Array.isArray(planOrOptions.jobs) || planOrOptions.mode === 'master'
    ? planOrOptions
    : planRegeneration(folder, planOrOptions);
  if (!plan.ready) throw new Error(plan.reason || '当前任务不能重新生成');
  if (plan.mode === 'master') {
    return {
      ...folder,
      progress: plan.message,
      taskRunning: true,
      logs: appendOperationLog(folder.logs, { folderName: folder.name, message: plan.message, time: options.time })
    };
  }
  const targets = new Set(plan.jobs.map(job => job.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
  const jobs = folder.jobs.map(job => targets.has(job.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN'))
    ? { ...job, isGenerating: true, manualStatus: '', reviewedAt: '', auditStatus: job.outputExists ? AUDIT_STATUS.PENDING : '' }
    : job);
  return {
    ...folder,
    jobs,
    progress: plan.message,
    taskRunning: true,
    logs: appendOperationLog(folder.logs, { folderName: folder.name, message: plan.message, time: options.time })
  };
}

function setMainImageIndex(values, relativePath, index) {
  const targetIndex = Math.max(1, Math.min(5, Math.trunc(numberValue(index, 1))));
  const wanted = stringValue(relativePath).replaceAll('\\', '/').toLocaleLowerCase('zh-CN');
  return values.map(value => {
    const image = normalizeReviewImage(value);
    const current = image.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN');
    if (current === wanted) return { ...image, result: '通过', mainIndex: targetIndex };
    if (image.mainIndex === targetIndex) return { ...image, mainIndex: null };
    return image;
  });
}

function planLegacyFolderConfirmation(folderPath, values) {
  const images = values.map(normalizeReviewImage);
  const selected = images.filter(image => image.mainIndex > 0).sort((left, right) => left.mainIndex - right.mainIndex);
  const renames = selected.map((image, index) => {
    const extension = path.extname(image.outputPath || image.relativePath);
    return { from: image.outputPath, to: path.join(folderPath, `主图${index + 1}${extension}`) };
  }).filter(operation => operation.from && operation.from.toLocaleLowerCase('en-US') !== operation.to.toLocaleLowerCase('en-US'));
  const deletes = images.filter(image => image.result === '不通过' || image.manualStatus === MANUAL_REVIEW_STATUS.REJECTED).map(image => image.outputPath).filter(Boolean);
  return { renames, deletes };
}

function safeMetadataName(relativePath) {
  const normalized = stringValue(relativePath).replaceAll('\\', '/');
  const withoutExtension = normalized.replace(/\.[^./]+$/, '');
  return withoutExtension.replaceAll('/', '_').replace(/[<>:"|?*\u0000-\u001f]/g, '_') || 'template';
}

function metadataPaths(outputFolder, relativePath = '') {
  const metadataFolder = path.join(outputFolder, '.caishen-meta');
  const name = safeMetadataName(relativePath);
  return {
    macSource: path.join(outputFolder, '.caishen-source.json'),
    macReview: path.join(outputFolder, '.caishen-review.json'),
    metadataFolder,
    wpfSource: path.join(metadataFolder, 'source.json'),
    productProfile: path.join(metadataFolder, 'product-profile.json'),
    operationLog: path.join(metadataFolder, 'review-operation-log.json'),
    generationErrors: path.join(metadataFolder, 'template-generation-errors.json'),
    generationProgress: path.join(metadataFolder, 'template-generation-progress.json'),
    manualReview: relativePath ? path.join(metadataFolder, `${name}.manual-review.json`) : '',
    templateAudit: relativePath ? path.join(metadataFolder, `${name}.template-audit-action-v2.json`) : '',
    apiResponse: relativePath ? path.join(metadataFolder, `${name}.api-response.json`) : '',
    printReference: relativePath ? path.join(metadataFolder, `${name}.print-reference.png`) : '',
    printDraft: relativePath ? path.join(metadataFolder, `${name}.print-draft.png`) : ''
  };
}

function templateCachePaths(templateRoot, relativePath) {
  const cacheFolder = path.join(templateRoot, '.caishen-template-cache');
  const name = safeMetadataName(relativePath);
  return {
    cacheFolder,
    analysis: path.join(cacheFolder, `${name}.template-analysis.json`),
    replaceMask: path.join(cacheFolder, `${name}.replace-mask.png`),
    cleanMask: path.join(cacheFolder, `${name}.clean-mask.png`)
  };
}

function toWpfManualReviewState(status, updatedAt) {
  const manualStatus = normalizeManualStatus(status);
  if (!manualStatus) throw new Error(`无效人工审核状态：${status}`);
  return { Status: manualStatus, UpdatedAt: isoTime(updatedAt, new Date().toISOString()) };
}

module.exports = {
  AUDIT_STATUS,
  MANUAL_REVIEW_STATUS,
  REVIEW_FILTERS,
  TASK_STATUS,
  addCombinationTasks,
  appendOperationLog,
  applyBatchApproval,
  applyRegenerationStart,
  countImagesForFilter,
  deleteSelectedTasks,
  deriveFolderStatus,
  deriveImageStatus,
  duplicateSelectedTasks,
  extractLogTargetPath,
  filterReviewFolders,
  isFolderReadyForTitle,
  isFullyManuallyApproved,
  isImageReadyForTitle,
  markOperationLogRead,
  matchesReviewFilter,
  metadataPaths,
  nextTaskNumber,
  normalizeAuditStatus,
  normalizeFolderRecord,
  normalizeManualStatus,
  normalizeOperationLog,
  normalizeOperationLogs,
  normalizeReviewImage,
  normalizeReviewMetadata,
  normalizeSelection,
  normalizeSourceMetadata,
  normalizeTask,
  normalizeTaskStatus,
  planBatchApproval,
  planLegacyFolderConfirmation,
  planRegeneration,
  planSelectedFolderDeletion,
  planTaskGeneration,
  safeMetadataName,
  selectAllTasks,
  selectedOrAllTasks,
  setMainImageIndex,
  setManualDecision,
  summarizeGenerationProgress,
  taskReadiness,
  templateCachePaths,
  toMacReviewMetadata,
  toMacSourceMetadata,
  toWpfManualReviewState,
  toWpfOperationLogs,
  toWpfSourceMetadata,
  transitionTask,
  updateFolderSelection
};

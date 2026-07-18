const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const sharp = require('sharp');
const runtime = require('./runtime');
const { createAuthService } = require('./auth');
const { metadataPaths, normalizeSourceMetadata } = require('./core/review-engine');
const { isSameOrChildPath } = require('./core/path-utils');

const PORT = Math.max(1, Number(process.env.PORT || 8788));
const HOST = String(process.env.CAISHEN_HOST || '127.0.0.1');
const auth = createAuthService(runtime.DATA_ROOT);
const tempRoot = () => path.join(runtime.WORKSPACE_ROOT, 'tmp');
const assetRoot = () => path.join(runtime.WORKSPACE_ROOT, 'assets');
const jobRoot = () => path.join(runtime.WORKSPACE_ROOT, 'jobs');
const thumbnailRoot = () => path.join(runtime.WORKSPACE_ROOT, '.cache', 'thumbnails');
const LONG_JOB_METHODS = new Set([
  'analyzeProductProfile', 'analyzeTemplates', 'prepareTemplates', 'generateFree', 'generateTask', 'generateTemplateMaster',
  'generateTemplates', 'regenerateMaster', 'regenerateTemplate', 'analyzeTemplateItems', 'analyzeTemplateItemWithReference'
]);
const SUPERADMIN_RPC_METHODS = new Set([
  'getApiSettings', 'saveApiSettings', 'testApiSettings', 'testAnalysisApi', 'savePromptSetting', 'resetPromptSetting'
]);

function canAccessRpc(user, method) {
  const name = String(method || '');
  if (SUPERADMIN_RPC_METHODS.has(name)) return user?.role === 'superadmin';
  if (name === 'getPromptSettings') return isTeamAdmin(user);
  return true;
}

const isSuperAdmin = user => user?.role === 'superadmin';
const isTeamAdmin = user => user?.role === 'superadmin' || user?.role === 'admin';
const BILLING_AMOUNT_SCALE = 1_000_000;

function parseBillingUsdMinor(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{0,6})?$/.test(text)) return NaN;
  const [whole, fraction = ''] = text.split('.');
  const major = Number(whole);
  if (!Number.isSafeInteger(major)) return NaN;
  const minor = major * BILLING_AMOUNT_SCALE + Number(fraction.padEnd(6, '0'));
  return Number.isSafeInteger(minor) ? minor : NaN;
}

function billingAmountMinorFromRequest(body) {
  const amountMinor = Number(body?.amountMinor);
  if (Number.isSafeInteger(amountMinor)) return amountMinor;
  const amountUsd = parseBillingUsdMinor(body?.amountUsd ?? body?.amount);
  if (Number.isSafeInteger(amountUsd)) return amountUsd;
  return amountMinor;
}

function roleName(role) {
  return { superadmin: '超级管理员', admin: '管理员', member: '成员' }[role] || '成员';
}

function visibleUsersForActor(users, actor) {
  if (actor.role === 'superadmin') return users;
  if (actor.role === 'admin') {
    return users.filter(user => user.id === actor.id || (user.role === 'member' && (!user.parentUserId || user.parentUserId === actor.id)));
  }
  return [];
}

function billingVisibleUsersForActor(users, actor) {
  if (actor.role === 'superadmin') return users;
  if (actor.role === 'admin') return users.filter(user => user.role !== 'superadmin');
  return [];
}

function canManageUser(actor, target) {
  if (!target) return false;
  if (actor.role === 'superadmin') return target.role !== 'superadmin' || target.id !== actor.id;
  if (actor.role === 'admin') return target.role === 'member' && (!target.parentUserId || target.parentUserId === actor.id);
  return false;
}
const MAX_ACTIVE_JOBS = Math.max(1, Number(process.env.CAISHEN_JOB_CONCURRENCY || 50));
const JOB_RATE_LIMIT_PER_HOUR = Math.max(10, Number(process.env.CAISHEN_JOB_RATE_LIMIT_PER_HOUR || 120));
const UPLOAD_FILE_LIMIT_MB = Math.max(1, Number(process.env.CAISHEN_UPLOAD_FILE_LIMIT_MB || 1024));
const UPLOAD_FILE_LIMIT_BYTES = Math.round(UPLOAD_FILE_LIMIT_MB * 1024 * 1024);
const pendingJobs = [];
const jobsByClientKey = new Map();
const activeJobControllers = new Map();
const jobRateWindows = new Map();
const loginRateWindows = new Map();
const assetSyncSessions = new Map();
const thumbnailJobs = new Map();

async function markInterruptedGenerationProgress(job, message) {
  const folder = String(job?.progress?.folder || '');
  if (!folder || !runtime.isWorkspacePath(folder)) return;
  const current = job.progress && typeof job.progress === 'object' ? job.progress : {};
  const next = {
    ...current,
    folder,
    phase: 'failed',
    message,
    updatedAt: new Date().toISOString()
  };
  try {
    const file = metadataPaths(folder).generationProgress;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(next, null, 2), 'utf8');
  } catch {}
}
const thumbnailWaiters = [];
const THUMBNAIL_CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.CAISHEN_THUMBNAIL_CONCURRENCY || 3)));
let activeThumbnails = 0;
let activeJobs = 0;
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      const destination = tempRoot();
      fs.mkdirSync(destination, { recursive: true });
      callback(null, destination);
    },
    filename: (_req, _file, callback) => callback(null, `${Date.now()}-${crypto.randomBytes(10).toString('hex')}`)
  }),
  limits: { fileSize: UPLOAD_FILE_LIMIT_BYTES, files: 10000 }
});

function safeSegment(value, fallback = 'file') {
  const cleaned = String(value || '').normalize('NFC').replace(/[<>:"|?*\u0000-\u001f]/g, '-').replace(/^\.+$/, '').trim();
  return cleaned || fallback;
}

function uploadName(file) {
  const raw = String(file?.originalname || '');
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('\ufffd') ? raw : decoded;
}

function safeRelative(value, fallback) {
  const parts = String(value || '').replaceAll('\\', '/').split('/').filter(part => part && part !== '.' && part !== '..');
  return parts.map(part => safeSegment(part)).join('/') || safeSegment(fallback);
}

function isWithin(root, candidate) {
  return isSameOrChildPath(root, candidate);
}

const decodeFileToken = token => runtime.fileFromToken(token);
const fileUrl = file => runtime.imageUrl(file);

const ZIP_CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  ZIP_CRC_TABLE[index] = crc >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = ZIP_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDosDateTime(input) {
  const date = input instanceof Date && !Number.isNaN(input.getTime()) ? input : new Date();
  return {
    date: (((date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}

function zipAttachmentName(name) {
  const fallback = safeSegment(name, 'task');
  const ascii = fallback.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}.zip"; filename*=UTF-8''${encodeURIComponent(`${fallback}.zip`)}`;
}

async function readZipSourceMetadata(folder) {
  const paths = metadataPaths(folder);
  for (const file of [paths.wpfSource, paths.macSource]) {
    try {
      return normalizeSourceMetadata(JSON.parse(await fsp.readFile(file, 'utf8')));
    } catch {
      // Try the next known metadata location.
    }
  }
  return normalizeSourceMetadata({});
}

function zipDateStamp(folder, fallbackDate = new Date()) {
  const match = path.basename(folder).match(/^(\d{4})(?:-|$)/);
  if (match) return match[1];
  return `${String(fallbackDate.getMonth() + 1).padStart(2, '0')}${String(fallbackDate.getDate()).padStart(2, '0')}`;
}

function normalizedComparablePath(value) {
  return path.resolve(String(value || '')).toLocaleLowerCase('en-US');
}

function sameTemplateSource(left, right) {
  if (!left || !right) return false;
  if (normalizedComparablePath(left) === normalizedComparablePath(right)) return true;
  return path.basename(left).toLocaleLowerCase('zh-CN') === path.basename(right).toLocaleLowerCase('zh-CN');
}

async function buildZipDownloadName(folder) {
  const source = await readZipSourceMetadata(folder);
  const templateFolderPath = source.templateFolderPath;
  const templateName = safeSegment(templateFolderPath ? path.basename(templateFolderPath) : path.basename(folder), 'task');
  const stamp = zipDateStamp(folder);
  let sequence = 1;

  try {
    const parent = path.dirname(folder);
    const siblings = await fsp.readdir(parent, { withFileTypes: true });
    const matching = [];
    for (const entry of siblings) {
      if (!entry.isDirectory() || zipDateStamp(entry.name) !== stamp) continue;
      const siblingFolder = path.join(parent, entry.name);
      const siblingSource = await readZipSourceMetadata(siblingFolder);
      if (sameTemplateSource(siblingSource.templateFolderPath, templateFolderPath)) matching.push(siblingFolder);
    }
    matching.sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'zh-CN', { numeric: true }));
    const index = matching.findIndex(item => path.resolve(item) === path.resolve(folder));
    if (index >= 0) sequence = index + 1;
  } catch {
    sequence = 1;
  }

  return `${templateName}-${stamp}-${String(sequence).padStart(2, '0')}`;
}

async function collectZipEntries(root, folder = root, entries = []) {
  const children = await fsp.readdir(folder, { withFileTypes: true });
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))) {
    const target = path.join(folder, child.name);
    if (child.isDirectory()) await collectZipEntries(root, target, entries);
    else if (child.isFile()) entries.push(target);
  }
  return entries;
}

async function createFolderZip(folder) {
  const root = path.resolve(folder);
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const files = await collectZipEntries(root);
  for (const file of files) {
    const stat = await fsp.stat(file);
    const source = await fsp.readFile(file);
    const compressedCandidate = zlib.deflateRawSync(source);
    const useDeflate = compressedCandidate.length < source.length;
    const payload = useDeflate ? compressedCandidate : source;
    const name = Buffer.from(path.relative(root, file).replaceAll(path.sep, '/'), 'utf8');
    const checksum = crc32(source);
    const dos = zipDosDateTime(stat.mtime);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(useDeflate ? 8 : 0, 8);
    localHeader.writeUInt16LE(dos.time, 10);
    localHeader.writeUInt16LE(dos.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(source.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(useDeflate ? 8 : 0, 10);
    centralHeader.writeUInt16LE(dos.time, 12);
    centralHeader.writeUInt16LE(dos.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(source.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + payload.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function normalizedThumbnailWidth(value) {
  return Math.max(1, Number(value) || 0) <= 480 ? 480 : 1200;
}

async function withThumbnailSlot(worker) {
  if (activeThumbnails >= THUMBNAIL_CONCURRENCY) {
    await new Promise(resolve => thumbnailWaiters.push(resolve));
  }
  activeThumbnails += 1;
  try { return await worker(); }
  finally {
    activeThumbnails = Math.max(0, activeThumbnails - 1);
    thumbnailWaiters.shift()?.();
  }
}

async function createAssetThumbnail(file, requestedWidth = 480) {
  const source = path.resolve(String(file || ''));
  if (!runtime.isWorkspacePath(source) || !SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(source).toLowerCase())) {
    throw new Error('不支持生成此文件的预览图');
  }
  const stat = await fsp.stat(source).catch(() => null);
  if (!stat?.isFile()) throw new Error('原始图片不存在');
  const width = normalizedThumbnailWidth(requestedWidth);
  const quality = width > 480 ? 84 : 78;
  const cacheKey = crypto.createHash('sha256')
    .update(`${source}\0${Math.trunc(stat.mtimeMs)}\0${stat.size}\0${width}\0webp`)
    .digest('hex');
  const target = path.join(thumbnailRoot(), cacheKey.slice(0, 2), `${cacheKey}.webp`);
  if ((await fsp.stat(target).catch(() => null))?.isFile()) return { file: target, width, cacheHit: true };
  if (thumbnailJobs.has(target)) return thumbnailJobs.get(target);

  const job = withThumbnailSlot(async () => {
    if ((await fsp.stat(target).catch(() => null))?.isFile()) return { file: target, width, cacheHit: true };
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`;
    try {
      await sharp(source, { failOn: 'none', animated: false, limitInputPixels: 120_000_000 })
        .rotate()
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 3, smartSubsample: true })
        .toFile(temporary);
      await fsp.rename(temporary, target);
      return { file: target, width, cacheHit: false };
    } finally {
      await fsp.rm(temporary, { force: true }).catch(() => {});
    }
  }).finally(() => thumbnailJobs.delete(target));
  thumbnailJobs.set(target, job);
  return job;
}

async function pruneThumbnailCache(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  const root = thumbnailRoot();
  const buckets = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const bucket of buckets) {
    if (!bucket.isDirectory()) continue;
    const directory = path.join(root, bucket.name);
    const files = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of files) {
      if (!entry.isFile()) continue;
      const target = path.join(directory, entry.name);
      const stat = await fsp.stat(target).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) await fsp.rm(target, { force: true }).catch(() => {});
    }
    if (!(await fsp.readdir(directory).catch(() => [])).length) await fsp.rmdir(directory).catch(() => {});
  }
}

function workspacePath(value, options = {}) {
  const text = String(value || '').trim();
  if (!text && options.allowEmpty) return '';
  if (!text || !runtime.isWorkspacePath(text)) throw new Error(options.message || '路径不属于当前工作区');
  return path.resolve(text);
}

function managedPath(value, options = {}) {
  const text = String(value || '').trim();
  if (!text && options.allowEmpty) return '';
  if (!text || (!runtime.isWorkspacePath(text) && !runtime.isOutputPath(text))) {
    throw new Error(options.message || '路径不属于当前工作区或成品输出目录');
  }
  return path.resolve(text);
}

function safeTask(task = {}) {
  return {
    ...task,
    productPath: workspacePath(task.productPath, { allowEmpty: task.generationMode === 'template_print', message: '品类图不属于当前工作区' }),
    printPath: workspacePath(task.printPath, { message: '印花图不属于当前工作区' }),
    templateFolderPath: workspacePath(task.templateFolderPath, { message: '套图不属于当前工作区' }),
    masterImagePath: managedPath(task.masterImagePath, { allowEmpty: true, message: '母版图不属于当前工作区或成品输出目录' }),
    masterReferencePath: workspacePath(task.masterReferencePath, { allowEmpty: true, message: '母版参考图不属于当前工作区' }),
    templateRelativePaths: [...new Set((Array.isArray(task.templateRelativePaths)
      ? task.templateRelativePaths
      : task.templateRelativePath ? [task.templateRelativePath] : [])
      .map(value => String(value || '').trim())
      .filter(Boolean))].slice(0, 500)
  };
}

function safeConfig(config = {}) {
  const outputValue = String(config.outputPath || runtime.OUTPUT_ROOT).trim();
  if (!path.isAbsolute(outputValue)) throw new Error('成品输出目录必须填写主电脑上的绝对路径');
  const outputPath = path.resolve(outputValue);
  if (outputPath === path.parse(outputPath).root || outputPath === path.resolve(os.homedir())) {
    throw new Error('成品输出目录必须使用单独的文件夹，不能选择磁盘根目录或用户主目录');
  }
  const forbiddenRoots = ['assets', 'jobs', 'tmp', '.cache'].map(name => path.join(runtime.WORKSPACE_ROOT, name));
  if (outputPath === path.resolve(runtime.WORKSPACE_ROOT) || forbiddenRoots.some(root => isWithin(root, outputPath))) {
    throw new Error('成品输出目录不能使用素材、任务缓存或工作区根目录');
  }
  return {
    ...config,
    categoriesPath: workspacePath(config.categoriesPath, { allowEmpty: true }),
    printsPath: workspacePath(config.printsPath, { allowEmpty: true }),
    detailSetsPath: workspacePath(config.detailSetsPath, { allowEmpty: true }),
    outputPath
  };
}

function publicConfig(config) {
  return { ...config, workspaceRoot: runtime.WORKSPACE_ROOT, defaultOutputPath: runtime.OUTPUT_ROOT };
}

function jobFile(id) {
  return path.join(jobRoot(), `${String(id).replace(/[^a-zA-Z0-9-]/g, '')}.json`);
}

async function readJob(id) {
  try { return JSON.parse(await fsp.readFile(jobFile(id), 'utf8')); } catch { return null; }
}

async function writeJob(job) {
  await fsp.mkdir(jobRoot(), { recursive: true });
  const file = jobFile(job.id);
  const temporary = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(job, null, 2));
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fsp.rename(temporary, file);
      return job;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY'].includes(error?.code) || attempt === 5) break;
      await wait(80 * (attempt + 1));
    }
  }
  throw lastError;
}

async function modelPackageWorkspaceForUser(user) {
  if (!user || user.role !== 'member') return user?.workspaceId || runtime.WORKSPACE_ID;
  if (!user.parentUserId) return user.workspaceId;
  const users = await auth.listUsers();
  const parent = users.find(item => item.id === user.parentUserId && item.role === 'admin');
  return parent?.workspaceId || user.workspaceId;
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    clientKey: job.clientKey || '',
    method: job.method,
    status: job.status,
    result: job.status === 'completed' ? job.result : undefined,
    error: job.status === 'failed' ? job.error : undefined,
    progress: job.progress && typeof job.progress === 'object' ? job.progress : {},
    createdAt: job.createdAt,
    startedAt: job.startedAt || '',
    finishedAt: job.finishedAt || ''
  };
}

async function runNextJobs() {
  while (activeJobs < MAX_ACTIVE_JOBS && pendingJobs.length) {
    const job = pendingJobs.shift();
    activeJobs += 1;
    void runtime.runWithWorkspace(job.workspaceId, async () => {
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      job.progress = { ...(job.progress || {}), phase: 'running', message: job.progress?.message || '后台任务已开始', updatedAt: new Date().toISOString() };
      const controller = new AbortController();
      activeJobControllers.set(job.id, controller);
      await writeJob(job);
      try {
        let progressWrite = Promise.resolve();
        const reportProgress = update => {
          job.progress = { ...(job.progress || {}), ...(update || {}), updatedAt: new Date().toISOString() };
          progressWrite = progressWrite.then(() => writeJob(job));
          return progressWrite;
        };
        job.result = await rpc[job.method](job.args || [], { reportProgress, signal: controller.signal });
        await progressWrite;
        job.status = 'completed';
        job.progress = { ...(job.progress || {}), phase: 'completed', percent: 100, message: job.progress?.message || '任务已完成', updatedAt: new Date().toISOString() };
      } catch (error) {
        job.status = 'failed';
        job.error = controller.signal.aborted ? '任务已手动停止' : (error?.message || String(error));
        job.progress = { ...(job.progress || {}), phase: 'failed', message: job.error, updatedAt: new Date().toISOString() };
      } finally {
        activeJobControllers.delete(job.id);
        job.finishedAt = new Date().toISOString();
        await writeJob(job);
        activeJobs -= 1;
        runNextJobs();
      }
    }, { modelPackageWorkspaceId: job.modelPackageWorkspaceId || job.workspaceId });
  }
}

async function enqueueJob(method, args, clientKey = '', modelPackageWorkspaceId = runtime.WORKSPACE_ID) {
  const workspaceId = runtime.WORKSPACE_ID;
  const normalizedClientKey = String(clientKey || '').slice(0, 160);
  const scopedClientKey = normalizedClientKey ? `${workspaceId}:${normalizedClientKey}` : '';
  if (scopedClientKey && jobsByClientKey.has(scopedClientKey)) {
    const existing = await readJob(jobsByClientKey.get(scopedClientKey));
    if (existing) return existing;
    jobsByClientKey.delete(scopedClientKey);
  }
  const job = {
    id: crypto.randomUUID(),
    workspaceId,
    modelPackageWorkspaceId,
    clientKey: normalizedClientKey,
    method,
    args,
    status: 'queued',
    result: null,
    error: '',
    createdAt: new Date().toISOString(),
    startedAt: '',
    finishedAt: '',
    progress: { phase: 'queued', current: 0, total: 0, percent: 0, message: '等待服务器处理', updatedAt: new Date().toISOString() }
  };
  await writeJob(job);
  if (scopedClientKey) jobsByClientKey.set(scopedClientKey, job.id);
  pendingJobs.push(job);
  runNextJobs();
  return job;
}

async function cancelJob(id) {
  const job = await readJob(id);
  if (!job) return null;
  if (!['queued', 'running'].includes(job.status)) return job;
  const controller = activeJobControllers.get(job.id);
  if (controller) {
    controller.abort();
    job.progress = { ...(job.progress || {}), phase: 'stopping', message: '正在停止当前任务…', updatedAt: new Date().toISOString() };
    await writeJob(job);
    return job;
  }
  const index = pendingJobs.findIndex(item => item.id === job.id);
  if (index >= 0) pendingJobs.splice(index, 1);
  job.status = 'failed';
  job.error = '任务已手动停止';
  job.progress = { ...(job.progress || {}), phase: 'failed', message: job.error, updatedAt: new Date().toISOString() };
  job.finishedAt = new Date().toISOString();
  await writeJob(job);
  return job;
}

async function cancelWorkspaceJobs(workspaceId = runtime.WORKSPACE_ID) {
  const ids = new Set();
  for (const job of pendingJobs) {
    if (job.workspaceId === workspaceId) ids.add(job.id);
  }
  for (const id of activeJobControllers.keys()) {
    const job = await readJob(id);
    if (job?.workspaceId === workspaceId) ids.add(id);
  }
  const cancelled = [];
  for (const id of ids) {
    const job = await cancelJob(id);
    if (job) cancelled.push(job);
  }
  return {
    count: cancelled.length,
    jobs: cancelled.map(publicJob)
  };
}

async function initializeJobs() {
  await fsp.mkdir(jobRoot(), { recursive: true });
  const files = await fsp.readdir(jobRoot()).catch(() => []);
  for (const name of files.filter(name => name.endsWith('.json'))) {
    const job = await readJob(name.slice(0, -5));
    if (!job) continue;
    if (job.clientKey) jobsByClientKey.set(`${runtime.WORKSPACE_ID}:${job.clientKey}`, job.id);
    if (job.status === 'queued' || job.status === 'running') {
      job.status = 'failed';
      job.error = '服务重启，任务执行状态已中断，请重新提交。';
      job.progress = { ...(job.progress || {}), phase: 'failed', message: job.error, updatedAt: new Date().toISOString() };
      job.finishedAt = new Date().toISOString();
      await markInterruptedGenerationProgress(job, job.error);
      await writeJob(job);
    }
  }
}

function consumeJobRate(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown');
  const recent = (jobRateWindows.get(key) || []).filter(value => now - value < 60 * 60 * 1000);
  if (recent.length >= JOB_RATE_LIMIT_PER_HOUR) return false;
  recent.push(now);
  jobRateWindows.set(key, recent);
  return true;
}

function consumeLoginRate(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown');
  const recent = (loginRateWindows.get(key) || []).filter(value => now - value < 15 * 60 * 1000);
  if (recent.length >= 20) return false;
  recent.push(now);
  loginRateWindows.set(key, recent);
  return true;
}

function requestIsSecure(req) {
  return Boolean(req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
}

async function moveUploadedFile(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fsp.rename(source, destination);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fsp.copyFile(source, destination);
    await fsp.rm(source, { force: true });
  }
}

async function handleFolderUpload(req, res) {
  const kindMap = { product: 'product', print: 'print', template: 'template' };
  const kind = kindMap[req.params.kind];
  if (!kind) return res.status(400).json({ error: '不支持的素材类型' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: '没有收到文件' });

  let relativePaths = [];
  try { relativePaths = JSON.parse(req.body.relativePaths || '[]'); } catch {}
  const normalized = files.map((file, index) => safeRelative(relativePaths[index], uploadName(file)));
  const firstParts = normalized.map(value => value.split('/')[0]);
  const commonRoot = firstParts.length && firstParts.every(value => value === firstParts[0]) && normalized.some(value => value.includes('/'))
    ? firstParts[0]
    : '';
  const collection = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const collectionRoot = path.join(assetRoot(), kind, collection, commonRoot || '素材');

  for (let index = 0; index < files.length; index += 1) {
    const relative = commonRoot ? normalized[index].split('/').slice(1).join('/') : normalized[index];
    const target = path.join(collectionRoot, safeRelative(relative, uploadName(files[index])));
    if (!isWithin(collectionRoot, target)) throw new Error('上传路径无效');
    await moveUploadedFile(files[index].path, target);
  }

  return res.json({ root: collectionRoot, count: files.length, name: commonRoot || '素材' });
}

const ASSET_KIND_MAP = Object.freeze({ product: 'product', print: 'print', template: 'template' });
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff']);

function assetKind(value) {
  return ASSET_KIND_MAP[String(value || '')] || '';
}

function cleanExpiredAssetSyncSessions() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, session] of assetSyncSessions) {
    if (session.createdAt < cutoff) assetSyncSessions.delete(id);
  }
}

async function prepareAssetSync(kindValue, payload = {}, workspaceId = runtime.WORKSPACE_ID) {
  cleanExpiredAssetSyncSessions();
  const kind = assetKind(kindValue);
  if (!kind) throw new Error('不支持的素材类型');
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!files.length) throw new Error('选择的文件夹里没有支持的图片');
  if (files.length > 50000) throw new Error('单次扫描最多支持 50000 张图片');

  const kindRoot = path.join(assetRoot(), kind);
  const requestedRoot = String(payload.currentRoot || '').trim();
  const requestedStat = requestedRoot && isWithin(kindRoot, requestedRoot)
    ? await fsp.stat(requestedRoot).catch(() => null)
    : null;
  const rootName = safeSegment(payload.rootName, '素材');
  const root = requestedStat?.isDirectory()
    ? path.resolve(requestedRoot)
    : path.join(kindRoot, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`, rootName);
  const entries = [];
  const seen = new Set();

  for (const item of files) {
    const relativePath = safeRelative(item?.relativePath, item?.name || 'image');
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) continue;
    const key = relativePath.toLocaleLowerCase('zh-CN');
    if (seen.has(key)) continue;
    seen.add(key);
    const size = Math.max(0, Number(item?.size) || 0);
    const lastModified = Math.max(0, Number(item?.lastModified) || 0);
    const target = path.join(root, relativePath);
    if (!isWithin(root, target)) continue;
    const current = await fsp.stat(target).catch(() => null);
    const unchanged = current?.isFile()
      && current.size === size
      && (!lastModified || Math.abs(current.mtimeMs - lastModified) < 2000);
    entries.push({ relativePath, size, lastModified, needed: !unchanged });
  }

  if (!entries.length) throw new Error('选择的文件夹里没有支持的图片');
  const session = {
    id: crypto.randomUUID(),
    workspaceId,
    kind,
    root,
    rootName,
    createdAt: Date.now(),
    entries: new Map(entries.map(item => [item.relativePath, item])),
    uploaded: 0,
    uploadedBytes: 0
  };
  assetSyncSessions.set(session.id, session);
  return {
    sessionId: session.id,
    root,
    rootName,
    total: entries.length,
    skipped: entries.filter(item => !item.needed).length,
    neededRelativePaths: entries.filter(item => item.needed).map(item => item.relativePath)
  };
}

async function uploadAssetSyncBatch(sessionId, files, relativePaths, lastModifiedValues, workspaceId = runtime.WORKSPACE_ID) {
  const session = assetSyncSessions.get(String(sessionId || ''));
  if (!session || session.workspaceId !== workspaceId) throw new Error('扫描会话已失效，请重新选择文件夹');
  let uploaded = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const relativePath = safeRelative(relativePaths[index], uploadName(file));
    const entry = session.entries.get(relativePath);
    if (!entry?.needed) {
      await fsp.rm(file.path, { force: true });
      continue;
    }
    const target = path.join(session.root, relativePath);
    if (!isWithin(session.root, target)) throw new Error('上传路径无效');
    await moveUploadedFile(file.path, target);
    const lastModified = Math.max(0, Number(lastModifiedValues[index]) || entry.lastModified || 0);
    if (lastModified) {
      const modifiedAt = new Date(lastModified);
      await fsp.utimes(target, modifiedAt, modifiedAt).catch(() => {});
    }
    entry.needed = false;
    uploaded += 1;
    session.uploaded += 1;
    session.uploadedBytes += Number(file.size) || 0;
  }
  return { uploaded, totalUploaded: session.uploaded };
}

async function finishAssetSync(sessionId, workspaceId = runtime.WORKSPACE_ID) {
  const session = assetSyncSessions.get(String(sessionId || ''));
  if (!session || session.workspaceId !== workspaceId) throw new Error('扫描会话已失效，请重新选择文件夹');
  const missing = [...session.entries.values()].filter(item => item.needed).length;
  if (missing) throw new Error(`还有 ${missing} 张图片未上传完成`);
  await fsp.mkdir(session.root, { recursive: true });
  assetSyncSessions.delete(session.id);
  return {
    root: session.root,
    name: session.rootName,
    count: session.entries.size,
    uploaded: session.uploaded,
    skipped: session.entries.size - session.uploaded,
    uploadedBytes: session.uploadedBytes
  };
}

async function assetLibraryRoot(kindValue, requestedRoot = '') {
  const kind = assetKind(kindValue);
  if (!kind) throw new Error('不支持的素材类型');
  const kindRoot = path.join(assetRoot(), kind);
  const value = String(requestedRoot || '').trim();
  if (value) {
    const root = path.resolve(value);
    if (!isWithin(kindRoot, root)) throw new Error('素材目录不属于当前素材库');
    const stat = await fsp.stat(root).catch(() => null);
    if (!stat?.isDirectory()) throw new Error('素材目录不存在，请重新选择文件夹');
    return { kind, kindRoot, root };
  }
  const root = path.join(kindRoot, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`, '手动添加');
  await fsp.mkdir(root, { recursive: true });
  return { kind, kindRoot, root };
}

async function moveAssetFileWithoutOverwrite(source, root, relativePath) {
  const normalized = safeRelative(relativePath, path.basename(source));
  const extension = path.extname(normalized).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) return '';
  const directory = path.dirname(normalized);
  const baseName = path.basename(normalized, extension);
  for (let attempt = 1; attempt <= 1000; attempt += 1) {
    const fileName = attempt === 1 ? `${baseName}${extension}` : `${baseName} (${attempt})${extension}`;
    const target = path.join(root, directory === '.' ? '' : directory, fileName);
    if (!isWithin(root, target)) throw new Error('上传路径无效');
    await fsp.mkdir(path.dirname(target), { recursive: true });
    let handle;
    try {
      handle = await fsp.open(target, 'wx');
      await handle.close();
      handle = null;
      await fsp.copyFile(source, target);
      await fsp.rm(source, { force: true });
      return target;
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code === 'EEXIST') continue;
      await fsp.rm(target, { force: true }).catch(() => {});
      throw error;
    }
  }
  throw new Error(`同名素材过多：${path.basename(normalized)}`);
}

async function addAssetFiles(kindValue, requestedRoot, files = [], relativePaths = []) {
  if (!files.length) throw new Error('没有收到图片文件');
  if (files.length > 500) throw new Error('单次最多添加 500 张图片');
  const library = await assetLibraryRoot(kindValue, requestedRoot);
  const added = [];
  let skipped = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const relativePath = safeRelative(relativePaths[index], uploadName(file));
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
      skipped += 1;
      await fsp.rm(file.path, { force: true });
      continue;
    }
    added.push(await moveAssetFileWithoutOverwrite(file.path, library.root, relativePath));
  }
  if (!added.length) throw new Error('没有可添加的图片文件');
  return { root: library.root, added: added.length, skipped, paths: added };
}

async function removeEmptyAssetParents(directory, root) {
  let current = path.resolve(directory);
  const boundary = path.resolve(root);
  while (current !== boundary && isWithin(boundary, current)) {
    const entries = await fsp.readdir(current).catch(() => null);
    if (!entries || entries.length) break;
    await fsp.rmdir(current).catch(() => {});
    current = path.dirname(current);
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function removeFileWithRetry(file) {
  const retryable = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fsp.chmod(file, 0o666).catch(() => {});
      await fsp.rm(file, { force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!retryable.has(error?.code) || attempt === 4) break;
      await wait(80 * (attempt + 1));
    }
  }
  throw lastError;
}

async function deleteAssetFiles(kindValue, requestedRoot, paths = []) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('请先选择需要删除的素材');
  if (paths.length > 500) throw new Error('单次最多删除 500 张图片');
  const library = await assetLibraryRoot(kindValue, requestedRoot);
  let deleted = 0;
  for (const value of [...new Set(paths.map(item => String(item || '').trim()).filter(Boolean))]) {
    const file = path.resolve(value);
    if (!isWithin(library.root, file) || !isWithin(library.kindRoot, file)) throw new Error('存在不属于当前素材库的文件');
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile() || !SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    await removeFileWithRetry(file);
    await removeEmptyAssetParents(path.dirname(file), library.root);
    deleted += 1;
  }
  return { root: library.root, deleted };
}

const rpc = {
  getConfig: async () => publicConfig(await runtime.loadConfig()),
  getApiConcurrencySettings: () => runtime.publicApiConcurrencySettings(),
  getApiSettings: () => runtime.loadApiSettings(),
  saveApiSettings: ([payload]) => runtime.saveApiSettings(payload || {}),
  testApiSettings: ([payload]) => runtime.testApiSettings(payload || {}),
  testAnalysisApi: ([payload]) => runtime.testAnalysisApi(payload || {}),
  saveConfig: async ([config]) => publicConfig(await runtime.saveConfig(safeConfig(config || {}))),
  resetConfig: async () => publicConfig(await runtime.resetConfig()),
  getPromptSettings: async (args, context) => {
    if (context?.user?.role === 'superadmin') return runtime.loadPromptSettings();
    if (context?.user?.role === 'admin' && await runtime.canAdminViewPromptSettings()) return runtime.loadPromptSettings();
    throw new Error('没有查看网站提示词的权限');
  },
  savePromptSetting: ([id, value]) => runtime.savePromptSetting(id, value),
  resetPromptSetting: ([id]) => runtime.resetPromptSetting(id),
  listImages: ([root, query]) => runtime.scanImages(workspacePath(root, { allowEmpty: true }), String(query || '')),
  listTemplateFolders: () => runtime.listTemplateFolders(),
  deleteTemplateFolder: ([folder]) => runtime.deleteTemplateFolder(workspacePath(folder)),
  generateTask: ([task], context) => runtime.generateTask(safeTask(task || {}), context || {}),
  generateTemplateMaster: ([task], context) => runtime.generateTemplateTaskMaster(safeTask(task || {}), context || {}),
  listTemplates: ([folder]) => runtime.listTemplates(workspacePath(folder)),
  getTemplatePreparation: ([folder]) => runtime.getTemplatePreparation(workspacePath(folder)),
  prepareTemplates: ([folder]) => runtime.prepareTemplateFolder(workspacePath(folder)),
  saveTemplateConfig: ([payload]) => runtime.saveTemplateConfiguration({ ...(payload || {}), folder: workspacePath(payload?.folder) }),
  analyzeTemplates: ([folder]) => runtime.analyzeTemplateFolder(workspacePath(folder)),
  analyzeTemplateItems: ([payload], context) => runtime.analyzeTemplateItems({
    folder: workspacePath(payload?.folder),
    relativePaths: Array.isArray(payload?.relativePaths) ? payload.relativePaths.map(String) : []
  }, context || {}),
  analyzeTemplateItemWithReference: ([payload], context) => runtime.analyzeTemplateItemWithReference({
    folder: workspacePath(payload?.folder),
    relativePath: String(payload?.relativePath || ''),
    referenceRelativePath: String(payload?.referenceRelativePath || '')
  }, context || {}),
  getProductProfile: ([folder]) => runtime.loadTemplateProductProfile(workspacePath(folder)),
  analyzeProductProfile: ([file]) => runtime.analyzeProductProfile(workspacePath(file)),
  saveProductProfile: ([payload]) => runtime.saveTemplateProductProfile({ ...(payload || {}), folder: workspacePath(payload?.folder) }),
  generateFree: ([payload], context) => runtime.generateFree({ ...(payload || {}), sourcePath: workspacePath(payload?.sourcePath) }, context || {}),
  listReviews: () => runtime.reviewFolders(),
  approveReview: ([folder]) => runtime.approveReviewFolder(managedPath(folder)),
  setReviewStatus: ([payload]) => runtime.setTemplateManualStatus({ ...(payload || {}), folder: managedPath(payload?.folder) }),
  generateTemplates: async ([payload], context) => {
    const results = [];
    for (const folder of [...new Set((payload?.folders || []).map(value => managedPath(value)))]) {
      if (context?.signal?.aborted) throw new Error('任务已停止');
      results.push(await runtime.generateTemplateSetForFolder(folder, payload?.onlyMissing !== false, null, context || {}));
    }
    return results;
  },
  regenerateMaster: ([folder]) => runtime.regenerateMasterForReviewFolder(managedPath(folder)),
  regenerateTemplate: ([payload], context) => runtime.regenerateSingleTemplate({
    ...(payload || {}),
    folder: managedPath(payload?.folder),
    relativePath: String(payload?.relativePath || ''),
    referenceResultRelativePath: String(payload?.referenceResultRelativePath || '')
  }, context || {}),
  batchApproveReviews: ([folders]) => runtime.batchApproveReviewFolders((folders || []).map(value => managedPath(value))),
  deleteReviews: ([folders]) => runtime.deleteReviewFolders((folders || []).map(value => managedPath(value))),
  getTitleLibrary: async () => runtime.publicTitleLibrary(await runtime.loadTitleLibrary()),
  listReadyTitleTasks: () => runtime.listReadyTitleTasks(),
  generateTitleForTask: ([folder]) => runtime.generateTitleForTask(managedPath(folder)),
  saveTitleSetup: ([payload]) => runtime.saveTitleSetup(payload || {}),
  generateTitles: ([payload]) => runtime.generateTitles(payload || {}),
  exportTitles: ([payload]) => runtime.exportTitles(payload || {}),
  getTaobaoPublishSettings: () => runtime.getTaobaoPublishSettings(),
  saveTaobaoPublishSettings: ([payload]) => runtime.saveTaobaoPublishSettings(payload || {}),
  listTaobaoPublishTasks: () => runtime.listTaobaoPublishTasks(),
  queueTaobaoPublishTask: ([payload]) => runtime.queueTaobaoPublishTask({
    ...(payload || {}),
    folder: managedPath(payload?.folder),
    categoryId: String(payload?.categoryId || '')
  }),
  getFileLink: ([target, kind]) => {
    const file = managedPath(target);
    const token = runtime.fileToken(file);
    if (kind === 'zip') return `/api/zip/${token}`;
    return kind === 'folder' ? `/api/browse?path=${token}` : `/api/files/${token}?download=1`;
  }
};

async function startServer() {
  const existingUsers = await auth.listUsers();
  for (const user of existingUsers) {
    await runtime.runWithWorkspace(user.workspaceId, async () => {
      await runtime.initializeRuntime();
      await runtime.billing.ensureAccount(user.workspaceId);
      await Promise.all([fsp.mkdir(tempRoot(), { recursive: true }), initializeJobs()]);
    });
  }

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'same-origin' },
    contentSecurityPolicy: false
  }));
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    const queue = runtime.getImageSchedulerSnapshot();
    return res.json({
      ok: true,
      commit: String(process.env.APP_COMMIT_SHA || 'unknown'),
      uptimeSeconds: Math.floor(process.uptime()),
      activeImageRequests: queue.active,
      queuedImageRequests: queue.queued,
      currentImageConcurrency: queue.currentConcurrency,
      maxImageConcurrency: queue.maxConcurrency,
      imageStartIntervalMs: queue.minStartIntervalMs
    });
  });

  app.get('/api/auth/status', async (req, res) => {
    const user = await auth.userFromRequest(req);
    return res.json({ data: { authenticated: Boolean(user), bootstrapRequired: !(await auth.hasUsers()), user } });
  });

  app.post('/api/auth/bootstrap', async (req, res) => {
    try {
      const user = await auth.createUser(req.body || {}, { bootstrap: true });
      await runtime.runWithWorkspace(user.workspaceId, () => runtime.initializeRuntime());
      await runtime.billing.ensureAccount(user.workspaceId);
      const token = await auth.createSession(user);
      res.setHeader('Set-Cookie', auth.sessionCookie(token, requestIsSecure(req)));
      return res.status(201).json({ data: { user } });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    if (!consumeLoginRate(req.ip)) return res.status(429).json({ error: '登录尝试过于频繁，请 15 分钟后再试' });
    const user = await auth.authenticate(req.body?.username, req.body?.password);
    if (!user) return res.status(401).json({ error: '账号或密码不正确' });
    const token = await auth.createSession(user);
    res.setHeader('Set-Cookie', auth.sessionCookie(token, requestIsSecure(req)));
    return res.json({ data: { user } });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', auth.clearSessionCookie(requestIsSecure(req)));
    return res.json({ data: { ok: true } });
  });

  async function runTaobaoPublishWithToken(token, worker) {
    const wanted = String(token || '');
    if (!wanted) throw new Error('淘宝发布助手令牌无效');
    const users = await auth.listUsers();
    const workspaceIds = [...new Set(users.map(user => user.workspaceId).filter(Boolean))];
    for (const workspaceId of workspaceIds) {
      const matched = await runtime.runWithWorkspace(workspaceId, async () => {
        const settings = await runtime.getTaobaoPublishSettings();
        return String(settings.token || '') === wanted;
      });
      if (matched) return runtime.runWithWorkspace(workspaceId, worker);
    }
    throw new Error('淘宝发布助手令牌无效');
  }

  app.post('/api/taobao/publish/claim', async (req, res) => {
    try {
      const token = String(req.body?.token || '');
      return res.json({ data: await runTaobaoPublishWithToken(token, () => runtime.claimTaobaoPublishTask(req.body || {})) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/taobao/publish/tasks/:id/package', async (req, res) => {
    try {
      const token = String(req.query.token || req.get('x-caishen-taobao-token') || '');
      return res.json({ data: await runTaobaoPublishWithToken(token, () => runtime.getTaobaoPublishPackage(req.params.id)) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/taobao/publish/tasks/:id/images/:group/:index', async (req, res) => {
    try {
      const token = String(req.query.token || req.get('x-caishen-taobao-token') || '');
      const file = await runTaobaoPublishWithToken(token, async () => {
        const pack = await runtime.getTaobaoPublishPackage(req.params.id);
        const groupMap = {
          main: 'mainImages',
          ratio: 'ratioImages',
          detail: 'detailImages'
        };
        const key = groupMap[String(req.params.group || '')];
        const index = Math.max(0, Math.trunc(Number(req.params.index) || 0));
        const image = key ? pack.images?.[key]?.[index] : null;
        if (!image?.outputPath || !runtime.isOutputPath(image.outputPath)) throw new Error('淘宝发布图片不存在');
        return image.outputPath;
      });
      return res.sendFile(file, { dotfiles: 'allow' });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/taobao/publish/tasks/:id/status', async (req, res) => {
    try {
      const token = String(req.body?.token || '');
      return res.json({ data: await runTaobaoPublishWithToken(token, () => runtime.updateTaobaoPublishStatus(req.params.id, req.body || {})) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.use('/api', async (req, res, next) => {
    const user = await auth.userFromRequest(req);
    if (!user) return res.status(401).json({ error: '请先登录' });
    req.user = user;
    req.modelPackageWorkspaceId = await modelPackageWorkspaceForUser(user);
    return runtime.runWithWorkspace(user.workspaceId, () => next(), { modelPackageWorkspaceId: req.modelPackageWorkspaceId });
  });

  app.post('/api/auth/password', async (req, res) => {
    try {
      const user = await auth.changeOwnPassword(req.user.id, req.body?.currentPassword, req.body?.newPassword);
      return res.json({ data: user });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/auth/users', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以查看团队账号' });
    const users = await auth.listUsers();
    return res.json({ data: visibleUsersForActor(users, req.user) });
  });

  app.post('/api/auth/users', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以创建团队账号' });
    try {
      const payload = { ...(req.body || {}) };
      if (req.user.role !== 'superadmin') payload.role = 'member';
      const user = await auth.createUser(payload, {
        actorRole: req.user.role,
        parentUserId: req.user.role === 'admin' ? req.user.id : ''
      });
      await runtime.runWithWorkspace(user.workspaceId, () => runtime.initializeRuntime());
      await runtime.billing.ensureAccount(user.workspaceId);
      return res.status(201).json({ data: user });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.patch('/api/auth/users/:id', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以管理团队账号' });
    try {
      const target = await auth.getUserById(req.params.id);
      if (!canManageUser(req.user, target)) return res.status(403).json({ error: `不能编辑该${roleName(target?.role)}账号` });
      return res.json({ data: await auth.updateUser(req.params.id, req.body || {}, req.user) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.delete('/api/auth/users/:id', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以管理团队账号' });
    try {
      const target = await auth.getUserById(req.params.id);
      if (!canManageUser(req.user, target)) return res.status(403).json({ error: `不能删除该${roleName(target?.role)}账号` });
      return res.json({ data: await auth.deleteUser(req.params.id, req.user) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/billing/me', async (req, res) => {
    try {
      const days = Math.max(1, Math.min(3660, Math.trunc(Number(req.query.days) || 30)));
      const data = await runtime.billing.getSummary(req.user.workspaceId, 30);
      if (![1, 7, 30].includes(days)) data.spendTotals = {
        ...(data.spendTotals || {}),
        ...(await runtime.billing.getSpendTotals(req.user.workspaceId, [days]))
      };
      data.customSpendDays = days;
      return res.json({ data });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/billing/admin', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以查看团队算力余额' });
    try {
      const allUsers = await auth.listUsers();
      const users = billingVisibleUsersForActor(allUsers, req.user);
      const visibleWorkspaceIds = new Set(users.map(user => user.workspaceId));
      const [rules, accounts, transactions] = await Promise.all([
        req.user.role === 'superadmin' ? runtime.billing.getRules() : Promise.resolve(undefined),
        runtime.billing.listAccounts(users.map(user => user.workspaceId)),
        runtime.billing.listTransactions('', 150)
      ]);
      const visibleTransactions = transactions.filter(entry => visibleWorkspaceIds.has(entry.workspaceId));
      const byWorkspace = new Map(accounts.map(account => [account.workspaceId, account]));
      return res.json({
        data: {
          role: req.user.role,
          ...(req.user.role === 'superadmin' ? { rules } : {}),
          users: users.map(user => ({ ...user, billing: byWorkspace.get(user.workspaceId) })),
          transactionUsers: users.map(user => ({
              id: user.id,
              username: user.username,
              displayName: user.displayName,
              role: user.role,
              active: user.active,
              workspaceId: user.workspaceId
          })),
          transactions: visibleTransactions
        }
      });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.put('/api/billing/rules', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '只有超级管理员可以修改计费规则' });
    try {
      return res.json({ data: await runtime.billing.saveRules(req.body || {}) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.delete('/api/billing/ledger', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '只有超级管理员可以清空费用流水' });
    try {
      return res.json({ data: await runtime.billing.clearTransactions() });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/billing/adjust', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以调整余额' });
    try {
      const user = (await auth.listUsers()).find(item => item.id === String(req.body?.userId || ''));
      if (!user) return res.status(404).json({ error: '账号不存在' });
      let result;
      const amountMinor = billingAmountMinorFromRequest(req.body || {});
      if (req.user.role === 'superadmin') {
        result = await runtime.billing.adjustBalance(user.workspaceId, amountMinor, {
          description: req.body?.description,
          operatorUserId: req.user.id
        });
      } else {
        if (!canManageUser(req.user, user)) return res.status(403).json({ error: '只能给自己的成员账号划拨算力余额' });
        if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return res.status(400).json({ error: '管理员只能输入正数划拨算力余额' });
        result = await runtime.billing.transferBalance(req.user.workspaceId, user.workspaceId, amountMinor, {
          debitDescription: '成员账户划拨',
          creditDescription: '账户充值到账',
          operatorUserId: req.user.id
        });
      }
      return res.json({ data: result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/model-packages', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以选择模型' });
    try {
      return res.json({ data: await runtime.loadModelPackageSettings(req.user) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.put('/api/model-packages/selection', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以切换模型' });
    try {
      return res.json({ data: await runtime.saveSelectedModelPackage(req.body?.selectedModelPackageId) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/rpc', async (req, res) => {
    const method = String(req.body?.method || '');
    const handler = rpc[method];
    if (!handler) return res.status(404).json({ error: `未知操作：${method}` });
    if (!canAccessRpc(req.user, method)) return res.status(403).json({ error: '只有管理员可以访问此设置' });
    if (LONG_JOB_METHODS.has(method)) return res.status(409).json({ error: '该操作必须通过后台任务接口执行' });
    try {
      return res.json({ data: await handler(Array.isArray(req.body?.args) ? req.body.args : [], { user: req.user }) });
    } catch (error) {
      console.error(`[rpc:${method}]`, error);
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/jobs', async (req, res) => {
    const method = String(req.body?.method || '');
    if (!LONG_JOB_METHODS.has(method) || !rpc[method]) return res.status(404).json({ error: `未知后台任务：${method}` });
    if (!consumeJobRate(req.ip)) return res.status(429).json({ error: '后台任务提交过于频繁，请稍后再试' });
    try {
      const job = await enqueueJob(method, Array.isArray(req.body?.args) ? req.body.args : [], req.body?.clientKey, req.modelPackageWorkspaceId);
      return res.status(job.status === 'completed' ? 200 : 202).json({ data: publicJob(job) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/jobs/:id', async (req, res) => {
    const job = await readJob(req.params.id);
    if (!job) return res.sendStatus(404);
    return res.json({ data: publicJob(job) });
  });

  app.post('/api/jobs/:id/cancel', async (req, res) => {
    const job = await cancelJob(req.params.id);
    if (!job) return res.sendStatus(404);
    return res.json({ data: publicJob(job) });
  });

  app.post('/api/jobs/cancel-active', async (req, res) => {
    return res.json({ data: await cancelWorkspaceJobs(req.user.workspaceId) });
  });

  app.post('/api/assets/sync/prepare/:kind', async (req, res, next) => {
    try {
      return res.json({ data: await prepareAssetSync(req.params.kind, req.body || {}, req.user.workspaceId) });
    } catch (error) { next(error); }
  });

  app.post('/api/assets/sync/upload/:sessionId', upload.array('files', 80), async (req, res, next) => {
    try {
      let relativePaths = [];
      let lastModifiedValues = [];
      try { relativePaths = JSON.parse(req.body.relativePaths || '[]'); } catch {}
      try { lastModifiedValues = JSON.parse(req.body.lastModified || '[]'); } catch {}
      return res.json({ data: await uploadAssetSyncBatch(req.params.sessionId, req.files || [], relativePaths, lastModifiedValues, req.user.workspaceId) });
    } catch (error) { next(error); }
  });

  app.post('/api/assets/sync/finish/:sessionId', async (req, res, next) => {
    try {
      return res.json({ data: await finishAssetSync(req.params.sessionId, req.user.workspaceId) });
    } catch (error) { next(error); }
  });

  app.post('/api/assets/files/:kind', upload.array('files', 500), async (req, res, next) => {
    try {
      let relativePaths = [];
      try { relativePaths = JSON.parse(req.body.relativePaths || '[]'); } catch {}
      return res.json({ data: await addAssetFiles(req.params.kind, req.body.root, req.files || [], relativePaths) });
    } catch (error) { next(error); }
  });

  app.delete('/api/assets/files/:kind', async (req, res, next) => {
    try {
      return res.json({ data: await deleteAssetFiles(req.params.kind, req.body?.root, req.body?.paths) });
    } catch (error) { next(error); }
  });

  app.post('/api/upload/folder/:kind', upload.array('files', 10000), (req, res, next) => {
    handleFolderUpload(req, res).catch(next);
  });

  app.post('/api/upload/image', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: '没有收到图片' });
      const originalName = uploadName(req.file);
      const extension = path.extname(originalName).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff'].includes(extension)) {
        await fsp.rm(req.file.path, { force: true });
        return res.status(415).json({ error: '不支持的图片格式' });
      }
      const destination = path.join(assetRoot(), 'free', `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${extension}`);
      await moveUploadedFile(req.file.path, destination);
      return res.json({ path: destination, name: safeSegment(originalName), url: fileUrl(destination) });
    } catch (error) { next(error); }
  });

  app.post('/api/upload/title-library', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: '没有收到词库文件' });
      const originalName = uploadName(req.file);
      const extension = path.extname(originalName).toLowerCase();
      if (!['.xlsx', '.csv'].includes(extension)) {
        await fsp.rm(req.file.path, { force: true });
        return res.status(415).json({ error: '仅支持 xlsx 或 csv' });
      }
      const destination = path.join(runtime.WORKSPACE_ROOT, 'imports', `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`, safeSegment(originalName));
      await moveUploadedFile(req.file.path, destination);
      return res.json({ data: await runtime.importTitleLibrary(destination) });
    } catch (error) { next(error); }
  });

  app.get('/api/files/:token', async (req, res) => {
    const file = decodeFileToken(req.params.token);
    const stat = file ? await fsp.stat(file).catch(() => null) : null;
    if (!stat?.isFile()) return res.sendStatus(404);
    if (req.query.download === '1') res.download(file, path.basename(file));
    else {
      res.set('Cache-Control', req.query.v ? 'private, max-age=31536000, immutable' : 'private, no-cache');
      res.sendFile(file);
    }
  });

  app.get('/api/zip/:token', async (req, res, next) => {
    try {
      const folder = decodeFileToken(req.params.token);
      const stat = folder ? await fsp.stat(folder).catch(() => null) : null;
      if (!stat?.isDirectory()) return res.sendStatus(404);
      const archive = await createFolderZip(folder);
      const downloadName = await buildZipDownloadName(folder);
      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': zipAttachmentName(downloadName),
        'Cache-Control': 'private, no-cache'
      });
      return res.send(archive);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/thumbnails/:token', async (req, res) => {
    const file = decodeFileToken(req.params.token);
    const stat = file ? await fsp.stat(file).catch(() => null) : null;
    if (!stat?.isFile() || !SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) return res.sendStatus(404);
    try {
      const thumbnail = await createAssetThumbnail(file, req.query.w);
      res.set({
        'Cache-Control': req.query.v ? 'private, max-age=31536000, immutable' : 'private, no-cache',
        'X-Thumbnail-Cache': thumbnail.cacheHit ? 'HIT' : 'MISS'
      });
      res.type('image/webp');
      return res.sendFile(thumbnail.file, { dotfiles: 'allow' });
    } catch (error) {
      console.warn(`[thumbnail] ${path.basename(file)}: ${error?.message || error}`);
      res.set('Cache-Control', 'private, no-cache');
      return res.sendFile(file);
    }
  });

  app.get('/api/browse', async (req, res) => {
    const folder = decodeFileToken(req.query.path);
    const stat = folder ? await fsp.stat(folder).catch(() => null) : null;
    if (!stat?.isDirectory()) return res.sendStatus(404);
    const entries = await fsp.readdir(folder, { withFileTypes: true });
    const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const items = entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true })).map(entry => {
      const target = path.join(folder, entry.name);
      const token = runtime.fileToken(target);
      const href = entry.isDirectory() ? `/api/browse?path=${token}` : `${fileUrl(target)}?download=1`;
      return `<li><a href="${href}">${entry.isDirectory() ? '文件夹' : '文件'} · ${escape(entry.name)}</a></li>`;
    }).join('');
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>任务文件</title><style>body{font:16px system-ui;max-width:900px;margin:48px auto;padding:0 24px}li{margin:12px 0}a{color:#174b3a}</style><h1>${escape(path.basename(folder))}</h1><ul>${items}</ul>`);
  });

  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use((error, _req, res, _next) => {
    console.error(error);
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `单个文件不能超过 ${UPLOAD_FILE_LIMIT_MB}MB` });
    }
    res.status(400).json({ error: error?.message || '请求失败' });
  });

  const server = app.listen(PORT, HOST, () => {
    console.log(`财神测款机 Web 已启动：http://${HOST}:${PORT}`);
    for (const user of existingUsers) {
      void runtime.runWithWorkspace(user.workspaceId, () => pruneThumbnailCache())
        .catch(error => console.warn(`[thumbnail-cache] ${error?.message || error}`));
    }
  });
  return server;
}

if (require.main === module) startServer().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = {
  addAssetFiles,
  buildZipDownloadName,
  canAccessRpc,
  createAssetThumbnail,
  decodeFileToken,
  deleteAssetFiles,
  isWithin,
  normalizedThumbnailWidth,
  safeRelative,
  startServer,
  UPLOAD_FILE_LIMIT_MB,
  writeJob
};

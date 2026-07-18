const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('@e965/xlsx');

process.env.CAISHEN_DATA_DIR = path.join(os.tmpdir(), `caishen-taobao-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`);

const runtime = require('../src/runtime');
const { metadataPaths } = require('../src/core/review-engine');
const { createTitleWorkbookRows } = require('../src/core/title-task-engine');

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

async function writeImage(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, tinyPng);
}

async function writeTitleWorkbook(file, title) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(createTitleWorkbookRows('餐边柜', [title], '2026/07/18 00:00'));
  XLSX.utils.book_append_sheet(workbook, worksheet, '标题');
  XLSX.writeFile(workbook, file);
}

async function createPublishableReviewTask() {
  const outputRoot = path.join(runtime.WORKSPACE_ROOT, 'outputs');
  const templateRoot = path.join(runtime.WORKSPACE_ROOT, 'assets', 'templates', 'sideboard-set');
  const folder = path.join(outputRoot, 'taobao-ready-0001');
  const relativePaths = [
    '1-1主图/1.jpg',
    '3-4主图/1.jpg',
    '详情页/1.jpg'
  ];

  await runtime.saveConfig({ outputPath: outputRoot, detailSetsPath: path.dirname(templateRoot), auditMode: 'quality' });
  for (const relativePath of relativePaths) {
    await writeImage(path.join(templateRoot, relativePath));
    await writeImage(path.join(folder, relativePath));
    await writeJson(metadataPaths(folder, relativePath).manualReview, {
      Status: '人工通过',
      UpdatedAt: new Date().toISOString()
    });
  }

  await writeJson(metadataPaths(folder).macSource, {
    schemaVersion: 2,
    templateFolderPath: templateRoot,
    templateRelativePaths: relativePaths,
    generationMode: 'template_print',
    status: '待人工筛图',
    createdAt: new Date().toISOString()
  });
  await writeJson(metadataPaths(folder).generationProgress, {
    phase: 'completed',
    pending: 0,
    failed: 0,
    current: relativePaths.length,
    total: relativePaths.length
  });
  await writeTitleWorkbook(path.join(folder, '标题.xlsx'), '餐边柜储物柜客厅靠墙收纳柜');
  return folder;
}

test('taobao publish runtime queues claims packages and records draft save status', async () => {
  const folder = await createPublishableReviewTask();
  const settings = await runtime.getTaobaoPublishSettings();
  const categoryId = 'sideboard';

  const listed = await runtime.listTaobaoPublishTasks();
  assert.equal(listed.tasks.length, 1);
  assert.equal(listed.tasks[0].folder, folder);
  assert.equal(listed.tasks[0].titleReady, true);
  assert.equal(listed.tasks[0].mainImageCount, 1);
  assert.equal(listed.tasks[0].ratioImageCount, 1);
  assert.equal(listed.tasks[0].detailImageCount, 1);

  const queued = await runtime.queueTaobaoPublishTask({ folder, categoryId });
  assert.equal(queued.status, '等待插件接收');
  assert.ok(queued.id);

  await assert.rejects(
    () => runtime.claimTaobaoPublishTask({ token: 'wrong-token' }),
    /令牌无效/
  );

  const claimed = await runtime.claimTaobaoPublishTask({ token: settings.token, extensionId: 'extension-test' });
  assert.equal(claimed.id, queued.id);
  assert.equal(claimed.title, '餐边柜储物柜客厅靠墙收纳柜');
  assert.equal(claimed.category.id, categoryId);
  assert.equal(claimed.images.mainImages.length, 1);
  assert.equal(claimed.images.ratioImages.length, 1);
  assert.equal(claimed.images.detailImages.length, 1);

  const updated = await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    status: '已保存草稿',
    detail: { confirmation: '保存成功' }
  });
  assert.equal(updated.status, '已保存草稿');
  assert.equal(updated.detail.confirmation, '保存成功');
});

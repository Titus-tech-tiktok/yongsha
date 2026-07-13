const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  AUDIT_STATUS,
  MANUAL_REVIEW_STATUS,
  TASK_STATUS,
  addCombinationTasks,
  appendOperationLog,
  applyBatchApproval,
  applyRegenerationStart,
  deriveFolderStatus,
  deriveImageStatus,
  duplicateSelectedTasks,
  extractLogTargetPath,
  filterReviewFolders,
  isFolderReadyForTitle,
  isFullyManuallyApproved,
  markOperationLogRead,
  matchesReviewFilter,
  metadataPaths,
  normalizeAuditStatus,
  normalizeFolderRecord,
  normalizeReviewMetadata,
  normalizeSourceMetadata,
  planBatchApproval,
  planLegacyFolderConfirmation,
  planRegeneration,
  planSelectedFolderDeletion,
  planTaskGeneration,
  safeMetadataName,
  setMainImageIndex,
  setManualDecision,
  summarizeGenerationProgress,
  toMacReviewMetadata,
  toMacSourceMetadata,
  toWpfManualReviewState,
  toWpfOperationLogs,
  toWpfSourceMetadata,
  transitionTask,
  templateCachePaths,
  updateFolderSelection
} = require('../src/core/review-engine');

function source(overrides = {}) {
  return {
    ProductPath: '/素材/餐边柜.png',
    PrintPath: '/素材/印花.png',
    TemplateFolderPath: '/模板/套图1',
    GenerationMode: 'master',
    TaskNumber: 7,
    CreatedAt: '2026-07-10T01:02:03.000Z',
    ...overrides
  };
}

function job(relativePath, overrides = {}) {
  return {
    relativePath,
    outputPath: `/输出/${relativePath}`,
    outputExists: true,
    auditStatus: AUDIT_STATUS.APPROVED,
    manualStatus: '',
    ...overrides
  };
}

function folder(name, jobs, overrides = {}) {
  return {
    folder: `/输出/${name}`,
    name,
    source: source(),
    masterExists: true,
    templateAvailable: true,
    jobs,
    ...overrides
  };
}

test('兼容当前 Mac 与 WPF 的 source/review 元数据字段', () => {
  const mac = normalizeSourceMetadata(JSON.stringify({
    productPath: '/a/product.png',
    printPath: '/a/print.png',
    templateFolderPath: '/a/template',
    templateRelativePaths: ['主图/01.png', '详情/02.png'],
    generationMode: 'template_print',
    taskNumber: 12,
    note: '备注',
    status: '待人工筛图',
    createdAt: '2026-07-10T00:00:00Z'
  }));
  assert.equal(mac.productPath, '/a/product.png');
  assert.equal(mac.generationMode, 'template_print');
  assert.equal(mac.status, '待人工筛图');
  assert.deepEqual(mac.templateRelativePaths, ['主图/01.png', '详情/02.png']);

  const wpf = normalizeSourceMetadata(source());
  assert.equal(wpf.productPath, '/素材/餐边柜.png');
  assert.equal(wpf.taskNumber, 7);
  assert.deepEqual(toWpfSourceMetadata(mac), {
    ModelPath: '',
    ProductPath: '/a/product.png',
    PrintPath: '/a/print.png',
    TemplateFolderPath: '/a/template',
    TemplateRelativePaths: ['主图/01.png', '详情/02.png'],
    GenerationMode: 'template_print',
    TaskNumber: 12,
    CreatedAt: '2026-07-10T00:00:00.000Z'
  });
  assert.equal(toMacSourceMetadata(wpf, { status: '待人工筛图' }).status, '待人工筛图');

  const legacyReview = normalizeReviewMetadata('{"status":"已通过","reviewedAt":"2026-07-10T02:00:00Z"}');
  assert.equal(legacyReview.status, '已通过');
  assert.equal(toMacReviewMetadata(legacyReview).reviewedAt, '2026-07-10T02:00:00.000Z');
});

test('元数据路径同时覆盖早期 Mac 文件和 WPF 隐藏目录', () => {
  assert.equal(safeMetadataName('详情\\场景图01.jpg'), '详情_场景图01');
  const files = metadataPaths('/输出/任务1', '详情/场景图01.jpg');
  assert.equal(files.macSource, path.join('/输出/任务1', '.caishen-source.json'));
  assert.equal(files.macReview, path.join('/输出/任务1', '.caishen-review.json'));
  assert.equal(files.wpfSource, path.join('/输出/任务1', '.caishen-meta', 'source.json'));
  assert.equal(files.manualReview, path.join('/输出/任务1', '.caishen-meta', '详情_场景图01.manual-review.json'));
  assert.equal(files.templateAudit, path.join('/输出/任务1', '.caishen-meta', '详情_场景图01.template-audit-action-v2.json'));
});

test('任务状态机拒绝越级，并保留完成结果', () => {
  const idle = { taskNumber: 1, status: '未开始', productPath: '/p', printPath: '/i', templateFolderPath: '/t' };
  const running = transitionTask(transitionTask(idle, 'queue'), 'start');
  assert.equal(running.status, TASK_STATUS.RUNNING);
  const done = transitionTask(running, 'succeed', { outputFolder: '/out/1', result: { ok: true } });
  assert.equal(done.status, TASK_STATUS.COMPLETED);
  assert.equal(done.outputFolder, '/out/1');
  assert.throws(() => transitionTask(idle, 'succeed'), /不能执行/);
});

test('复制选中任务按 WPF 规则生成新编号并重置运行态', () => {
  const tasks = [
    { id: 'a', taskNumber: 3, isSelected: true, status: '已完成', outputFolder: '/out/a', productPath: '/p1', printPath: '/i1', templateFolderPath: '/t' },
    { id: 'b', taskNumber: 8, isSelected: false, status: '失败', productPath: '/p2', printPath: '/i2', templateFolderPath: '/t' }
  ];
  const result = duplicateSelectedTasks(tasks, { createId: () => 'copy-a' });
  assert.equal(result.length, 3);
  assert.deepEqual(result[2], {
    ...result[0],
    id: 'copy-a',
    taskNumber: 9,
    isSelected: false,
    status: TASK_STATUS.IDLE,
    outputFolder: '',
    masterImagePath: '',
    error: '',
    result: null
  });
});

test('批量素材按笛卡尔积建任务并跳过已有组合', () => {
  const existing = [{ taskNumber: 4, productPath: '/p/A.png', printPath: '/i/1.png' }];
  let id = 0;
  const result = addCombinationTasks(existing, ['/p/A.png', '/p/B.png'], ['/i/1.png', '/i/2.png'], {
    templateFolderPath: '/template',
    createId: () => `new-${++id}`
  });
  assert.equal(result.added.length, 3);
  assert.deepEqual(result.added.map(item => item.taskNumber), [5, 6, 7]);
  assert.equal(result.added.every(item => item.templateFolderPath === '/template'), true);
});

test('生成计划遵循勾选优先，并明确跳过原因', () => {
  const tasks = [
    { taskNumber: 1, isSelected: true, productPath: '/p1', printPath: '/i1', templateFolderPath: '/t1' },
    { taskNumber: 2, isSelected: true, productPath: '', printPath: '/i2', templateFolderPath: '/t2' },
    { taskNumber: 3, isSelected: false, productPath: '/p3', printPath: '/i3', templateFolderPath: '/t3' }
  ];
  const plan = planTaskGeneration(tasks);
  assert.equal(plan.candidates.length, 2);
  assert.equal(plan.runnableCount, 1);
  assert.equal(plan.skippedCount, 1);
  assert.equal(plan.skipped[0].reason, '缺少品类图');

  const printOnly = planTaskGeneration([tasks[1]], { generationMode: 'template_print' });
  assert.equal(printOnly.runnableCount, 1);
});

test('AI 审核状态解析与省钱/质检模式筛选对齐 WPF', () => {
  assert.equal(normalizeAuditStatus('{"passed":false,"reason":"结构错误"}', { outputExists: true }), AUDIT_STATUS.REJECTED);
  assert.equal(normalizeAuditStatus('{"passed":true,"action":"copy_template","reason":"直接复制"}', { outputExists: true }), AUDIT_STATUS.DIRECT);

  const pending = job('主图1.jpg', { auditStatus: AUDIT_STATUS.PENDING });
  assert.equal(deriveImageStatus(pending, 'saving'), '待人工确认');
  assert.equal(deriveImageStatus(pending, 'quality'), AUDIT_STATUS.PENDING);
  assert.equal(matchesReviewFilter(pending, '待人工确认', 'saving'), true);
  assert.equal(matchesReviewFilter(pending, 'AI审核中', 'quality'), true);

  const rejected = job('主图2.jpg', { auditStatus: AUDIT_STATUS.REJECTED });
  assert.equal(matchesReviewFilter(rejected, 'AI不通过', 'quality'), true);
  assert.equal(matchesReviewFilter(rejected, '待人工确认', 'quality'), true);
  const direct = job('主图3.jpg', { auditStatus: AUDIT_STATUS.DIRECT });
  assert.equal(matchesReviewFilter(direct, '直接套模板', 'saving'), true);
});

test('不处理图片不占待生成数量，也不阻塞整套通过和标题条件', () => {
  const skipped = job('说明页.jpg', {
    outputExists: false,
    outputPath: '',
    auditStatus: AUDIT_STATUS.SKIPPED,
    generationAction: 'skip_copy'
  });
  const approved = job('主图.jpg', { manualStatus: MANUAL_REVIEW_STATUS.APPROVED });
  const value = folder('含跳过图片', [approved, skipped]);
  assert.equal(deriveImageStatus(skipped), AUDIT_STATUS.SKIPPED);
  assert.equal(matchesReviewFilter(skipped, '待生成'), false);
  assert.equal(deriveFolderStatus(value), '套图已确认');
  assert.equal(isFullyManuallyApproved(value), true);
  assert.equal(isFolderReadyForTitle(value), true);
});

test('生成摘要明确区分 API 生成、直接复制、跳过和失败', () => {
  const summary = summarizeGenerationProgress([
    job('主图.jpg', { generationAction: 'replace_print' }),
    job('详情1.jpg', { generationAction: 'copy_template', auditStatus: AUDIT_STATUS.DIRECT }),
    job('说明页.jpg', { outputExists: false, outputPath: '', generationAction: 'copy_template', auditStatus: AUDIT_STATUS.SKIPPED }),
    job('详情2.jpg', { outputExists: false, outputPath: '', generationAction: 'replace_print', auditStatus: '' }),
    job('详情3.jpg', { outputExists: false, outputPath: '', generationAction: 'replace_print', auditStatus: '' })
  ], 1);
  assert.deepEqual(summary, {
    total: 5,
    current: 4,
    percent: 80,
    apiGenerated: 1,
    copied: 1,
    skipped: 1,
    failed: 1,
    pending: 1
  });
});

test('文件夹状态按缺图、人工不通过、AI不通过、待确认顺序归类', () => {
  assert.equal(deriveFolderStatus(folder('缺母版', [job('1.jpg')], { masterExists: false })), '母版未生成');
  assert.equal(deriveFolderStatus(folder('部分', [job('1.jpg'), job('2.jpg', { outputExists: false, outputPath: '' })])), '套图部分生成');
  assert.equal(deriveFolderStatus(folder('人工拒绝', [job('1.jpg', { manualStatus: MANUAL_REVIEW_STATUS.REJECTED })])), '部分人工不通过');
  assert.equal(deriveFolderStatus(folder('AI拒绝', [job('1.jpg', { auditStatus: AUDIT_STATUS.REJECTED })])), '部分审核不通过');
  assert.equal(deriveFolderStatus(folder('待确认', [job('1.jpg')])), '待人工确认');
  assert.equal(deriveFolderStatus(folder('完成', [job('1.jpg', { manualStatus: MANUAL_REVIEW_STATUS.APPROVED })])), '套图已确认');
});

test('已通过归档过滤只显示全部图片都人工通过的任务', () => {
  const complete = folder('完成', [
    job('1.jpg', { manualStatus: MANUAL_REVIEW_STATUS.APPROVED }),
    job('2.jpg', { manualStatus: MANUAL_REVIEW_STATUS.APPROVED })
  ]);
  const pending = folder('待确认', [job('1.jpg')]);
  assert.equal(isFullyManuallyApproved(complete), true);
  assert.deepEqual(filterReviewFolders([complete, pending], { filter: '全部图片' }).map(item => item.name), ['待确认']);
  assert.deepEqual(filterReviewFolders([complete, pending], { filter: '已通过' }).map(item => item.name), ['完成']);
});

test('早期 .caishen-review.json 文件夹级通过状态仍可读取和归档', () => {
  const legacy = normalizeFolderRecord({
    folder: '/输出/旧任务',
    sourceJson: { productPath: '/p', printPath: '/i', status: '待人工筛图' },
    reviewJson: { status: '已通过', reviewedAt: '2026-07-10T03:00:00Z' },
    images: [{ name: '母版图.png', path: '/输出/旧任务/母版图.png' }]
  });
  assert.equal(legacy.jobs.length, 0);
  assert.equal(legacy.images.length, 1);
  assert.equal(deriveFolderStatus(legacy), '已通过');
  assert.equal(isFullyManuallyApproved(legacy), true);
  assert.equal(filterReviewFolders([legacy], { filter: '已通过' }).length, 1);
});

test('批量通过完整任务，缺图任务只给跳过决策', () => {
  const ready = folder('完整任务', [job('1.jpg'), job('2.jpg', { manualStatus: MANUAL_REVIEW_STATUS.REJECTED })]);
  const missing = folder('缺图任务', [job('1.jpg'), job('2.jpg', { outputExists: false, outputPath: '' })]);
  const plans = planBatchApproval([ready, missing]);
  assert.equal(plans[0].action, 'approve');
  assert.deepEqual(plans[0].changed, ['1.jpg', '2.jpg']);
  assert.equal(plans[1].action, 'skip');
  assert.match(plans[1].message, /还有 1 张未生成/);

  const result = applyBatchApproval(ready, { time: '2026-07-10T04:00:00Z' });
  assert.equal(result.folder.jobs.every(item => item.manualStatus === MANUAL_REVIEW_STATUS.APPROVED), true);
  assert.equal(result.folder.review.status, '已通过');
  assert.match(result.folder.logs[0].message, /^\[完整任务\]/);
});

test('单张人工决策写状态并追加可定位日志', () => {
  const result = setManualDecision(folder('任务A', [job('详情/场景图01.jpg')]), '详情\\场景图01.jpg', '不通过', {
    time: '2026-07-10T05:00:00Z'
  });
  assert.equal(result.jobs[0].manualStatus, MANUAL_REVIEW_STATUS.REJECTED);
  assert.equal(extractLogTargetPath(result.logs[0].message), '详情/场景图01.jpg');
  assert.deepEqual(toWpfManualReviewState('通过', '2026-07-10T05:00:00Z'), {
    Status: MANUAL_REVIEW_STATUS.APPROVED,
    UpdatedAt: '2026-07-10T05:00:00.000Z'
  });
});

test('操作日志保持 120 条、可标记已读并序列化 WPF 字段', () => {
  let logs = [];
  for (let index = 0; index < 125; index += 1) {
    logs = appendOperationLog(logs, {
      folderName: '任务B',
      message: `生成完成：主图${index}.jpg`,
      time: new Date(Date.UTC(2026, 6, 10, 0, 0, index)).toISOString()
    });
  }
  assert.equal(logs.length, 120);
  assert.equal(logs[0].message, '[任务B] 生成完成：主图124.jpg');
  const marked = markOperationLogRead(logs, logs[0]);
  assert.equal(marked[0].isRead, true);
  assert.deepEqual(Object.keys(toWpfOperationLogs(marked)[0]), ['Time', 'Message', 'IsRead']);
});

test('选择状态仅作用于当前可见任务并支持清理失效目录', () => {
  assert.deepEqual(updateFolderSelection(['/a'], 'select-visible', ['/b', '/c']), ['/a', '/b', '/c']);
  assert.deepEqual(updateFolderSelection(['/a', '/b'], 'toggle', ['/b', '/c']), ['/a', '/c']);
  assert.deepEqual(updateFolderSelection(['/a', '/missing', '/b'], 'prune', ['/a', '/b']), ['/a', '/b']);
  assert.deepEqual(updateFolderSelection(['/a'], 'clear'), []);

  const deletion = planSelectedFolderDeletion(['/a', '/missing'], [
    { folder: '/a', source: {}, review: {} },
    { folder: '/b', source: {}, review: {} }
  ]);
  assert.deepEqual(deletion.folders, ['/a']);
  assert.equal(deletion.clearActiveFolder('/a'), true);
});

test('复刻与重生成计划区分缺图、整套、单张和上一张参考', () => {
  const value = folder('任务C', [job('1.jpg'), job('2.jpg', { outputExists: false, outputPath: '' })]);
  const missing = planRegeneration(value, { mode: 'missing' });
  assert.equal(missing.ready, true);
  assert.deepEqual(missing.jobs.map(item => item.relativePath), ['2.jpg']);
  assert.equal(planRegeneration(value, { mode: 'all' }).jobs.length, 2);

  const single = planRegeneration(value, {
    mode: 'single',
    relativePath: '1.jpg',
    extraInstruction: '柜门颜色保持不变',
    includePreviousResult: true
  });
  assert.equal(single.includePreviousResult, true);
  assert.match(single.message, /含本次备注.*参考上一张结果/);
  assert.equal(planRegeneration(value, { mode: 'single', relativePath: '2.jpg', includePreviousResult: true }).includePreviousResult, false);
  assert.equal(planRegeneration(value, { mode: 'master' }).ready, true);

  const started = applyRegenerationStart(value, single, { time: '2026-07-10T06:00:00Z' });
  assert.equal(started.jobs[0].isGenerating, true);
  assert.equal(started.jobs[0].manualStatus, '');
  assert.equal(started.jobs[0].auditStatus, AUDIT_STATUS.PENDING);
  assert.match(started.logs[0].message, /开始重生成单张/);
});

test('模板分析缓存路径与 WPF 的隐藏目录一致', () => {
  const files = templateCachePaths('/模板/套图1', '详情\\场景图01.jpg');
  assert.equal(files.analysis, path.join('/模板/套图1', '.caishen-template-cache', '详情_场景图01.template-analysis.json'));
  assert.equal(files.replaceMask, path.join('/模板/套图1', '.caishen-template-cache', '详情_场景图01.replace-mask.png'));
  assert.equal(files.cleanMask, path.join('/模板/套图1', '.caishen-template-cache', '详情_场景图01.clean-mask.png'));
});

test('旧版主图排序计划保证同一主图序号唯一，并给出移动/删除操作', () => {
  let images = [
    { relativePath: 'a.jpg', outputPath: '/输出/任务/a.jpg', outputExists: true, mainIndex: 1, result: '通过' },
    { relativePath: 'b.png', outputPath: '/输出/任务/b.png', outputExists: true, mainIndex: null, result: '未筛选' },
    { relativePath: 'c.jpg', outputPath: '/输出/任务/c.jpg', outputExists: true, mainIndex: null, result: '不通过' }
  ];
  images = setMainImageIndex(images, 'b.png', 1);
  assert.equal(images[0].mainIndex, null);
  assert.equal(images[1].mainIndex, 1);
  const plan = planLegacyFolderConfirmation('/输出/任务', images);
  assert.deepEqual(plan.renames, [{ from: '/输出/任务/b.png', to: path.join('/输出/任务', '主图1.png') }]);
  assert.deepEqual(plan.deletes, ['/输出/任务/c.jpg']);
});

test('标题前置条件与 WPF 一致：人工通过优先，否则接受 AI 通过或直接套模板', () => {
  assert.equal(isFolderReadyForTitle(folder('人工通过', [job('1.jpg', { manualStatus: MANUAL_REVIEW_STATUS.APPROVED, auditStatus: AUDIT_STATUS.REJECTED })])), true);
  assert.equal(isFolderReadyForTitle(folder('AI通过', [job('1.jpg', { auditStatus: AUDIT_STATUS.APPROVED })])), true);
  assert.equal(isFolderReadyForTitle(folder('直接复制', [job('1.jpg', { auditStatus: AUDIT_STATUS.DIRECT })])), true);
  assert.equal(isFolderReadyForTitle(folder('人工拒绝', [job('1.jpg', { manualStatus: MANUAL_REVIEW_STATUS.REJECTED })])), false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  PRODUCT_PROFILE_ANALYSIS_PROMPT,
  buildProductProfileAnalysisRequest,
  collectProductProfileBackupEntries,
  createTaskProductProfilePayload,
  getTaskProductProfileFile,
  getTemplateProductProfileFile,
  loadProductProfileForJob,
  mergeProductProfile,
  normalizeProductProfile,
  parseAiProductProfileContent,
  parseProductProfileChatResponse,
  readProductProfileFile,
  resolveProductProfileBackupTarget,
  serializeProductProfile,
  shouldRefreshTaskProductProfile,
  toPromptText,
  toWpfProductProfile,
  writeProductProfileFile
} = require('../src/core/product-profile');

test('归一化 WPF 中文、PascalCase 和 snake_case 商品资料字段', () => {
  assert.deepEqual(normalizeProductProfile({
    品类: '餐边柜',
    默认尺寸: 140,
    Material: '实木',
    structure: true,
    Color: '胡桃色',
    注意: '仅运营查看',
    selling_points: ['大容量', 24, false]
  }), {
    category: '餐边柜',
    dimensions: '140',
    material: '实木',
    structure: 'True',
    color: '胡桃色',
    notes: '仅运营查看',
    sellingPoints: ['大容量', '24', 'False']
  });

  assert.deepEqual(normalizeProductProfile({ 卖点: '免安装\r\n 整装发货 \n' }).sellingPoints, ['免安装', '整装发货']);
});

test('合并规则与 WPF 一致：来源非空字段优先，非空卖点整体替换', () => {
  const target = normalizeProductProfile({ Category: '旧品类', Dimensions: '100cm', SellingPoints: ['旧卖点'] });
  const merged = mergeProductProfile(target, {
    category: '  ',
    dimensions: '120cm',
    Material: '岩板',
    sellingPoints: []
  });
  assert.equal(merged, target);
  assert.deepEqual(merged, {
    category: '旧品类',
    dimensions: '120cm',
    material: '岩板',
    structure: '',
    color: '',
    notes: '',
    sellingPoints: ['旧卖点']
  });

  mergeProductProfile(target, { 默认卖点: ['新卖点'] });
  assert.deepEqual(target.sellingPoints, ['新卖点']);
});

test('商品资料路径与 Windows 版目录约定一致', () => {
  assert.equal(getTemplateProductProfileFile(path.join('/tmp', '套图', '款式1')), path.join('/tmp', '套图', '款式1', '商品资料.json'));
  assert.equal(getTaskProductProfileFile(path.join('/tmp', '输出', '0710-0001')), path.join('/tmp', '输出', '0710-0001', '.caishen-meta', 'product-profile.json'));
});

test('ToPromptText 只带尺寸材质，缺失时使用 WPF 保守提示', () => {
  assert.equal(toPromptText({ Dimensions: '高140cm', 材质: '实木' }), '尺寸：高140cm\n材质：实木');
  assert.equal(
    toPromptText({ Category: '餐边柜', SellingPoints: ['大容量'] }),
    '未提供商品资料。尺寸和材质不得编造；缺资料的信息页应保守处理或复制模板。'
  );
});

test('解析 AI JSON、代码围栏、中文别名和非 JSON 兜底', () => {
  assert.deepEqual(
    parseAiProductProfileContent('说明\n```json\n{"尺寸":"高 140cm","material":"岩板","raw_values":["140cm"]}\n```'),
    normalizeProductProfile({ dimensions: '高 140cm', material: '岩板' })
  );
  assert.deepEqual(
    parseProductProfileChatResponse({ choices: [{ message: { content: '{"dimensions":"56cm","材质":"金属"}' } }] }),
    normalizeProductProfile({ dimensions: '56cm', material: '金属' })
  );
  assert.deepEqual(
    parseAiProductProfileContent('约 120 × 40 × 80cm'),
    normalizeProductProfile({ dimensions: '约 120 × 40 × 80cm' })
  );
  assert.deepEqual(parseAiProductProfileContent('   '), normalizeProductProfile());
});

test('商品资料识别提示词和 chat/completions 请求与 WPF 一致', () => {
  const request = buildProductProfileAnalysisRequest({ model: 'gpt-test', imageDataUrl: 'data:image/png;base64,YQ==' });
  assert.equal(request.model, 'gpt-test');
  assert.equal(request.temperature, 0);
  assert.equal(request.messages[0].role, 'user');
  assert.equal(request.messages[0].content[0].text, PRODUCT_PROFILE_ANALYSIS_PROMPT);
  assert.deepEqual(request.messages[0].content[1], {
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,YQ==' }
  });
  assert.match(PRODUCT_PROFILE_ANALYSIS_PROMPT, /尺寸只能读取图片中真实出现的尺寸文字/);
  assert.match(PRODUCT_PROFILE_ANALYSIS_PROMPT, /只输出合法 JSON/);
});

test('WPF JSON 序列化和任务资料元数据保持字段兼容', () => {
  assert.deepEqual(toWpfProductProfile({
    category: '餐边柜', dimensions: '120cm', material: '实木', sellingPoints: ['大容量']
  }), {
    Category: '餐边柜',
    Dimensions: '120cm',
    Material: '实木',
    Structure: '',
    Color: '',
    Notes: '',
    SellingPoints: ['大容量']
  });
  assert.match(serializeProductProfile({ 尺寸: '120cm' }), /"Dimensions": "120cm"/);

  const payload = createTaskProductProfilePayload({ Material: '实木' }, {
    sourceProductPath: '/tmp/品类图.png',
    sourceProductLastWriteUtc: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T01:00:00.000Z'
  });
  assert.deepEqual(payload, {
    source_product_path: '/tmp/品类图.png',
    source_product_last_write_utc: '2026-07-10T00:00:00.000Z',
    updated_at: '2026-07-10T01:00:00.000Z',
    Dimensions: '',
    Material: '实木',
    Notes: ''
  });
});

test('读写资料文件，并按任务资料优先、模板资料兜底加载', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'caishen-product-profile-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const templateFolder = path.join(root, '套图');
  const outputRoot = path.join(root, '任务');
  await writeProductProfileFile(getTemplateProductProfileFile(templateFolder), { 默认尺寸: '100cm', 材质: '木质' });

  assert.deepEqual(await readProductProfileFile(getTemplateProductProfileFile(templateFolder)), normalizeProductProfile({ dimensions: '100cm', material: '木质' }));
  assert.deepEqual(
    await loadProductProfileForJob({ outputRoot, templateFolderPath: templateFolder }),
    normalizeProductProfile({ dimensions: '100cm', material: '木质' })
  );

  await writeProductProfileFile(getTaskProductProfileFile(outputRoot), { Dimensions: '120cm', Material: '岩板' });
  assert.deepEqual(
    await loadProductProfileForJob({ outputRoot, templateFolderPath: templateFolder }),
    normalizeProductProfile({ dimensions: '120cm', material: '岩板' })
  );
  assert.equal(await readProductProfileFile(path.join(root, '不存在.json')), null);
});

test('任务资料刷新规则复刻 WPF 时间判断', () => {
  assert.equal(shouldRefreshTaskProductProfile({ profileExists: false, productExists: false }), true);
  assert.equal(shouldRefreshTaskProductProfile({ profileExists: true, productExists: false }), false);
  assert.equal(shouldRefreshTaskProductProfile({
    profileExists: true,
    productExists: true,
    profileLastWriteMs: 200,
    productLastWriteMs: 100
  }), false);
  assert.equal(shouldRefreshTaskProductProfile({
    profileExists: true,
    productExists: true,
    profileLastWriteMs: 100,
    productLastWriteMs: 200
  }), true);
});

test('资料备份只收集商品资料.json，并阻止 ZIP 路径穿越', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'caishen-profile-backup-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, 'A', 'B'), { recursive: true });
  await fsp.writeFile(path.join(root, 'A', '商品资料.json'), '{}');
  await fsp.writeFile(path.join(root, 'A', 'B', '商品资料.json'), '{}');
  await fsp.writeFile(path.join(root, 'A', '普通.json'), '{}');

  const entries = await collectProductProfileBackupEntries(root);
  assert.deepEqual(entries.map(item => item.archivePath), ['A/商品资料.json', 'A/B/商品资料.json']);
  assert.equal(resolveProductProfileBackupTarget(root, 'A/B/商品资料.json'), path.join(root, 'A', 'B', '商品资料.json'));
  assert.equal(resolveProductProfileBackupTarget(root, '../商品资料.json'), null);
  assert.equal(resolveProductProfileBackupTarget(root, '/tmp/商品资料.json'), null);
  assert.equal(resolveProductProfileBackupTarget(root, 'A/B/普通.json'), null);
});

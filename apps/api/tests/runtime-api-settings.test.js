const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('API settings keep Change2Pro image and analysis credentials isolated', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-api-settings-'));
  const previousEnv = {
    dataDir: process.env.CAISHEN_DATA_DIR,
    workspaceId: process.env.CAISHEN_WORKSPACE_ID,
    baseUrl: process.env.CAISHEN_API_BASE_URL,
    apiKey: process.env.CAISHEN_API_KEY
  };
  const originalFetch = global.fetch;

  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = 'api-settings';
  process.env.CAISHEN_API_BASE_URL = 'https://api.change2pro.com';
  process.env.CAISHEN_API_KEY = 'legacy-image-secret-key';

  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');

  try {
    await runtime.initializeRuntime();

    const initial = await runtime.loadApiSettings();
    assert.equal(initial.version, 2);
    assert.equal(initial.imageKeyConfigured, true);
    assert.equal(initial.analysisKeyConfigured, false);
    assert.equal(initial.imageConfigured, true);
    assert.equal(initial.analysisConfigured, false);
    assert.equal(Object.hasOwn(initial, 'imageKey'), false);
    assert.equal(Object.hasOwn(initial, 'analysisKey'), false);
    assert.match(initial.imageKeyMasked, /lega/);

    await assert.rejects(
      () => runtime.testApiSettings({ channel: 'analysis' }),
      /文字分析 API 密钥/
    );

    const saved = await runtime.saveApiSettings({
      baseUrl: 'https://api.change2pro.com/',
      imageApiKey: 'image-private-key',
      analysisApiKey: 'analysis-private-key',
      imageModel: 'gpt-image-custom',
      analysisModel: 'gpt-analysis-custom',
      responseFormat: 'url',
      requestTimeoutSeconds: 180,
      allowAdminPromptView: true,
      imageInitialConcurrency: 9,
      imageMaxConcurrency: 21,
      imageStartIntervalMs: 250
    });
    assert.equal(saved.version, 2);
    assert.equal(saved.baseUrl, 'https://api.change2pro.com');
    assert.equal(saved.imageKeyConfigured, true);
    assert.equal(saved.analysisKeyConfigured, true);
    assert.equal(saved.configured, true);
    assert.equal(saved.imageInitialConcurrency, 9);
    assert.equal(saved.imageMaxConcurrency, 21);
    assert.equal(saved.imageStartIntervalMs, 250);
    assert.equal(saved.allowAdminPromptView, true);
    assert.equal(Object.hasOwn(saved, 'imageApiKey'), false);
    assert.equal(Object.hasOwn(saved, 'analysisApiKey'), false);
    assert.deepEqual({
      currentConcurrency: runtime.getImageSchedulerSnapshot().currentConcurrency,
      maxConcurrency: runtime.getImageSchedulerSnapshot().maxConcurrency,
      minStartIntervalMs: runtime.getImageSchedulerSnapshot().minStartIntervalMs
    }, {
      currentConcurrency: 9,
      maxConcurrency: 21,
      minStartIntervalMs: 250
    });

    const preserved = await runtime.saveApiSettings({
      ...saved,
      imageApiKey: '',
      analysisApiKey: ''
    });
    assert.equal(preserved.imageKeyConfigured, true);
    assert.equal(preserved.analysisKeyConfigured, true);

    const privateFile = path.join(runtime.DATA_ROOT, 'system', 'api-settings.json');
    const privateValue = JSON.parse(await fs.readFile(privateFile, 'utf8'));
    assert.equal(privateValue.version, 2);
    assert.equal(privateValue.allowAdminPromptView, true);
    assert.equal(privateValue.imageKey, 'image-private-key');
    assert.equal(privateValue.analysisKey, 'analysis-private-key');
    assert.equal(Object.hasOwn(privateValue, 'key'), false);

    const requests = [];
    let chatRequest;
    global.fetch = async (url, options = {}) => {
      const authorization = options.headers?.Authorization;
      requests.push({ url: String(url), authorization });
      if (String(url).endsWith('/v1/chat/completions')) {
        chatRequest = JSON.parse(options.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const model = authorization === 'Bearer image-private-key'
        ? 'gpt-image-custom'
        : 'gpt-analysis-custom';
      return new Response(JSON.stringify({
        data: [{ id: model, object: 'model', created: 123, owned_by: 'change2pro' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const imageModels = await runtime.testApiSettings({ channel: 'image' });
    assert.equal(imageModels.channel, 'image');
    assert.deepEqual(imageModels.models.map(item => item.id), ['gpt-image-custom']);

    const analysisModels = await runtime.testApiSettings({ channel: 'analysis' });
    assert.equal(analysisModels.channel, 'analysis');
    assert.deepEqual(analysisModels.models.map(item => item.id), ['gpt-analysis-custom']);

    const analysis = await runtime.testAnalysisApi({});
    assert.equal(analysis.ok, true);
    assert.equal(analysis.model, 'gpt-analysis-custom');
    assert.equal(analysis.responsePreview, 'OK');

    assert.deepEqual(requests.map(item => item.authorization), [
      'Bearer image-private-key',
      'Bearer analysis-private-key',
      'Bearer analysis-private-key',
      'Bearer analysis-private-key'
    ]);
    assert.equal(requests[0].url, 'https://api.change2pro.com/v1/models');
    assert.equal(requests[3].url, 'https://api.change2pro.com/v1/chat/completions');
    assert.equal(chatRequest.model, 'gpt-analysis-custom');
    assert.equal(chatRequest.messages[0].role, 'user');
    assert.equal(typeof chatRequest.messages[0].content, 'string');
    assert.equal(Object.hasOwn(chatRequest, 'input'), false);
  } finally {
    global.fetch = originalFetch;
    delete require.cache[runtimePath];
    if (previousEnv.dataDir === undefined) delete process.env.CAISHEN_DATA_DIR;
    else process.env.CAISHEN_DATA_DIR = previousEnv.dataDir;
    if (previousEnv.workspaceId === undefined) delete process.env.CAISHEN_WORKSPACE_ID;
    else process.env.CAISHEN_WORKSPACE_ID = previousEnv.workspaceId;
    if (previousEnv.baseUrl === undefined) delete process.env.CAISHEN_API_BASE_URL;
    else process.env.CAISHEN_API_BASE_URL = previousEnv.baseUrl;
    if (previousEnv.apiKey === undefined) delete process.env.CAISHEN_API_KEY;
    else process.env.CAISHEN_API_KEY = previousEnv.apiKey;
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('API settings store model packages while public selection hides private fields', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-model-packages-'));
  const previousEnv = {
    dataDir: process.env.CAISHEN_DATA_DIR,
    workspaceId: process.env.CAISHEN_WORKSPACE_ID,
    baseUrl: process.env.CAISHEN_API_BASE_URL,
    apiKey: process.env.CAISHEN_API_KEY
  };

  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = 'model-package-user';
  process.env.CAISHEN_API_BASE_URL = 'https://api.change2pro.com';
  process.env.CAISHEN_API_KEY = 'global-image-secret-key';

  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');

  try {
    await runtime.initializeRuntime();

    const saved = await runtime.saveApiSettings({
      baseUrl: 'https://api.change2pro.com',
      imageApiKey: 'global-image-private-key',
      analysisApiKey: 'global-analysis-private-key',
      imageModel: 'gpt-image-2',
      analysisModel: 'gpt-5-3',
      allowAdminPromptView: true,
      modelPackages: [
        {
          id: 'fast',
          name: 'Fast',
          description: 'Fast preview',
          enabled: true,
          default: false,
          recommended: false,
          apiBaseUrl: 'https://api.change2pro.com',
          apiKey: 'fast-secret-key',
          modelId: 'gpt-image-2',
          maxConcurrency: 2,
          startIntervalMs: 1200,
          promptQuality: 'basic',
          promptMode: 'internal',
          userPromptPolicy: 'ignore',
          hiddenPrompt: 'short internal prompt',
          imagePriceMinor: 40000,
          analysisPriceMinor: 0,
          queuePriority: 2
        },
        {
          id: 'flagship',
          name: 'Flagship',
          description: 'Best quality',
          enabled: true,
          default: true,
          recommended: true,
          apiBaseUrl: 'https://api.change2pro.com/v1',
          apiKey: 'flagship-secret-key',
          modelId: 'gpt-image-2',
          maxConcurrency: 30,
          startIntervalMs: 200,
          promptQuality: 'flagship',
          promptMode: 'full',
          userPromptPolicy: 'full',
          hiddenPrompt: 'best internal prompt',
          imagePriceMinor: 300000,
          analysisPriceMinor: 50000,
          queuePriority: 10
        }
      ]
    });

    assert.equal(saved.modelPackages.length, 3);
    assert.deepEqual(saved.modelPackages.map(item => item.id), ['flagship', 'fast', 'standard']);
    assert.equal(saved.modelPackages[1].apiKeyConfigured, true);
    assert.match(saved.modelPackages[1].apiKeyMasked, /fast/);
    assert.equal(Object.hasOwn(saved.modelPackages[1], 'apiKey'), false);
    assert.equal(saved.modelPackages[1].imagePriceMinMinor, 40000);
    assert.equal(saved.modelPackages[1].imagePriceMaxMinor, 40000);
    assert.equal(saved.modelPackages[0].default, true);
    assert.equal(saved.modelPackages[0].imagePriceMinMinor, 300000);
    assert.equal(saved.modelPackages[0].imagePriceMaxMinor, 300000);

    const privateFile = path.join(runtime.DATA_ROOT, 'system', 'api-settings.json');
    const privateValue = JSON.parse(await fs.readFile(privateFile, 'utf8'));
    assert.equal(privateValue.modelPackages[1].apiKey, 'fast-secret-key');
    assert.equal(privateValue.modelPackages[0].apiBaseUrl, 'https://api.change2pro.com/v1');
    assert.equal(privateValue.modelPackages[0].default, true);

    const publicSettings = await runtime.loadModelPackageSettings({ role: 'member' });
    assert.equal(publicSettings.selectedModelPackageId, 'flagship');
    assert.equal(publicSettings.allowAdminPromptView, true);
    assert.deepEqual(publicSettings.modelPackages.map(item => item.id), ['flagship', 'fast', 'standard']);
    assert.equal(publicSettings.modelPackages[1].name, 'Fast');
    assert.equal(Object.hasOwn(publicSettings.modelPackages[0], 'apiBaseUrl'), false);
    assert.equal(Object.hasOwn(publicSettings.modelPackages[0], 'apiKey'), false);
    assert.equal(Object.hasOwn(publicSettings.modelPackages[0], 'apiKeyMasked'), false);
    assert.equal(Object.hasOwn(publicSettings.modelPackages[0], 'hiddenPrompt'), false);
    assert.equal(Object.hasOwn(publicSettings.modelPackages[0], 'imagePriceMinor'), false);
    assert.equal(Object.hasOwn(publicSettings.modelPackages[0], 'imagePriceMinMinor'), false);
    assert.equal(Object.hasOwn(publicSettings.modelPackages[0], 'maxConcurrency'), false);

    const selected = await runtime.saveSelectedModelPackage('fast');
    assert.equal(selected.selectedModelPackageId, 'fast');
    assert.equal((await runtime.loadModelPackageSettings({ role: 'member' })).selectedModelPackageId, 'fast');
    await assert.rejects(
      () => runtime.saveSelectedModelPackage('missing'),
      /模型套餐不存在|not found/i
    );
  } finally {
    delete require.cache[runtimePath];
    if (previousEnv.dataDir === undefined) delete process.env.CAISHEN_DATA_DIR;
    else process.env.CAISHEN_DATA_DIR = previousEnv.dataDir;
    if (previousEnv.workspaceId === undefined) delete process.env.CAISHEN_WORKSPACE_ID;
    else process.env.CAISHEN_WORKSPACE_ID = previousEnv.workspaceId;
    if (previousEnv.baseUrl === undefined) delete process.env.CAISHEN_API_BASE_URL;
    else process.env.CAISHEN_API_BASE_URL = previousEnv.baseUrl;
    if (previousEnv.apiKey === undefined) delete process.env.CAISHEN_API_KEY;
    else process.env.CAISHEN_API_KEY = previousEnv.apiKey;
    await fs.rm(temp, { recursive: true, force: true });
  }
});

# Change2Pro Dual-Key API Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the web application's Change2Pro access into one text-analysis key and one Image2-generation key so every AI call uses a model supported by its own key group.

**Architecture:** Keep one canonical Change2Pro base URL and two server-only credentials in the global API settings. Runtime helpers expose public masked state, migrate the legacy single key to the image channel, query model lists per channel, and route language and image requests through channel-specific configuration. The settings page renders and tests both channels independently.

**Tech Stack:** Node.js 22, Express 5, Node test runner, vanilla JavaScript, HTML/CSS, Vite 8.

## Global Constraints

- Canonical gateway URL is `https://api.change2pro.com`.
- Exactly one key is supported per channel.
- Supported channels are text analysis and Image2 only; Nano Banana is out of scope.
- Model IDs must come from `/v1/models` and must not be invented or rewritten.
- Image2 uses `/images/edits`; text analysis defaults to `/responses` and keeps `/v1/chat/completions` as a compatibility option.
- Secret values remain server-only and must never be returned to the browser or printed in tests.
- The legacy single `key` value migrates to `imageKey`; it must not silently become the analysis key.
- Cross-channel key fallback is prohibited.
- The current image output sizing, quality and file-writing behavior must remain unchanged.
- This checkout has no Git metadata, so test/build checkpoints replace commit steps.

---

### Task 1: Add the version 2 API settings model and safe migration

**Files:**
- Modify: `apps/api/src/runtime.js:230-410`
- Modify: `apps/api/tests/runtime-api-settings.test.js`

**Interfaces:**
- Consumes: legacy private settings `{ key, baseUrl, imageModel, analysisModel }` and environment fallback `ENV_API.key`.
- Produces: private settings `{ version, baseUrl, imageKey, analysisKey, imageModel, analysisModel, responseFormat, requestTimeoutSeconds }` and public settings with independent configured/masked fields.

- [ ] **Step 1: Replace the API settings test with a failing dual-key contract**

Add assertions that the initial legacy key appears only as the image key, saving one blank key preserves that channel, and neither private key appears in public results:

```js
assert.equal(initial.version, 2);
assert.equal(initial.imageKeyConfigured, true);
assert.equal(initial.analysisKeyConfigured, false);
assert.equal(Object.hasOwn(initial, 'imageKey'), false);
assert.equal(Object.hasOwn(initial, 'analysisKey'), false);

const saved = await runtime.saveApiSettings({
  baseUrl: 'https://api.change2pro.com',
  imageApiKey: '',
  analysisApiKey: 'analysis-private-key',
  imageModel: 'gpt-image-2',
  analysisModel: 'gpt-text-custom',
  responseFormat: 'b64_json',
  requestTimeoutSeconds: 300
});
assert.equal(saved.imageKeyConfigured, true);
assert.equal(saved.analysisKeyConfigured, true);
const privateValue = JSON.parse(await fs.readFile(privateFile, 'utf8'));
assert.equal(privateValue.imageKey, 'environment-secret-key');
assert.equal(privateValue.analysisKey, 'analysis-private-key');
assert.equal(Object.hasOwn(privateValue, 'key'), false);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test apps/api/tests/runtime-api-settings.test.js`

Expected: FAIL because `version`, `imageKeyConfigured`, `analysisKeyConfigured`, `imageKey`, and `analysisKey` do not exist yet.

- [ ] **Step 3: Implement migration and independent secret persistence**

Update `readPrivateApiSettings`, `publicApiSettings`, and `saveApiSettings` so the core mapping is:

```js
const legacyKey = String(saved.key || ENV_API.key || '').trim();
const next = {
  version: 2,
  serviceUrl: String(saved.serviceUrl || ENV_API.serviceUrl || '').trim(),
  baseUrl: normalizeApiBaseUrl(saved.baseUrl || ENV_API.baseUrl || ''),
  imageKey: String(saved.imageKey || legacyKey).trim(),
  analysisKey: String(saved.analysisKey || '').trim(),
  imageModel: normalizeModelName(saved.imageModel, ENV_API.imageModel),
  analysisModel: normalizeModelName(saved.analysisModel, ENV_API.analysisModel),
  responseFormat: normalizeResponseFormat(saved.responseFormat, ENV_API.responseFormat),
  requestTimeoutSeconds: normalizeRequestTimeoutSeconds(saved.requestTimeoutSeconds, ENV_API.requestTimeoutSeconds)
};
```

Public state must contain `imageKeyConfigured`, `imageKeyMasked`, `analysisKeyConfigured`, `analysisKeyMasked`, `imageConfigured`, `analysisConfigured`, and aggregate `configured`, but no secret fields. Saving must write only the version 2 shape.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test apps/api/tests/runtime-api-settings.test.js`

Expected: PASS with no secret printed in output.

### Task 2: Isolate model discovery and runtime requests by channel

**Files:**
- Modify: `apps/api/src/runtime.js:354-410`
- Modify: `apps/api/src/runtime.js:817-930`
- Modify: `apps/api/src/runtime.js:1280-1620`
- Modify: `apps/api/tests/runtime-api-settings.test.js`

**Interfaces:**
- Consumes: channel name `'image' | 'analysis'`, private version 2 settings, and an optional unsaved key from the settings form.
- Produces: channel-aware `testApiSettings(payload)`, `testAnalysisApi(payload)`, and channel-specific authorization headers for all runtime calls.

- [ ] **Step 1: Add failing request-routing assertions**

Record every mocked request's URL and `Authorization` header. Assert image model discovery uses `Bearer image-private-key`, analysis model discovery and chat use `Bearer analysis-private-key`, and no request uses the opposite key:

```js
const requests = [];
global.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), authorization: options.headers?.Authorization });
  // Return channel-specific model or chat responses.
};

await runtime.testApiSettings({ channel: 'image' });
await runtime.testApiSettings({ channel: 'analysis' });
await runtime.testAnalysisApi({});

assert.deepEqual(requests.map(item => item.authorization), [
  'Bearer environment-secret-key',
  'Bearer analysis-private-key',
  'Bearer analysis-private-key'
]);
```

Add a rejection assertion that missing analysis credentials report `请先配置文字分析 API 密钥`, while image discovery remains callable.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test apps/api/tests/runtime-api-settings.test.js`

Expected: FAIL because model discovery ignores `channel` and all calls still use the legacy shared key.

- [ ] **Step 3: Implement channel selectors and route every call**

Add a single selector:

```js
function apiChannelConfig(settings, channel) {
  if (channel === 'image') {
    return { key: settings.imageKey, model: settings.imageModel, label: 'Image2 生图' };
  }
  return { key: settings.analysisKey, model: settings.analysisModel, label: '文字分析' };
}
```

`testApiSettings` must accept `channel`, use the corresponding payload field (`imageApiKey` or `analysisApiKey`), query `/v1/models`, and return `{ channel, models, modelCount, latencyMs }`. `testAnalysisApi` must use only `analysisApiKey` and verify the configured analysis model exists before the minimal chat request.

Update `generateImage` to authorize with `api.imageKey`. Update every `billableLlmJson` language-model call to authorize with `api.analysisKey`. Change `requireApiConfig` or split it into channel-aware validation so missing one channel does not block the other.

- [ ] **Step 4: Run API tests and verify GREEN**

Run: `node --test apps/api/tests/runtime-api-settings.test.js apps/api/tests/runtime-template-preparation.test.js apps/api/tests/runtime.test.js`

Expected: all tests PASS and the routing assertions prove key isolation.

### Task 3: Build the two-channel API settings interface

**Files:**
- Modify: `apps/web/index.html:177-210`
- Modify: `apps/web/src/renderer.js:2732-2910`
- Modify: `apps/web/src/styles.css` in the API settings component section

**Interfaces:**
- Consumes: public API settings and the existing RPC methods `getApiSettings`, `saveApiSettings`, `testApiSettings`, and `testAnalysisApi`.
- Produces: payload fields `imageApiKey`, `analysisApiKey`, channel-specific model discovery calls, separate model datalists, and independent status text.

- [ ] **Step 1: Add the two channel forms and model lists**

Replace the single secret field with two labelled password inputs:

```html
<label>文字分析密钥
  <div class="password-input">
    <input id="analysisApiKey" type="password" autocomplete="new-password">
    <button class="text-button" data-toggle-secret="analysisApiKey" type="button">显示</button>
  </div>
  <small id="analysisApiKeyHint">尚未保存文字密钥</small>
</label>
<label>Image2 密钥
  <div class="password-input">
    <input id="imageApiKey" type="password" autocomplete="new-password">
    <button class="text-button" data-toggle-secret="imageApiKey" type="button">显示</button>
  </div>
  <small id="imageApiKeyHint">尚未保存图片密钥</small>
</label>
```

Create `analysisModelOptions` and `imageModelOptions` datalists. Keep common base URL, timeout, output format, size and quality controls.

- [ ] **Step 2: Update renderer state and payloads**

Use independent arrays `state.analysisApiModels` and `state.imageApiModels`. The payload must be:

```js
{
  baseUrl: $('#apiBaseUrl').value.trim(),
  analysisApiKey: $('#analysisApiKey').value.trim(),
  imageApiKey: $('#imageApiKey').value.trim(),
  analysisModel: $('#analysisModel').value.trim(),
  imageModel: $('#imageModel').value.trim(),
  responseFormat: $('#apiResponseFormat').value,
  requestTimeoutSeconds: Number($('#apiRequestTimeout').value)
}
```

Image testing calls `testApiSettings({ ...payload, channel: 'image' })`. Analysis model discovery calls `testApiSettings({ ...payload, channel: 'analysis' })`, fills only the analysis list, then `testAnalysisApi(payload)` performs the minimal completion test.

- [ ] **Step 3: Render independent and aggregate status**

Status copy must map as follows:

```js
const statusText = settings.imageConfigured && settings.analysisConfigured
  ? '全部已配置'
  : settings.imageConfigured
    ? '仅 Image2 已配置'
    : settings.analysisConfigured
      ? '仅文字分析已配置'
      : '未配置';
```

Each hint uses its own configured and masked values. Blank input keeps the saved channel key. Remove the shared model modal behavior that permits an image-only model to be assigned to analysis.

- [ ] **Step 4: Build the web application**

Run: `npm run build -w @caishen/web`

Expected: Vite build succeeds with no missing selector or syntax errors.

### Task 4: Migrate live configuration and verify end to end

**Files:**
- Modify through application API: `data/system/api-settings.json`
- Generated by build: `apps/web/dist/**`

**Interfaces:**
- Consumes: the currently saved image-only Change2Pro key and a future user-provided text-analysis key.
- Produces: live version 2 settings with the existing key preserved as `imageKey`, plus verified independent UI states.

- [ ] **Step 1: Run the full automated verification before touching live settings**

Run: `npm run check`

Expected: web build, API build, and all API tests PASS.

- [ ] **Step 2: Restart the API server and trigger safe migration**

Restart `apps/api/src/server.js`, authenticate as the super administrator, and call `getApiSettings`. Confirm the response contains `version: 2`, `imageKeyConfigured: true`, `analysisKeyConfigured: false`, and no private key fields.

- [ ] **Step 3: Verify the current Image2 channel through the web RPC**

Call `testApiSettings` with `{ channel: 'image' }` through `/api/rpc`.

Expected: HTTP 200, `modelCount >= 1`, and returned model IDs include `gpt-image-2`.

- [ ] **Step 4: Verify missing analysis configuration is isolated**

Call `testApiSettings` with `{ channel: 'analysis' }` before a text key is supplied.

Expected: a clear `请先配置文字分析 API 密钥` error, while repeating the image test still succeeds.

- [ ] **Step 5: Inspect the page at desktop width**

Open `http://127.0.0.1:3008`, sign in as the super administrator, and inspect API settings. Confirm both key areas fit without overlap, each status is correct, and the aggregate state reads `仅 Image2 已配置`.

- [ ] **Step 6: Complete live text verification when the user supplies a text-group key**

Save the text key in the `文字分析密钥` field, query that key's `/v1/models`, select an ID returned by the endpoint, and run the minimal analysis request.

Expected: both channel tests are green and the aggregate state reads `全部已配置`.

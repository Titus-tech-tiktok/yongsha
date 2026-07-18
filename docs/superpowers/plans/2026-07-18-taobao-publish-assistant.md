# Taobao Publish Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first version of the Taobao publish assistant: Web UI, fixed category templates, approved-task publishing queue, browser extension communication, and extension-side Taobao draft automation framework.

**Architecture:** The existing API owns review-task discovery, publish task package generation, status persistence, and local image URLs. The Web app exposes a Taobao publish assistant page for operators. A Chrome extension polls/claims queued tasks from the local Web app and runs a Taobao page adapter to fill fields, upload images, save draft, and report progress.

**Tech Stack:** Node.js API, existing plain JavaScript Web renderer, Chrome Manifest V3 extension, local HTTP JSON endpoints, existing Node test runner.

## Global Constraints

- Work only in `D:\自制软件\永沙`.
- Do not modify package, image generation, prompt, or billing logic.
- First version saves Taobao drafts only; it must not click immediate publish.
- Web click should enqueue a task and let the extension receive it automatically.
- Only approved review tasks are eligible.
- Fixed category templates are the 14 categories listed in the design spec.
- Extension must report progress and failure reasons back to Web.
- Build and existing tests must pass.

---

### Task 1: Publish Assistant Core Model And API

**Files:**
- Create: `apps/api/src/core/taobao-publish.js`
- Modify: `apps/api/src/runtime.js`
- Modify: `apps/api/src/server.js`
- Test: `apps/api/tests/taobao-publish.test.js`

**Interfaces:**
- Produces: `TAOBAO_CATEGORY_TEMPLATES: Array<{ id: string, name: string, product: string, defaults: object }>`
- Produces: `isReviewReadyForTaobao(review: object): boolean`
- Produces: `class TaobaoPublishStore`
- Produces runtime methods:
  - `listTaobaoPublishTasks(): Promise<Array<object>>`
  - `queueTaobaoPublishTask(payload: { folder: string, categoryId: string }): Promise<object>`
  - `claimTaobaoPublishTask(payload: { token: string, extensionId?: string }): Promise<object | null>`
  - `getTaobaoPublishPackage(id: string, token?: string): Promise<object>`
  - `updateTaobaoPublishStatus(id: string, payload: object): Promise<object>`
  - `getTaobaoPublishSettings(): Promise<object>`
  - `saveTaobaoPublishSettings(payload: object): Promise<object>`
- Consumes: existing `reviewFolders()`, `listReadyTitleTasks()`, `fileToken()`, `/api/files/:token`.

- [ ] **Step 1: Write failing core/API tests**

Create `apps/api/tests/taobao-publish.test.js` with tests for:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { TAOBAO_CATEGORY_TEMPLATES, isReviewReadyForTaobao, classifyTaobaoImages } = require('../src/core/taobao-publish');

test('taobao category templates include the fixed product categories', () => {
  const names = TAOBAO_CATEGORY_TEMPLATES.map(item => item.name);
  assert.deepEqual(names, [
    '餐边柜（储物柜）',
    '边角柜',
    '电视柜',
    '床头柜',
    '衣柜',
    '鞋柜',
    '屏风柜',
    '斗柜',
    '茶几',
    '梳妆台',
    '衣帽架',
    '书柜',
    '异形产品',
    '多巴胺 包豪斯'
  ]);
});

test('taobao publish only accepts fully approved review tasks', () => {
  assert.equal(isReviewReadyForTaobao({
    jobs: [
      { status: '已通过', outputUrl: '/a.jpg', action: 'replace_print' },
      { status: '直接套模板', outputUrl: '/b.jpg', action: 'copy_original' }
    ],
    generationProgress: { pending: 0, failed: 0, phase: 'completed' }
  }), true);
  assert.equal(isReviewReadyForTaobao({
    jobs: [
      { status: '已通过', outputUrl: '/a.jpg' },
      { status: '待人工确认', outputUrl: '/b.jpg' }
    ],
    generationProgress: { pending: 1, failed: 0, phase: 'attention' }
  }), false);
});

test('taobao image classifier separates main, ratio and detail images by relative path', () => {
  const images = classifyTaobaoImages([
    { relativePath: '1-1主图/1.jpg', outputUrl: '/1.jpg' },
    { relativePath: '3-4主图/1.jpg', outputUrl: '/2.jpg' },
    { relativePath: '详情页/1.jpg', outputUrl: '/3.jpg' },
    { relativePath: '详情/2.jpg', outputUrl: '/4.jpg' }
  ]);
  assert.equal(images.mainImages.length, 1);
  assert.equal(images.ratioImages.length, 1);
  assert.equal(images.detailImages.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps\api\tests\taobao-publish.test.js`

Expected: FAIL because `apps/api/src/core/taobao-publish.js` does not exist.

- [ ] **Step 3: Implement core model**

Create `apps/api/src/core/taobao-publish.js` with:

```js
const path = require('node:path');

const TAOBAO_CATEGORY_TEMPLATES = [
  ['sideboard', '餐边柜（储物柜）', '餐边柜'],
  ['corner-cabinet', '边角柜', '边角柜'],
  ['tv-cabinet', '电视柜', '电视柜'],
  ['nightstand', '床头柜', '床头柜'],
  ['wardrobe', '衣柜', '衣柜'],
  ['shoe-cabinet', '鞋柜', '鞋柜'],
  ['screen-cabinet', '屏风柜', '屏风柜'],
  ['drawer-cabinet', '斗柜', '斗柜'],
  ['coffee-table', '茶几', '茶几'],
  ['dressing-table', '梳妆台', '梳妆台'],
  ['coat-rack', '衣帽架', '衣帽架'],
  ['bookcase', '书柜', '书柜'],
  ['irregular', '异形产品', '异形产品'],
  ['dopamine-bauhaus', '多巴胺 包豪斯', '多巴胺 包豪斯']
].map(([id, name, product]) => ({
  id,
  name,
  product,
  defaults: {
    publishUrl: '',
    price: '',
    stock: '999',
    shipFrom: '',
    freightTemplate: '',
    serviceTemplate: '',
    attributes: {},
    selectors: {}
  }
}));

function normalizedStatus(value) {
  return String(value || '').trim();
}

function isReviewReadyForTaobao(review = {}) {
  const jobs = Array.isArray(review.jobs) ? review.jobs : [];
  const actionable = jobs.filter(job => normalizedStatus(job.status) !== '已跳过' && job.action !== 'exclude');
  if (!actionable.length) return false;
  const progress = review.generationProgress || {};
  if (Number(progress.pending) > 0 || Number(progress.failed) > 0) return false;
  if (['queued', 'preparing', 'generating', 'auditing', 'running'].includes(String(progress.phase || ''))) return false;
  return actionable.every(job => {
    const status = normalizedStatus(job.status);
    return Boolean(job.outputUrl) && (status === '已通过' || status === '直接套模板');
  });
}

function classifyTaobaoImages(jobs = []) {
  const result = { mainImages: [], ratioImages: [], detailImages: [] };
  for (const job of jobs) {
    if (!job?.outputUrl) continue;
    const relativePath = String(job.relativePath || '').replaceAll('\\', '/');
    const lower = relativePath.toLocaleLowerCase('zh-CN');
    const image = {
      relativePath,
      name: path.basename(relativePath),
      url: job.outputUrl,
      outputUrl: job.outputUrl
    };
    if (lower.includes('3-4') || lower.includes('3:4') || lower.includes('3_4')) result.ratioImages.push(image);
    else if (lower.includes('详情') || lower.includes('detail')) result.detailImages.push(image);
    else result.mainImages.push(image);
  }
  return result;
}

function templateById(id) {
  return TAOBAO_CATEGORY_TEMPLATES.find(item => item.id === id) || null;
}

module.exports = {
  TAOBAO_CATEGORY_TEMPLATES,
  isReviewReadyForTaobao,
  classifyTaobaoImages,
  templateById
};
```

- [ ] **Step 4: Run core tests**

Run: `node --test apps\api\tests\taobao-publish.test.js`

Expected: PASS for the three core tests.

- [ ] **Step 5: Add runtime persistence and RPC endpoints**

Modify `apps/api/src/runtime.js` to persist:

- settings file in userData/workspace: `taobao-publish-settings.json`
- state file in userData/workspace: `taobao-publish-state.json`

Expose runtime functions listed in this task. Package generation should:

- Find the review by folder.
- Reject if `isReviewReadyForTaobao(review)` is false.
- Read matching ready-title task and require `firstTitle`.
- Use `classifyTaobaoImages(review.jobs)`.
- Require at least one main image and one detail image.
- Merge category defaults from settings.

Modify `apps/api/src/server.js` RPC map and direct HTTP routes:

```js
getTaobaoPublishSettings: () => runtime.getTaobaoPublishSettings(),
saveTaobaoPublishSettings: ([payload]) => runtime.saveTaobaoPublishSettings(payload || {}),
listTaobaoPublishTasks: () => runtime.listTaobaoPublishTasks(),
queueTaobaoPublishTask: ([payload]) => runtime.queueTaobaoPublishTask({
  folder: managedPath(payload?.folder),
  categoryId: String(payload?.categoryId || '')
}),
```

Add direct extension routes:

```js
app.post('/api/taobao/publish/claim', async (req, res, next) => { ... });
app.get('/api/taobao/publish/tasks/:id/package', async (req, res, next) => { ... });
app.post('/api/taobao/publish/tasks/:id/status', async (req, res, next) => { ... });
```

All extension routes validate the local token.

- [ ] **Step 6: Add runtime/API tests**

Extend `apps/api/tests/taobao-publish.test.js` with tests that create a temporary output folder, fake approved jobs, queue a task, claim it with a token, fetch its package, and update status.

- [ ] **Step 7: Run API tests**

Run: `node --test apps\api\tests\taobao-publish.test.js`

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add apps/api/src/core/taobao-publish.js apps/api/src/runtime.js apps/api/src/server.js apps/api/tests/taobao-publish.test.js
git commit -m "Add Taobao publish task API"
```

---

### Task 2: Web Taobao Publish Assistant Page

**Files:**
- Modify: `apps/web/index.html`
- Modify: `apps/web/src/api-bridge.js`
- Modify: `apps/web/src/renderer.js`
- Modify: `apps/web/src/styles.css`
- Test: `apps/api/tests/frontend-taobao-publish.test.js`

**Interfaces:**
- Consumes API bridge methods:
  - `getTaobaoPublishSettings()`
  - `saveTaobaoPublishSettings(payload)`
  - `listTaobaoPublishTasks()`
  - `queueTaobaoPublishTask(payload)`
- Produces UI page `page-taobao-publish`.

- [ ] **Step 1: Write failing frontend source test**

Create `apps/api/tests/frontend-taobao-publish.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('web app exposes Taobao publish assistant page and bridge methods', async () => {
  const index = await fs.readFile(path.join(__dirname, '../../web/index.html'), 'utf8');
  const bridge = await fs.readFile(path.join(__dirname, '../../web/src/api-bridge.js'), 'utf8');
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');

  assert.match(index, /page-taobao-publish/);
  assert.match(index, /淘宝发布辅助/);
  assert.match(bridge, /getTaobaoPublishSettings/);
  assert.match(bridge, /queueTaobaoPublishTask/);
  assert.match(renderer, /renderTaobaoPublishPage/);
  assert.match(renderer, /发布到淘宝草稿/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps\api\tests\frontend-taobao-publish.test.js`

Expected: FAIL because page and bridge methods do not exist.

- [ ] **Step 3: Add Web bridge methods**

Modify `apps/web/src/api-bridge.js` inside `window.caishen`:

```js
getTaobaoPublishSettings: () => rpc('getTaobaoPublishSettings'),
saveTaobaoPublishSettings: payload => rpc('saveTaobaoPublishSettings', payload),
listTaobaoPublishTasks: () => rpc('listTaobaoPublishTasks'),
queueTaobaoPublishTask: payload => rpc('queueTaobaoPublishTask', payload),
```

- [ ] **Step 4: Add nav and page skeleton**

Modify `apps/web/index.html`:

- Add sidebar nav item after title generation: `淘宝发布`
- Add `section.page#page-taobao-publish`
- Include:
  - category template list
  - approved task list
  - task detail/package preview
  - extension connection token panel
  - status timeline

- [ ] **Step 5: Add renderer state and page loaders**

Modify `apps/web/src/renderer.js`:

- Add state fields:
  - `taobaoPublishSettings`
  - `taobaoPublishTasks`
  - `activeTaobaoPublishTaskId`
  - `taobaoPublishCategoryFilter`
- Add `loadTaobaoPublishPage()`
- Add `renderTaobaoPublishPage()`
- Update `setPage()` to load page when `name === 'taobao-publish'`
- Add click handlers for:
  - category select
  - queue publish
  - refresh
  - save category settings

- [ ] **Step 6: Add styles**

Modify `apps/web/src/styles.css`:

- Add dense operational layout, not marketing hero.
- Use existing card styles where possible.
- Ensure the page can scan many approved tasks.

- [ ] **Step 7: Run frontend source test**

Run: `node --test apps\api\tests\frontend-taobao-publish.test.js`

Expected: PASS.

- [ ] **Step 8: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add apps/web/index.html apps/web/src/api-bridge.js apps/web/src/renderer.js apps/web/src/styles.css apps/api/tests/frontend-taobao-publish.test.js
git commit -m "Add Taobao publish assistant page"
```

---

### Task 3: Browser Extension Scaffold And Local Communication

**Files:**
- Create: `extensions/taobao-publish-assistant/manifest.json`
- Create: `extensions/taobao-publish-assistant/src/background.js`
- Create: `extensions/taobao-publish-assistant/src/content.js`
- Create: `extensions/taobao-publish-assistant/src/popup.html`
- Create: `extensions/taobao-publish-assistant/src/popup.js`
- Create: `extensions/taobao-publish-assistant/src/popup.css`
- Create: `extensions/taobao-publish-assistant/README.md`
- Test: `apps/api/tests/taobao-extension-files.test.js`

**Interfaces:**
- Consumes API routes:
  - `POST /api/taobao/publish/claim`
  - `GET /api/taobao/publish/tasks/:id/package`
  - `POST /api/taobao/publish/tasks/:id/status`
- Produces extension storage keys:
  - `caishenBaseUrl`
  - `caishenToken`
  - `currentTask`

- [ ] **Step 1: Write failing extension structure test**

Create `apps/api/tests/taobao-extension-files.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('taobao extension has manifest, popup, background and content scripts', async () => {
  const root = path.join(__dirname, '../../..', 'extensions/taobao-publish-assistant');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.match(JSON.stringify(manifest.permissions), /storage/);
  assert.match(JSON.stringify(manifest.host_permissions), /taobao|tmall|127\.0\.0\.1/);
  await fs.access(path.join(root, 'src/background.js'));
  await fs.access(path.join(root, 'src/content.js'));
  await fs.access(path.join(root, 'src/popup.html'));
  await fs.access(path.join(root, 'README.md'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps\api\tests\taobao-extension-files.test.js`

Expected: FAIL because extension files do not exist.

- [ ] **Step 3: Create manifest**

Create `extensions/taobao-publish-assistant/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "财神淘宝发布助手",
  "version": "0.1.0",
  "description": "从财神 Web 端接收已审核任务并辅助保存淘宝商品草稿。",
  "permissions": ["storage", "tabs", "scripting", "alarms"],
  "host_permissions": [
    "http://127.0.0.1:*/*",
    "http://localhost:*/*",
    "https://*.taobao.com/*",
    "https://*.tmall.com/*",
    "https://*.seller.taobao.com/*",
    "https://*.myseller.taobao.com/*"
  ],
  "background": { "service_worker": "src/background.js" },
  "action": {
    "default_title": "淘宝发布助手",
    "default_popup": "src/popup.html"
  },
  "content_scripts": [
    {
      "matches": ["https://*.taobao.com/*", "https://*.tmall.com/*"],
      "js": ["src/content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 4: Create background communication**

Create `src/background.js` with:

- Load base URL/token from storage.
- Poll every 5 seconds.
- Claim task.
- Open publish URL if present.
- Send task package to content script.
- Forward content progress to Web API.

- [ ] **Step 5: Create popup UI**

Create popup with:

- Base URL input default `http://127.0.0.1:3000`
- token input
- connection status
- current task status
- manual claim button
- stop polling toggle

- [ ] **Step 6: Create content script execution shell**

Create `src/content.js` with:

- message listener `TAOBAO_PUBLISH_TASK`
- status callback `received`, `opening`, `filling`, `uploading`, `saving`
- draft save disabled until adapter is configured
- clear failure when unsupported page.

- [ ] **Step 7: Add extension README**

Document:

- Chrome extension loading path.
- Required Web base URL and token.
- First version saves drafts only.
- Login/verification must be handled by operator.

- [ ] **Step 8: Run extension test**

Run: `node --test apps\api\tests\taobao-extension-files.test.js`

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add extensions/taobao-publish-assistant apps/api/tests/taobao-extension-files.test.js
git commit -m "Add Taobao publish assistant extension"
```

---

### Task 4: Taobao Page Adapter And Upload Strategy Shell

**Files:**
- Modify: `extensions/taobao-publish-assistant/src/content.js`
- Create: `extensions/taobao-publish-assistant/src/taobao-adapter.js`
- Test: `apps/api/tests/taobao-extension-adapter.test.js`

**Interfaces:**
- Produces content functions:
  - `fillTextByLabels(labels: string[], value: string): boolean`
  - `clickByText(texts: string[]): boolean`
  - `findFileInputs(): Array<HTMLInputElement>`
  - `runTaobaoDraftTask(taskPackage: object): Promise<object>`

- [ ] **Step 1: Write source-level adapter test**

Create `apps/api/tests/taobao-extension-adapter.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('taobao adapter includes text, upload and draft-save strategies', async () => {
  const adapter = await fs.readFile(path.join(__dirname, '../../../extensions/taobao-publish-assistant/src/taobao-adapter.js'), 'utf8');
  assert.match(adapter, /fillTextByLabels/);
  assert.match(adapter, /findFileInputs/);
  assert.match(adapter, /saveDraft/);
  assert.match(adapter, /保存草稿/);
  assert.match(adapter, /input\[type="file"\]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps\api\tests\taobao-extension-adapter.test.js`

Expected: FAIL because adapter file does not exist.

- [ ] **Step 3: Implement adapter shell**

Create `src/taobao-adapter.js` as a browser script exposing `window.CaishenTaobaoAdapter`.

Functions:

- `waitForPageReady()`
- `fillTitle(title)`
- `fillBasicFields(template)`
- `uploadImages(groups)`
- `saveDraft()`
- `runTaobaoDraftTask(taskPackage, report)`

Image upload first version:

- Find all `input[type="file"]`.
- If present, mark upload strategy as available but do not fake a file path.
- If absent, return clear failure: `未找到淘宝图片上传控件，需要实测页面后配置上传策略`.

This creates a working automation shell and avoids pretending uploads are solved before Taobao observation.

- [ ] **Step 4: Wire adapter into content script**

Update manifest/content script injection order or import adapter content into `content.js`.

Content script should:

- Receive task package.
- Call adapter.
- Report every stage.
- If upload cannot complete, report actionable failure.

- [ ] **Step 5: Run adapter test**

Run: `node --test apps\api\tests\taobao-extension-adapter.test.js`

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add extensions/taobao-publish-assistant/src/content.js extensions/taobao-publish-assistant/src/taobao-adapter.js apps/api/tests/taobao-extension-adapter.test.js extensions/taobao-publish-assistant/manifest.json
git commit -m "Add Taobao page automation adapter"
```

---

### Task 5: Verification And Manual Test Guide

**Files:**
- Modify: `README.md`
- Modify: `docs/deployment.md` if needed only for local extension notes

**Interfaces:**
- Consumes all tasks.
- Produces documented local verification steps.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test apps\api\tests\taobao-publish.test.js apps\api\tests\frontend-taobao-publish.test.js apps\api\tests\taobao-extension-files.test.js apps\api\tests\taobao-extension-adapter.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full API tests**

Run: `npm test -w @caishen/api`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Document extension loading**

Add README section:

```md
### 淘宝发布助手插件

1. 打开 Chrome 扩展管理页。
2. 开启开发者模式。
3. 加载已解压的扩展：`extensions/taobao-publish-assistant`。
4. 在插件 popup 填入 Web 地址和发布令牌。
5. 在 Web 端“淘宝发布辅助”页选择已通过任务并点击“发布到淘宝草稿”。
6. 打开已登录的淘宝卖家后台，插件会接收任务并开始执行。
```

- [ ] **Step 5: Commit verification docs**

```bash
git add README.md docs/deployment.md
git commit -m "Document Taobao publish assistant setup"
```

- [ ] **Step 6: Final status**

Run: `git status -sb`

Expected: clean or only intentional untracked local artifacts.


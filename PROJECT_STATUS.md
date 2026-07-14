# PROJECT_STATUS

## 2026-07-15 Update - Separate master reference from full-set generation

- 素材生图页把“母版底图选择”和“整套生成范围”拆开。
- 03 待生成顶部新增母版生成区，显示 `母版底图 + 印花 -> 母版图`，并集中提供 `生成母版 / 重新生成母版`。
- 左侧套图图片点击或 `设为母版` 只设置母版底图，不再缩小正式生成范围。
- `用当前印花生成整套任务` 默认创建当前套图范围内全部 `replace_print` 任务。
- 下方任务卡片改为 `母版图 + 套图页`，更准确表达正式生成会使用已生成母版图迁移到每张套图。
- 开始生成前如果发现旧队列只包含部分换印花任务，会提示是否补齐为整套，确认后自动补齐缺失任务。
- Verification completed: `node --check apps/web/src/renderer.js`, `npm run build -w @caishen/web`, `git diff --check`.

## 2026-07-15 Update - Template master-first generation

- 素材生图的 `template_print` 任务改为“先生成母版，再正式生成套图”。
- 每个任务卡片会自动选一张套图参考图生成母版，卡片内提供 `生成母版` / `重新生成母版`。
- 母版生成调用真实图片 API，但通过 `skipBilling` 跳过计费，不扣用户余额，也不进入任务成本。
- 正式套图生成必须带已生成母版图；批量生成时只运行已有母版的任务，未生成母版的任务会被跳过并提示数量，不阻塞其他任务卡片。
- 正式生成的输入顺序改为：当前套图模板图、已生成母版产品图、原始印花图；提示词强调母版是产品和印花效果标准，模板只提供场景、文字、尺寸和透视。
- 新增默认提示词 `templateMasterGeneration`，用于初始化套图母版生成，不做自动质检。
- Verification completed: `npm test -w @caishen/api`, `npm run build -w @caishen/web`, `node --check`.

## 2026-07-15 Update - Restore API template generation

- Removed the production local template-print compositing path.
- `replace_print` template tasks now continue into the `templatePrint` prompt and call the configured image generation API.
- Removed the misleading template-analysis prompt text that said formal processing would use deterministic pixel compositing.
- Moved the “用当前印花创建任务” button back into the visible queue panel instead of hiding it inside advanced settings.
- Reworked regression coverage so single regenerate, missing-image regenerate, full-template regenerate, and 30-image template batches must call the image API.
- Verification completed: `npm test -w @caishen/api -- tests/runtime-image-retry.test.js`, `npm test -w @caishen/api -- tests/runtime-template-print-compositor.test.js`, `npm run build -w @caishen/web`, `node --check`, and `git diff --check`.

## 2026-07-14 Update - Reference-guided template re-analysis

- Added a manual-confirmation recovery workflow: the analysis-result modal now shows recognized `replace_print` images as references.
- Clicking `Reference re-analyze` sends both the target image and the selected reference image to the analysis API.
- The reference is used only as decision guidance. The prompt explicitly forbids copying reference polygons, coordinates, panel count, door count, proportions, or replace areas.
- The target image is independently re-analyzed and must output its own `printableSurfaces`, so a 3-door reference cannot be directly applied to a 4-door target.
- Added API regression coverage for this flow in `apps/api/tests/template-analysis-batch.test.js`.
- Verification completed: `npm test -w @caishen/api -- tests/template-analysis-batch.test.js`, `npm run build -w @caishen/web`, and `git diff --check`.

## 2026-07-14 Update - Template AI fallback

- Current pushed base before this change: `a268eb2 Allow parallel template analysis retries`.
- New fix in progress: when template AI returns empty text or marks an obvious light cabinet-panel image as `manual_check`, the API now attempts a local visual fallback.
- The fallback detects non-edge, light neutral cabinet door/drawer panel components with nearby dark cabinet borders, then writes `printableSurfaces` and a normal mask so these images can enter `replace_print`.
- This targets cases like size/SKU/detail images (`5.jpg`, `638_23.jpg`) where similar images are correctly recognized as `replace_print` but isolated retries stay stuck in `manual_check`.
- Regression added in `apps/api/tests/template-analysis-batch.test.js`: empty AI response on a plain image remains `manual_check`, while empty AI response on a synthetic cabinet panel image becomes `replace_print` with a non-empty clean mask.
- Verification completed: `npm test -w @caishen/api -- tests/template-analysis-batch.test.js tests/core-template-regions.test.js` passed `138 pass / 0 fail`.

更新日期：2026-07-14

## 项目概况

财神测款机 V8 当前主线是 `web-saas/` Web SaaS 版本，使用 npm workspaces 管理：

- `apps/web/`：Vite 浏览器端 UI 和 API bridge。
- `apps/api/`：Node.js/Express API、本地工作区适配器和业务核心。
- `apps/api/src/core/`：模板区域、提示词、审核、标题、商品资料、调度和本地合成等核心逻辑。
- `apps/api/tests/`：核心逻辑与 API 回归测试。
- `data/`、`output/`、日志和 `.env` 是本地运行数据或敏感配置，不应提交。

系统目标是把原 Mac/EXE 业务流程迁移到局域网/服务器可用的 Web 版本。素材、配置、任务、计费和输出按团队账号隔离保存在服务器工作区，不依赖 Supabase 或其他云存储。

## 当前状态

- 最新主线提交为 `b997256 Improve template analysis reliability`，当前正在准备新的直接推送提交。
- 本轮待提交改动包含：
  - `apps/web/src/renderer.js`：修复素材资产页筛选条/选项条遮挡第一行图片的问题。切换素材库或筛选时重置 `assetManagementGrid.scrollTop`，避免复用旧滚动位置导致第一行被裁切。
  - `apps/api/src/core/template-regions.js`：AI 模板分析改为更接近 EXE 的执行策略。AI 返回旧版 `replace_regions` 矩形时会转换成可执行 `printableSurfaces`；旧版本号不再在已有可执行区域时直接降级为人工确认。
  - `apps/api/tests/core-template-regions.test.js`：更新回归测试，覆盖旧版本与旧矩形区域仍可执行换印花、缺失动作仍需人工确认。
- `PROJECT_STATUS.md` 已同步更新，并将作为本次提交的一部分。

## 本轮策略说明

AI 识别先采用更接近 EXE 的判定方式：

- 明确 `replace_print` 且有可执行区域时优先进入换印花。
- 优先使用新版多边形 `printableSurfaces`。
- 如果 AI 返回旧版矩形 `replace_regions`，自动转成可执行面板。
- 只有缺失动作、明确 `needs_manual_check: true`、没有任何可执行区域、不可读结果等情况才进入人工确认。

这会减少真实 Web 测试中“能看出白色柜门但被版本/字段校验打成人工确认”的情况。代价是区域可能比纯多边形更粗，需要通过真实服务器测试观察误换风险。

## 验证记录

本轮已完成验证：

```text
npm test -w @caishen/api -- tests/core-template-regions.test.js tests/template-analysis-batch.test.js
138 pass / 0 fail

npm run build
前端构建通过
API 构建检查通过

git diff --check
通过
```

## 推送前注意

- 本次应提交 4 个文件：
  - `PROJECT_STATUS.md`
  - `apps/api/src/core/template-regions.js`
  - `apps/api/tests/core-template-regions.test.js`
  - `apps/web/src/renderer.js`
- 不提交 `.env`、`data/`、`output/`、日志文件或构建产物。
- 推送到 `origin/main` 后，服务器可拉取最新代码重新构建，重点测试：
  - 素材资产页第一行图片是否仍被选项条遮挡。
  - 真实套图 AI 分析中，旧矩形/旧契约结果是否能进入“换印花”。
  - 是否出现明显误换背景、文字底板、包装图白色区域等副作用。

## 下一步建议

1. 提交并推送本轮 4 个文件到 `main`。
2. 在真实服务器拉取、重建并先跑小批量问题图片。
3. 重点对比“人工确认”数量是否下降，以及换印花区域是否可接受。
4. 如果误换变多，再在 EXE 风格判定上增加少量保守规则，而不是恢复复杂版本硬校验。

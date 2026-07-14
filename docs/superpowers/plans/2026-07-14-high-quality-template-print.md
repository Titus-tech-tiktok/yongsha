# High-Quality Template Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the paid generative redraw path for normal template-print jobs with validated, deterministic, full-resolution print compositing while preserving the complete output set and operator workflow.

**Architecture:** AI receives a compressed proxy only to classify each template and propose printable polygons. The server validates that result before caching it. Normal `replace_print` jobs read the original print file directly and composite it through a cleaned mask; `copy_original` jobs copy bytes; `manual_check` blocks task creation; `exclude` is manual-only and omitted. The task planner expands selected replacement images with every `copy_original` image from the same template folder.

**Tech Stack:** Node.js, Express, Sharp/libvips, Vite, browser Canvas, Node test runner.

## Global Constraints

- Standard print transfer must not call the image-generation API or reserve image billing.
- Analysis proxies may be compressed; production compositing must read the original print path.
- Mapping mode is one continuous print across all printable surfaces, using `contain`, without crop, stretch, repeat, recolor, or rearrangement.
- Pixels outside the validated mask come from the template; dark seams, handles, borders, text, and foreground details remain above the print.
- Output dimensions and relative file names equal the source template.
- `copy_original` uses byte-for-byte file copy and never calls an API.
- Any unresolved `manual_check` image blocks task creation before billable work.
- Legacy `copy_template` and `skip_copy` cache values remain readable as aliases.

---

### Task 1: Strict Analysis Contract and Canonical Actions

**Files:**
- Modify: `apps/api/src/core/template-regions.js`
- Modify: `apps/api/src/core/prompts.js`
- Modify: `apps/api/tests/core-template-regions.test.js`
- Modify: `apps/api/tests/core-prompts.test.js`

**Interfaces:**
- Produces: `normalizeTemplateProcessingMode(value)`, `normalizePrintableSurfaces(values)`, `validateTemplateAnalysis(value, options)`, and polygon-aware `rasterizeMask(...)`.
- Produces canonical modes: `replace_print`, `copy_original`, `manual_check`, `exclude`.

- [ ] **Step 1: Write failing tests** for legacy aliases, version 9 fields, valid printable polygons, invalid/empty masks downgrading to `manual_check`, and AI output never selecting `exclude`.
- [ ] **Step 2: Run** `node --test apps/api/tests/core-template-regions.test.js apps/api/tests/core-prompts.test.js` and confirm the new assertions fail for missing version 9 validation.
- [ ] **Step 3: Implement** canonical action normalization, polygon parsing/rasterization, strict validation, and the revised analysis prompt/JSON contract.
- [ ] **Step 4: Re-run the two focused test files** and confirm they pass.

### Task 2: Full-Resolution Deterministic Compositor

**Files:**
- Create: `apps/api/src/core/template-print-compositor.js`
- Create: `apps/api/tests/core-template-print-compositor.test.js`
- Modify: `apps/api/src/core/template-regions.js`

**Interfaces:**
- Consumes: template path, original print path, validated mask path, output path.
- Produces: `composeTemplatePrint({ templatePath, printPath, maskPath, outputPath })` returning dimensions, mask coverage, source bytes, and output bytes.

- [ ] **Step 1: Write failing compositor tests** using generated fixtures that assert exact PNG dimensions, unchanged pixels outside the mask, preserved dark handle/seam pixels, complete contain mapping, and direct original-source sampling.
- [ ] **Step 2: Run** `node --test apps/api/tests/core-template-print-compositor.test.js` and confirm failure because the module does not exist.
- [ ] **Step 3: Implement** cleaned-mask generation, mask bounds, direct original print resize with Lanczos, alpha application, template compositing, and high-quality PNG/JPEG output (`JPEG 98`, `4:4:4`).
- [ ] **Step 4: Re-run the compositor tests** and inspect generated fixture pixels.

### Task 3: Output Planner and Runtime Generation

**Files:**
- Modify: `apps/api/src/runtime.js`
- Modify: `apps/api/tests/runtime-template-preparation.test.js`
- Modify: `apps/api/tests/runtime-image-retry.test.js`
- Create: `apps/api/tests/runtime-template-print-compositor.test.js`

**Interfaces:**
- Produces: `planTemplateOutputJobs(templateFolderPath, selectedPaths)`.
- Consumes: `composeTemplatePrint(...)` from Task 2.
- Produces progress counters `composited`, `copied`, `excluded`, `failed`; keeps legacy summary fields readable.

- [ ] **Step 1: Write failing runtime tests** proving selected replacement images automatically include all `copy_original` siblings, unresolved manual images block before work, excluded images are absent, copied files are byte-identical, replacement without a mask fails before fetch/billing, and replacement uses the local compositor without fetch.
- [ ] **Step 2: Run the focused runtime tests** and confirm the current selection/API behavior fails them.
- [ ] **Step 3: Implement** task planning before task-folder creation, source metadata with expanded paths, canonical action handling, direct file copy, local compositing, and progress/audit messages.
- [ ] **Step 4: Re-run focused runtime tests** and confirm the local path never invokes the image API.

### Task 4: Analysis Persistence and Clean Masks

**Files:**
- Modify: `apps/api/src/runtime.js`
- Modify: `apps/api/tests/template-analysis-batch.test.js`
- Modify: `apps/api/tests/template-manual-config.test.js`

**Interfaces:**
- Consumes: `validateTemplateAnalysis(...)` and polygon-aware mask rasterization.
- Produces valid cached analysis plus `.replace-mask.png`/`.clean-mask.png` only for executable replacements.

- [ ] **Step 1: Write failing tests** for paid-but-malformed AI responses becoming a successful `manual_check`, valid polygons generating a nonempty mask, manual copy/exclude saving without a mask, and manual replacement requiring a nonempty mask.
- [ ] **Step 2: Run focused tests** and confirm current permissive caching fails.
- [ ] **Step 3: Implement** validation before cache persistence, polygon mask generation, clean-mask regeneration after manual edits, and pre-billing validation errors.
- [ ] **Step 4: Re-run focused tests** and confirm all analysis states are deterministic.

### Task 5: Web Workflow and Operator Copy

**Files:**
- Modify: `apps/web/src/renderer.js`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes canonical actions and mask status from the API.
- Shows: `图片用途与判断`, `可印花区域`, `必须保持不变`, mask overlay/coverage, and explicit local-copy/composite behavior.

- [ ] **Step 1: Update action/filter labels** to `换印花`, `保留原图`, `人工确认`, `排除该图（不输出）`, while accepting legacy aliases returned by old caches.
- [ ] **Step 2: Update the analysis modal** so copy-original shows `无`/`整张原图`, replacement requires a marked mask, and no placeholder text can pretend a mask exists.
- [ ] **Step 3: Update task preview and progress copy** to include automatic original copies and local high-resolution compositing.
- [ ] **Step 4: Run** `npm run build -w @caishen/web` and resolve all build failures.

### Task 6: Regression Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-template-print-analysis-design.md` only if implementation details require clarification.

- [ ] **Step 1: Run** `npm test` and confirm all API tests pass.
- [ ] **Step 2: Run** `npm run build` and confirm both workspaces build.
- [ ] **Step 3: Run a fixture integration job** and verify output dimensions, decoded outside-mask pixels, source/output paths, task counts, and ZIP-visible file names.
- [ ] **Step 4: Review** `git diff --check`, `git status --short`, and the requirement checklist before integration.

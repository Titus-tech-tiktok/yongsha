# Adaptive Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace burst image generation with a global adaptive scheduler that can process all queued images without collapsing when Change2Pro temporarily accepts only four concurrent requests, while preserving URL previews, exact template output dimensions, ZIP downloads, and 300-second timeouts.

**Architecture:** A process-wide scheduler owns all image API starts. It begins at four concurrent requests, ramps toward fifty only after healthy result windows, halves concurrency on upstream pressure, and requeues retries without occupying active slots. Runtime image requests prepare compact cached reference files before scheduling, report retry state into task progress, and normalize the final downloaded URL image to the original template dimensions. A public health endpoint exposes only deployment and queue state, and CI verifies the deployed commit.

**Tech Stack:** Node.js 22+, CommonJS, native `fetch`, `sharp`, Node test runner, Docker Compose, GitHub Actions.

## Global Constraints

- Keep Change2Pro image generation on `gpt-image-2` and `/v1/images/edits`.
- Keep image responses as URL-first with `b64_json` fallback.
- Apply a 300-second timeout to image API calls and generated URL downloads.
- Never exceed 50 active image API calls for the single image key.
- Do not alter original template or print files.
- Final files must exactly match each original template's pixel dimensions and use centered `cover` fitting without white borders.
- Preserve cancellation, billing reservation semantics, previews, review actions, filename mapping, and ZIP behavior.
- Do not expose keys, filesystem paths, or account data through health or diagnostic APIs.

---

### Task 1: Make tests cross-platform and expose deployment identity

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `.github/workflows/deploy.yml`
- Test: `apps/api/tests/server-health.test.js`

**Step 1: Write the failing health test**

Add a test that starts the server with `APP_COMMIT_SHA=test-commit`, requests `/api/health`, and asserts this exact public shape:

```js
assert.deepEqual(Object.keys(body).sort(), [
  "activeImageRequests",
  "commit",
  "currentImageConcurrency",
  "maxImageConcurrency",
  "ok",
  "queuedImageRequests",
  "uptimeSeconds",
].sort());
assert.equal(body.ok, true);
assert.equal(body.commit, "test-commit");
```

**Step 2: Run the test to verify it fails**

Run: `node --test apps/api/tests/server-health.test.js`

Expected: FAIL because `/api/health` is not implemented.

**Step 3: Implement minimal health response and cross-platform discovery**

- Change the package test command from directory discovery to a quoted glob that works on Windows and Linux:

```json
"test": "node --test \"tests/**/*.test.js\""
```

- Add `GET /api/health` before authenticated routes. Read scheduler state through a callback exported by runtime. Return only the fields asserted by the test.
- Add `ARG APP_COMMIT_SHA=unknown` and `ENV APP_COMMIT_SHA=$APP_COMMIT_SHA` to the API image.
- Pass the build argument through Compose.
- In deployment, export `APP_COMMIT_SHA=$DEPLOY_REF`, rebuild, poll `/api/health`, and fail unless the returned `commit` equals the deployed SHA.

**Step 4: Verify**

Run: `npm run check`

Expected: all tests and syntax checks pass on Windows; the same test command no longer relies on directory discovery.

---

### Task 2: Add the adaptive global image scheduler

**Files:**
- Create: `apps/api/src/core/adaptive-image-scheduler.js`
- Create: `apps/api/tests/core-adaptive-image-scheduler.test.js`

**Step 1: Write failing scheduler tests**

Cover these cases with a fake operation and short test delays:

1. The scheduler starts at four and never exceeds configured maximum.
2. Thirty jobs against a mock upstream that rejects active request five and above eventually all succeed.
3. A retryable 429 halves current concurrency immediately.
4. `Retry-After` seconds and HTTP-date values are honored.
5. A retry waits in the queue and does not count as active.
6. Ten healthy completions increase concurrency by two, capped at fifty.
7. Aborting a queued, delayed, or active job rejects it with `AbortError`.

The public module contract is:

```js
const {
  AdaptiveImageScheduler,
  RetryableRequestError,
  parseRetryAfterMs,
} = require("../src/core/adaptive-image-scheduler");
```

Scheduler construction must accept:

```js
new AdaptiveImageScheduler({
  initialConcurrency: 4,
  maxConcurrency: 50,
  minStartIntervalMs: 500,
  healthyWindowSize: 10,
  healthySuccessRatio: 0.9,
  maxAttempts: 8,
  baseBackoffMs: 1000,
  maxBackoffMs: 120000,
  random: Math.random,
});
```

**Step 2: Run tests to verify failure**

Run: `node --test apps/api/tests/core-adaptive-image-scheduler.test.js`

Expected: FAIL because the module does not exist.

**Step 3: Implement the scheduler**

Implement a FIFO ready queue with these invariants:

- `active <= currentConcurrency <= maxConcurrency` always.
- A queued item contains `operation`, `attempt`, `readyAt`, `signal`, `onState`, `resolve`, and `reject`.
- Starting an operation removes it from the queue and increments `active`.
- A retryable failure decrements `active`, reduces concurrency, computes delay, sets a future `readyAt`, and puts the same item back in the queue.
- Backoff delay uses `Retry-After` when present; otherwise full jitter in `[0, min(120000, 1000 * 2 ** (attempt - 1))]`.
- Permanent failure happens only after eight total attempts or a non-retryable error.
- `snapshot()` returns `{active, queued, currentConcurrency, maxConcurrency}`.
- `onState` emits `queued`, `running`, `retrying`, `succeeded`, or `failed` with attempt and delay metadata.

**Step 4: Verify scheduler tests**

Run: `node --test apps/api/tests/core-adaptive-image-scheduler.test.js`

Expected: all scheduler tests pass and the mock upstream records eventual 30/30 completion.

---

### Task 3: Integrate adaptive scheduling into Change2Pro image calls

**Files:**
- Modify: `apps/api/src/runtime.js`
- Modify: `apps/api/tests/runtime-image-retry.test.js`

**Step 1: Extend the existing retry test first**

Add a mock Change2Pro server with capacity four and thirty generated template jobs. Assert:

```js
assert.equal(result.completed, 30);
assert.equal(result.failed, 0);
assert.ok(mock.peakActive <= 4);
assert.ok(mock.totalRequests > 30);
```

Also assert task progress reports at least one `waitingUpstream` state rather than marking retrying images permanently failed.

**Step 2: Run the focused test to verify failure**

Run: `node --test apps/api/tests/runtime-image-retry.test.js`

Expected: FAIL with the current fixed-concurrency retry loop.

**Step 3: Replace fixed image slots and in-slot sleeping**

- Create one process-wide `AdaptiveImageScheduler` in runtime.
- Read these environment variables with bounded defaults:
  - `CAISHEN_IMAGE_API_MAX_CONCURRENCY=50`
  - `CAISHEN_IMAGE_API_INITIAL_CONCURRENCY=4`
  - `CAISHEN_IMAGE_API_START_INTERVAL_MS=500`
  - `CAISHEN_IMAGE_API_MAX_ATTEMPTS=8`
  - `CAISHEN_IMAGE_API_TIMEOUT_MS=300000`
  - `CAISHEN_IMAGE_URL_TIMEOUT_MS=300000`
- Convert the current request helper into a single-attempt function. Throw `RetryableRequestError` for HTTP 408, 425, 429, 502, 503, 504, timeout, network reset, and the existing upstream pressure messages.
- Parse `Retry-After` from upstream responses.
- Reserve billing once before scheduling, commit once after successful output, and release only after final failure or cancellation.
- Pass cancellation into both the API request and URL download.
- Export `getImageSchedulerSnapshot()` for `/api/health`.
- Preserve PowerShell transport fallback, but route its status failures through the same scheduler classification.

**Step 4: Add structured request diagnostics**

Append one JSON object per state transition to the task's `.caishen-meta/image-api-events.jsonl` with:

```js
{
  at,
  relativePath,
  attempt,
  state,
  status,
  error,
  currentConcurrency,
  maxConcurrency,
  active,
  queued,
  originalBytes,
  preparedBytes,
  apiElapsedMs,
  downloadElapsedMs,
}
```

Do not log prompts, keys, complete upstream URLs, or absolute source paths.

**Step 5: Verify**

Run: `node --test apps/api/tests/runtime-image-retry.test.js`

Expected: transient-capacity simulation completes all thirty jobs, retries release active slots, and cancellation remains functional.

---

### Task 4: Cache compact reference images and derive API size from real orientation

**Files:**
- Create: `apps/api/src/core/image-reference-cache.js`
- Create: `apps/api/tests/core-image-reference-cache.test.js`
- Modify: `apps/api/src/runtime.js`
- Modify: `apps/api/tests/runtime-image-retry.test.js`

**Step 1: Write failing cache and orientation tests**

Cover:

- Cache key changes when absolute path, size, mtime, or conversion spec changes.
- Concurrent preparation of the same source runs one conversion.
- Long edge is at most 2048 and images are never enlarged.
- Alpha sources use PNG; opaque sources use JPEG quality 92.
- Square, landscape, and portrait templates select `1024x1024`, `1536x1024`, and `1024x1536` respectively.
- Final generated files exactly equal each original template's width and height.
- Final fitting uses `cover` and produces no white padding.

**Step 2: Run focused tests to verify failure**

Run: `node --test apps/api/tests/core-image-reference-cache.test.js apps/api/tests/runtime-image-retry.test.js`

Expected: FAIL because cache and real-orientation selection do not exist.

**Step 3: Implement preparation and reuse**

- Store prepared files below `DATA_ROOT/.api-reference-cache` using a SHA-256 cache key.
- Maintain an in-flight promise map so concurrent requests for one print do not duplicate conversion.
- Read prepared files into multipart requests instead of originals.
- Use actual template metadata, not folder names, to choose the nearest supported API aspect ratio.
- Keep `writeTemplateSizedImage()` as the final exact-dimension normalization with centered `cover`.
- Return original/prepared byte counts for diagnostics.

**Step 4: Verify**

Run: `node --test apps/api/tests/core-image-reference-cache.test.js apps/api/tests/runtime-image-retry.test.js`

Expected: all cache, aspect-ratio, exact-size, retry, URL, and regeneration assertions pass.

---

### Task 5: Surface upstream waiting state without changing review workflows

**Files:**
- Modify: `apps/api/src/runtime.js`
- Modify: `apps/api/public/renderer.js`
- Modify: `apps/api/public/styles.css`
- Test: `apps/api/tests/runtime-image-retry.test.js`

**Step 1: Write the failing progress assertion**

Assert task progress can contain:

```js
{
  pending: 26,
  waitingUpstream: 26,
  failed: 0,
}
```

while jobs are in scheduler backoff.

**Step 2: Implement progress mapping**

- Track retrying job paths in a set owned by each generation run.
- Update `waitingUpstream` on scheduler retry/running/success/final-failure transitions.
- Display `等待上游恢复 N` beside API-generated, copied, skipped, failed, and pending counters.
- Use a neutral warning color; do not show a permanent failure card until retries are exhausted.
- Keep URL previews, manual review, regenerate, regenerate-set, fill-missing, batch-fill, ZIP download, and cancellation endpoints unchanged.

**Step 3: Verify syntax and focused tests**

Run: `node --check apps/api/public/renderer.js`

Run: `node --test apps/api/tests/runtime-image-retry.test.js`

Expected: both pass.

---

### Task 6: Full verification, deployment, and rollback evidence

**Files:**
- Modify only if verification finds a defect in files already listed above.

**Step 1: Run complete local checks**

Run: `npm run check`

Expected: all tests and syntax checks pass.

**Step 2: Run the no-cost thirty-job capacity-four diagnostic**

Run the local mock Change2Pro test suite and record:

- 30 jobs completed.
- 0 final failures.
- Peak mock upstream active requests never exceeded 4.
- Scheduler later ramps above 4 only after healthy windows when the mock capacity permits it.
- Output dimensions match original templates.

**Step 3: Review the diff**

Run: `git diff --check`

Run: `git status --short`

Confirm there are no keys, passwords, generated assets, cache files, or workspace data in the diff.

**Step 4: Commit and push**

Create one implementation commit after all checks pass, push `main`, and monitor the GitHub Actions run.

**Step 5: Verify deployment identity**

The workflow must request `/api/health` and verify `commit` equals the pushed SHA. If SSH or the host is unavailable, report deployment as failed rather than claiming success.

**Step 6: Record rollback command**

Rollback remains an explicit deployment of a known-good commit:

```powershell
git revert <bad-commit-sha>
git push origin main
```

The deployment health check must then verify the revert commit SHA.

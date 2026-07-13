const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AdaptiveImageScheduler,
  RetryableRequestError,
  parseRetryAfterMs
} = require('../src/core/adaptive-image-scheduler');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('parseRetryAfterMs supports seconds and HTTP dates', () => {
  assert.equal(parseRetryAfterMs('2', 1000), 2000);
  assert.equal(parseRetryAfterMs(new Date(5000).toUTCString(), 1000), 4000);
  assert.equal(parseRetryAfterMs('', 1000), undefined);
  assert.equal(parseRetryAfterMs('invalid', 1000), undefined);
});

test('capacity-four upstream eventually completes all thirty jobs', async () => {
  const scheduler = new AdaptiveImageScheduler({
    initialConcurrency: 4,
    maxConcurrency: 12,
    minStartIntervalMs: 0,
    healthyWindowSize: 10,
    maxAttempts: 8,
    baseBackoffMs: 2,
    maxBackoffMs: 10,
    random: () => 0.5
  });
  let active = 0;
  let acceptedActive = 0;
  let peakAccepted = 0;
  let requestCount = 0;

  const results = await Promise.all(Array.from({ length: 30 }, (_, index) => scheduler.schedule(async () => {
    requestCount += 1;
    active += 1;
    if (active > 4) {
      active -= 1;
      throw new RetryableRequestError('Upstream rate limit', { status: 429, retryAfterMs: 2 });
    }
    acceptedActive += 1;
    peakAccepted = Math.max(peakAccepted, acceptedActive);
    await wait(3);
    acceptedActive -= 1;
    active -= 1;
    return index;
  })));

  assert.deepEqual(results, Array.from({ length: 30 }, (_, index) => index));
  assert.equal(peakAccepted, 4);
  assert.ok(requestCount > 30);
  assert.equal(scheduler.snapshot().active, 0);
  assert.equal(scheduler.snapshot().queued, 0);
});

test('retryable pressure halves concurrency and releases the active slot while waiting', async () => {
  const states = [];
  const scheduler = new AdaptiveImageScheduler({
    initialConcurrency: 8,
    maxConcurrency: 8,
    minStartIntervalMs: 0,
    maxAttempts: 3,
    baseBackoffMs: 20,
    maxBackoffMs: 20,
    random: () => 1
  });
  let attempts = 0;
  const result = await scheduler.schedule(async () => {
    attempts += 1;
    if (attempts === 1) throw new RetryableRequestError('busy', { status: 429 });
    return 'ok';
  }, {
    onState(event) {
      states.push(event);
    }
  });

  const retry = states.find(event => event.state === 'retrying');
  assert.equal(result, 'ok');
  assert.equal(retry.currentConcurrency, 4);
  assert.equal(retry.active, 0);
  assert.equal(retry.delayMs, 20);
});

test('ten healthy completions raise concurrency by two without exceeding max', async () => {
  const scheduler = new AdaptiveImageScheduler({
    initialConcurrency: 2,
    maxConcurrency: 4,
    minStartIntervalMs: 0,
    healthyWindowSize: 10
  });
  await Promise.all(Array.from({ length: 10 }, () => scheduler.schedule(async () => 'ok')));
  assert.equal(scheduler.snapshot().currentConcurrency, 4);
});

test('aborting a queued request rejects it without starting the operation', async () => {
  const scheduler = new AdaptiveImageScheduler({
    initialConcurrency: 1,
    maxConcurrency: 1,
    minStartIntervalMs: 0
  });
  let releaseFirst;
  const first = scheduler.schedule(() => new Promise(resolve => {
    releaseFirst = resolve;
  }));
  while (!releaseFirst) await wait(1);

  const controller = new AbortController();
  let started = false;
  const second = scheduler.schedule(async () => {
    started = true;
  }, { signal: controller.signal });
  controller.abort();

  await assert.rejects(second, error => error?.name === 'AbortError');
  assert.equal(started, false);
  releaseFirst('done');
  assert.equal(await first, 'done');
});

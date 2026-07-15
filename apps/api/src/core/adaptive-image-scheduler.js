class RetryableRequestError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'RetryableRequestError';
    this.status = Number(options.status) || undefined;
    this.retryAfterMs = Number.isFinite(options.retryAfterMs)
      ? Math.max(0, Number(options.retryAfterMs))
      : undefined;
    this.code = options.code;
  }
}

function parseRetryAfterMs(value, now = Date.now()) {
  const text = String(value || '').trim();
  if (!text) return undefined;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - now);
}

function abortError() {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function boundedInteger(value, fallback, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

class AdaptiveImageScheduler {
  constructor(options = {}) {
    this.maxConcurrency = boundedInteger(options.maxConcurrency, 50, 1, 50);
    this.currentConcurrency = boundedInteger(
      options.initialConcurrency,
      Math.min(4, this.maxConcurrency),
      1,
      this.maxConcurrency
    );
    this.minStartIntervalMs = boundedInteger(options.minStartIntervalMs, 500, 0);
    this.healthyWindowSize = boundedInteger(options.healthyWindowSize, 10, 1);
    this.healthySuccessRatio = Math.min(1, Math.max(0, Number(options.healthySuccessRatio ?? 0.9)));
    this.maxAttempts = boundedInteger(options.maxAttempts, 8, 1);
    this.baseBackoffMs = boundedInteger(options.baseBackoffMs, 1000, 0);
    this.maxBackoffMs = boundedInteger(options.maxBackoffMs, 120000, this.baseBackoffMs);
    this.random = typeof options.random === 'function' ? options.random : Math.random;
    this.queue = [];
    this.active = 0;
    this.nextStartAt = 0;
    this.healthWindow = [];
    this.timer = undefined;
  }

  snapshot() {
    return {
      active: this.active,
      queued: this.queue.filter(item => !item.settled).length,
      currentConcurrency: this.currentConcurrency,
      maxConcurrency: this.maxConcurrency,
      minStartIntervalMs: this.minStartIntervalMs
    };
  }

  configure(options = {}) {
    const nextMax = boundedInteger(options.maxConcurrency, this.maxConcurrency, 1, 50);
    const requestedCurrent = Object.prototype.hasOwnProperty.call(options, 'initialConcurrency')
      ? options.initialConcurrency
      : this.currentConcurrency;
    this.maxConcurrency = nextMax;
    this.currentConcurrency = boundedInteger(requestedCurrent, Math.min(this.currentConcurrency, nextMax), 1, nextMax);
    if (Object.prototype.hasOwnProperty.call(options, 'minStartIntervalMs')) {
      this.minStartIntervalMs = boundedInteger(options.minStartIntervalMs, this.minStartIntervalMs, 0);
    }
    this._pump();
    return this.snapshot();
  }

  schedule(operation, options = {}) {
    if (typeof operation !== 'function') return Promise.reject(new TypeError('operation must be a function'));
    if (options.signal?.aborted) return Promise.reject(abortError());

    return new Promise((resolve, reject) => {
      const item = {
        operation,
        signal: options.signal,
        onState: typeof options.onState === 'function' ? options.onState : undefined,
        attempt: 0,
        readyAt: Date.now(),
        inFlight: false,
        settled: false,
        resolve,
        reject
      };
      item.abortHandler = () => this._abort(item);
      item.signal?.addEventListener('abort', item.abortHandler, { once: true });
      this.queue.push(item);
      this._emit(item, 'queued');
      this._pump();
    });
  }

  _abort(item) {
    if (item.settled || item.inFlight) return;
    const index = this.queue.indexOf(item);
    if (index >= 0) this.queue.splice(index, 1);
    item.settled = true;
    this._cleanup(item);
    this._emit(item, 'failed', { error: 'aborted' });
    item.reject(abortError());
    this._pump();
  }

  _cleanup(item) {
    item.signal?.removeEventListener('abort', item.abortHandler);
  }

  _emit(item, state, extra = {}) {
    if (!item.onState) return;
    try {
      item.onState({ state, attempt: item.attempt, ...this.snapshot(), ...extra });
    } catch {
      // Progress callbacks must never break queue execution.
    }
  }

  _recordOutcome(success, pressure = false) {
    this.healthWindow.push({ success, pressure });
    if (pressure) this.currentConcurrency = Math.max(1, Math.floor(this.currentConcurrency / 2));
    if (this.healthWindow.length < this.healthyWindowSize) return;

    const window = this.healthWindow.splice(0, this.healthWindow.length);
    const successRatio = window.filter(entry => entry.success).length / window.length;
    const hasPressure = window.some(entry => entry.pressure);
    if (!hasPressure && successRatio >= this.healthySuccessRatio) {
      this.currentConcurrency = Math.min(this.maxConcurrency, this.currentConcurrency + 2);
    }
  }

  _backoffMs(item, error) {
    if (Number.isFinite(error.retryAfterMs)) return Math.min(this.maxBackoffMs, error.retryAfterMs);
    const ceiling = Math.min(this.maxBackoffMs, this.baseBackoffMs * (2 ** Math.max(0, item.attempt - 1)));
    return Math.max(0, Math.round(ceiling * Math.min(1, Math.max(0, Number(this.random()) || 0))));
  }

  _pump() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    let now = Date.now();
    while (this.active < this.currentConcurrency) {
      if (now < this.nextStartAt) break;
      const index = this.queue.findIndex(item => !item.settled && item.readyAt <= now);
      if (index < 0) break;
      const [item] = this.queue.splice(index, 1);
      this.nextStartAt = now + this.minStartIntervalMs;
      this._start(item);
      if (this.minStartIntervalMs > 0) break;
      now = Date.now();
    }

    if (this.active >= this.currentConcurrency || this.queue.length === 0) return;
    const earliestReady = Math.min(...this.queue.filter(item => !item.settled).map(item => item.readyAt));
    if (!Number.isFinite(earliestReady)) return;
    const wakeAt = Math.max(this.nextStartAt, earliestReady);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this._pump();
    }, Math.max(0, wakeAt - Date.now()));
  }

  _start(item) {
    item.inFlight = true;
    item.attempt += 1;
    this.active += 1;
    this._emit(item, 'running');

    Promise.resolve()
      .then(() => item.operation({ attempt: item.attempt, signal: item.signal }))
      .then(result => {
        this.active -= 1;
        item.inFlight = false;
        item.settled = true;
        this._recordOutcome(true);
        this._cleanup(item);
        this._emit(item, 'succeeded');
        item.resolve(result);
        this._pump();
      })
      .catch(error => {
        this.active -= 1;
        item.inFlight = false;
        if (item.signal?.aborted) {
          item.settled = true;
          this._cleanup(item);
          this._emit(item, 'failed', { error: 'aborted' });
          item.reject(abortError());
          this._pump();
          return;
        }

        const retryable = error instanceof RetryableRequestError || error?.retryable === true;
        this._recordOutcome(false, retryable);
        if (retryable && item.attempt < this.maxAttempts) {
          const delayMs = this._backoffMs(item, error);
          item.readyAt = Date.now() + delayMs;
          this.queue.push(item);
          this._emit(item, 'retrying', {
            delayMs,
            status: error.status,
            error: String(error.message || error)
          });
          this._pump();
          return;
        }

        item.settled = true;
        this._cleanup(item);
        this._emit(item, 'failed', {
          status: error?.status,
          error: String(error?.message || error)
        });
        item.reject(error);
        this._pump();
      });
  }
}

module.exports = {
  AdaptiveImageScheduler,
  RetryableRequestError,
  parseRetryAfterMs
};

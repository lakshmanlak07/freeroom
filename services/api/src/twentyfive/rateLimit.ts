const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Token bucket: `ratePerSec` sustained, bursts up to `capacity`. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly ratePerSec = 5,
    private readonly capacity = ratePerSec,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep = realSleep,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  async take(): Promise<void> {
    for (;;) {
      const t = this.now();
      this.tokens = Math.min(
        this.capacity,
        this.tokens + ((t - this.last) / 1000) * this.ratePerSec,
      );
      this.last = t;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.sleep(Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000));
    }
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(`HTTP ${status}`);
  }
}

/** Retry-After: delta-seconds or HTTP-date. */
export function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  if (!header) return undefined;
  if (/^\d+$/.test(header.trim())) return Number(header) * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}

const isRetryable = (e: unknown) =>
  e instanceof HttpError
    ? e.status === 429 || e.status >= 500
    : e instanceof Error && (e.name === 'TimeoutError' || e.name === 'TypeError'); // timeout / network

export interface RetryOpts {
  maxRetries?: number;
  baseMs?: number;
  capMs?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Exponential backoff with full jitter on 429/5xx/network; honours Retry-After. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const {
    maxRetries = 5,
    baseMs = 200,
    capMs = 10_000,
    random = Math.random,
    sleep = realSleep,
  } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= maxRetries || !isRetryable(e)) throw e;
      const retryAfter = e instanceof HttpError ? e.retryAfterMs : undefined;
      await sleep(retryAfter ?? random() * Math.min(capMs, baseMs * 2 ** attempt));
    }
  }
}

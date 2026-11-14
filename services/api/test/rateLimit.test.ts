import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, TokenBucket, parseRetryAfter, withRetry } from '../src/twentyfive/rateLimit';
import { RealTwentyFiveLiveSource } from '../src/twentyfive/real';

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('TokenBucket', () => {
  it('allows a burst of 5 then 1 every 200ms (5 rps)', async () => {
    const bucket = new TokenBucket(5);
    let done = 0;
    for (let i = 0; i < 7; i++) void bucket.take().then(() => done++);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(5);
    await vi.advanceTimersByTimeAsync(199);
    expect(done).toBe(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(6);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(7);
  });
});

describe('withRetry', () => {
  it('backs off exponentially with full jitter on 429 then succeeds', async () => {
    let calls = 0;
    const p = withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new HttpError(429);
        return 'ok';
      },
      { random: () => 1 },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(199);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1); // 200 * 2^0
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(400); // 200 * 2^1
    await expect(p).resolves.toBe('ok');
    expect(calls).toBe(3);
  });

  it('uses jitter in [0, cap)', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await withRetry(
      async () => {
        if (++calls < 3) throw new HttpError(503);
        return 1;
      },
      { random: () => 0.5, sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(sleeps).toEqual([100, 200]);
  });

  it('honours Retry-After over jitter', async () => {
    let calls = 0;
    const p = withRetry(async () => {
      if (++calls === 1) throw new HttpError(503, 5000);
      return 'ok';
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe('ok');
  });

  it('gives up after 5 retries (6 attempts)', async () => {
    let calls = 0;
    const p = withRetry(async () => {
      calls++;
      throw new HttpError(500);
    });
    const assertion = expect(p).rejects.toThrow('HTTP 500');
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(calls).toBe(6);
  });

  it('does not retry 4xx', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new HttpError(400);
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('3', 0)).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter('soon', 0)).toBeUndefined();
    expect(parseRetryAfter(null, 0)).toBeUndefined();
  });
});

describe('RealTwentyFiveLiveSource', () => {
  it('retries a 429 with Retry-After, sends basic auth, maps spaces', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(
        Response.json({
          spaces: { space: [{ space_id: 5, space_name: 'ILC S131', max_capacity: 300 }] },
        }),
      );
    const src = new RealTwentyFiveLiveSource(
      { baseUrl: 'https://25live.example.edu/r25ws/run/', username: 'u', password: 'p' },
      { fetch: fetchMock },
    );
    const p = src.listRooms();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual([expect.objectContaining({ roomId: 'ILC-S131', capacity: 300 })]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://25live.example.edu/r25ws/run/spaces.json');
    expect((init?.headers as Record<string, string>).authorization).toBe(`Basic ${btoa('u:p')}`);
  });
});

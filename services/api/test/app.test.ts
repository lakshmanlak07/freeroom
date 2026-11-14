import { afterEach, describe, expect, it } from 'vitest';
import { ApiErrorSchema, HealthResponseSchema } from '@freeroom/shared';
import { assertNoPII } from '@freeroom/domain';
import { createApp } from '../src/app';
import { makeDb } from '../src/data/db';
import { createLogger } from '../src/logger';
import { MockSource } from '../src/twentyfive/mock';

const deps = {
  db: makeDb({ table: 'unused', endpoint: 'http://127.0.0.1:1' }),
  source: new MockSource(),
  logger: createLogger({}, () => {}),
};
const app = createApp(deps);

afterEach(() => {
  delete process.env.STAGE;
});

describe('api app', () => {
  it('GET /health', async () => {
    const res = await app.request('/health');
    const body = await res.json();
    assertNoPII(body);
    expect(res.status).toBe(200);
    expect(HealthResponseSchema.parse(body)).toEqual({ ok: true });
    expect(res.headers.get('x-correlation-id')).toBeTruthy();
  });

  it('echoes a safe correlation id, replaces an unsafe one', async () => {
    const ok = await app.request('/health', { headers: { 'x-correlation-id': 'abc-123' } });
    assertNoPII(await ok.json());
    expect(ok.headers.get('x-correlation-id')).toBe('abc-123');
    const bad = await app.request('/health', { headers: { 'x-correlation-id': 'bad id; drop' } });
    assertNoPII(await bad.json());
    expect(bad.headers.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('requires auth everywhere else, ignoring x-dev-user unless devAuth', async () => {
    const res = await app.request('/rooms', { headers: { 'x-dev-user': 'admin1' } });
    const body = await res.json();
    assertNoPII(body);
    expect(res.status).toBe(401);
    expect(ApiErrorSchema.parse(body).error.code).toBe('UNAUTHORIZED');
  });

  it('refuses dev auth / demo / mock 25Live in prod', () => {
    process.env.STAGE = 'prod';
    for (const flag of ['devAuth', 'demo', 'mock25live'] as const) {
      expect(() => createApp({ ...deps, [flag]: true })).toThrow(/never be enabled in prod/);
    }
    expect(() => createApp(deps)).not.toThrow();
  });
});

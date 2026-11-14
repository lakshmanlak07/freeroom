import { describe, expect, it } from 'vitest';
import { ApiErrorSchema, HealthResponseSchema } from '@freeroom/shared';
import { assertNoPII } from '@freeroom/domain';
import { AppError, app } from '../src/app';

app.get('/__test/slot-taken', () => {
  throw new AppError('SLOT_TAKEN', 'Slot taken', { slot: '2026-11-16T14:00:00.000Z' });
});
app.get('/__test/boom', () => {
  throw new Error('boom');
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

  it('maps AppError to PRD error shape and status', async () => {
    const res = await app.request('/__test/slot-taken');
    const body = await res.json();
    assertNoPII(body);
    expect(res.status).toBe(409);
    expect(ApiErrorSchema.parse(body).error).toMatchObject({
      code: 'SLOT_TAKEN',
      details: { slot: expect.any(String) },
    });
  });

  it('hides internal errors and 404s', async () => {
    const boom = await app.request('/__test/boom');
    const boomBody = await boom.json();
    assertNoPII(boomBody);
    expect(boom.status).toBe(500);
    expect(ApiErrorSchema.parse(boomBody).error).toEqual({
      code: 'INTERNAL',
      message: 'Internal error',
    });

    const missing = await app.request('/nope');
    const missingBody = await missing.json();
    assertNoPII(missingBody);
    expect(missing.status).toBe(404);
    expect(ApiErrorSchema.parse(missingBody).error.code).toBe('NOT_FOUND');
  });
});

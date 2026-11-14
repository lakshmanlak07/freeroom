import type { ErrorCode } from '@freeroom/shared';

export type Err = { ok: false; code: ErrorCode; details?: Record<string, unknown> };
export type Result<T = undefined> = { ok: true; value: T } | Err;

export const ok = <T = undefined>(value?: T): Result<T> => ({ ok: true, value: value as T });
export const err = (code: ErrorCode, details?: Record<string, unknown>): Err =>
  details ? { ok: false, code, details } : { ok: false, code };

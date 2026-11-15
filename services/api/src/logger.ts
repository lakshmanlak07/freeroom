/** Structured JSON logs; PII and secrets are redacted by key name at any depth (CLAUDE.md). */
// Substring match (audit L1): phoneNumber, userEmail, idToken… are caught too.
const REDACT_KEY =
  /universityid|uidhash|email|phone|contact|authorization|cookie|password|secret|token|x-dev-user|enc$/i;
// PII that can hide inside free text (error messages).
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
// Phone-shaped (413-555-0100, (413) 555 0100, +1 413 555 0100) — not ISO dates or ids.
const PHONE = /(\+?\d{1,3}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const scrub = (s: string) => s.replace(EMAIL, '[REDACTED]').replace(PHONE, '[REDACTED]');

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: scrub(value.message) };
  if (value instanceof Date) return value.toISOString();
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      REDACT_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1),
    ]),
  );
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(
  base: Record<string, unknown> = {},
  write: (line: string) => void = (l) => process.stdout.write(l + '\n'),
): Logger {
  const emit =
    (level: string) =>
    (msg: string, fields: Record<string, unknown> = {}) =>
      write(
        JSON.stringify({
          level,
          time: new Date().toISOString(),
          msg,
          ...(redact({ ...base, ...fields }) as object),
        }),
      );
  return {
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    child: (fields) => createLogger({ ...base, ...fields }, write),
  };
}

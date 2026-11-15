import { describe, expect, it } from 'vitest';
import { createLogger, redact } from '../src/logger';

describe('logger redaction', () => {
  it('redacts PII and secrets at any depth', () => {
    expect(
      redact({
        universityId: '33012345',
        user: { email: 'a@b.edu', phone: '555', emailEnc: 'x', displayAlias: 'Owl' },
        headers: { authorization: 'Bearer t', 'x-dev-user': 'student1' },
        list: [{ idToken: 'jwt' }],
        roomId: 'LGRT-0101',
      }),
    ).toEqual({
      universityId: '[REDACTED]',
      user: {
        email: '[REDACTED]',
        phone: '[REDACTED]',
        emailEnc: '[REDACTED]',
        displayAlias: 'Owl',
      },
      headers: { authorization: '[REDACTED]', 'x-dev-user': '[REDACTED]' },
      list: [{ idToken: '[REDACTED]' }],
      roomId: 'LGRT-0101',
    });
  });

  it('audit L1: variant key names, PII inside error messages, and deep values are redacted', () => {
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 12; i++) cur = (cur.next = {}) as Record<string, unknown>;
    cur.leak = 'x';
    const out = redact({
      phoneNumber: '+1 413 555 0100',
      userEmail: 'a@b.edu',
      err: new Error('lookup failed for jane.doe@umass.edu / 413-555-0100'),
      deep,
    }) as Record<string, unknown>;
    expect(out.phoneNumber).toBe('[REDACTED]');
    expect(out.userEmail).toBe('[REDACTED]');
    expect(JSON.stringify(out.err)).not.toMatch(/umass.edu|555/);
    expect(JSON.stringify(out.deep)).not.toContain('leak');
  });

  it('writes one JSON line with correlation id from child loggers', () => {
    const lines: string[] = [];
    createLogger({ service: 'api' }, (l) => lines.push(l))
      .child({ correlationId: 'c-1' })
      .error('boom', { error: new Error('bad'), contact: { email: 'x' } });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toMatchObject({
      level: 'error',
      msg: 'boom',
      service: 'api',
      correlationId: 'c-1',
      error: { name: 'Error', message: 'bad' },
      contact: '[REDACTED]',
    });
  });
});

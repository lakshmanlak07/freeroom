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

import { Hono } from 'hono';
import { ERROR_STATUS, type ApiError, type ErrorCode } from '@freeroom/shared';

/** Throw from handlers; mapped to the PRD §7 error shape + status. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string = code,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const errorBody = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiError => ({ error: { code, message, ...(details && { details }) } });

const CORRELATION_ID = /^[\w-]{1,64}$/;

export const app = new Hono<{ Variables: { correlationId: string } }>();

app.use('*', async (c, next) => {
  const incoming = c.req.header('x-correlation-id');
  const id = incoming && CORRELATION_ID.test(incoming) ? incoming : crypto.randomUUID();
  c.set('correlationId', id);
  c.header('x-correlation-id', id);
  await next();
});

app.get('/health', (c) => c.json({ ok: true as const }));

app.notFound((c) => c.json(errorBody('NOT_FOUND', 'Route not found'), 404));

app.onError((e, c) => {
  if (e instanceof AppError) {
    return c.json(errorBody(e.code, e.message, e.details), ERROR_STATUS[e.code]);
  }
  // ponytail: plain console JSON; P2 replaces with the redacting structured logger.
  console.error(
    JSON.stringify({ level: 'error', correlationId: c.get('correlationId'), msg: e.message }),
  );
  return c.json(errorBody('INTERNAL', 'Internal error'), 500);
});

import { type RoleLimits } from '@freeroom/domain';
import { ERROR_STATUS, type ApiError, type ErrorCode, type Role } from '@freeroom/shared';
import { Hono } from 'hono';
import type { Db } from './data/db';
import { getUser, type UserProfile } from './data/users';
import { AppError } from './errors';
import { createLogger, type Logger } from './logger';
import { demoRoutes, mock25liveRoutes } from './routes/dev';
import { reservationRoutes } from './routes/reservations';
import { roomRoutes } from './routes/rooms';
import type { ScheduleSource } from './twentyfive/source';

export { AppError };

export interface AppDeps {
  db: Db;
  source: ScheduleSource;
  now?: () => Date;
  logger?: Logger;
  /** `x-dev-user` header auth. Only when NODE_ENV=development; refused in prod. */
  devAuth?: boolean;
  /** /mock25live/* endpoints. Refused in prod. */
  mock25live?: boolean;
  /** /demo/* controls. Refused in prod. */
  demo?: boolean;
  limits?: Readonly<Record<Role, RoleLimits>>;
  refreshTimeoutMs?: number;
}

export interface Ctx extends AppDeps {
  now: () => Date;
  logger: Logger;
  refreshTimeoutMs: number;
}

export type Env = { Variables: { correlationId: string; log: Logger; user: UserProfile } };

const errorBody = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiError => ({
  error: { code, message, ...(details && { details }) },
});

const CORRELATION_ID = /^[\w-]{1,64}$/;
const PUBLIC = (path: string) => path === '/health' || path.startsWith('/mock25live/');

export function createApp(deps: AppDeps) {
  if (process.env.STAGE === 'prod' && (deps.devAuth || deps.mock25live || deps.demo)) {
    throw new Error('dev auth / mock 25Live / demo endpoints must never be enabled in prod');
  }
  const ctx: Ctx = {
    ...deps,
    now: deps.now ?? (() => new Date()),
    logger: deps.logger ?? createLogger({ service: 'api' }),
    refreshTimeoutMs: deps.refreshTimeoutMs ?? 2000,
  };
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    const incoming = c.req.header('x-correlation-id');
    const id = incoming && CORRELATION_ID.test(incoming) ? incoming : crypto.randomUUID();
    c.set('correlationId', id);
    c.set('log', ctx.logger.child({ correlationId: id }));
    c.header('x-correlation-id', id);
    const t0 = Date.now();
    await next();
    c.get('log').info('http', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - t0,
    });
  });

  app.use('*', async (c, next) => {
    if (PUBLIC(c.req.path)) return next();
    let user: UserProfile | null = null;
    if (ctx.devAuth) {
      const devUser = c.req.header('x-dev-user');
      if (devUser) user = await getUser(ctx.db, devUser);
    }
    // TODO(P3): Cognito ID token claims from the HTTP API JWT authorizer.
    if (!user) throw new AppError('UNAUTHORIZED', 'Sign in required');
    if (user.status === 'SUSPENDED') throw new AppError('FORBIDDEN', 'Account suspended');
    c.set('user', user);
    return next();
  });

  app.get('/health', (c) => c.json({ ok: true as const }));
  if (ctx.mock25live) app.route('/mock25live', mock25liveRoutes(ctx));
  app.route('/', roomRoutes(ctx));
  app.route('/', reservationRoutes(ctx));
  if (ctx.demo) app.route('/', demoRoutes(ctx));

  app.notFound((c) => c.json(errorBody('NOT_FOUND', 'Route not found'), 404));
  app.onError((e, c) => {
    if (e instanceof AppError) {
      return c.json(errorBody(e.code, e.message, e.details), ERROR_STATUS[e.code]);
    }
    (c.get('log') ?? ctx.logger).error('unhandled', { error: e });
    return c.json(errorBody('INTERNAL', 'Internal error'), 500);
  });

  return app;
}

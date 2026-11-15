import { type RoleLimits } from '@freeroom/domain';
import { ERROR_STATUS, type ApiError, type ErrorCode, type Role } from '@freeroom/shared';
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import type { VerifyIdToken } from './auth';
import type { ContactService } from './contact';
import type { Db } from './data/db';
import { getUser, type UserProfile } from './data/users';
import { withCorrelationId } from './correlation';
import { AppError } from './errors';
import { createLogger, type Logger } from './logger';
import { metric } from './metrics';
import type { NlBedrock } from './nlsearch';
import { claimRoutes, contactRevealRoutes } from './routes/claims';
import { demoRoutes, mock25liveRoutes } from './routes/dev';
import { notificationRoutes } from './routes/notifications';
import { reservationRoutes } from './routes/reservations';
import { roomRoutes } from './routes/rooms';
import { meRoutes, registerRoutes } from './routes/users';
import type { ScheduleSource } from './twentyfive/source';

export { AppError };

/**
 * Which routes this deployment serves. `privileged` = GET/PATCH /me + GET /claims/:id/contact,
 * deployed as its own Lambda whose role alone holds kms:Decrypt (PRD §9). `main` = everything else.
 */
export type Surface = 'all' | 'main' | 'privileged';

export interface AppDeps {
  db: Db;
  source: ScheduleSource;
  now?: () => Date;
  logger?: Logger;
  /** Cognito ID-token verification (aws-jwt-verify). */
  verifyIdToken?: VerifyIdToken;
  uidPepper?: () => Promise<string>;
  /**
   * Shared secret CloudFront adds as `x-origin-verify` on /api/*. When set, requests without it
   * (i.e. straight to the execute-api URL, around the WAF) are refused.
   */
  originSecret?: () => Promise<string>;
  /** Bedrock for natural-language search; absent = deterministic parser only. */
  nlBedrock?: NlBedrock;
  contacts?: ContactService;
  surface?: Surface;
  /** `x-dev-user` header auth. Only when NODE_ENV=development; refused in prod. */
  devAuth?: boolean;
  /** /mock25live/* endpoints. Refused in prod. */
  mock25live?: boolean;
  /** /demo/* controls (DEMO_MODE). Refused in prod. */
  demo?: boolean;
  limits?: Readonly<Record<Role, RoleLimits>>;
  refreshTimeoutMs?: number;
}

export interface Ctx extends AppDeps {
  now: () => Date;
  logger: Logger;
  refreshTimeoutMs: number;
}

/**
 * `user` is set for registered users. It is absent only on /register, GET /me and anonymous
 * public room reads — those handlers check for it explicitly.
 */
export type Env = {
  Variables: { correlationId: string; log: Logger; sub: string; user: UserProfile };
};

const errorBody = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiError => ({
  error: { code, message, ...(details && { details }) },
});

const CORRELATION_ID = /^[\w-]{1,64}$/;
const PUBLIC = (path: string) => path === '/health' || path.startsWith('/mock25live/');
/** Room browsing works signed-out (no JWT authorizer on these routes); a token, if sent, is verified. */
const PUBLIC_READ = (method: string, path: string) =>
  method === 'GET' &&
  (path === '/buildings' || path === '/rooms' || /^\/rooms\/[^/]+(\/schedule)?$/.test(path));
const ALLOWED_UNREGISTERED = (method: string, path: string) =>
  (method === 'POST' && path === '/register') || (method === 'GET' && path === '/me');

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
  const surface = deps.surface ?? 'all';
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    const incoming = c.req.header('x-correlation-id');
    const id = incoming && CORRELATION_ID.test(incoming) ? incoming : crypto.randomUUID();
    c.set('correlationId', id);
    c.set('log', ctx.logger.child({ correlationId: id }));
    c.header('x-correlation-id', id);
    const t0 = Date.now();
    await withCorrelationId(id, next);
    c.get('log').info('http', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - t0,
    });
  });

  app.use('*', async (c, next) => {
    if (!ctx.originSecret) return next();
    const got = Buffer.from(c.req.header('x-origin-verify') ?? '');
    const want = Buffer.from(await ctx.originSecret());
    if (got.length !== want.length || !timingSafeEqual(got, want)) {
      throw new AppError('FORBIDDEN', 'Use the FreeRoom site URL');
    }
    return next();
  });

  app.use('*', async (c, next) => {
    if (PUBLIC(c.req.path)) return next();
    let sub: string | undefined;
    const devUser = ctx.devAuth ? c.req.header('x-dev-user') : undefined;
    if (devUser) {
      sub = devUser;
    } else {
      const auth = c.req.header('authorization');
      const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
      if (token && ctx.verifyIdToken) {
        sub = await ctx.verifyIdToken(token).then(
          (v) => v.sub,
          () => undefined,
        );
      }
    }
    if (!sub) {
      const credentialsSent = !!c.req.header('authorization') || !!devUser;
      if (!credentialsSent && PUBLIC_READ(c.req.method, c.req.path)) return next(); // anonymous
      throw new AppError('UNAUTHORIZED', 'Sign in required');
    }
    const user = await getUser(ctx.db, sub);
    if (user?.status === 'SUSPENDED') throw new AppError('FORBIDDEN', 'Account suspended');
    c.set('sub', sub);
    if (user) c.set('user', user);
    else if (
      !ALLOWED_UNREGISTERED(c.req.method, c.req.path) &&
      !PUBLIC_READ(c.req.method, c.req.path)
    ) {
      throw new AppError('FORBIDDEN', 'Complete registration first');
    }
    return next();
  });

  app.get('/health', (c) => c.json({ ok: true as const }));
  if (surface !== 'privileged') {
    if (ctx.mock25live) app.route('/mock25live', mock25liveRoutes(ctx));
    app.route('/', registerRoutes(ctx));
    app.route('/', roomRoutes(ctx));
    app.route('/', reservationRoutes(ctx));
    app.route('/', claimRoutes(ctx));
    app.route('/', notificationRoutes(ctx));
    if (ctx.demo) app.route('/', demoRoutes(ctx));
  }
  if (surface !== 'main') {
    app.route('/', meRoutes(ctx));
    app.route('/', contactRevealRoutes(ctx));
  }

  app.notFound((c) => c.json(errorBody('NOT_FOUND', 'Route not found'), 404));
  app.onError((e, c) => {
    if (e instanceof AppError) {
      if (e.code === 'CLASS_CONFLICT') metric('ClassConflictsBlocked');
      if (e.code === 'SLOT_TAKEN') metric('SlotTakenRaces');
      return c.json(errorBody(e.code, e.message, e.details), ERROR_STATUS[e.code]);
    }
    (c.get('log') ?? ctx.logger).error('unhandled', { error: e });
    return c.json(errorBody('INTERNAL', 'Internal error'), 500);
  });

  return app;
}

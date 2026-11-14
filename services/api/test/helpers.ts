import { randomUUID } from 'node:crypto';
import { assertNoPII } from '@freeroom/domain';
import { createApp, type AppDeps } from '../src/app';
import { makeDb } from '../src/data/db';
import { createTableIfMissing } from '../src/data/table';
import { DEMO_USERS, putUser } from '../src/data/users';
import { createLogger } from '../src/logger';
import { loadInjected, syncSchedule } from '../src/sync/syncSchedule';
import { MockSource } from '../src/twentyfive/mock';
import type { ScheduleSource } from '../src/twentyfive/source';

export const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
export const silent = createLogger({}, () => {});

/** Fresh table per suite; mock campus with NO generated classes (tests inject what they need). */
export async function setupTestApp(opts: {
  now: Date;
  source?: ScheduleSource;
  sync?: boolean;
  deps?: Partial<AppDeps>;
}) {
  const db = makeDb({ table: `t-${randomUUID()}`, endpoint: ENDPOINT });
  await createTableIfMissing(db.raw, db.table);
  await Promise.all(DEMO_USERS.map((u) => putUser(db, u)));
  const source =
    opts.source ?? new MockSource({ generateClasses: false, loadInjected: () => loadInjected(db) });
  const clock = { now: opts.now };
  if (opts.sync !== false) await syncSchedule({ db, source, now: clock.now, log: silent });
  const app = createApp({
    db,
    source,
    now: () => clock.now,
    logger: silent,
    devAuth: true,
    demo: true,
    ...opts.deps,
  });

  /** Every API response in tests goes through assertNoPII (CLAUDE.md). */
  async function req(
    user: string,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await app.request(path, {
      method,
      headers: { 'x-dev-user': user, 'content-type': 'application/json', ...headers },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const json = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    assertNoPII(json);
    return { status: res.status, body: json };
  }

  const reserve = (
    user: string,
    roomId: string,
    start: string,
    end: string,
    extra: Record<string, unknown> = {},
    key = randomUUID(),
  ) =>
    req(
      user,
      'POST',
      '/reservations',
      { roomId, start, end, partySize: 1, ...extra },
      { 'idempotency-key': key },
    );

  return { db, app, source, clock, req, reserve };
}

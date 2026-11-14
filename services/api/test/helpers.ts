import { randomUUID } from 'node:crypto';
import { assertNoPII } from '@freeroom/domain';
import { createApp, type AppDeps } from '../src/app';
import { ContactService, LocalKeyProvider } from '../src/contact';
import { makeDb } from '../src/data/db';
import { createTableIfMissing } from '../src/data/table';
import { seedDemoUsers } from '../src/data/users';
import { createLogger } from '../src/logger';
import { loadInjected, syncSchedule } from '../src/sync/syncSchedule';
import { MockSource } from '../src/twentyfive/mock';
import type { ScheduleSource } from '../src/twentyfive/source';

export const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
export const silent = createLogger({}, () => {});

/** Test stand-in for the Cognito verifier: "Bearer test:<sub>". The real verifier is tested in auth.test.ts. */
export const fakeVerify = async (token: string) => {
  if (!token.startsWith('test:')) throw new Error('bad token');
  return { sub: token.slice(5) };
};

/** Fresh table per suite; mock campus with NO generated classes (tests inject what they need). */
export async function setupTestApp(opts: {
  now: Date;
  source?: ScheduleSource;
  sync?: boolean;
  deps?: Partial<AppDeps>;
}) {
  const db = makeDb({ table: `t-${randomUUID()}`, endpoint: ENDPOINT });
  await createTableIfMissing(db.raw, db.table);
  const contacts = new ContactService(new LocalKeyProvider());
  await seedDemoUsers(db, contacts);
  const source =
    opts.source ?? new MockSource({ generateClasses: false, loadInjected: () => loadInjected(db) });
  const clock = { now: opts.now };
  if (opts.sync !== false) await syncSchedule({ db, source, now: clock.now, log: silent });
  const app = createApp({
    db,
    source,
    now: () => clock.now,
    logger: silent,
    contacts,
    uidPepper: async () => 'test-pepper',
    verifyIdToken: fakeVerify,
    devAuth: true,
    demo: true,
    ...opts.deps,
  });

  /**
   * Every API response goes through assertNoPII (CLAUDE.md), except the two routes that exist to
   * return the caller's own / an approved owner's contact: GET|PATCH /me and GET /claims/:id/contact.
   */
  async function req(
    user: string,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    o: { allowPII?: boolean; bearer?: boolean } = {},
  ) {
    const res = await app.request(path, {
      method,
      headers: {
        ...(o.bearer ? { authorization: `Bearer test:${user}` } : { 'x-dev-user': user }),
        'content-type': 'application/json',
        ...headers,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const json = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const exempt = /^\/me$|^\/claims\/[^/]+\/contact$/.test(path.split('?')[0]!);
    if (!(o.allowPII && exempt)) assertNoPII(json);
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

  return { db, app, source, clock, contacts, req, reserve };
}

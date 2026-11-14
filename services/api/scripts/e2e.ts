/**
 * P7 end-to-end flow check over HTTP against a running API (default: `pnpm dev:api` on :3001,
 * dev auth via x-dev-user). Prints a pass/fail table; exit 1 on any failure.
 * Usage: pnpm --filter @freeroom/api e2e [baseUrl]
 */
import { addDays, campusDay, campusLocalToUtc } from '@freeroom/domain';
import { randomUUID } from 'node:crypto';

const BASE = process.argv[2] ?? 'http://localhost:3001';
const run = randomUUID().slice(0, 6);
type Res = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(
  user: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<Res> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (user) headers['x-dev-user'] = user;
  if (method === 'POST' && path === '/reservations') headers['idempotency-key'] = randomUUID();
  const r = await fetch(BASE + path, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
const expect = (cond: unknown, msg: string, res?: Res) => {
  if (!cond)
    throw new Error(`${msg}${res ? ` (got ${res.status} ${JSON.stringify(res.body)})` : ''}`);
};
const results: { flow: string; ok: boolean; note: string }[] = [];
async function flow(name: string, fn: () => Promise<string | void>) {
  try {
    results.push({ flow: name, ok: true, note: (await fn()) ?? '' });
  } catch (e) {
    results.push({ flow: name, ok: false, note: (e as Error).message });
  }
}
const until = async <T>(fn: () => Promise<T | undefined>, ms = 15_000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 500))) {
    const v = await fn();
    if (v) return v;
  }
  return undefined;
};
type Notif = { type: string; alternatives?: { roomId: string; start: string; end: string }[] };
const findNotif = (user: string, type: string) =>
  until(async () => {
    const l = await call(user, 'GET', '/me/notifications');
    return (l.body.notifications as Notif[]).find((x) => x.type === type);
  });

// Two campus days out so new reservations start PENDING (outside the 24h confirm window).
const day = addDays(campusDay(new Date()), 2);
const at = (hhmm: string) => campusLocalToUtc(`${day}T${hhmm}:00`).toISOString();
const A = `e2e-a-${run}`;
const B = `e2e-b-${run}`;
const C = `e2e-c-${run}`;
const emailOf = (u: string) => `${u}@e2e.freeroom.test`;
const ids: Record<string, string> = {};

await flow('demo reset + seed', async () => {
  const r = await call('admin1', 'POST', '/demo/reset');
  expect(r.status === 200 && r.body.seeded?.pending && r.body.seeded?.claimed, 'reset', r);
  const inc = await call('student1', 'GET', '/me/claims?direction=incoming');
  expect(
    inc.body.claims?.some((c: { status: string }) => c.status === 'PENDING'),
    'claim',
    inc,
  );
  return `${r.body.seeded.reservations} seeded`;
});

await flow('register (3 new students)', async () => {
  for (const [i, u] of [A, B, C].entries()) {
    const r = await call(u, 'POST', '/register', {
      universityId: `E2E${run}${i}`.replace(/[^0-9A-Za-z]/g, '').slice(0, 12),
      displayAlias: `Tester ${i}`,
      contact: { email: emailOf(u) },
      shareChannel: 'email',
    });
    expect(r.status === 201 || r.status === 200, `register ${u}`, r);
    expect(!JSON.stringify(r.body).includes(emailOf(u)), 'register response leaks contact', r);
  }
});

let room = '';
await flow('search (rooms + buildings)', async () => {
  const b = await call(null, 'GET', '/buildings');
  expect(b.status === 200 && b.body.buildings.length > 0, 'buildings', b);
  const r = await call(A, 'GET', '/rooms?minCapacity=4');
  expect(r.status === 200 && r.body.rooms.length > 0, 'rooms', r);
  room = r.body.rooms[0].room?.roomId ?? r.body.rooms[0].roomId;
  return `${r.body.rooms.length} rooms`;
});

let classItem: { start: string; end: string } | undefined;
let free: { start: string; end: string }[] = [];
await flow('reserve', async () => {
  const s = await call(A, 'GET', `/rooms/${room}/schedule?from=${at('07:00')}&to=${at('23:00')}`);
  expect(s.status === 200, 'schedule', s);
  const busy = s.body.items as { kind: string; start: string; end: string }[];
  classItem = busy.find((x) => x.kind === 'class');
  const clash = (st: string, en: string) => busy.some((x) => x.start < en && st < x.end);
  free = ['08:00', '09:00', '12:00', '13:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00']
    .map((h) => ({ start: at(h), end: new Date(Date.parse(at(h)) + 3_600_000).toISOString() }))
    .filter((x) => !clash(x.start, x.end));
  expect(free.length >= 3, 'need 3 free hours in the test room');
  const r = await call(A, 'POST', '/reservations', { roomId: room, ...free[0], partySize: 2 });
  expect(r.status === 201 && r.body.status === 'PENDING_CONFIRMATION', 'create', r);
  ids.res1 = r.body.id;
  return `${room} on ${day}`;
});

await flow('class conflict rejected (BR-1)', async () => {
  expect(classItem, `no class in ${room} on ${day} to test against`);
  // Classes needn't sit on the 15-min grid; ask for the aligned slots covering one.
  const q = 15 * 60_000;
  const start = new Date(Math.floor(Date.parse(classItem!.start) / q) * q).toISOString();
  const end = new Date(Math.ceil(Date.parse(classItem!.end) / q) * q).toISOString();
  const r = await call(A, 'POST', '/reservations', { roomId: room, start, end, partySize: 2 });
  expect(r.status === 409 && r.body.error.code === 'CLASS_CONFLICT', 'expected CLASS_CONFLICT', r);
});

await flow('double-booking race (BR-8)', async () => {
  const body = { roomId: room, ...free[1], partySize: 2 };
  const [x, y] = await Promise.all([
    call(B, 'POST', '/reservations', body),
    call(C, 'POST', '/reservations', body),
  ]);
  const codes = [x.status, y.status].sort();
  expect(codes[0] === 201 && codes[1] === 409, 'exactly one winner', { status: 0, body: [x, y] });
  const loser = x.status === 409 ? x : y;
  expect(loser.body.error.code === 'SLOT_TAKEN', 'loser gets SLOT_TAKEN', loser);
  ids.race = (x.status === 201 ? x : y).body.id;
  ids.raceOwner = x.status === 201 ? B : C;
  return `one 201, one 409 SLOT_TAKEN`;
});

await flow('confirm (window + seeded pending)', async () => {
  const early = await call(A, 'POST', `/reservations/${ids.res1}/confirm`);
  expect(early.status === 409 && early.body.error.code === 'TOO_EARLY', 'TOO_EARLY', early);
  const mine = await call('student1', 'GET', '/me/reservations');
  const p = (mine.body.reservations as { id: string; status: string }[]).find(
    (x) => x.status === 'PENDING_CONFIRMATION',
  );
  expect(p, 'seeded pending reservation for student1', mine);
  const ok = await call('student1', 'POST', `/reservations/${p!.id}/confirm`);
  expect(ok.status === 200 && ok.body.status === 'CONFIRMED', 'confirm', ok);
});

await flow('claim, approve (share contact), reveal (BR-5)', async () => {
  const cl = await call(B, 'POST', `/reservations/${ids.res1}/claims`, {
    message: 'pls',
    partySize: 2,
  });
  expect(cl.status === 201, 'claim', cl);
  const before = await call(B, 'GET', `/claims/${cl.body.claimId}/contact`);
  expect(before.status === 403, 'no contact before approval', before);
  const ap = await call(A, 'POST', `/claims/${cl.body.claimId}/approve`, { mode: 'SHARE_CONTACT' });
  expect(ap.status === 200 && ap.body.status === 'APPROVED', 'approve', ap);
  expect(!JSON.stringify(ap.body).includes(emailOf(A)), 'approve response leaks contact', ap);
  const rv = await call(B, 'GET', `/claims/${cl.body.claimId}/contact`);
  expect(rv.status === 200 && rv.body.value === emailOf(A), 'reveal', rv);
  const other = await call(C, 'GET', `/claims/${cl.body.claimId}/contact`);
  expect(other.status === 403 || other.status === 404, 'third party blocked', other);
});

await flow('transfer', async () => {
  const r = await call(A, 'POST', '/reservations', { roomId: room, ...free[2], partySize: 2 });
  expect(r.status === 201, 'create res2', r);
  ids.res2 = r.body.id;
  const taker = ids.raceOwner === B ? C : B; // the one who lost the race
  const cl = await call(taker, 'POST', `/reservations/${ids.res2}/claims`, { partySize: 2 });
  expect(cl.status === 201, 'claim', cl);
  const ap = await call(A, 'POST', `/claims/${cl.body.claimId}/approve`, { mode: 'TRANSFER' });
  expect(ap.status === 200, 'approve transfer', ap);
  const g = await call(taker, 'GET', `/reservations/${ids.res2}`);
  expect(g.status === 200 && g.body.isMine === true, 'new owner sees it as theirs', g);
});

await flow('auto-release via fast-forward (BR-6)', async () => {
  const ff = await call('admin1', 'POST', '/demo/fast-forward', { reservationId: ids.res1 });
  expect(ff.status === 200 && ff.body.status === 'RELEASED', 'released', ff);
  expect(await findNotif(A, 'reservation.auto_released'), 'auto_released notification');
  const late = await call(A, 'POST', `/reservations/${ids.res1}/confirm`);
  expect(late.status === 409, 'cannot confirm after release', late);
});

await flow('inject conflict, alternatives, rebook (BR-9)', async () => {
  const owner = ids.raceOwner!;
  const inj = await call('admin1', 'POST', '/demo/inject-conflict', { reservationId: ids.race });
  expect(inj.status === 201 && inj.body.releaseReason === 'CLASS_CONFLICT', 'inject', inj);
  const n = await findNotif(owner, 'reservation.class_conflict');
  expect(n?.alternatives?.length, 'class_conflict notification with alternatives');
  const alt = n!.alternatives![0]!;
  const rb = await call(owner, 'POST', '/reservations', {
    roomId: alt.roomId,
    start: alt.start,
    end: alt.end,
    partySize: 2,
  });
  expect(rb.status === 201, 'rebook', rb);
  return `${n!.alternatives!.length} alternatives`;
});

await flow('map data (buildings mix)', async () => {
  const b = await call(null, 'GET', '/buildings');
  const pcts = (b.body.buildings as { freePct: number }[]).map((x) => x.freePct);
  expect(
    pcts.some((p) => p < 100),
    'some building busy right now',
    b,
  );
  return pcts.join('/');
});

console.log('\n| Flow | Result | Note |\n|---|---|---|');
for (const r of results) console.log(`| ${r.flow} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.note} |`);
process.exit(results.every((r) => r.ok) ? 0 : 1);

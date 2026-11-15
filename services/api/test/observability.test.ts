/** P8: correlation id API → EVT item → onChange log; EMF metrics for blocked/created writes. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryAll } from '../src/data/db';
import { keys } from '../src/data/keys';
import { createLogger } from '../src/logger';
import { setMetricSink } from '../src/metrics';
import { onChange } from '../src/notify/onChange';
import { setupTestApp } from './helpers';

const NOW = new Date('2026-11-16T12:00:00Z');
let t: Awaited<ReturnType<typeof setupTestApp>>;
const lines: string[] = [];
const metricNames = () =>
  lines.map((l) => JSON.parse(l)._aws.CloudWatchMetrics[0].Metrics[0].Name as string);

beforeAll(async () => {
  t = await setupTestApp({ now: NOW });
  setMetricSink((l) => lines.push(l));
});
afterAll(() => setMetricSink(null));

describe('observability', () => {
  it('correlation id rides the audit event into onChange logs', async () => {
    const cid = 'test-corr-0001';
    const res = await t.app.request('/reservations', {
      method: 'POST',
      headers: {
        'x-dev-user': 'student2',
        'content-type': 'application/json',
        'idempotency-key': 'corr-test-key-1',
        'x-correlation-id': cid,
      },
      body: JSON.stringify({
        roomId: 'LGRT-0101',
        start: '2026-11-18T17:00:00Z',
        end: '2026-11-18T18:00:00Z',
        partySize: 1,
      }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('x-correlation-id')).toBe(cid);
    const { id } = (await res.json()) as { id: string };
    const evts = await queryAll(t.db, {
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :e)',
      ExpressionAttributeValues: { ':pk': keys.resPk(id), ':e': keys.prefix.evt },
    });
    expect(evts[0]?.correlationId).toBe(cid);

    const logged: string[] = [];
    await onChange({ db: t.db, log: createLogger({}, (l) => logged.push(l)) }, [
      { eventName: 'INSERT', newImage: evts[0] },
    ]);
    expect(logged.some((l) => JSON.parse(l).correlationId === cid)).toBe(true);
  });

  it('emits ReservationsCreated, SlotTakenRaces and ClassConflictsBlocked as EMF', async () => {
    lines.length = 0;
    const slot = ['2026-11-19T15:00:00Z', '2026-11-19T16:00:00Z'] as const;
    const a = await t.reserve('faculty1', 'LGRT-0111', ...slot);
    const b = await t.reserve('tutor1', 'LGRT-0111', ...slot);
    expect([a.status, b.status]).toEqual([201, 409]);
    await t.req('admin1', 'POST', '/demo/inject-class', {
      roomId: 'LGRT-0121',
      start: slot[0],
      end: slot[1],
    });
    const c = await t.reserve('faculty1', 'LGRT-0121', ...slot);
    expect(c.status).toBe(409);
    expect(metricNames()).toEqual(
      expect.arrayContaining(['ReservationsCreated', 'SlotTakenRaces', 'ClassConflictsBlocked']),
    );
    expect(JSON.parse(lines[0]!)._aws.CloudWatchMetrics[0]).toMatchObject({
      Namespace: 'FreeRoom',
      Dimensions: [['Stage']],
    });
  });
});

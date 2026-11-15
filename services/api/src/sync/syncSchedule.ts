/**
 * 25Live → DynamoDB sync (PRD §8.1). Diffs by sourceHash, writes CLASS items + class slot locks,
 * stamps lastSyncedAt per room/day, records a SyncRun, and resolves BR-9 (class wins) in one
 * transaction per conflicting reservation. Callable from the sync Lambda, scripts, demo routes,
 * and the on-demand refresh in POST /reservations.
 */
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  SLOT_MS,
  addDays,
  campusDay,
  campusDayStart,
  coveringSlots,
  enumerateSlots,
  findAlternatives,
  formatCampus,
  type ClassEvent,
} from '@freeroom/domain';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { getCatalog, upsertCatalog } from '../data/catalog';
import { mapLimit, queryAll, type Db } from '../data/db';
import { keys } from '../data/keys';
import {
  asInterval,
  getReservation,
  releaseForClassConflict,
  type ReservationRecord,
} from '../data/reservations';
import {
  deleteClass,
  getLocks,
  getRoomDay,
  lockClassSlots,
  putClass,
  setSyncMeta,
  unlockClassSlots,
} from '../data/schedule';
import { AppError } from '../errors';
import type { Logger } from '../logger';
import { roomIdFromSpaceName } from '../twentyfive/mapper';
import { mockSpaces, type RawReservation } from '../twentyfive/mock';
import type { ScheduleSource } from '../twentyfive/source';

export const SYNC_WINDOW_DAYS = 14;

export interface SyncDeps {
  db: Db;
  source: ScheduleSource;
  now: Date;
  log: Logger;
}

export interface SyncSummary {
  runId: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  counts: {
    roomDays: number;
    added: number;
    updated: number;
    removed: number;
    conflicts: number;
    errors: number;
  };
  durationMs: number;
}

export const sourceHash = (c: ClassEvent) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        c.name,
        c.courseCode ?? null,
        c.section ?? null,
        c.eventType ?? null,
        c.organization ?? null,
        c.start.toISOString(),
        c.end.toISOString(),
      ]),
    )
    .digest('hex');

export async function syncSchedule(
  deps: SyncDeps,
  opts: { roomIds?: string[]; from?: Date; to?: Date } = {},
): Promise<SyncSummary> {
  const { db, source, now, log } = deps;
  const startedMs = Date.now();
  const runId = randomUUID();
  const nowIso = now.toISOString();
  const today = campusDay(now);
  const from = opts.from ?? campusDayStart(today);
  const to = opts.to ?? campusDayStart(addDays(today, SYNC_WINDOW_DAYS));
  const counts = { roomDays: 0, added: 0, updated: 0, removed: 0, conflicts: 0, errors: 0 };
  const errors: string[] = [];

  const record = async (status: SyncSummary['status']) => {
    const summary: SyncSummary = { runId, status, counts, durationMs: Date.now() - startedMs };
    await db.doc.send(
      new PutCommand({
        TableName: db.table,
        Item: {
          ...keys.syncRun(source.name, nowIso),
          ...summary,
          source: source.name,
          startedAt: nowIso,
          scope: opts.roomIds ? 'rooms' : 'full',
          errors: errors.slice(0, 20),
        },
      }),
    );
    log.info('sync.finished', { ...summary, source: source.name });
    return summary;
  };

  let roomIds = opts.roomIds;
  let events: ClassEvent[];
  try {
    if (!roomIds) {
      const [buildings, rooms] = await Promise.all([source.listBuildings(), source.listRooms()]);
      await upsertCatalog(db, buildings, rooms);
      roomIds = rooms.map((r) => r.roomId);
    }
    events = await source.listEvents(roomIds, from, to);
  } catch (e) {
    errors.push((e as Error).message);
    await record('FAILED');
    throw e;
  }

  const days: string[] = [];
  for (let d = campusDay(from); campusDayStart(d) < to; d = addDays(d, 1)) days.push(d);
  const byRoomDay = new Map<string, ClassEvent[]>();
  for (const ev of events) {
    const k = `${ev.roomId}|${campusDay(ev.start)}`;
    byRoomDay.set(k, [...(byRoomDay.get(k) ?? []), ev]);
  }

  const conflicts = new Map<string, ClassEvent>(); // reservationId → colliding class
  const roomDays = roomIds.flatMap((roomId) => days.map((day) => [roomId, day] as const));
  await mapLimit(roomDays, 8, async ([roomId, day]) => {
    try {
      const desired = new Map(
        (byRoomDay.get(`${roomId}|${day}`) ?? []).map((ev) => [
          ev.eventId,
          { ev, hash: sourceHash(ev) },
        ]),
      );
      const { classes: cached } = await getRoomDay(db, roomId, day);
      const cachedById = new Map(cached.map((c) => [c.eventId, c]));

      for (const c of cached) {
        const want = desired.get(c.eventId);
        if (want?.hash === c.sourceHash) continue;
        await unlockClassSlots(db, roomId, coveringSlots(c), c.eventId);
        await deleteClass(db, day, c);
        if (!want) counts.removed++;
      }
      for (const { ev, hash } of desired.values()) {
        const prev = cachedById.get(ev.eventId);
        if (prev?.sourceHash === hash) continue;
        await putClass(db, day, { ...ev, sourceHash: hash }, runId);
        if (prev) counts.updated++;
        else counts.added++;
        for (const resId of await lockClassSlots(db, roomId, coveringSlots(ev), ev.eventId)) {
          conflicts.set(resId, ev);
        }
      }
      await setSyncMeta(db, roomId, day, nowIso);
      counts.roomDays++;
    } catch (e) {
      counts.errors++;
      errors.push(`${roomId}/${day}: ${(e as Error).message}`);
    }
  });

  // BR-9: 25Live wins.
  for (const [resId, cls] of conflicts) {
    try {
      const rec = await getReservation(db, resId);
      if (rec && (rec.status === 'PENDING_CONFIRMATION' || rec.status === 'CONFIRMED')) {
        const alternatives = await alternativesFor(db, rec, now);
        if (await releaseForClassConflict(db, rec, cls, alternatives, now)) {
          counts.conflicts++;
          log.info('sync.class_conflict', { reservationId: resId, eventId: cls.eventId });
        }
      }
      // Lock any class slots that were blocked only by this reservation.
      await lockClassSlots(db, cls.roomId, coveringSlots(cls), cls.eventId);
    } catch (e) {
      counts.errors++;
      errors.push(`conflict ${resId}: ${(e as Error).message}`);
    }
  }

  return record(counts.errors === 0 ? 'SUCCESS' : counts.roomDays > 0 ? 'PARTIAL' : 'FAILED');
}

/** Up to 3 free rooms for the same window (same building first, then nearest). */
export async function alternativesFor(db: Db, rec: ReservationRecord, now: Date) {
  const catalog = await getCatalog(db, now.getTime());
  const origin = catalog.rooms.find((r) => r.roomId === rec.roomId);
  if (!origin) return [];
  const window = asInterval(rec);
  const slots = enumerateSlots(window);
  const candidates = catalog.rooms.filter(
    (r) => r.roomId !== rec.roomId && r.capacity >= rec.partySize,
  );
  const locks = await getLocks(
    db,
    candidates.flatMap((r) => slots.map((s) => ({ roomId: r.roomId, slotIso: s.toISOString() }))),
  );
  const picked = findAlternatives(
    { ...origin, window, partySize: rec.partySize },
    candidates.map((r) => ({
      ...r,
      busy: slots
        .filter((s) => locks.has(`${r.roomId}|${s.toISOString()}`))
        .map((s) => ({ start: s, end: new Date(s.getTime() + SLOT_MS) })),
    })),
  );
  return picked.map((p) => {
    const room = catalog.rooms.find((r) => r.roomId === p.roomId)!;
    return {
      roomId: room.roomId,
      name: room.name,
      buildingId: room.buildingId,
      buildingName: room.buildingName,
      capacity: room.capacity,
      start: rec.start,
      end: rec.end,
    };
  });
}

// ---------- Demo: inject a class into the mock 25Live (persisted so every Lambda sees it) ----------

export async function loadInjected(db: Db): Promise<RawReservation[]> {
  const items = await queryAll(db, {
    KeyConditionExpression: 'PK = :p',
    ExpressionAttributeValues: { ':p': keys.injectedPk },
  });
  return items.map((i) => i.raw as RawReservation);
}

export async function injectClass(
  db: Db,
  input: { roomId: string; start: Date; end: Date; name: string },
): Promise<string> {
  const space = mockSpaces().find((s) => roomIdFromSpaceName(s.space_name) === input.roomId);
  if (!space) throw new AppError('NOT_FOUND', 'Unknown room');
  const raw: RawReservation = {
    reservation_id: randomInt(1, 2 ** 31 - 1),
    reservation_start_dt: formatCampus(input.start, "yyyy-MM-dd'T'HH:mm:ssxxx"),
    reservation_end_dt: formatCampus(input.end, "yyyy-MM-dd'T'HH:mm:ssxxx"),
    space_id: space.space_id,
    event: {
      event_id: randomInt(1, 2 ** 31 - 1),
      event_name: input.name,
      event_type_name: 'Class',
      organization_name: 'Registrar (demo)',
    },
  };
  const eventId = `EV-${raw.event.event_id}-${raw.reservation_id}`;
  await db.doc.send(
    new PutCommand({ TableName: db.table, Item: { ...keys.injectedClass(eventId), raw } }),
  );
  return eventId;
}

/** Newest successful FULL sync across sources (ScheduleStalenessMinutes; null = never synced). */
export async function lastSuccessfulSyncAt(db: Db): Promise<Date | null> {
  let best: string | null = null;
  for (const source of ['25live', 'mock']) {
    const r = await db.doc.send(
      new QueryCommand({
        TableName: db.table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :run)',
        FilterExpression: '#s = :ok AND #scope = :full',
        ExpressionAttributeNames: { '#s': 'status', '#scope': 'scope' },
        ExpressionAttributeValues: {
          ':pk': keys.syncRunPk(source),
          ':run': keys.prefix.run,
          ':ok': 'SUCCESS',
          ':full': 'full',
        },
        ScanIndexForward: false,
        Limit: 50, // ponytail: newest 50 runs (~8h at 10-min cadence); older = stale anyway
      }),
    );
    const at = r.Items?.[0]?.startedAt as string | undefined;
    if (at && (!best || at > best)) best = at;
  }
  return best ? new Date(best) : null;
}

/**
 * Claims (F5, BR-5, BR-6). Every state change is one transaction with conditions:
 * approve carries `cutoffAt > :now` (server clock) — no acceptance ever at/after cutoff.
 * Limits: 3 open claims per user (CLAIMQUOTA, optimistic version), 1 per reservation (OPENCLAIM lock).
 */
import { GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  DEFAULT_ROLE_LIMITS,
  can,
  canApproveClaim,
  canSubmitClaim,
  checkOpenClaims,
  checkQuota,
  type Actor,
  type RoleLimits,
} from '@freeroom/domain';
import type { ApproveMode, ClaimStatus, Role } from '@freeroom/shared';
import { randomUUID } from 'node:crypto';
import { AppError } from '../errors';
import { queryAll, ttlFrom, type Db, type Item } from './db';
import { keys } from './keys';
import {
  eventPut,
  getReservation,
  jitter,
  attendeeIdsOf,
  quotaRemove,
  reasonCodes,
  type ReservationRecord,
  type TxItem,
} from './reservations';
import { getUser } from './users';

export interface ClaimRecord {
  claimId: string;
  reservationId: string;
  requesterId: string;
  ownerId: string;
  message?: string;
  partySize: number;
  status: ClaimStatus;
  mode: ApproveMode | null;
  createdAt: string;
  expiresAt: string; // = reservation cutoffAt
  decidedAt: string | null;
}

const toClaim = (i: Item): ClaimRecord => ({
  claimId: i.claimId as string,
  reservationId: i.reservationId as string,
  requesterId: i.requesterId as string,
  ownerId: i.ownerId as string,
  ...(i.message ? { message: i.message as string } : {}),
  partySize: i.partySize as number,
  status: i.status as ClaimStatus,
  mode: (i.mode as ApproveMode | null | undefined) ?? null,
  createdAt: i.createdAt as string,
  expiresAt: i.expiresAt as string,
  decidedAt: (i.decidedAt as string | null | undefined) ?? null,
});

/** Claim ids embed their reservation id so /claims/:id needs a single GetItem. */
export const newClaimId = (resId: string) => `${resId}_${randomUUID()}`;
export const reservationIdOf = (claimId: string) => {
  const i = claimId.lastIndexOf('_');
  return i > 0 ? claimId.slice(0, i) : null;
};

const ACTIVE_RES = { ':p': 'PENDING_CONFIRMATION', ':c': 'CONFIRMED' };
const REVEAL_TTL_HOURS = 24;

export async function getClaim(db: Db, claimId: string): Promise<ClaimRecord | null> {
  const resId = reservationIdOf(claimId);
  if (!resId) return null;
  const r = await db.doc.send(
    new GetCommand({ TableName: db.table, Key: keys.claim(resId, claimId), ConsistentRead: true }),
  );
  return r.Item ? toClaim(r.Item) : null;
}

export async function listReservationClaims(db: Db, resId: string) {
  const items = await queryAll(db, {
    KeyConditionExpression: 'PK = :p AND begins_with(SK, :c)',
    ExpressionAttributeValues: { ':p': keys.resPk(resId), ':c': keys.prefix.claim },
    ConsistentRead: true,
  });
  return items.map(toClaim);
}

export async function listUserClaims(db: Db, userId: string, direction: 'incoming' | 'outgoing') {
  const [index, pk] =
    direction === 'outgoing'
      ? ['GSI2', keys.gsi2.userPk(userId)]
      : ['GSI3', keys.gsi3.incomingPk(userId)];
  const items = await queryAll(db, {
    IndexName: index,
    KeyConditionExpression: `${index}PK = :p AND begins_with(${index}SK, :c)`,
    ExpressionAttributeValues: { ':p': pk, ':c': keys.prefix.claim },
    ScanIndexForward: false,
  });
  return items.map(toClaim).slice(0, 100);
}

async function readClaimQuota(db: Db, userId: string, nowIso: string) {
  const r = await db.doc.send(
    new GetCommand({ TableName: db.table, Key: keys.claimQuota(userId), ConsistentRead: true }),
  );
  const open = Object.fromEntries(
    Object.entries((r.Item?.open as Record<string, string> | undefined) ?? {}).filter(
      ([, exp]) => exp > nowIso,
    ),
  );
  return { exists: !!r.Item, version: (r.Item?.version as number | undefined) ?? 0, open };
}

const claimQuotaRemove = (db: Db, userId: string, claimId: string): TxItem => ({
  Update: {
    TableName: db.table,
    Key: keys.claimQuota(userId),
    UpdateExpression: 'REMOVE #open.#id ADD version :one',
    ExpressionAttributeNames: { '#open': 'open', '#id': claimId },
    ExpressionAttributeValues: { ':one': 1 },
  },
});

/** Close a PENDING claim: status, unindex from sweeper, free the per-reservation + per-user slots. */
function closeClaim(
  db: Db,
  c: ClaimRecord,
  status: ClaimStatus,
  now: Date,
  extra: { mode?: ApproveMode; dueOnly?: boolean } = {},
): TxItem[] {
  return [
    {
      Update: {
        TableName: db.table,
        Key: keys.claim(c.reservationId, c.claimId),
        UpdateExpression: `SET #s = :st, decidedAt = :now${extra.mode ? ', #m = :mode' : ''} REMOVE GSI4PK, GSI4SK`,
        ConditionExpression: `#s = :pending${extra.dueOnly ? ' AND expiresAt <= :now' : ''}`,
        ExpressionAttributeNames: { '#s': 'status', ...(extra.mode && { '#m': 'mode' }) },
        ExpressionAttributeValues: {
          ':st': status,
          ':now': now.toISOString(),
          ':pending': 'PENDING',
          ...(extra.mode && { ':mode': extra.mode }),
        },
      },
    },
    { Delete: { TableName: db.table, Key: keys.openClaim(c.reservationId, c.requesterId) } },
    claimQuotaRemove(db, c.requesterId, c.claimId),
  ];
}

export async function submitClaim(db: Db, claim: ClaimRecord, res: ReservationRecord, now: Date) {
  const nowIso = now.toISOString();
  for (let attempt = 0; attempt < 6; attempt++) {
    const q = await readClaimQuota(db, claim.requesterId, nowIso);
    const limit = checkOpenClaims(Object.keys(q.open).length);
    if (!limit.ok) throw new AppError(limit.code, 'Too many open claims', limit.details);
    const items: TxItem[] = [
      {
        ConditionCheck: {
          TableName: db.table,
          Key: keys.reservation(res.id),
          ConditionExpression: '#s IN (:p, :c) AND cutoffAt > :now AND ownerId <> :me',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ...ACTIVE_RES, ':now': nowIso, ':me': claim.requesterId },
        },
      },
      {
        Put: {
          TableName: db.table,
          Item: {
            ...keys.claim(res.id, claim.claimId),
            ...claim,
            GSI2PK: keys.gsi2.userPk(claim.requesterId),
            GSI2SK: keys.gsi2.claimSk(claim.createdAt),
            GSI3PK: keys.gsi3.incomingPk(claim.ownerId),
            GSI3SK: keys.gsi3.claimSk(claim.createdAt),
            GSI4PK: keys.gsi4.sweepClaim,
            GSI4SK: keys.gsi4.sk(claim.expiresAt, claim.claimId),
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      {
        Put: {
          TableName: db.table,
          Item: { ...keys.openClaim(res.id, claim.requesterId), claimId: claim.claimId },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      {
        Put: {
          TableName: db.table,
          Item: {
            ...keys.claimQuota(claim.requesterId),
            open: { ...q.open, [claim.claimId]: claim.expiresAt },
            version: q.version + 1,
          },
          ConditionExpression: q.exists ? 'version = :v' : 'attribute_not_exists(PK)',
          ...(q.exists && { ExpressionAttributeValues: { ':v': q.version } }),
        },
      },
      eventPut(
        db,
        res.id,
        0,
        {
          type: 'CLAIM_REQUESTED',
          at: nowIso,
          actorId: claim.requesterId,
          data: { claimId: claim.claimId },
          notify: [res.ownerId],
        },
        now,
      ),
    ];
    try {
      await db.doc.send(new TransactWriteCommand({ TransactItems: items }));
      return;
    } catch (e) {
      const codes = reasonCodes(e);
      if (!codes.length) throw e;
      if (codes[0] === 'ConditionalCheckFailed') {
        const fresh = await getReservation(db, res.id);
        const v = fresh
          ? canSubmitClaim({ ...fresh, start: new Date(fresh.start) }, claim.requesterId, now)
          : null;
        throw new AppError(v && !v.ok ? v.code : 'NOT_CLAIMABLE', 'Reservation is not claimable');
      }
      if (codes[2] === 'ConditionalCheckFailed') {
        throw new AppError('CLAIM_EXISTS', 'You already have an open claim on this reservation');
      }
      if (codes[3] === 'ConditionalCheckFailed' || codes.includes('TransactionConflict')) {
        await jitter(attempt);
        continue;
      }
      throw e;
    }
  }
  throw new AppError('RATE_LIMITED', 'Busy; try again');
}

async function loadPair(db: Db, claimId: string) {
  const claim = await getClaim(db, claimId);
  if (!claim) throw new AppError('NOT_FOUND', 'Claim not found');
  const res = await getReservation(db, claim.reservationId);
  if (!res) throw new AppError('NOT_FOUND', 'Reservation not found');
  return { claim, res };
}

/**
 * Approve (owner or admin). SHARE_CONTACT writes a REVEAL item (TTL end+24h).
 * TRANSFER moves ownership (version check), writes TRANSFERRED, moves quota, and denies every
 * other pending claim — all in ONE transaction with `cutoffAt > :now`.
 */
export async function approveClaim(
  db: Db,
  input: {
    claimId: string;
    mode: ApproveMode;
    actor: Actor;
    now: Date;
    limits?: Readonly<Record<Role, RoleLimits>>;
  },
) {
  const { mode, actor, now } = input;
  const nowIso = now.toISOString();
  for (let attempt = 0; attempt < 6; attempt++) {
    const { claim, res } = await loadPair(db, input.claimId);
    // BR-5: approval shares the owner's contact or gives away their reservation, so only the
    // owner can approve — not even admins (they may deny). Requesters can never self-approve.
    if (actor.userId !== res.ownerId || actor.userId === claim.requesterId) {
      throw new AppError('FORBIDDEN', 'Only the reservation owner can approve claims');
    }
    const pre = canApproveClaim(claim, { ...res, start: new Date(res.start) }, now);
    if (!pre.ok) throw new AppError(pre.code, pre.code);

    const resCond = {
      ConditionExpression:
        '#s IN (:p, :c) AND cutoffAt > :now AND version = :v AND ownerId = :owner',
      ExpressionAttributeNames: { '#s': 'status' },
    };
    const resVals = { ...ACTIVE_RES, ':now': nowIso, ':v': res.version, ':owner': res.ownerId };
    let seq = 0;
    const items: TxItem[] = [...closeClaim(db, claim, 'APPROVED', now, { mode })];
    const RES_INDEX = 1;
    items.splice(RES_INDEX, 0, {
      ...(mode === 'TRANSFER'
        ? {
            Update: {
              TableName: db.table,
              Key: keys.reservation(res.id),
              UpdateExpression:
                'SET ownerId = :req, GSI2PK = :reqPk, #s = :conf, confirmedAt = :confAt, version = version + :one REMOVE GSI4PK, GSI4SK',
              ...resCond,
              ExpressionAttributeValues: {
                ...resVals,
                ':req': claim.requesterId,
                ':reqPk': keys.gsi2.userPk(claim.requesterId),
                ':conf': 'CONFIRMED',
                ':confAt': res.confirmedAt ?? nowIso,
                ':one': 1,
              },
            },
          }
        : {
            ConditionCheck: {
              TableName: db.table,
              Key: keys.reservation(res.id),
              ...resCond,
              ExpressionAttributeValues: resVals,
            },
          }),
    });
    items.push(
      eventPut(
        db,
        res.id,
        seq++,
        {
          type: 'CLAIM_APPROVED',
          at: nowIso,
          actorId: actor.userId,
          data: { claimId: claim.claimId, mode },
          notify: [claim.requesterId],
        },
        now,
      ),
    );

    let quotaIndex = -1;
    if (mode === 'SHARE_CONTACT') {
      const expiresAt = new Date(new Date(res.end).getTime() + REVEAL_TTL_HOURS * 3_600_000);
      items.push({
        Put: {
          TableName: db.table,
          Item: {
            ...keys.reveal(res.id, claim.requesterId),
            claimId: claim.claimId,
            reservationId: res.id,
            ownerId: res.ownerId,
            requesterId: claim.requesterId,
            expiresAt: expiresAt.toISOString(),
            ttl: ttlFrom(expiresAt, 0),
          },
        },
      });
    } else {
      const requester = await getUser(db, claim.requesterId);
      const rq = await db.doc.send(
        new GetCommand({
          TableName: db.table,
          Key: keys.quota(claim.requesterId),
          ConsistentRead: true,
        }),
      );
      const version = (rq.Item?.version as number | undefined) ?? 0;
      const active = Object.fromEntries(
        Object.entries((rq.Item?.active as Record<string, string> | undefined) ?? {}).filter(
          ([, end]) => end > nowIso,
        ),
      );
      const qv = checkQuota(
        requester?.role ?? 'STUDENT',
        Object.keys(active).length,
        input.limits ?? DEFAULT_ROLE_LIMITS,
      );
      if (!qv.ok)
        throw new AppError(qv.code, 'Requester is at their reservation limit', qv.details);
      items.push(
        eventPut(
          db,
          res.id,
          seq++,
          {
            type: 'TRANSFERRED',
            at: nowIso,
            actorId: actor.userId,
            data: { claimId: claim.claimId },
            notify: [res.ownerId, claim.requesterId, ...(await attendeeIdsOf(db, res.id))],
          },
          now,
        ),
        quotaRemove(db, res.ownerId, res.id),
      );
      quotaIndex = items.length;
      items.push({
        Put: {
          TableName: db.table,
          Item: {
            ...keys.quota(claim.requesterId),
            active: { ...active, [res.id]: res.end },
            version: version + 1,
          },
          ConditionExpression: rq.Item ? 'version = :v' : 'attribute_not_exists(PK)',
          ...(rq.Item && { ExpressionAttributeValues: { ':v': version } }),
        },
      });
      const others = (await listReservationClaims(db, res.id)).filter(
        (c) => c.status === 'PENDING' && c.claimId !== claim.claimId,
      );
      for (const o of others) {
        items.push(
          ...closeClaim(db, o, 'DENIED', now),
          eventPut(
            db,
            res.id,
            seq++,
            {
              type: 'CLAIM_DENIED',
              at: nowIso,
              actorId: actor.userId,
              reason: 'TRANSFERRED_TO_ANOTHER',
              data: { claimId: o.claimId },
              notify: [o.requesterId],
            },
            now,
          ),
        );
      }
    }

    try {
      await db.doc.send(new TransactWriteCommand({ TransactItems: items }));
      return loadPair(db, claim.claimId);
    } catch (e) {
      const codes = reasonCodes(e);
      if (!codes.length) throw e;
      if (codes[0] === 'ConditionalCheckFailed') {
        throw new AppError('INVALID_TRANSITION', 'Claim is no longer pending');
      }
      if (codes[RES_INDEX] === 'ConditionalCheckFailed') {
        const fresh = await getReservation(db, res.id);
        const v =
          fresh &&
          canApproveClaim(claim, { ...fresh, start: new Date(fresh.start) }, new Date(nowIso));
        if (v && !v.ok) throw new AppError(v.code, v.code);
        // version/owner changed underneath us: re-read and re-authorize
      }
      if (quotaIndex >= 0 && codes[quotaIndex] === 'ConditionalCheckFailed') {
        // requester quota raced: retry
      }
      await jitter(attempt);
    }
  }
  throw new AppError('INVALID_TRANSITION', 'Reservation changed; reload and retry');
}

/** Deny (owner/admin) or withdraw (requester). Allowed while PENDING. */
export async function closeByActor(
  db: Db,
  claimId: string,
  action: 'deny' | 'withdraw',
  actor: Actor,
  now: Date,
) {
  const { claim, res } = await loadPair(db, claimId);
  const allowed =
    action === 'deny'
      ? can(actor, 'claim:decide', { ownerId: res.ownerId })
      : can(actor, 'claim:withdraw', { requesterId: claim.requesterId });
  if (!allowed) throw new AppError('FORBIDDEN', 'Not allowed');
  const items = closeClaim(db, claim, action === 'deny' ? 'DENIED' : 'WITHDRAWN', now);
  if (action === 'deny') {
    items.push(
      eventPut(
        db,
        res.id,
        0,
        {
          type: 'CLAIM_DENIED',
          at: now.toISOString(),
          actorId: actor.userId,
          data: { claimId },
          notify: [claim.requesterId],
        },
        now,
      ),
    );
  }
  try {
    await db.doc.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (e) {
    if (reasonCodes(e)[0] === 'ConditionalCheckFailed') {
      throw new AppError('INVALID_TRANSITION', 'Claim is no longer pending');
    }
    throw e;
  }
  return loadPair(db, claimId);
}

/** Sweeper: PENDING claim at cutoff → EXPIRED (reservation stays with owner). Idempotent. */
export async function expireClaim(db: Db, claim: ClaimRecord, now: Date) {
  try {
    await db.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          ...closeClaim(db, claim, 'EXPIRED', now, { dueOnly: true }),
          eventPut(
            db,
            claim.reservationId,
            0,
            {
              type: 'CLAIM_EXPIRED',
              at: now.toISOString(),
              actorId: null,
              data: { claimId: claim.claimId },
              notify: [claim.requesterId],
            },
            now,
          ),
        ],
      }),
    );
    return true;
  } catch (e) {
    if (reasonCodes(e)[0] === 'ConditionalCheckFailed') return false;
    throw e;
  }
}

export async function listDueClaims(db: Db, now: Date) {
  const items = await queryAll(db, {
    IndexName: 'GSI4',
    KeyConditionExpression: 'GSI4PK = :p AND GSI4SK <= :u',
    ExpressionAttributeValues: {
      ':p': keys.gsi4.sweepClaim,
      ':u': keys.gsi4.dueBy(now.toISOString()),
    },
  });
  return items.map(toClaim);
}

export async function getReveal(db: Db, resId: string, requesterId: string) {
  const r = await db.doc.send(
    new GetCommand({
      TableName: db.table,
      Key: keys.reveal(resId, requesterId),
      ConsistentRead: true,
    }),
  );
  return r.Item as { claimId: string; ownerId: string; expiresAt: string } | undefined;
}

/** Every contact access is audited (append-only). */
export async function auditReveal(
  db: Db,
  resId: string,
  actorId: string,
  claimId: string,
  now: Date,
) {
  const id = randomUUID();
  await db.doc.send(
    new PutCommand({
      TableName: db.table,
      Item: {
        ...keys.audit(resId, now.toISOString(), id),
        type: 'CONTACT_REVEALED',
        actorId,
        claimId,
        at: now.toISOString(),
        ttl: ttlFrom(now, 365),
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );
}

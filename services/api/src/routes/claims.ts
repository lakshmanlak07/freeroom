import { canSubmitClaim, cutoffAt } from '@freeroom/domain';
import {
  ApproveClaimRequestSchema,
  CreateClaimRequestSchema,
  MyClaimsQuerySchema,
  type Claim,
  type ContactRevealResponse,
} from '@freeroom/shared';
import { Hono } from 'hono';
import type { Ctx, Env } from '../app';
import {
  approveClaim,
  auditReveal,
  closeByActor,
  getClaim,
  getReveal,
  listUserClaims,
  newClaimId,
  submitClaim,
  type ClaimRecord,
} from '../data/claims';
import { getReservation } from '../data/reservations';
import { getPrivate, getUser, getUsers } from '../data/users';
import { AppError, parse } from '../errors';
import { UNKNOWN_OWNER } from '../views';

async function views(ctx: Ctx, claims: ClaimRecord[]): Promise<Claim[]> {
  const users = await getUsers(
    ctx.db,
    claims.flatMap((c) => [c.requesterId, c.ownerId]),
  );
  const alias = (id: string) => users.get(id)?.displayAlias ?? UNKNOWN_OWNER.displayAlias;
  return claims.map((c) => ({
    claimId: c.claimId,
    reservationId: c.reservationId,
    status: c.status,
    mode: c.mode,
    ...(c.message ? { message: c.message } : {}),
    partySize: c.partySize,
    requesterAlias: alias(c.requesterId),
    ownerAlias: alias(c.ownerId),
    createdAt: c.createdAt,
    expiresAt: c.expiresAt,
  }));
}

/** Claim lifecycle (main surface — no kms:Decrypt needed). */
export function claimRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  r.post('/reservations/:id/claims', async (c) => {
    const user = c.get('user');
    const body = parse(CreateClaimRequestSchema, await c.req.json().catch(() => null));
    const res = await getReservation(ctx.db, c.req.param('id'));
    if (!res) throw new AppError('NOT_FOUND', 'Reservation not found');
    const now = ctx.now();
    const pre = canSubmitClaim({ ...res, start: new Date(res.start) }, user.userId, now);
    if (!pre.ok) throw new AppError(pre.code, pre.code);
    const claim: ClaimRecord = {
      claimId: newClaimId(res.id),
      reservationId: res.id,
      requesterId: user.userId,
      ownerId: res.ownerId,
      ...(body.message ? { message: body.message } : {}),
      partySize: body.partySize,
      status: 'PENDING',
      mode: null,
      createdAt: now.toISOString(),
      expiresAt: cutoffAt(new Date(res.start)).toISOString(),
      decidedAt: null,
    };
    await submitClaim(ctx.db, claim, res, now);
    return c.json((await views(ctx, [claim]))[0], 201);
  });

  r.get('/me/claims', async (c) => {
    const { direction } = parse(MyClaimsQuerySchema, c.req.query());
    return c.json({
      claims: await views(ctx, await listUserClaims(ctx.db, c.get('user').userId, direction)),
    });
  });

  r.post('/claims/:id/approve', async (c) => {
    const { mode } = parse(ApproveClaimRequestSchema, await c.req.json().catch(() => null));
    const { claim } = await approveClaim(ctx.db, {
      claimId: c.req.param('id'),
      mode,
      actor: c.get('user'),
      now: ctx.now(),
      limits: ctx.limits,
    });
    return c.json((await views(ctx, [claim]))[0]);
  });

  for (const action of ['deny', 'withdraw'] as const) {
    r.post(`/claims/:id/${action}`, async (c) => {
      const { claim } = await closeByActor(
        ctx.db,
        c.req.param('id'),
        action,
        c.get('user'),
        ctx.now(),
      );
      return c.json((await views(ctx, [claim]))[0]);
    });
  }
  return r;
}

/**
 * BR-5 contact reveal (privileged surface: own Lambda + kms:Decrypt). Only the approved
 * requester, only for that reservation, only until end + 24h. Every access is audited.
 */
export function contactRevealRoutes(ctx: Ctx) {
  const r = new Hono<Env>();
  r.get('/claims/:id/contact', async (c) => {
    const user = c.get('user');
    const claim = await getClaim(ctx.db, c.req.param('id'));
    if (!claim) throw new AppError('NOT_FOUND', 'Claim not found');
    if (claim.requesterId !== user.userId) throw new AppError('FORBIDDEN', 'Not your claim');
    if (claim.status !== 'APPROVED' || claim.mode !== 'SHARE_CONTACT') {
      throw new AppError('FORBIDDEN', 'Contact is shared only after an approved request');
    }
    const now = ctx.now();
    const reveal = await getReveal(ctx.db, claim.reservationId, user.userId);
    if (!reveal || reveal.claimId !== claim.claimId || reveal.expiresAt <= now.toISOString()) {
      throw new AppError('FORBIDDEN', 'Contact access has expired');
    }
    const owner = await getUser(ctx.db, reveal.ownerId);
    const enc = await getPrivate(ctx.db, reveal.ownerId);
    if (!owner || !enc || !ctx.contacts) throw new AppError('NOT_FOUND', 'Contact unavailable');
    const contact = await ctx.contacts.decrypt(reveal.ownerId, enc);
    // Only the channel the owner chose to share — never fall back to the other one.
    const channel = owner.shareChannel ?? 'email';
    const value = contact[channel];
    if (!value) throw new AppError('NOT_FOUND', 'Contact unavailable');
    await auditReveal(ctx.db, claim.reservationId, user.userId, claim.claimId, now);
    c.get('log').info('contact.revealed', { claimId: claim.claimId }); // value never logged
    const out: ContactRevealResponse = { channel, value, expiresAt: reveal.expiresAt };
    return c.json(out);
  });
  return r;
}

import {
  AdminSetRoleRequestSchema,
  RegisterRequestSchema,
  UpdateMeRequestSchema,
  type MeResponse,
  type RegisterResponse,
} from '@freeroom/shared';
import { can } from '@freeroom/domain';
import { Hono } from 'hono';
import type { Ctx, Env } from '../app';
import { hashUniversityId } from '../auth';
import type { Contact } from '../contact';
import {
  getPrivate,
  getUser,
  putPrivate,
  registerUser,
  setRole,
  updateProfile,
  type UserProfile,
} from '../data/users';
import { AppError, parse } from '../errors';

const need = <T>(v: T | undefined, what: string): T => {
  if (!v) throw new AppError('INTERNAL', `${what} not configured`);
  return v;
};

function checkChannel(channel: string, contact: Contact) {
  if (!contact[channel as keyof Contact]) {
    throw new AppError('VALIDATION_ERROR', `shareChannel "${channel}" requires that contact field`);
  }
}

/** POST /register (main surface: needs kms:GenerateDataKey, never kms:Decrypt). */
export function registerRoutes(ctx: Ctx) {
  const r = new Hono<Env>();
  r.post('/register', async (c) => {
    if (c.get('user')) throw new AppError('INVALID_TRANSITION', 'Already registered');
    const sub = c.get('sub');
    const body = parse(RegisterRequestSchema, await c.req.json().catch(() => null));
    checkChannel(body.shareChannel, body.contact);
    const uidHash = hashUniversityId(await need(ctx.uidPepper, 'UID pepper')(), body.universityId);
    const contactEnc = await need(ctx.contacts, 'Contact service').encrypt(sub, body.contact);
    const result = await registerUser(ctx.db, {
      userId: sub,
      displayAlias: body.displayAlias,
      shareChannel: body.shareChannel,
      uidHash,
      contactEnc,
      now: ctx.now(),
    });
    if (result === 'uid_taken') {
      throw new AppError('UID_ALREADY_REGISTERED', 'This University ID is already registered');
    }
    if (result === 'already_registered')
      throw new AppError('INVALID_TRANSITION', 'Already registered');
    const out: RegisterResponse = {
      userId: sub,
      role: 'STUDENT',
      displayAlias: body.displayAlias,
      shareChannel: body.shareChannel,
    };
    return c.json(out, 201);
  });

  /** Option 2 (PRD §7): roles are assigned by admins only; ADMIN is never assignable via API. */
  r.post('/admin/users/:userId/role', async (c) => {
    if (!can(c.get('user'), 'admin:suspend')) throw new AppError('FORBIDDEN', 'Admin only');
    const { role } = parse(AdminSetRoleRequestSchema, await c.req.json().catch(() => null));
    const target = await getUser(ctx.db, c.req.param('userId'));
    if (!target) throw new AppError('NOT_FOUND', 'User not found');
    if (target.role === 'ADMIN')
      throw new AppError('FORBIDDEN', 'Admin roles are managed out of band');
    await setRole(ctx.db, target.userId, role);
    return c.json({ userId: target.userId, role });
  });
  return r;
}

/**
 * Privileged surface (own Lambda + IAM role with kms:Decrypt): GET/PATCH /me.
 * Responses here intentionally contain the caller's own contact info.
 */
export function meRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  const me = async (user: UserProfile): Promise<MeResponse> => {
    const enc = await getPrivate(ctx.db, user.userId);
    const contact = enc
      ? await need(ctx.contacts, 'Contact service').decrypt(user.userId, enc)
      : {};
    return {
      userId: user.userId,
      role: user.role,
      displayAlias: user.displayAlias,
      contact,
      shareChannel: user.shareChannel ?? 'email',
    };
  };

  r.get('/me', async (c) => {
    const user = c.get('user') as UserProfile | undefined;
    if (!user) throw new AppError('NOT_FOUND', 'Not registered');
    return c.json(await me(user));
  });

  r.patch('/me', async (c) => {
    const user = c.get('user');
    const patch = parse(UpdateMeRequestSchema, await c.req.json().catch(() => null));
    const current = await me(user);
    const contact = patch.contact ?? current.contact;
    checkChannel(patch.shareChannel ?? current.shareChannel, contact);
    if (patch.contact) {
      await putPrivate(
        ctx.db,
        user.userId,
        await need(ctx.contacts, 'Contact service').encrypt(user.userId, patch.contact),
      );
    }
    await updateProfile(ctx.db, user.userId, {
      displayAlias: patch.displayAlias,
      shareChannel: patch.shareChannel,
    });
    return c.json(await me((await getUser(ctx.db, user.userId))!));
  });
  return r;
}

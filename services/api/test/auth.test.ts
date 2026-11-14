import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { generateKeyPairSync, sign } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { cognitoVerifier, hashUniversityId } from '../src/auth';
import { addClaims } from '../src/preToken';
import { setupTestApp, silent } from './helpers';

// ---------- Real aws-jwt-verify against a locally generated JWKS ----------
const POOL = 'us-east-1_TESTPOOL';
const CLIENT = 'testclient123';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({
    sub: 'abc-123',
    iss: `https://cognito-idp.us-east-1.amazonaws.com/${POOL}`,
    aud: CLIENT,
    token_use: 'id',
    iat: now,
    auth_time: now,
    exp: now + 3600,
    ...claims,
  });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

describe('Cognito ID token verification (aws-jwt-verify)', () => {
  const verify = cognitoVerifier({ userPoolId: POOL, clientId: CLIENT }, { keys: [jwk as never] });
  it('accepts a valid ID token and returns only sub', async () => {
    expect(await verify(token({}))).toEqual({ sub: 'abc-123' });
  });
  it('rejects wrong audience, access tokens, expired and tampered tokens', async () => {
    await expect(verify(token({ aud: 'other' }))).rejects.toThrow();
    await expect(verify(token({ token_use: 'access' }))).rejects.toThrow();
    await expect(verify(token({ exp: 1 }))).rejects.toThrow();
    const t = token({});
    await expect(verify(t.slice(0, -4) + 'AAAA')).rejects.toThrow();
  });
});

// ---------- Registration, /me, roles, pre-token, surfaces (DynamoDB Local) ----------
const NOW = new Date('2026-11-16T12:00:00Z');
type T = Awaited<ReturnType<typeof setupTestApp>>;
let t: T;
beforeAll(async () => {
  t = await setupTestApp({ now: NOW });
});

const REG = {
  universityId: '33012345',
  displayAlias: 'New Owl',
  contact: { email: 'newbie@umass.edu' },
  shareChannel: 'email',
};
const asBearer = (user: string, method: string, path: string, body?: unknown, allowPII = false) =>
  t.req(user, method, path, body, {}, { bearer: true, allowPII });

describe('auth middleware', () => {
  it('401 without/with a bad token; 403 for unregistered users outside /register', async () => {
    expect((await t.app.request('/rooms')).status).toBe(401);
    expect(
      (await t.app.request('/rooms', { headers: { authorization: 'Bearer nope' } })).status,
    ).toBe(401);
    expect((await asBearer('ghost', 'GET', '/rooms')).body.error.code).toBe('FORBIDDEN');
    expect((await asBearer('ghost', 'GET', '/me')).status).toBe(404);
  });
});

describe('POST /register', () => {
  it('registers as STUDENT, returns no contact/universityId, rejects a client role', async () => {
    expect(
      (await asBearer('newbie', 'POST', '/register', { ...REG, role: 'FACULTY' })).status,
    ).toBe(400);
    const r = await asBearer('newbie', 'POST', '/register', REG);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({
      userId: 'newbie',
      role: 'STUDENT',
      displayAlias: 'New Owl',
      shareChannel: 'email',
    });
    expect(JSON.stringify(r.body)).not.toContain('33012345');
  });

  it('one account per University ID (HMAC, normalized) → 409 UID_ALREADY_REGISTERED', async () => {
    const dup = await asBearer('other', 'POST', '/register', { ...REG, universityId: '33012345' });
    expect([dup.status, dup.body.error.code]).toEqual([409, 'UID_ALREADY_REGISTERED']);
    expect((await asBearer('newbie', 'POST', '/register', REG)).status).toBe(409);
  });

  it('requires the share channel to exist in contact', async () => {
    const r = await asBearer('nochan', 'POST', '/register', {
      ...REG,
      universityId: '99999',
      shareChannel: 'phone',
    });
    expect(r.status).toBe(400);
  });

  it('stores only the HMAC and ciphertext at rest (table scan)', async () => {
    const items = (await t.db.doc.send(new ScanCommand({ TableName: t.db.table }))).Items ?? [];
    const dump = JSON.stringify(items);
    expect(dump).not.toContain('33012345');
    expect(dump).not.toContain('newbie@umass.edu');
    expect(dump).toContain(hashUniversityId('test-pepper', '33012345'));
  });
});

describe('/me (privileged) and roles', () => {
  it('GET /me decrypts own contact; PATCH /me re-encrypts', async () => {
    const me = await asBearer('newbie', 'GET', '/me', undefined, true);
    expect(me.body).toMatchObject({ role: 'STUDENT', contact: { email: 'newbie@umass.edu' } });
    const p = await asBearer(
      'newbie',
      'PATCH',
      '/me',
      {
        displayAlias: 'Owl 2',
        contact: { email: 'n2@umass.edu', phone: '+1 413 555 0101' },
        shareChannel: 'phone',
      },
      true,
    );
    expect(p.body).toMatchObject({
      displayAlias: 'Owl 2',
      shareChannel: 'phone',
      contact: { phone: '+1 413 555 0101' },
    });
    expect(
      (await asBearer('newbie', 'PATCH', '/me', { contact: { email: 'x@umass.edu' } }, true))
        .status,
    ).toBe(400);
  });

  it('only admins assign roles; ADMIN is never assignable', async () => {
    expect(
      (await t.req('student1', 'POST', '/admin/users/newbie/role', { role: 'FACULTY' })).status,
    ).toBe(403);
    expect(
      (await t.req('admin1', 'POST', '/admin/users/newbie/role', { role: 'ADMIN' })).status,
    ).toBe(400);
    expect(
      (await t.req('admin1', 'POST', '/admin/users/newbie/role', { role: 'FACULTY' })).status,
    ).toBe(200);
    expect((await asBearer('newbie', 'GET', '/me', undefined, true)).body.role).toBe('FACULTY');
  });

  it('pre-token Lambda adds role + registered claims, never PII', async () => {
    const reg = await addClaims(t.db, {
      request: { userAttributes: { sub: 'newbie', email: 'n2@umass.edu' } },
      response: {},
    });
    expect(reg.response.claimsOverrideDetails).toEqual({
      claimsToAddOrOverride: { registered: 'true', role: 'FACULTY' },
    });
    const anon = await addClaims(t.db, {
      request: { userAttributes: { sub: 'ghost' } },
      response: {},
    });
    expect(anon.response.claimsOverrideDetails).toEqual({
      claimsToAddOrOverride: { registered: 'false' },
    });
  });

  it('main surface has no /me; privileged surface serves only /me + contact', async () => {
    const base = {
      db: t.db,
      source: t.source,
      logger: silent,
      contacts: t.contacts,
      devAuth: true,
    };
    const main = createApp({ ...base, surface: 'main' });
    const priv = createApp({ ...base, surface: 'privileged' });
    const h = { headers: { 'x-dev-user': 'student1' } };
    expect((await main.request('/me', h)).status).toBe(404);
    expect((await priv.request('/me', h)).status).toBe(200);
    expect((await priv.request('/rooms', h)).status).toBe(404);
    expect((await main.request('/rooms', h)).status).toBe(200);
  });
});

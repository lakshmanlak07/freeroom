/**
 * After `cdk deploy`: run the first 25Live sync, then create the test users (demo users in demo
 * mode + two smoke-test students in every stage) with encrypted fake contact, then seed the demo.
 * Generated passwords go to the stack's test-users secret (read by CI and the Playwright smoke)
 * and a gitignored local copy, infra/.demo-users.<stage>.local.json. They are never printed.
 * Usage: tsx scripts/postDeploy.ts --stage dev
 */
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { AwsKmsKeyProvider, ContactService } from '../../services/api/src/contact';
import { makeDb } from '../../services/api/src/data/db';
import {
  DEMO_USERS,
  putPrivate,
  putUser,
  type UserProfile,
} from '../../services/api/src/data/users';
import { type DemoIds, seedDemoOnce } from '../../services/api/src/demoSeed';

const i = process.argv.indexOf('--stage');
const stage = i >= 0 ? process.argv[i + 1] : undefined;
if (stage !== 'dev' && stage !== 'prod') throw new Error('Usage: postDeploy.ts --stage dev|prod');
const o = JSON.parse(readFileSync(`cdk-outputs.${stage}.json`, 'utf8'))[
  `FreeRoom-${stage}`
] as Record<string, string>;
const region = o.Region ?? 'us-east-2';

// 1. First sync (catalog + 14 days of classes + class slot locks).
const lambda = new LambdaClient({ region });
const r = await lambda.send(
  new InvokeCommand({ FunctionName: o.SyncFnName, InvocationType: 'RequestResponse' }),
);
const payload = JSON.parse(new TextDecoder().decode(r.Payload ?? new Uint8Array()) || '{}');
if (r.FunctionError) throw new Error(`First sync failed: ${JSON.stringify(payload)}`);
console.log(
  `First sync: ${payload.status} ${JSON.stringify(payload.counts)} in ${payload.durationMs} ms`,
);

// 2. Test users. Smoke users exist in every stage so the Playwright smoke can run against prod.
const SMOKE_USERS: UserProfile[] = [
  {
    userId: 'smoke1',
    role: 'STUDENT',
    displayAlias: 'Smoke Test A',
    status: 'ACTIVE',
    shareChannel: 'email',
  },
  {
    userId: 'smoke2',
    role: 'STUDENT',
    displayAlias: 'Smoke Test B',
    status: 'ACTIVE',
    shareChannel: 'email',
  },
];
type Creds = Record<string, { email: string; password: string }>;
const demo = o.DemoMode === 'true';
const cognito = new CognitoIdentityProviderClient({ region });
const secrets = new SecretsManagerClient({ region });
const db = makeDb({ table: o.TableName!, region });
const contacts = new ContactService(new AwsKmsKeyProvider(o.PiiKeyArn!));
const credsFile = `.demo-users.${stage}.local.json`;
const stored = JSON.parse(
  (await secrets.send(new GetSecretValueCommand({ SecretId: o.TestUsersSecretArn })))
    .SecretString ?? '{}',
) as Creds;
// One-time migration: keep passwords that predate the secret (secret wins after that).
const creds: Creds = {
  ...(existsSync(credsFile) ? (JSON.parse(readFileSync(credsFile, 'utf8')) as Creds) : {}),
  ...stored,
};
// Satisfies the pool policy: upper, lower, digit, symbol, ≥ 12 chars.
const newPassword = () => `Fr-${randomBytes(12).toString('base64url')}9a!`;

const users = [...(demo ? DEMO_USERS : []), ...SMOKE_USERS];
const subs: Record<string, string> = {};
for (const u of users) {
  const email = `${u.userId}@demo.freeroom.test`; // reserved TLD: undeliverable by design
  let attrs: { Name?: string; Value?: string }[] | undefined;
  try {
    attrs = (
      await cognito.send(new AdminGetUserCommand({ UserPoolId: o.UserPoolId, Username: email }))
    ).UserAttributes;
  } catch (e) {
    if (!(e instanceof UserNotFoundException)) throw e;
    attrs = (
      await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: o.UserPoolId,
          Username: email,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
          ],
        }),
      )
    ).User?.Attributes;
    delete creds[u.userId]; // brand-new Cognito user: always set a fresh password
  }
  const sub = attrs?.find((a) => a.Name === 'sub')?.Value;
  if (!sub) throw new Error(`No sub for ${u.userId}`);
  if (!creds[u.userId]) {
    creds[u.userId] = { email, password: newPassword() };
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: o.UserPoolId,
        Username: email,
        Password: creds[u.userId]!.password,
        Permanent: true,
      }),
    );
  }
  subs[u.userId] = sub;
  await putUser(db, { ...u, userId: sub });
  await putPrivate(db, sub, await contacts.encrypt(sub, { email, phone: '+1 413 555 0100' }));
}
await secrets.send(
  new PutSecretValueCommand({
    SecretId: o.TestUsersSecretArn,
    SecretString: JSON.stringify(creds),
  }),
);
writeFileSync(credsFile, JSON.stringify(creds, null, 2), { mode: 0o600 });
console.log(`Test users ready: ${users.map((u) => u.userId).join(', ')} (logins in the secret)`);

// 3. Demo data (demo mode only; first run only — later re-seeds are Demo → Reset).
if (demo) {
  const seeded = await seedDemoOnce(db, subs as DemoIds, new Date());
  console.log(seeded ? `Demo data seeded: ${JSON.stringify(seeded)}` : 'Demo data already seeded');
}

console.log(`\nWeb: ${o.WebUrl}\nAPI: ${o.WebUrl}/api`);

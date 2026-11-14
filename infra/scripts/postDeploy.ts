/**
 * After `cdk deploy`: run the first 25Live sync, then (demo mode only) create Cognito demo users
 * and their FreeRoom profiles with encrypted fake contact. Generated passwords are written to a
 * gitignored infra/.demo-users.<stage>.local.json (never printed).
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
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { AwsKmsKeyProvider, ContactService } from '../../services/api/src/contact';
import { makeDb } from '../../services/api/src/data/db';
import { DEMO_USERS, putPrivate, putUser } from '../../services/api/src/data/users';

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

// 2. Demo users (demo mode only — never in a prod deploy without -c demoMode=true).
if (o.DemoMode === 'true') {
  const cognito = new CognitoIdentityProviderClient({ region });
  const db = makeDb({ table: o.TableName!, region });
  const contacts = new ContactService(new AwsKmsKeyProvider(o.PiiKeyArn!));
  const credsFile = `.demo-users.${stage}.local.json`;
  const creds: Record<string, { email: string; password: string }> = existsSync(credsFile)
    ? JSON.parse(readFileSync(credsFile, 'utf8'))
    : {};
  // Satisfies the pool policy: upper, lower, digit, symbol, ≥ 12 chars.
  const newPassword = () => `Fr-${randomBytes(12).toString('base64url')}9a!`;

  for (const u of DEMO_USERS) {
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
    await putUser(db, { ...u, userId: sub });
    await putPrivate(db, sub, await contacts.encrypt(sub, { email, phone: '+1 413 555 0100' }));
  }
  writeFileSync(credsFile, JSON.stringify(creds, null, 2), { mode: 0o600 });
  console.log(
    `Demo users ready (${DEMO_USERS.map((u) => u.userId).join(', ')}); credentials in infra/${credsFile}`,
  );
}

console.log(`\nWeb: ${o.WebUrl}\nAPI: ${o.ApiUrl}`);

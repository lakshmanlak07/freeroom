/** Production wiring from environment (set by CDK in P4). */
import type { AppDeps, Surface } from './app';
import { cognitoVerifier, secretsManagerPepper } from './auth';
import { AwsKmsKeyProvider, ContactService } from './contact';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { makeDb } from './data/db';
import { loadInjected } from './sync/syncSchedule';
import { createScheduleSource } from './twentyfive/source';

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
};

export async function lambdaDeps(surface: Surface): Promise<AppDeps> {
  const db = makeDb({ table: env('TABLE_NAME') });
  const demo = process.env.DEMO_MODE === 'true';
  return {
    db,
    surface,
    source: await createScheduleSource({
      secretArn: process.env.TWENTYFIVE_LIVE_SECRET_ARN,
      loadInjected: () => loadInjected(db),
    }),
    verifyIdToken: cognitoVerifier({
      userPoolId: env('COGNITO_USER_POOL_ID'),
      clientId: env('COGNITO_CLIENT_ID'),
    }),
    uidPepper: secretsManagerPepper(env('UID_PEPPER_SECRET_ARN')),
    ...(process.env.ORIGIN_VERIFY_SECRET_ARN && {
      originSecret: secretsManagerPepper(process.env.ORIGIN_VERIFY_SECRET_ARN),
    }),
    // IAM decides what this can do: main role → GenerateDataKey only; privileged role → Decrypt.
    contacts: new ContactService(new AwsKmsKeyProvider(env('CONTACT_KMS_KEY_ID'))),
    ...(process.env.NL_MODEL_ID && {
      nlBedrock: { client: new BedrockRuntimeClient({}), modelId: process.env.NL_MODEL_ID },
    }),
    devAuth: process.env.NODE_ENV === 'development',
    mock25live: demo,
    demo,
  };
}

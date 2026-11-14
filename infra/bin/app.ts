import { App } from 'aws-cdk-lib';
import { FreeRoomStack } from '../lib/freeroom-stack';

const app = new App();
const ctx = (k: string) => app.node.tryGetContext(k) as string | undefined;
const stage = ctx('stage');
if (stage !== 'dev' && stage !== 'prod') throw new Error(`stage must be dev|prod, got ${stage}`);

new FreeRoomStack(app, `FreeRoom-${stage}`, {
  stage,
  // Demo Controls + seeded demo users: on in dev, off in prod unless explicitly overridden.
  demoMode: (ctx('demoMode') ?? (stage === 'dev' ? 'true' : 'false')) === 'true',
  samlMetadataUrl: ctx('samlMetadataUrl'),
  alarmEmail: ctx('alarmEmail'),
  // us-east-2: the hackathon AWS free-plan project is SCP-locked to Ohio (us-east-1 calls are
  // denied). Override with -c region=… for an unrestricted account.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: ctx('region') ?? 'us-east-2' },
});

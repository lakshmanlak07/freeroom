import { App } from 'aws-cdk-lib';
import { FreeRoomStack } from '../lib/freeroom-stack';

const app = new App();
const stage = app.node.tryGetContext('stage');
if (stage !== 'dev' && stage !== 'prod') throw new Error(`stage must be dev|prod, got ${stage}`);

new FreeRoomStack(app, `FreeRoom-${stage}`, {
  stage,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
});

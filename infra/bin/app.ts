import { App, DefaultStackSynthesizer, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { bootstrapQualifier } from '../lib/fn';
import { FreeRoomStack } from '../lib/freeroom-stack';
import { suppressNag } from '../lib/nag';

const app = new App();
const ctx = (k: string) => app.node.tryGetContext(k) as string | undefined;
const stage = ctx('stage');
if (stage !== 'dev' && stage !== 'prod') throw new Error(`stage must be dev|prod, got ${stage}`);

const stack = new FreeRoomStack(app, `FreeRoom-${stage}`, {
  stage,
  // Demo Controls + seeded demo users: on in dev, off in prod (the stack refuses prod + demo).
  demoMode: (ctx('demoMode') ?? (stage === 'dev' ? 'true' : 'false')) === 'true',
  samlMetadataUrl: ctx('samlMetadataUrl'),
  alarmEmail: ctx('alarmEmail'),
  waf: ctx('waf') === undefined ? undefined : ctx('waf') === 'true',
  wafRateLimit: ctx('wafRateLimit') ? Number(ctx('wafRateLimit')) : undefined,
  githubRepo: ctx('githubRepo') ?? 'lakshmanlak07/freeroom',
  githubOidc: ctx('githubOidc') === 'true',
  // Natural-language search via Bedrock (cdk.json default on); the parser works without it.
  demoUrl: ctx('demoUrl'),
  nlModelId: ctx('nlBedrock') === 'false' ? undefined : (ctx('nlModelId') ?? undefined),
  // Prod: its own bootstrap (cdk bootstrap --qualifier frprod --toolkit-stack-name CDKToolkit-frprod).
  synthesizer: new DefaultStackSynthesizer({ qualifier: bootstrapQualifier(stage) }),
  // us-east-2: the hackathon AWS free-plan project is SCP-locked to Ohio (us-east-1 calls are
  // denied). Override with -c region=… for an unrestricted account.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: ctx('region') ?? 'us-east-2' },
});

// cdk-nag AwsSolutions on every synth (CI included): unjustified findings fail the synth.
Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
suppressNag(stack);

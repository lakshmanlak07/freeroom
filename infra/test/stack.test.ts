/** Security/operability invariants of the synthesized template (bundling skipped for speed). */
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { FreeRoomStack } from '../lib/freeroom-stack';

const synth = (stage: 'dev' | 'prod') => {
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new FreeRoomStack(app, `FreeRoom-${stage}`, {
    stage,
    demoMode: stage === 'dev',
    githubRepo: 'lakshmanlak07/freeroom',
    githubOidc: true,
    nlModelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    env: { account: '111111111111', region: 'us-east-1' },
  });
  return Template.fromStack(stack);
};
const dev = synth('dev');
const prod = synth('prod');

type Statement = { Action: string | string[]; Effect: string; Condition?: unknown };
const policies = (t: Template) =>
  Object.values(t.findResources('AWS::IAM::Policy')) as {
    Properties: { PolicyDocument: { Statement: Statement[] }; Roles: { Ref: string }[] };
  }[];
const actions = (s: Statement) => [s.Action].flat();

describe('Data', () => {
  it('table: on-demand, streams, TTL, PITR, 4 GSIs; deletion protection only in prod', () => {
    dev.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      StreamSpecification: { StreamViewType: 'NEW_AND_OLD_IMAGES' },
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'GSI4' })]),
      DeletionProtectionEnabled: false,
    });
    prod.hasResourceProperties('AWS::DynamoDB::Table', { DeletionProtectionEnabled: true });
  });

  it('PII CMK rotates; pepper is generated; 25Live secret is an empty placeholder', () => {
    dev.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
    dev.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'freeroom/dev/uid-pepper',
      GenerateSecretString: Match.objectLike({ PasswordLength: 64 }),
    });
    dev.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'freeroom/dev/25live',
      SecretString: '{}',
    });
  });
});

describe('IAM', () => {
  it('RevealFn is the ONLY function role with kms:Decrypt', () => {
    const decrypters = policies(dev).filter((p) =>
      p.Properties.PolicyDocument.Statement.some((s) => actions(s).includes('kms:Decrypt')),
    );
    expect(decrypters).toHaveLength(1);
    expect(decrypters[0]!.Properties.Roles[0]!.Ref).toMatch(/^ApiRevealFnServiceRole/);
  });

  it('every DynamoDB data-plane grant is scoped with dynamodb:LeadingKeys', () => {
    for (const p of policies(dev)) {
      for (const s of p.Properties.PolicyDocument.Statement) {
        // Item-level actions only (stream reads like GetRecords are granted separately by the event source).
        const data = actions(s).filter((a) =>
          /^dynamodb:(GetItem|PutItem|UpdateItem|DeleteItem|Query|BatchGetItem|BatchWriteItem|Scan|ConditionCheckItem)$/.test(
            a,
          ),
        );
        if (data.length) expect(JSON.stringify(s.Condition)).toContain('dynamodb:LeadingKeys');
      }
    }
  });

  it('only ApiFn may call Bedrock; Scan (demo reset) only in demo mode', () => {
    const bedrock = policies(dev).filter((p) =>
      p.Properties.PolicyDocument.Statement.some((s) => actions(s).includes('bedrock:InvokeModel')),
    );
    expect(bedrock.map((p) => p.Properties.Roles[0]!.Ref)).toEqual([
      expect.stringMatching(/^ApiApiFnServiceRole/),
    ]);
    // Exactly the one inference profile + the foundation model in each region it routes to.
    const res = bedrock[0]!.Properties.PolicyDocument.Statement.filter((s) =>
      actions(s).includes('bedrock:InvokeModel'),
    ).flatMap((s) => [(s as { Resource?: unknown }).Resource].flat());
    expect(JSON.stringify(res)).not.toContain('*');
    expect(res).toHaveLength(4);
    expect(JSON.stringify(res)).toContain(
      'inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0',
    );
    for (const r of ['us-east-1', 'us-east-2', 'us-west-2'])
      expect(JSON.stringify(res)).toContain(
        `arn:aws:bedrock:${r}::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
      );
    const scans = (t: Template) =>
      policies(t).filter((p) =>
        p.Properties.PolicyDocument.Statement.some((s) => actions(s).includes('dynamodb:Scan')),
      );
    expect(scans(dev)).toHaveLength(2); // ApiFn (admin reset) + DemoResetFn (scheduled reset)
    expect(scans(prod)).toHaveLength(0);
  });
});

describe('Api', () => {
  const routes = Object.values(dev.findResources('AWS::ApiGatewayV2::Route')) as {
    Properties: { RouteKey: string; AuthorizationType?: string };
  }[];
  const auth = (key: string) =>
    routes.find((r) => r.Properties.RouteKey === key)?.Properties.AuthorizationType;

  it('public: /health and room reads; JWT: everything else (no ANY route, so preflight is unauthenticated)', () => {
    for (const k of [
      'GET /health',
      'GET /buildings',
      'GET /rooms',
      'GET /rooms/{roomId}',
      'GET /rooms/{roomId}/schedule',
    ]) {
      expect(auth(k) ?? 'NONE').toBe('NONE');
    }
    for (const k of [
      'GET /me',
      'PATCH /me',
      'GET /claims/{id}/contact',
      'POST /{proxy+}',
      'GET /{proxy+}',
    ]) {
      expect(auth(k)).toBe('JWT');
    }
    expect(routes.some((r) => r.Properties.RouteKey.startsWith('ANY'))).toBe(false);
  });

  it('throttles the stage; CORS only for localhost in dev (the SPA is same-origin via /api)', () => {
    dev.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: Match.objectLike({
        ThrottlingBurstLimit: 100,
        ThrottlingRateLimit: 50,
      }),
    });
    dev.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({ AllowOrigins: ['http://localhost:5173'] }),
    });
    // prod must never trust a localhost origin (CORS, OAuth redirects, map key referers)
    expect(JSON.stringify(prod.toJSON())).not.toContain('localhost');
    prod.hasResourceProperties('AWS::ApiGatewayV2::Api', { CorsConfiguration: Match.absent() });
  });

  it('all functions run Node 24 on ARM64', () => {
    const fns = Object.values(
      dev.findResources('AWS::Lambda::Function', {
        Properties: {
          Environment: { Variables: Match.objectLike({ TABLE_NAME: Match.anyValue() }) },
        },
      }),
    ) as {
      Properties: { Runtime: string; Architectures: string[] };
    }[];
    expect(fns).toHaveLength(7); // incl. the dev-only DemoResetFn
    for (const f of fns)
      expect([f.Properties.Runtime, f.Properties.Architectures]).toEqual(['nodejs24.x', ['arm64']]);
  });
});

describe('Async', () => {
  it('schedules sweeper every minute and sync 10-min daytime / hourly overnight (campus time)', () => {
    dev.hasResourceProperties('AWS::Scheduler::Schedule', { ScheduleExpression: 'rate(1 minute)' });
    dev.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(0/10 6-22 * * ? *)',
      ScheduleExpressionTimezone: 'America/New_York',
    });
    dev.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(0 23,0-5 * * ? *)',
      ScheduleExpressionTimezone: 'America/New_York',
    });
  });

  it('stream consumer: batch 10, 2 retries, bisect, SQS DLQ, EVT# INSERT filter', () => {
    dev.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 10,
      MaximumRetryAttempts: 2,
      BisectBatchOnFunctionError: true,
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
      FilterCriteria: { Filters: [{ Pattern: Match.stringLikeRegexp('EVT#') }] },
    });
  });
});

describe('Auth + Web', () => {
  it('Cognito: email sign-in, strong passwords, SRP web client, pre-token trigger', () => {
    dev.hasResourceProperties('AWS::Cognito::UserPool', {
      UsernameAttributes: ['email'],
      Policies: { PasswordPolicy: Match.objectLike({ MinimumLength: 12, RequireSymbols: true }) },
      LambdaConfig: { PreTokenGeneration: Match.anyValue() },
    });
    dev.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_SRP_AUTH']),
      GenerateSecret: false,
    });
    expect(Object.keys(dev.findResources('AWS::Cognito::UserPoolIdentityProvider'))).toHaveLength(
      0,
    );
  });

  it('CloudFront: OAC, SPA fallback, HSTS + CSP + frame DENY; private bucket', () => {
    dev.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: {
        SecurityHeadersConfig: Match.objectLike({
          FrameOptions: { FrameOption: 'DENY', Override: true },
          StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 63072000 }),
          ContentSecurityPolicy: Match.objectLike({
            ContentSecurityPolicy: Match.stringLikeRegexp("frame-ancestors 'none'"),
          }),
        }),
      },
    });
    // SPA fallback is a viewer-request function (error pages would swallow API 403/404 JSON).
    dev.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionCode: Match.stringLikeRegexp("r.uri='/index.html'"),
    });
    dev.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.absent(),
        CacheBehaviors: [
          Match.objectLike({
            PathPattern: '/api/*',
            ViewerProtocolPolicy: 'https-only',
            CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // CachingDisabled
          }),
        ],
      }),
    });
    dev.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    dev.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: Match.objectLike({
        BlockPublicAcls: true,
        RestrictPublicBuckets: true,
      }),
    });
  });

  it('Location Maps v2: key limited to basemap reads from our origin; no legacy map resource', () => {
    dev.hasResourceProperties('AWS::Location::APIKey', {
      Restrictions: Match.objectLike({
        AllowActions: ['geo-maps:GetTile', 'geo-maps:GetStaticMap'],
        AllowResources: [Match.stringLikeRegexp('^arn:aws:geo-maps:.*::provider/default$')],
      }),
    });
    dev.resourceCountIs('AWS::Location::Map', 0);
    // maplibre's worker is a same-origin asset; the API is same-origin, so no execute-api wildcard.
    const csp = JSON.stringify(dev.findResources('AWS::CloudFront::ResponseHeadersPolicy'));
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).not.toContain('execute-api');
  });
});

describe('P8 hardening', () => {
  it('WAF WebACL (rate 300/5min + managed common + known bad inputs) on CloudFront in prod only', () => {
    prod.hasResourceProperties('Custom::CloudFrontWebAcl', {
      Name: 'freeroom-prod-edge',
      RateLimit: 300,
    });
    prod.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ WebACLId: Match.anyValue() }),
    });
    dev.resourceCountIs('Custom::CloudFrontWebAcl', 0);
  });

  it('prod: demo endpoints and dev auth cannot be enabled', () => {
    const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
    expect(
      () =>
        new FreeRoomStack(app, 'FreeRoom-prod', {
          stage: 'prod',
          demoMode: true,
          env: { account: '111111111111', region: 'us-east-1' },
        }),
    ).toThrow(/never be enabled in prod/);
    const env = Object.values(prod.findResources('AWS::Lambda::Function'))
      .map((f) => f as { Properties: { Environment?: { Variables?: Record<string, string> } } })
      .map((f) => f.Properties.Environment?.Variables ?? {})
      .filter((v) => v.TABLE_NAME);
    expect(env.length).toBeGreaterThan(0);
    for (const v of env) {
      expect(v.NODE_ENV).not.toBe('development'); // the only value that enables dev auth
      expect(v.DEMO_MODE ?? 'false').toBe('false');
    }
  });

  it('IAM audit: no Resource "*" except AWS-required ListStreams / CloudFront invalidation', () => {
    for (const t of [dev, prod]) {
      for (const p of policies(t)) {
        for (const s of p.Properties.PolicyDocument.Statement) {
          const res = [(s as { Resource?: unknown }).Resource].flat();
          if (!res.includes('*')) continue;
          expect(actions(s).sort()).toSatisfy(
            (a: string[]) =>
              a.join() === 'dynamodb:ListStreams' ||
              a.join() === 'cloudfront:CreateInvalidation,cloudfront:GetInvalidation',
          );
        }
      }
    }
  });

  it('no role but RevealFn has kms:Decrypt (incl. the GitHub deploy role)', () => {
    const decrypters = policies(prod).filter((p) =>
      p.Properties.PolicyDocument.Statement.some((s) => actions(s).includes('kms:Decrypt')),
    );
    expect(decrypters).toHaveLength(1);
    expect(decrypters[0]!.Properties.Roles[0]!.Ref).toMatch(/RevealFn/);
  });

  it('GitHub OIDC deploy role: pinned to the repo (main for dev, prod environment for prod)', () => {
    dev.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub':
                  'repo:lakshmanlak07/freeroom:ref:refs/heads/main',
              },
            },
          }),
        ],
      },
    });
    prod.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: Match.objectLike({
              StringEquals: Match.objectLike({
                'token.actions.githubusercontent.com:sub':
                  'repo:lakshmanlak07/freeroom:environment:prod',
              }),
            }),
          }),
        ],
      },
    });
    // The provider is account-wide: created once (dev), imported by prod.
    expect(Object.keys(prod.findResources('Custom::AWSCDKOpenIdConnectProvider'))).toHaveLength(0);
  });

  it('alarms → SNS: 5xx > 2%, every Lambda, sync failed twice, staleness > 60, DLQ > 0; dashboard', () => {
    const names = Object.values(prod.findResources('AWS::CloudWatch::Alarm')).map(
      (a) => (a as { Properties: { AlarmName: string } }).Properties.AlarmName,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'freeroom-prod-Api5xxRate',
        'freeroom-prod-SyncFailedTwice',
        'freeroom-prod-ScheduleStale',
        'freeroom-prod-StreamDlqNotEmpty',
        'freeroom-prod-ApiFnErrors',
        'freeroom-prod-RevealFnErrors',
        'freeroom-prod-SweeperFnErrors',
        'freeroom-prod-SyncFnErrors',
        'freeroom-prod-OnChangeFnErrors',
        'freeroom-prod-PreTokenFnErrors',
      ]),
    );
    prod.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'freeroom-prod-ScheduleStale',
      Threshold: 60,
      TreatMissingData: 'breaching',
    });
    prod.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'freeroom-prod-Api5xxRate',
      Threshold: 2,
    });
    prod.hasResourceProperties('AWS::CloudWatch::Dashboard', { DashboardName: 'FreeRoom-prod' });
    prod.hasResourceProperties('AWS::SNS::Topic', Match.anyValue());
  });
});

describe('P9 security review fixes', () => {
  it('CloudFront sends the origin-verify secret to the API; the API reads it', () => {
    prod.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: Match.arrayWith([
          Match.objectLike({
            OriginCustomHeaders: [
              Match.objectLike({ HeaderName: 'x-origin-verify', HeaderValue: Match.anyValue() }),
            ],
          }),
        ]),
      }),
    });
    expect(JSON.stringify(prod.toJSON())).toContain('ORIGIN_VERIFY_SECRET_ARN');
    expect(Object.keys(prod.toJSON().Outputs)).not.toContain('ApiUrl');
  });

  it('each deploy role can only assume its own stage’s bootstrap roles', () => {
    const assumable = (t: Template) =>
      policies(t)
        .flatMap((p) => p.Properties.PolicyDocument.Statement)
        .filter((s) => actions(s).includes('sts:AssumeRole'))
        .flatMap((s) => [(s as { Resource?: unknown }).Resource].flat())
        .map((r) => JSON.stringify(r));
    expect(assumable(prod).join()).toContain('cdk-frprod-');
    expect(assumable(prod).join()).not.toContain('hnb659fds');
    expect(assumable(dev).join()).not.toContain('frprod');
  });
});

describe('F3 judge-proof demo', () => {
  it('dev resets the demo every 2 hours; prod has no reset function or schedule', () => {
    dev.hasResourceProperties('AWS::Scheduler::Schedule', { ScheduleExpression: 'rate(2 hours)' });
    const resetFns = (t: Template) =>
      Object.values(t.findResources('AWS::Lambda::Function')).filter((f) =>
        JSON.stringify(f).includes('DEMO_MODE":"true'),
      );
    expect(resetFns(prod)).toHaveLength(0);
    expect(JSON.stringify(prod.toJSON())).not.toContain('rate(2 hours)');
  });
});

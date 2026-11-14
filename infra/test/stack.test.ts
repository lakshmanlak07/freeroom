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
    const scans = (t: Template) =>
      policies(t).filter((p) =>
        p.Properties.PolicyDocument.Statement.some((s) => actions(s).includes('dynamodb:Scan')),
      );
    expect(scans(dev)).toHaveLength(1);
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

  it('throttles the stage and allows only the web origin + localhost', () => {
    dev.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: Match.objectLike({
        ThrottlingBurstLimit: 100,
        ThrottlingRateLimit: 50,
      }),
    });
    dev.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: Match.arrayWith(['http://localhost:5173']),
      }),
    });
  });

  it('all functions run Node 20 on ARM64', () => {
    const fns = Object.values(
      dev.findResources('AWS::Lambda::Function', {
        Properties: {
          Environment: { Variables: Match.objectLike({ TABLE_NAME: Match.anyValue() }) },
        },
      }),
    ) as {
      Properties: { Runtime: string; Architectures: string[] };
    }[];
    expect(fns).toHaveLength(6);
    for (const f of fns)
      expect([f.Properties.Runtime, f.Properties.Architectures]).toEqual(['nodejs20.x', ['arm64']]);
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
    dev.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 404, ResponsePagePath: '/index.html' }),
        ]),
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

  it('Location key is limited to map reads on our map', () => {
    dev.hasResourceProperties('AWS::Location::APIKey', {
      Restrictions: Match.objectLike({ AllowActions: ['geo:GetMap*'] }),
    });
  });
});

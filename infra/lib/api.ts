import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CfnStage, CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import type { Auth } from './auth';
import type { Data } from './data';
import { READ, WRITE, apiFn, devOrigins, grantTable, type Stage } from './fn';

/** Every partition-key family the main API touches (see services/api/src/data/keys.ts). */
export const API_KEYS = [
  'ROOM#*',
  'BLDG#*',
  'CATALOG',
  'RES#*',
  'USER#*',
  'IDEMP#*',
  'UID#*',
  'SYNC#*',
  'SWEEP#*',
  'MOCK25LIVE',
];

/** Regions a `us.` cross-region inference profile routes to (AWS-defined; see DEPLOY.md). */
const US_PROFILE_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2'];
export function bedrockArns(modelId: string, region: string, account: string): string[] {
  if (!modelId.startsWith('us.')) return [`arn:aws:bedrock:${region}::foundation-model/${modelId}`];
  const base = modelId.slice(3);
  return [
    `arn:aws:bedrock:${region}:${account}:inference-profile/${modelId}`,
    ...US_PROFILE_REGIONS.map((r) => `arn:aws:bedrock:${r}::foundation-model/${base}`),
  ];
}

export class Api extends Construct {
  readonly httpApi: HttpApi;
  readonly apiFn: NodejsFunction;
  readonly revealFn: NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    props: { stage: Stage; demo: boolean; data: Data; auth: Auth; nlModelId?: string },
  ) {
    super(scope, id);
    const { data, auth, stage } = props;
    const env = {
      TABLE_NAME: data.table.tableName,
      STAGE: stage,
      NODE_ENV: 'production',
      DEMO_MODE: String(props.demo),
      COGNITO_USER_POOL_ID: auth.userPool.userPoolId,
      COGNITO_CLIENT_ID: auth.client.userPoolClientId,
      UID_PEPPER_SECRET_ARN: data.pepper.secretArn,
      CONTACT_KMS_KEY_ID: data.piiKey.keyArn,
      ORIGIN_VERIFY_SECRET_ARN: data.originVerify.secretArn,
    };

    // ---- Main API: everything except /me and contact reveal. Encrypts contact, never decrypts.
    this.apiFn = apiFn(this, 'ApiFn', {
      stage,
      entry: 'lambda.ts',
      memoryMb: 1024,
      timeoutSec: 29, // HTTP API integration limit is 30s
      environment: { ...env, TWENTYFIVE_LIVE_SECRET_ARN: data.twentyFiveLive.secretArn },
    });
    grantTable(
      this.apiFn,
      data.table,
      [...READ, ...WRITE, ...(props.demo ? ['Scan'] : [])],
      API_KEYS,
    );
    data.piiKey.grant(this.apiFn, 'kms:GenerateDataKey');
    data.pepper.grantRead(this.apiFn);
    data.originVerify.grantRead(this.apiFn);
    data.twentyFiveLive.grantRead(this.apiFn);
    // Natural-language search (F1 stretch): ONE model, exact ARNs — the inference profile plus the
    // foundation model in each region that profile can route to (verified with get-inference-profile).
    if (props.nlModelId) {
      this.apiFn.addEnvironment('NL_MODEL_ID', props.nlModelId);
      this.apiFn.addToRolePolicy(
        new PolicyStatement({
          actions: ['bedrock:InvokeModel'],
          resources: bedrockArns(props.nlModelId, Stack.of(this).region, Stack.of(this).account),
        }),
      );
    }

    // ---- Privileged: GET/PATCH /me + GET /claims/{id}/contact. The ONLY function with kms:Decrypt.
    this.revealFn = apiFn(this, 'RevealFn', {
      stage,
      entry: 'revealLambda.ts',
      timeoutSec: 10,
      environment: env,
    });
    grantTable(this.revealFn, data.table, [...READ, 'PutItem', 'UpdateItem'], ['USER#*', 'RES#*']);
    data.piiKey.grant(this.revealFn, 'kms:Decrypt', 'kms:GenerateDataKey');
    data.originVerify.grantRead(this.revealFn);

    // The SPA reaches the API same-origin through CloudFront (/api/*), so CORS is only for the
    // local Vite dev server against the dev stage. (Listing the CloudFront origin here would
    // also create a CloudFront ↔ API dependency cycle.)
    const corsOrigins = devOrigins(stage);
    this.httpApi = new HttpApi(this, 'Http', {
      apiName: `freeroom-${stage}`,
      corsPreflight: corsOrigins.length
        ? {
            allowOrigins: corsOrigins,
            allowMethods: [
              CorsHttpMethod.GET,
              CorsHttpMethod.POST,
              CorsHttpMethod.PATCH,
              CorsHttpMethod.DELETE,
              CorsHttpMethod.OPTIONS,
            ],
            allowHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-correlation-id'],
            exposeHeaders: ['x-correlation-id'],
            maxAge: Duration.hours(1),
          }
        : undefined,
    });
    const authorizer = new HttpJwtAuthorizer(
      'Cognito',
      `https://cognito-idp.${Stack.of(this).region}.amazonaws.com/${auth.userPool.userPoolId}`,
      { jwtAudience: [auth.client.userPoolClientId] },
    );
    const api = new HttpLambdaIntegration('ApiInt', this.apiFn);
    const reveal = new HttpLambdaIntegration('RevealInt', this.revealFn);
    const { GET, POST, PATCH, DELETE } = HttpMethod;

    // Public: health + signed-out room browsing (the Lambda still verifies a token if one is sent).
    for (const path of [
      '/health',
      '/buildings',
      '/rooms',
      '/rooms/{roomId}',
      '/rooms/{roomId}/schedule',
    ]) {
      this.httpApi.addRoutes({ path, methods: [GET], integration: api });
    }
    this.httpApi.addRoutes({ path: '/me', methods: [GET, PATCH], integration: reveal, authorizer });
    this.httpApi.addRoutes({
      path: '/claims/{id}/contact',
      methods: [GET],
      integration: reveal,
      authorizer,
    });
    // Explicit methods (not ANY) so CORS preflight OPTIONS never hits the authorizer.
    this.httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [GET, POST, PATCH, DELETE],
      integration: api,
      authorizer,
    });

    const accessLogs = new LogGroup(this, 'AccessLogs', {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    const cfnStage = this.httpApi.defaultStage!.node.defaultChild as CfnStage;
    // Stage-wide throttle; per-user rate limiting is the WAF rate rule (P8).
    cfnStage.defaultRouteSettings = {
      throttlingBurstLimit: 100,
      throttlingRateLimit: 50,
      detailedMetricsEnabled: true,
    };
    cfnStage.accessLogSettings = {
      destinationArn: accessLogs.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        routeKey: '$context.routeKey',
        status: '$context.status',
        latencyMs: '$context.responseLatency',
        integrationError: '$context.integrationErrorMessage',
      }),
    };
  }
}

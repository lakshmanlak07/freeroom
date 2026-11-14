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
import { READ, WRITE, apiFn, grantTable, type Stage } from './fn';

/** Every partition-key family the main API touches (see services/api/src/data/keys.ts). */
const API_KEYS = [
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

export class Api extends Construct {
  readonly httpApi: HttpApi;
  readonly apiFn: NodejsFunction;
  readonly revealFn: NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    props: { stage: Stage; demo: boolean; data: Data; auth: Auth; webOrigin: string },
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
    data.twentyFiveLive.grantRead(this.apiFn);
    this.apiFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:*:${Stack.of(this).account}:inference-profile/*`,
        ],
      }),
    );

    // ---- Privileged: GET/PATCH /me + GET /claims/{id}/contact. The ONLY function with kms:Decrypt.
    this.revealFn = apiFn(this, 'RevealFn', {
      stage,
      entry: 'revealLambda.ts',
      timeoutSec: 10,
      environment: env,
    });
    grantTable(this.revealFn, data.table, [...READ, 'PutItem', 'UpdateItem'], ['USER#*', 'RES#*']);
    data.piiKey.grant(this.revealFn, 'kms:Decrypt', 'kms:GenerateDataKey');

    this.httpApi = new HttpApi(this, 'Http', {
      apiName: `freeroom-${stage}`,
      corsPreflight: {
        allowOrigins: [props.webOrigin, 'http://localhost:5173'],
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
      },
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

import { Token, Validations, type CfnElement, type Stack } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';
import { bootstrapQualifier } from './fn';

/**
 * cdk-nag AwsSolutions: every finding we accept, with its reason (SECURITY.md summarises these).
 * Acknowledgements use exact finding ids, so a NEW wildcard or resource still fails `cdk synth`,
 * which CI runs on every push.
 */
export function suppressNag(stack: Stack) {
  const find = (path: string) =>
    path.split('/').reduce<IConstruct | undefined>((c, p) => c?.node.tryFindChild(p), stack);
  const ack = (path: string | null, id: string, reason: string) => {
    const scope = path ? find(path) : stack;
    if (scope) Validations.of(scope).acknowledge({ id, reason });
  };
  const arn = (path: string) =>
    `<${stack.getLogicalId(find(path)!.node.defaultChild as CfnElement)}.Arn>`;
  const IAM5 = (resource: string) => `AwsSolutions-IAM5[Resource::${resource}]`;
  // Env-agnostic synth (CI lint, no AWS credentials): nag prints the pseudo-parameter instead.
  const account = Token.isUnresolved(stack.account) ? '<AWS::AccountId>' : stack.account;
  const region = Token.isUnresolved(stack.region) ? '<AWS::Region>' : stack.region;
  const qualifier = bootstrapQualifier(stack.stackName.endsWith('prod') ? 'prod' : 'dev');

  // ---- Stack-wide
  ack(
    null,
    'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
    'AWSLambdaBasicExecutionRole only grants CloudWatch Logs writes; it is the AWS-maintained minimum for Lambda logging.',
  );
  ack(
    null,
    'AwsSolutions-L1',
    'Our functions run nodejs24.x (asserted in infra/test/stack.test.ts). Remaining findings are CDK-managed singleton handlers (BucketDeployment, Provider framework, AwsCustomResource) whose runtime CDK pins.',
  );
  ack(
    null,
    IAM5(`${arn('Data/Table')}/index/*`),
    'GSI ARNs (table/index/*): every DynamoDB grant carries a dynamodb:LeadingKeys condition limiting it to specific partition-key prefixes (asserted in stack.test.ts).',
  );
  for (const fn of ['Async/SyncFn', 'Async/SweeperFn', 'EdgeWaf/Handler']) {
    if (find(fn))
      ack(
        null,
        IAM5(`${arn(fn)}:*`),
        'Lambda grantInvoke adds <fn>:* so the caller can invoke versions/aliases of that one function.',
      );
  }

  // ---- CDK-managed asset deployment (S3 → site bucket + CloudFront invalidation).
  for (const child of stack.node.children) {
    if (!child.node.id.startsWith('Custom::CDKBucketDeployment')) continue;
    for (const id of [
      'Action::s3:GetObject*',
      'Action::s3:GetBucket*',
      'Action::s3:List*',
      'Action::s3:DeleteObject*',
      'Action::s3:Abort*',
      'Resource::*',
      `Resource::arn:<AWS::Partition>:s3:::cdk-${qualifier}-assets-${account}-${region}/*`,
      `Resource::${arn('Web/Site')}/*`,
    ]) {
      Validations.of(child).acknowledge({
        id: `AwsSolutions-IAM5[${id}]`,
        reason:
          'CDK BucketDeployment: copies build assets from the CDK assets bucket into the site bucket and invalidates CloudFront (unscoped CreateInvalidation inside the construct).',
      });
    }
  }

  // ---- Our wildcards that AWS requires.
  ack(
    'Async/OnChangeFn',
    IAM5('*'),
    'dynamodb:ListStreams does not support resource-level permissions (added by DynamoEventSource).',
  );
  for (const r of [
    'arn:aws:bedrock:*::foundation-model/*',
    `arn:aws:bedrock:*:${account}:inference-profile/*`,
  ]) {
    ack(
      'Api/ApiFn',
      IAM5(r),
      'Bedrock natural-language search: the model id is runtime configuration, so invoke is allowed on foundation models and this account’s inference profiles only.',
    );
  }
  ack(
    'GithubOidc',
    IAM5(`arn:aws:iam::${account}:role/cdk-${qualifier}-*-${account}-${region}`),
    'The deploy role may only assume ITS stage’s CDK bootstrap roles (cdk-<qualifier>-<kind>-role; prod has its own qualifier); the wildcard is the role kind.',
  );
  if (find('EdgeWaf')) {
    const stage = stack.stackName.replace(/^FreeRoom-/, '');
    for (const r of [
      `arn:aws:wafv2:us-east-1:${account}:global/webacl/freeroom-${stage}-edge/*`,
      `arn:aws:wafv2:us-east-1:${account}:global/managedruleset/*/*`,
    ]) {
      ack(
        'EdgeWaf/Handler',
        IAM5(r),
        'WAF assigns the WebACL id at creation, so the ARN is pinned by name (webacl/<name>/*); managed rule groups are AWS-owned and referenced by name.',
      );
    }
    ack(
      'EdgeWaf/Provider',
      'AwsSolutions-IAM4',
      'CDK custom-resource Provider framework role (logs only).',
    );
    ack(
      'EdgeWaf/Provider',
      'AwsSolutions-IAM5',
      'CDK Provider framework may invoke versions of its own handler.',
    );
  }

  // ---- Public API routes (signed-out room browsing + health). Everything else uses the JWT authorizer.
  for (const p of [
    'health',
    'buildings',
    'rooms',
    'rooms--{roomId}',
    'rooms--{roomId}--schedule',
  ]) {
    ack(
      `Api/Http/GET--${p}`,
      'AwsSolutions-APIG4',
      'Intentionally public, read-only, PII-free room data (PRD F1/F3); throttled by the stage (and the WAF rate rule in prod).',
    );
  }

  // ---- Edge / web
  ack(
    'Web/Cdn',
    'AwsSolutions-CFR1',
    'Students and faculty use the app while travelling; no geo restriction.',
  );
  ack(
    'Web/Cdn',
    'AwsSolutions-CFR3',
    'Cost: CloudFront standard logs need a separate ACL-enabled bucket. Request visibility comes from API access logs, WAF sampled requests/metrics and the dashboard.',
  );
  ack(
    'Web/Cdn',
    'AwsSolutions-CFR4',
    'Default *.cloudfront.net certificate fixes the viewer TLS policy; set minimumProtocolVersion TLSv1.2_2021 when a custom domain is attached (DEPLOY.md).',
  );
  if (!find('EdgeWaf')) {
    ack(
      'Web/Cdn',
      'AwsSolutions-CFR2',
      'Dev stage only: WAF is prod-only to save cost (owner decision). Dev keeps API throttling, JWT auth and per-user quotas.',
    );
  }
  ack(
    'Web/Site',
    'AwsSolutions-S1',
    'Static build artifacts only, private (OAC), redeployed from git; access is through CloudFront. Server access logs would add cost without security value here.',
  );

  // ---- Identity
  ack(
    'Auth/Users',
    'AwsSolutions-COG2',
    'v1 uses email + strong password; campus SAML SSO (config-ready, PRD §0) brings the university’s MFA. Required MFA would block the demo accounts.',
  );
  ack(
    'Auth/Users',
    'AwsSolutions-COG8',
    'Cognito Plus (threat protection) is a paid tier; abuse is limited by WAF, API throttling and per-user quotas.',
  );

  // ---- Data
  ack(
    'Data/UidPepper',
    'AwsSolutions-SMG4',
    'Rotating the HMAC pepper would invalidate every stored University-ID hash (uniqueness check). Procedure with re-registration is in RUNBOOK.md.',
  );
  ack(
    'Data/TwentyFiveLive',
    'AwsSolutions-SMG4',
    '25Live credentials are issued and rotated by UMass IT; RUNBOOK.md covers updating them.',
  );
  ack(
    'Data/TestUsers',
    'AwsSolutions-SMG4',
    'Demo/smoke-test logins managed by postDeploy (a removed entry gets a new password); RUNBOOK.md covers rotation.',
  );
  ack(
    'Data/OriginVerify',
    'AwsSolutions-SMG4',
    'CloudFront-to-API shared header value; rotate by putting a new value and redeploying (RUNBOOK.md) so CloudFront and the API change together.',
  );
  ack(
    'Async/OnChangeDlq',
    'AwsSolutions-SQS3',
    'This queue IS the dead-letter queue for the stream consumer.',
  );
}

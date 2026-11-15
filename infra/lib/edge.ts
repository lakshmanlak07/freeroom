import { CustomResource, Duration, Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { join } from 'node:path';
import { ROOT, type Stage } from './fn';

/**
 * CloudFront WAF WebACL: per-IP rate limit on /api/* + AWS managed common + known-bad-inputs.
 * CLOUDFRONT-scope ACLs must be created in us-east-1; this account's SCP blocks CloudFormation
 * there (but not the WAF API), so a custom resource in this stack creates it. Rules live in
 * infra/lambda/edge-waf/spec.mjs.
 */
export class EdgeWaf extends Construct {
  readonly webAclArn: string;
  readonly webAclName: string;
  readonly metricPrefix: string;

  constructor(scope: Construct, id: string, props: { stage: Stage; rateLimit: number }) {
    super(scope, id);
    const account = Stack.of(this).account;
    this.webAclName = `freeroom-${props.stage}-edge`;
    this.metricPrefix = `freeroom-${props.stage}`;

    const fn = new Function(this, 'Handler', {
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      code: Code.fromAsset(join(ROOT, 'infra/lambda/edge-waf')),
      timeout: Duration.minutes(14), // delete waits for CloudFront to detach the ACL
      logGroup: new LogGroup(this, 'HandlerLogs', { retention: RetentionDays.ONE_MONTH }),
    });
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'wafv2:CreateWebACL',
          'wafv2:GetWebACL',
          'wafv2:UpdateWebACL',
          'wafv2:DeleteWebACL',
        ],
        resources: [
          `arn:aws:wafv2:us-east-1:${account}:global/webacl/${this.webAclName}/*`,
          // AWS-owned managed rule groups referenced by the ACL.
          `arn:aws:wafv2:us-east-1:${account}:global/managedruleset/*/*`,
        ],
      }),
    );
    const provider = new Provider(this, 'Provider', {
      onEventHandler: fn,
      logGroup: new LogGroup(this, 'ProviderLogs', { retention: RetentionDays.ONE_MONTH }),
    });
    const acl = new CustomResource(this, 'WebAcl', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::CloudFrontWebAcl',
      properties: {
        Name: this.webAclName,
        RateLimit: props.rateLimit,
        MetricPrefix: this.metricPrefix,
      },
    });
    this.webAclArn = acl.getAttString('Arn');
  }
}

import { Duration, Stack } from 'aws-cdk-lib';
import {
  OpenIdConnectProvider,
  PolicyStatement,
  Role,
  WebIdentityPrincipal,
  type IOpenIdConnectProvider,
} from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import type { Stage } from './fn';

const ISSUER = 'token.actions.githubusercontent.com';

/**
 * Deploy role for GitHub Actions via OIDC (no long-lived keys). Trust is pinned to ONE repo and:
 *   dev  → pushes to main   (sub = repo:<owner/name>:ref:refs/heads/main)
 *   prod → the `prod` environment (sub = repo:<owner/name>:environment:prod)
 * The role can only assume the CDK bootstrap roles (which do the actual deploy) plus whatever
 * the stack grants it for post-deploy steps. The OIDC provider is account-wide: the dev stack
 * creates it, prod imports it.
 */
export class GithubOidc extends Construct {
  readonly role: Role;

  constructor(scope: Construct, id: string, props: { stage: Stage; repo: string }) {
    super(scope, id);
    const { account, region } = Stack.of(this);
    const provider: IOpenIdConnectProvider =
      props.stage === 'dev'
        ? new OpenIdConnectProvider(this, 'Provider', {
            url: `https://${ISSUER}`,
            clientIds: ['sts.amazonaws.com'],
          })
        : OpenIdConnectProvider.fromOpenIdConnectProviderArn(
            this,
            'Provider',
            `arn:aws:iam::${account}:oidc-provider/${ISSUER}`,
          );
    const sub =
      props.stage === 'dev'
        ? `repo:${props.repo}:ref:refs/heads/main`
        : `repo:${props.repo}:environment:prod`;

    this.role = new Role(this, 'DeployRole', {
      roleName: `freeroom-${props.stage}-github-deploy`,
      description: `GitHub Actions (${props.repo}) deploys FreeRoom-${props.stage}`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: { [`${ISSUER}:aud`]: 'sts.amazonaws.com', [`${ISSUER}:sub`]: sub },
      }),
    });
    this.role.addToPolicy(
      new PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${account}:role/cdk-hnb659fds-*-${account}-${region}`],
      }),
    );
  }
}

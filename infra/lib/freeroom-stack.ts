import { CfnOutput, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { API_KEYS, Api } from './api';
import { Async } from './async';
import { Auth } from './auth';
import { Data } from './data';
import { EdgeWaf } from './edge';
import { READ, WRITE, grantTable, type Stage } from './fn';
import { GithubOidc } from './github-oidc';
import { Observability } from './observability';
import { Web } from './web';

export interface FreeRoomStackProps extends StackProps {
  stage: Stage;
  demoMode: boolean;
  samlMetadataUrl?: string;
  alarmEmail?: string;
  /** CloudFront WAF (default: prod only). */
  waf?: boolean;
  wafRateLimit?: number;
  /** owner/name allowed to deploy via GitHub OIDC. */
  githubRepo?: string;
  /**
   * Create the GitHub OIDC deploy role. Off by default: the hackathon account's SCP denies
   * iam:CreateOpenIDConnectProvider. Turn on (-c githubOidc=true) in an account that allows it.
   */
  githubOidc?: boolean;
}

/** The ONE FreeRoom stack per stage (CLAUDE.md), composed of constructs. */
export class FreeRoomStack extends Stack {
  constructor(scope: Construct, id: string, props: FreeRoomStackProps) {
    super(scope, id, props);
    const { stage } = props;
    // Defense in depth: demo endpoints never ship to prod (also refused by createApp at runtime).
    if (stage === 'prod' && props.demoMode) {
      throw new Error('demoMode must never be enabled in prod');
    }
    Tags.of(this).add('app', 'freeroom');
    Tags.of(this).add('stage', stage);

    const data = new Data(this, 'Data', { stage });
    const edge =
      (props.waf ?? stage === 'prod')
        ? new EdgeWaf(this, 'EdgeWaf', { stage, rateLimit: props.wafRateLimit ?? 300 })
        : undefined;
    const web = new Web(this, 'Web', { stage, webAclArn: edge?.webAclArn });
    const auth = new Auth(this, 'Auth', {
      stage,
      table: data.table,
      webUrl: web.url,
      samlMetadataUrl: props.samlMetadataUrl,
    });
    const api = new Api(this, 'Api', {
      stage,
      demo: props.demoMode,
      data,
      auth,
    });
    // The SPA calls the API through CloudFront (/api/*), so WAF + HTTPS + headers cover it.
    // CloudFormation resolves the secret at deploy time (dynamic reference); it never sits in git.
    const apiUrl = web.routeApi(api.httpApi, data.originVerify.secretValue.unsafeUnwrap());
    const async = new Async(this, 'Async', { stage, data });
    const obs = new Observability(this, 'Observability', {
      stage,
      alarmEmail: props.alarmEmail,
      dlq: async.dlq,
      httpApi: api.httpApi,
      fns: [
        api.apiFn,
        api.revealFn,
        async.sweeperFn,
        async.syncFn,
        async.onChangeFn,
        auth.preTokenFn,
      ],
      waf: edge && { webAclName: edge.webAclName },
    });
    web.deploy({
      apiUrl,
      userPoolId: auth.userPool.userPoolId,
      clientId: auth.client.userPoolClientId,
      demoMode: props.demoMode,
    });

    const out = (name: string, value: string) => new CfnOutput(this, name, { value });
    if (props.githubOidc && props.githubRepo) {
      const gh = new GithubOidc(this, 'GithubOidc', { stage, repo: props.githubRepo });
      // Post-deploy (infra/scripts/postDeploy.ts): first sync, test users, demo seed.
      async.syncFn.grantInvoke(gh.role);
      data.testUsers.grantRead(gh.role);
      data.testUsers.grantWrite(gh.role);
      data.piiKey.grant(gh.role, 'kms:GenerateDataKey');
      grantTable(gh.role, data.table, [...READ, ...WRITE], [...API_KEYS, 'DEMO']);
      gh.role.addToPolicy(
        new PolicyStatement({
          actions: [
            'cognito-idp:AdminCreateUser',
            'cognito-idp:AdminGetUser',
            'cognito-idp:AdminSetUserPassword',
          ],
          resources: [auth.userPool.userPoolArn],
        }),
      );
      out('DeployRoleArn', gh.role.roleArn);
    }

    out('WebUrl', web.url);
    out('UserPoolId', auth.userPool.userPoolId);
    out('UserPoolClientId', auth.client.userPoolClientId);
    out('TableName', data.table.tableName);
    out('PiiKeyArn', data.piiKey.keyArn);
    out('SyncFnName', async.syncFn.functionName);
    out('TestUsersSecretArn', data.testUsers.secretArn);
    out('DashboardName', obs.dashboard.dashboardName);
    out('DemoMode', String(props.demoMode));
    out('Region', this.region);
  }
}

import { CfnOutput, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { Api } from './api';
import { Async } from './async';
import { Auth } from './auth';
import { Data } from './data';
import type { Stage } from './fn';
import { Observability } from './observability';
import { Web } from './web';

export interface FreeRoomStackProps extends StackProps {
  stage: Stage;
  demoMode: boolean;
  samlMetadataUrl?: string;
  alarmEmail?: string;
}

/** The ONE FreeRoom stack per stage (CLAUDE.md), composed of constructs. */
export class FreeRoomStack extends Stack {
  constructor(scope: Construct, id: string, props: FreeRoomStackProps) {
    super(scope, id, props);
    Tags.of(this).add('app', 'freeroom');
    Tags.of(this).add('stage', props.stage);
    const { stage } = props;

    const data = new Data(this, 'Data', { stage });
    const web = new Web(this, 'Web', { stage });
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
      webOrigin: web.url,
    });
    const async = new Async(this, 'Async', { stage, data });
    new Observability(this, 'Observability', {
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
    });
    web.deploy({
      apiUrl: api.httpApi.apiEndpoint,
      userPoolId: auth.userPool.userPoolId,
      clientId: auth.client.userPoolClientId,
      demoMode: props.demoMode,
    });

    const out = (name: string, value: string) => new CfnOutput(this, name, { value });
    out('WebUrl', web.url);
    out('ApiUrl', api.httpApi.apiEndpoint);
    out('UserPoolId', auth.userPool.userPoolId);
    out('UserPoolClientId', auth.client.userPoolClientId);
    out('TableName', data.table.tableName);
    out('PiiKeyArn', data.piiKey.keyArn);
    out('SyncFnName', async.syncFn.functionName);
    out('DemoMode', String(props.demoMode));
    out('Region', this.region);
  }
}

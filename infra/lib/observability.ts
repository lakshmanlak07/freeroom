import { Duration } from 'aws-cdk-lib';
import type { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import {
  Alarm,
  ComparisonOperator,
  TreatMissingData,
  type IMetric,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import type { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Queue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

/** Baseline alarms → SNS email. P8 adds the dashboard, staleness and sync-failure alarms. */
export class Observability extends Construct {
  readonly topic: Topic;

  constructor(
    scope: Construct,
    id: string,
    props: { alarmEmail?: string; dlq: Queue; httpApi: HttpApi; fns: NodejsFunction[] },
  ) {
    super(scope, id);
    this.topic = new Topic(this, 'Alarms', { displayName: 'FreeRoom alarms' });
    if (props.alarmEmail) this.topic.addSubscription(new EmailSubscription(props.alarmEmail));

    const alarm = (aid: string, metric: IMetric, threshold: number) =>
      new Alarm(this, aid, {
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new SnsAction(this.topic));

    const period = Duration.minutes(5);
    alarm('StreamDlqDepth', props.dlq.metricApproximateNumberOfMessagesVisible({ period }), 1);
    alarm('Api5xx', props.httpApi.metricServerError({ period, statistic: 'Sum' }), 5);
    for (const fn of props.fns)
      alarm(`${fn.node.id}Errors`, fn.metricErrors({ period, statistic: 'Sum' }), 1);
  }
}

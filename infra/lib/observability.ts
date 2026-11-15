import { Duration, Stack } from 'aws-cdk-lib';
import type { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  MathExpression,
  Metric,
  SingleValueWidget,
  TextWidget,
  TreatMissingData,
  type IMetric,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Queue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import type { Stage } from './fn';

/** Must match services/api/src/metrics.ts. */
const NAMESPACE = 'FreeRoom';
const BUSINESS = [
  'ReservationsCreated',
  'ClassConflictsBlocked',
  'SlotTakenRaces',
  'AutoReleases',
  'ClaimsApproved',
] as const;

/** Dashboard + alarms → SNS email (alarmEmail context). Runbook: RUNBOOK.md#alarms. */
export class Observability extends Construct {
  readonly topic: Topic;
  readonly dashboard: Dashboard;
  readonly alarms: Alarm[] = [];

  constructor(
    scope: Construct,
    id: string,
    props: {
      stage: Stage;
      alarmEmail?: string;
      dlq: Queue;
      httpApi: HttpApi;
      fns: IFunction[];
      waf?: { webAclName: string };
    },
  ) {
    super(scope, id);
    const { stage } = props;
    this.topic = new Topic(this, 'Alarms', {
      displayName: `FreeRoom ${stage} alarms`,
      enforceSSL: true,
    });
    if (props.alarmEmail) this.topic.addSubscription(new EmailSubscription(props.alarmEmail));

    const m = (metricName: string, statistic = 'Sum', period = Duration.minutes(5)) =>
      new Metric({
        namespace: NAMESPACE,
        metricName,
        dimensionsMap: { Stage: stage },
        statistic,
        period,
      });
    const alarm = (
      aid: string,
      description: string,
      metric: IMetric,
      threshold: number,
      o: { op?: ComparisonOperator; periods?: number; missing?: TreatMissingData } = {},
    ) => {
      const a = new Alarm(this, aid, {
        alarmName: `freeroom-${stage}-${aid}`,
        alarmDescription: `${description} See RUNBOOK.md (alarm ${aid}).`,
        metric,
        threshold,
        evaluationPeriods: o.periods ?? 1,
        datapointsToAlarm: o.periods ?? 1,
        comparisonOperator: o.op ?? ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: o.missing ?? TreatMissingData.NOT_BREACHING,
      });
      a.addAlarmAction(new SnsAction(this.topic));
      a.addOkAction(new SnsAction(this.topic));
      this.alarms.push(a);
      return a;
    };

    // ---- API: 5xx above 2%.
    const period = Duration.minutes(5);
    const requests = props.httpApi.metricCount({ period, statistic: 'Sum' });
    const errors5xx = props.httpApi.metricServerError({ period, statistic: 'Sum' });
    // % only once there is real traffic (≥ 20 req / 5 min), so one stray 500 at 3am isn't "50%".
    const rate5xx = new MathExpression({
      expression: 'IF(req >= 20, 100 * err / req, 0)',
      usingMetrics: { req: requests, err: errors5xx },
      label: '5xx %',
      period,
    });
    alarm('Api5xxRate', 'API 5xx responses above 2% of requests.', rate5xx, 2);

    // ---- Every Lambda: any error.
    for (const fn of props.fns) {
      alarm(
        `${fn.node.id}Errors`,
        `${fn.node.id} threw at least one error.`,
        fn.metricErrors({ period, statistic: 'Sum' }),
        0,
      );
    }

    // ---- Sync: two failed runs in a row (SyncSuccess = 0). Overnight runs are hourly, so
    // 10-min periods without a run are ignored rather than counted as OK or failed.
    alarm(
      'SyncFailedTwice',
      '25Live sync failed two runs in a row.',
      m('SyncSuccess', 'Maximum', Duration.minutes(10)),
      1,
      { op: ComparisonOperator.LESS_THAN_THRESHOLD, periods: 2, missing: TreatMissingData.IGNORE },
    );
    // ---- Staleness, reported every minute by the sweeper. Missing data = sweeper dead = breach.
    // 5 consecutive minutes > 60 so the top-of-the-hour overnight run doesn't flap at minute 60.
    alarm(
      'ScheduleStale',
      'Schedule data older than 60 minutes (for 5 minutes straight).',
      m('ScheduleStalenessMinutes', 'Maximum', Duration.minutes(1)),
      60,
      { periods: 5, missing: TreatMissingData.BREACHING },
    );
    // ---- Stream processing: anything in the DLQ.
    alarm(
      'StreamDlqNotEmpty',
      'onChange stream records failed and landed in the DLQ.',
      props.dlq.metricApproximateNumberOfMessagesVisible({ period, statistic: 'Maximum' }),
      0,
    );

    // ---- Dashboard
    this.dashboard = new Dashboard(this, 'Dashboard', {
      dashboardName: `FreeRoom-${stage}`,
      defaultInterval: Duration.hours(6),
    });
    this.dashboard.addWidgets(
      new TextWidget({
        markdown: `# FreeRoom ${stage}\nAlarms email the SNS topic. What to do: **RUNBOOK.md**. Region ${Stack.of(this).region}.`,
        width: 24,
        height: 2,
      }),
    );
    this.dashboard.addWidgets(
      new GraphWidget({ title: 'API requests', left: [requests], width: 8 }),
      new GraphWidget({ title: 'API 5xx %', left: [rate5xx], width: 8 }),
      new GraphWidget({
        title: 'API latency (ms)',
        left: [
          props.httpApi.metricLatency({ period, statistic: 'p50' }),
          props.httpApi.metricLatency({ period, statistic: 'p95' }),
        ],
        width: 8,
      }),
    );
    this.dashboard.addWidgets(
      new GraphWidget({
        title: 'Reservations & rule enforcement',
        left: BUSINESS.map((n) => m(n)),
        width: 12,
      }),
      new GraphWidget({
        title: 'Notifications & stream',
        left: [m('NotificationFailures')],
        right: [props.dlq.metricApproximateNumberOfMessagesVisible({ period })],
        width: 12,
      }),
    );
    this.dashboard.addWidgets(
      new SingleValueWidget({
        title: 'Schedule staleness (min)',
        metrics: [m('ScheduleStalenessMinutes', 'Maximum', Duration.minutes(1))],
        width: 6,
      }),
      new GraphWidget({
        title: 'Sync success (1 = ok)',
        left: [m('SyncSuccess', 'Minimum', Duration.minutes(10))],
        width: 6,
      }),
      new GraphWidget({
        title: 'Lambda errors',
        left: props.fns.map((fn) => fn.metricErrors({ period, statistic: 'Sum' })),
        width: 12,
      }),
    );
    if (props.waf) {
      const waf = (rule: string, metricName: string) =>
        new Metric({
          namespace: 'AWS/WAFV2',
          metricName,
          region: 'us-east-1', // CloudFront WAF metrics live in us-east-1
          dimensionsMap: { WebACL: props.waf!.webAclName, Rule: rule },
          statistic: 'Sum',
          period,
        });
      this.dashboard.addWidgets(
        new GraphWidget({
          title: 'WAF (CloudFront)',
          left: [waf('ALL', 'AllowedRequests'), waf('ALL', 'BlockedRequests')],
          right: [waf('RateLimitPerIp', 'BlockedRequests')],
          width: 24,
        }),
      );
    }
  }
}

import { Duration } from 'aws-cdk-lib';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { FilterCriteria, FilterRule, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import type { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { CfnSchedule } from 'aws-cdk-lib/aws-scheduler';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import type { Data } from './data';
import { READ, WRITE, apiFn, grantTable, type Stage } from './fn';

/** Sweeper (1 min), 25Live sync (10 min daytime / hourly overnight), stream → notifications. */
export class Async extends Construct {
  readonly sweeperFn: NodejsFunction;
  readonly syncFn: NodejsFunction;
  readonly onChangeFn: NodejsFunction;
  readonly dlq: Queue;

  constructor(scope: Construct, id: string, props: { stage: Stage; data: Data }) {
    super(scope, id);
    const { data, stage } = props;
    const env = { TABLE_NAME: data.table.tableName, STAGE: stage, NODE_ENV: 'production' };

    this.sweeperFn = apiFn(this, 'SweeperFn', {
      stage,
      entry: 'sweeperLambda.ts',
      timeoutSec: 60,
      environment: env,
    });
    grantTable(
      this.sweeperFn,
      data.table,
      [...READ, ...WRITE],
      ['SWEEP#*', 'RES#*', 'ROOM#*', 'USER#*'],
    );

    this.syncFn = apiFn(this, 'SyncFn', {
      stage,
      entry: 'syncLambda.ts',
      timeoutSec: 300,
      memoryMb: 1024,
      // ponytail: no reservedConcurrency=1 — new/free-plan accounts have a 10-execution account limit
      // and AWS refuses reservations that leave < 10 unreserved. A run takes ~15s vs a 10-min
      // schedule and every write is idempotent, so overlaps are harmless. Re-add when limit ≥ 100.
      environment: { ...env, TWENTYFIVE_LIVE_SECRET_ARN: data.twentyFiveLive.secretArn },
    });
    grantTable(
      this.syncFn,
      data.table,
      [...READ, ...WRITE],
      ['ROOM#*', 'BLDG#*', 'CATALOG', 'SYNC#*', 'RES#*', 'USER#*', 'MOCK25LIVE'],
    );
    data.twentyFiveLive.grantRead(this.syncFn);

    // No kms:Decrypt here (RevealFn is the only decrypter), so SES email stays off in AWS for v1.
    this.onChangeFn = apiFn(this, 'OnChangeFn', {
      stage,
      entry: 'onChangeLambda.ts',
      timeoutSec: 30,
      environment: env,
    });
    grantTable(this.onChangeFn, data.table, ['GetItem', 'PutItem'], ['USER#*']);
    this.dlq = new Queue(this, 'OnChangeDlq', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });
    this.onChangeFn.addEventSource(
      new DynamoEventSource(data.table, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 10,
        retryAttempts: 2,
        bisectBatchOnError: true,
        onFailure: new SqsDlq(this.dlq),
        // Only audit-event INSERTs are domain events; skip every other write (cost + noise).
        filters: [
          FilterCriteria.filter({
            eventName: FilterRule.isEqual('INSERT'),
            dynamodb: { NewImage: { SK: { S: FilterRule.beginsWith('EVT#') } } },
          }),
        ],
      }),
    );

    const role = new Role(this, 'SchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });
    this.sweeperFn.grantInvoke(role);
    this.syncFn.grantInvoke(role);
    const schedule = (sid: string, fn: NodejsFunction, expression: string, timezone?: string) =>
      new CfnSchedule(this, sid, {
        flexibleTimeWindow: { mode: 'OFF' },
        scheduleExpression: expression,
        scheduleExpressionTimezone: timezone,
        target: {
          arn: fn.functionArn,
          roleArn: role.roleArn,
          retryPolicy: { maximumRetryAttempts: 0 },
        },
        state: 'ENABLED',
      });
    schedule('SweepEveryMinute', this.sweeperFn, 'rate(1 minute)');
    schedule('SyncDaytime', this.syncFn, 'cron(0/10 6-22 * * ? *)', 'America/New_York'); // 06:00–22:50
    schedule('SyncOvernight', this.syncFn, 'cron(0 23,0-5 * * ? *)', 'America/New_York'); // hourly 23:00–05:00
  }
}

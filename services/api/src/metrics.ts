/**
 * Custom metrics via CloudWatch Embedded Metric Format: one JSON line on stdout that Lambda's log
 * pipeline turns into a metric. No SDK call, no agent, no extra latency. Namespace FreeRoom,
 * dimension Stage. Outside Lambda (local dev, tests) nothing is written unless a sink is set.
 */
export const METRIC_NAMESPACE = 'FreeRoom';
export type MetricName =
  | 'ReservationsCreated'
  | 'ClassConflictsBlocked'
  | 'SlotTakenRaces'
  | 'AutoReleases'
  | 'ClaimsApproved'
  | 'SyncSuccess'
  | 'ScheduleStalenessMinutes'
  | 'NotificationFailures';

let sink: ((line: string) => void) | null = process.env.AWS_LAMBDA_FUNCTION_NAME
  ? (l) => process.stdout.write(l + '\n')
  : null;
/** Tests: capture lines (or null to silence). */
export const setMetricSink = (s: ((line: string) => void) | null) => (sink = s);

export function metric(name: MetricName, value = 1, unit: 'Count' | 'None' = 'Count') {
  if (!sink) return;
  sink(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: METRIC_NAMESPACE,
            Dimensions: [['Stage']],
            Metrics: [{ Name: name, Unit: unit }],
          },
        ],
      },
      Stage: process.env.STAGE ?? 'local',
      [name]: value,
    }),
  );
}

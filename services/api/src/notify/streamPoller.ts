/**
 * Local stand-in for the DynamoDB Streams → Lambda trigger: polls DynamoDB Local's stream and feeds
 * onChange in-process, so notifications work in `pnpm dev:api` and integration tests.
 */
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  DescribeStreamCommand,
  DynamoDBStreamsClient,
  GetRecordsCommand,
  GetShardIteratorCommand,
} from '@aws-sdk/client-dynamodb-streams';
import type { Db } from '../data/db';
import { fromStreamRecord, type ChangeRecord } from './onChange';

export function createStreamPoller(
  db: Db,
  endpoint: string,
  handler: (records: ChangeRecord[]) => Promise<unknown>,
  opts: { start?: 'TRIM_HORIZON' | 'LATEST'; onError?: (e: unknown) => void } = {},
) {
  const client = new DynamoDBStreamsClient({
    region: 'us-east-1',
    endpoint,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  const iterators = new Map<string, string | null>();
  let streamArn: string | undefined;
  let first = true;
  let timer: NodeJS.Timeout | undefined;

  async function tick(): Promise<number> {
    streamArn ??= (await db.raw.send(new DescribeTableCommand({ TableName: db.table }))).Table
      ?.LatestStreamArn;
    if (!streamArn) return 0;
    const shards =
      (await client.send(new DescribeStreamCommand({ StreamArn: streamArn }))).StreamDescription
        ?.Shards ?? [];
    for (const s of shards) {
      if (!s.ShardId || iterators.has(s.ShardId)) continue;
      const it = await client.send(
        new GetShardIteratorCommand({
          StreamArn: streamArn,
          ShardId: s.ShardId,
          // Shards found after startup are read from the beginning so nothing is missed.
          ShardIteratorType: first ? (opts.start ?? 'LATEST') : 'TRIM_HORIZON',
        }),
      );
      iterators.set(s.ShardId, it.ShardIterator ?? null);
    }
    first = false;
    let n = 0;
    for (const [id, it] of iterators) {
      if (!it) continue;
      const r = await client.send(new GetRecordsCommand({ ShardIterator: it }));
      iterators.set(id, r.NextShardIterator ?? null);
      if (r.Records?.length) {
        await handler(
          r.Records.map((x) => fromStreamRecord(x as Parameters<typeof fromStreamRecord>[0])),
        );
        n += r.Records.length;
      }
    }
    return n;
  }

  return {
    tick,
    start(intervalMs = 1000) {
      let busy = false;
      timer = setInterval(() => {
        if (busy) return;
        busy = true;
        tick()
          .catch((e) => opts.onError?.(e))
          .finally(() => (busy = false));
      }, intervalMs);
    },
    stop: () => clearInterval(timer),
  };
}

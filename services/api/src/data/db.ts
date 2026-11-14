import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';

export interface Db {
  raw: DynamoDBClient;
  doc: DynamoDBDocumentClient;
  table: string;
}

export function makeDb(opts: { table: string; endpoint?: string; region?: string }): Db {
  const raw = new DynamoDBClient({
    region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1',
    ...(opts.endpoint && {
      endpoint: opts.endpoint,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  });
  const doc = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false },
  });
  return { raw, doc, table: opts.table };
}

export type Item = Record<string, unknown>;

export async function queryAll(
  db: Db,
  input: Omit<QueryCommandInput, 'TableName'>,
): Promise<Item[]> {
  const out: Item[] = [];
  let ExclusiveStartKey: Item | undefined;
  do {
    const r = await db.doc.send(
      new QueryCommand({ ...input, TableName: db.table, ExclusiveStartKey }),
    );
    out.push(...((r.Items ?? []) as Item[]));
    ExclusiveStartKey = r.LastEvaluatedKey as Item | undefined;
  } while (ExclusiveStartKey);
  return out;
}

/** BatchGet in chunks of 100, retrying unprocessed keys. */
export async function batchGet(db: Db, keyList: { PK: string; SK: string }[]): Promise<Item[]> {
  const out: Item[] = [];
  for (let i = 0; i < keyList.length; i += 100) {
    let pending: Item[] | undefined = keyList.slice(i, i + 100);
    for (let attempt = 0; pending?.length && attempt < 8; attempt++) {
      const r = await db.doc.send(
        new BatchGetCommand({ RequestItems: { [db.table]: { Keys: pending } } }),
      );
      out.push(...((r.Responses?.[db.table] ?? []) as Item[]));
      pending = r.UnprocessedKeys?.[db.table]?.Keys as Item[] | undefined;
      if (pending?.length) await new Promise((res) => setTimeout(res, 20 * 2 ** attempt));
    }
  }
  return out;
}

/** Bounded-concurrency map (no dependency needed for a few lines). */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export const ttlFrom = (d: Date, days: number) => Math.floor(d.getTime() / 1000) + days * 86_400;

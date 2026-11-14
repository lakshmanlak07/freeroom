/**
 * Single-table schema, defined ONCE: CDK (infra) and the local/test table creator both use it.
 * Follows (GSI4) and WebSocket items are v1.1 (PRD §0.3).
 */
import {
  CreateTableCommand,
  ResourceInUseException,
  waitUntilTableExists,
  type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';

export const TABLE = {
  partitionKey: 'PK',
  sortKey: 'SK',
  ttlAttribute: 'ttl',
  gsis: [
    { indexName: 'GSI1', partitionKey: 'GSI1PK', sortKey: 'GSI1SK' }, // catalog, room/day reservations
    { indexName: 'GSI2', partitionKey: 'GSI2PK', sortKey: 'GSI2SK' }, // user's reservations / outgoing claims
    { indexName: 'GSI3', partitionKey: 'GSI3PK', sortKey: 'GSI3SK' }, // incoming claims
    // Sparse: only PENDING_CONFIRMATION reservations / PENDING claims carry GSI4 attrs (sweeper).
    { indexName: 'GSI4', partitionKey: 'GSI4PK', sortKey: 'GSI4SK' },
  ],
} as const;

export async function createTableIfMissing(client: DynamoDBClient, tableName: string) {
  const attrs = [
    TABLE.partitionKey,
    TABLE.sortKey,
    ...TABLE.gsis.flatMap((g) => [g.partitionKey, g.sortKey]),
  ];
  try {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: attrs.map((AttributeName) => ({ AttributeName, AttributeType: 'S' })),
        KeySchema: [
          { AttributeName: TABLE.partitionKey, KeyType: 'HASH' },
          { AttributeName: TABLE.sortKey, KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: TABLE.gsis.map((g) => ({
          IndexName: g.indexName,
          KeySchema: [
            { AttributeName: g.partitionKey, KeyType: 'HASH' },
            { AttributeName: g.sortKey, KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        })),
        StreamSpecification: { StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES' },
      }),
    );
  } catch (e) {
    if (!(e instanceof ResourceInUseException)) throw e;
  }
  await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: tableName });
}

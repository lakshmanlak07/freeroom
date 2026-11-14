/** Local/test table creator (DynamoDB Local). Schema lives in ./schema.ts. */
import {
  CreateTableCommand,
  ResourceInUseException,
  waitUntilTableExists,
  type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';

import { TABLE } from './schema';

export { TABLE };

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

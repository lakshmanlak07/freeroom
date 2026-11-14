/**
 * Single-table schema, defined ONCE and dependency-free: CDK (infra/lib/data.ts) and the
 * local/test table creator (data/table.ts) both import it. Follows/WebSocket items are v1.1.
 */
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

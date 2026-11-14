import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Room } from '@freeroom/shared';
import type { SourceBuilding, SourceRoom } from '../twentyfive/source';
import { queryAll, type Db, type Item } from './db';
import { keys } from './keys';

export type CatalogRoom = Room & { twentyFiveLiveId: number };
export interface Catalog {
  buildings: SourceBuilding[];
  rooms: CatalogRoom[];
}

async function batchPut(db: Db, items: Item[]) {
  for (let i = 0; i < items.length; i += 25) {
    let pending = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    for (let attempt = 0; pending.length && attempt < 8; attempt++) {
      const r = await db.doc.send(new BatchWriteCommand({ RequestItems: { [db.table]: pending } }));
      pending = (r.UnprocessedItems?.[db.table] ?? []) as typeof pending;
      if (pending.length) await new Promise((res) => setTimeout(res, 20 * 2 ** attempt));
    }
  }
}

export async function upsertCatalog(db: Db, buildings: SourceBuilding[], rooms: SourceRoom[]) {
  const byId = new Map(buildings.map((b) => [b.buildingId, b]));
  await batchPut(db, [
    ...buildings.map((b) => ({
      ...keys.building(b.buildingId),
      GSI1PK: keys.gsi1.catalog,
      GSI1SK: keys.gsi1.buildingSk(b.buildingId),
      ...b,
    })),
    ...rooms.flatMap((r) => {
      const b = byId.get(r.buildingId);
      if (!b) return [];
      const room: CatalogRoom = {
        roomId: r.roomId,
        buildingId: r.buildingId,
        buildingName: b.name,
        name: r.name,
        capacity: r.capacity,
        equipment: r.equipment,
        lat: b.lat,
        lng: b.lng,
        twentyFiveLiveId: r.twentyFiveLiveId,
      };
      return [
        {
          ...keys.room(r.roomId),
          GSI1PK: keys.gsi1.buildingPk(r.buildingId),
          GSI1SK: keys.gsi1.roomSk(r.roomId),
          ...room,
        },
      ];
    }),
  ]);
  cache.delete(db.table);
}

export async function loadCatalog(db: Db): Promise<Catalog> {
  const bItems = await queryAll(db, {
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :p',
    ExpressionAttributeValues: { ':p': keys.gsi1.catalog },
  });
  const buildings = bItems.map((i) => ({
    buildingId: i.buildingId as string,
    name: i.name as string,
    lat: i.lat as number,
    lng: i.lng as number,
  }));
  const rooms = (
    await Promise.all(
      buildings.map((b) =>
        queryAll(db, {
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :p AND begins_with(GSI1SK, :r)',
          ExpressionAttributeValues: {
            ':p': keys.gsi1.buildingPk(b.buildingId),
            ':r': keys.prefix.room,
          },
        }),
      ),
    )
  )
    .flat()
    .map((i): CatalogRoom => ({
      roomId: i.roomId as string,
      buildingId: i.buildingId as string,
      buildingName: i.buildingName as string,
      name: i.name as string,
      capacity: i.capacity as number,
      equipment: i.equipment as CatalogRoom['equipment'],
      lat: i.lat as number,
      lng: i.lng as number,
      twentyFiveLiveId: i.twentyFiveLiveId as number,
    }));
  return { buildings, rooms };
}

// PRD §6.2: the room set is small, so the catalog is cached in Lambda memory for 5 minutes.
const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: Promise<Catalog> }>();

export function getCatalog(db: Db, nowMs: number): Promise<Catalog> {
  const hit = cache.get(db.table);
  if (hit && nowMs - hit.at < TTL_MS) return hit.value;
  const value = loadCatalog(db);
  cache.set(db.table, { at: nowMs, value });
  value.catch(() => cache.delete(db.table));
  return value;
}

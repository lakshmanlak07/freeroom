/**
 * Natural-language search: Bedrock when configured, the deterministic parser otherwise or on any
 * Bedrock failure. Results are cached for 5 minutes per normalized query.
 */
import type { RoomSearchQuery } from '@freeroom/shared';
import type { Logger } from '../logger';
import { bedrockFilters, type ConverseClient } from './bedrock';
import { parseQuery, type ParseCtx } from './parser';

export type NlSource = 'bedrock' | 'parser';
export interface NlBedrock {
  client: ConverseClient;
  modelId: string;
  timeoutMs?: number;
}
export interface Understood {
  filters: RoomSearchQuery;
  source: NlSource;
}

const TTL_MS = 5 * 60_000;
// ponytail: per-Lambda-instance cache (cold starts and other instances miss); a DynamoDB/TTL
// cache would be shared but costs a read per search — not worth it at campus scale.
const cache = new Map<string, { at: number; value: Understood }>();
export const clearNlCache = () => cache.clear();

export async function understand(
  query: string,
  ctx: ParseCtx,
  bedrock: NlBedrock | undefined,
  log: Logger,
): Promise<Understood> {
  const key = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const hit = cache.get(key);
  if (hit && ctx.now.getTime() - hit.at < TTL_MS) return hit.value;

  let value: Understood | undefined;
  if (bedrock) {
    try {
      const filters = await bedrockFilters(
        bedrock.client,
        bedrock.modelId,
        query,
        ctx,
        bedrock.timeoutMs,
      );
      value = { filters, source: 'bedrock' };
    } catch (e) {
      // Name only: the query text is user input and stays out of logs.
      log.warn('nlsearch.bedrock_fallback', { errorName: (e as Error).name });
    }
  }
  value ??= { filters: parseQuery(query, ctx), source: 'parser' };
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: ctx.now.getTime(), value });
  return value;
}

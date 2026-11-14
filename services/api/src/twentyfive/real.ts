import { overlaps, type ClassEvent } from '@freeroom/domain';
import { CAMPUS_BUILDINGS } from './campus';
import { PATHS, mapReservation, mapSpace, unwrapReservations, unwrapSpaces } from './mapper';
import { HttpError, TokenBucket, parseRetryAfter, withRetry } from './rateLimit';
import type { ScheduleSource, SourceRoom } from './source';

export interface TwentyFiveLiveCreds {
  baseUrl: string;
  username: string;
  password: string;
}

/** Activated only when 25Live credentials exist in Secrets Manager (see createScheduleSource). */
export class RealTwentyFiveLiveSource implements ScheduleSource {
  readonly name = '25live';
  private readonly bucket: TokenBucket;
  private rooms?: SourceRoom[];

  constructor(
    private readonly creds: TwentyFiveLiveCreds,
    private readonly opts: { rps?: number; timeoutMs?: number; fetch?: typeof fetch } = {},
  ) {
    this.bucket = new TokenBucket(opts.rps ?? 5);
  }

  private async get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(this.creds.baseUrl.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const auth = Buffer.from(`${this.creds.username}:${this.creds.password}`).toString('base64');
    const doFetch = this.opts.fetch ?? fetch;
    return withRetry(async () => {
      await this.bucket.take();
      const res = await doFetch(url, {
        headers: { authorization: `Basic ${auth}`, accept: 'application/json' },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
      });
      if (!res.ok) {
        throw new HttpError(
          res.status,
          parseRetryAfter(res.headers.get('retry-after'), Date.now()),
        );
      }
      return res.json();
    });
  }

  async listBuildings() {
    return [...CAMPUS_BUILDINGS];
  }

  async listRooms(): Promise<SourceRoom[]> {
    // TODO(25live): add the schedulable-classroom category filter param (PRD §12.9).
    const spaces = unwrapSpaces(await this.get(PATHS.spaces));
    this.rooms = spaces.map(mapSpace).filter((r): r is SourceRoom => r !== null);
    return this.rooms;
  }

  async listEvents(roomIds: readonly string[], from: Date, to: Date): Promise<ClassEvent[]> {
    const rooms = this.rooms ?? (await this.listRooms());
    const wanted = rooms.filter((r) => roomIds.includes(r.roomId));
    const bySpace = new Map(wanted.map((r) => [r.twentyFiveLiveId, r.roomId]));
    const out: ClassEvent[] = [];
    for (const room of wanted) {
      // TODO(25live): confirm param names (space_id, start_dt, end_dt) and date format.
      const json = await this.get(PATHS.reservations, {
        space_id: String(room.twentyFiveLiveId),
        start_dt: from.toISOString(),
        end_dt: to.toISOString(),
      });
      for (const raw of unwrapReservations(json)) {
        const ev = mapReservation(raw, bySpace);
        if (ev && overlaps(ev, { start: from, end: to })) out.push(ev);
      }
    }
    return out;
  }
}

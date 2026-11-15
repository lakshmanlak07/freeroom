import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { ClassEvent } from '@freeroom/domain';
import type { Equipment } from '@freeroom/shared';
import { createLogger } from '../logger';
import type { SourceBuilding } from './campus';
import { MockSource, type RawReservation } from './mock';
import { RealTwentyFiveLiveSource, type TwentyFiveLiveCreds } from './real';

export type { SourceBuilding };

export interface SourceRoom {
  roomId: string;
  buildingId: string;
  name: string;
  capacity: number;
  equipment: Equipment[];
  twentyFiveLiveId: number;
}

/** Read-only view of 25Live. Everything 25Live-specific stays behind this (PRD §8.1). */
export interface ScheduleSource {
  readonly name: string;
  listBuildings(): Promise<SourceBuilding[]>;
  listRooms(): Promise<SourceRoom[]>;
  listEvents(roomIds: readonly string[], from: Date, to: Date): Promise<ClassEvent[]>;
}

/** Real 25Live when credentials exist in Secrets Manager; otherwise the seeded mock. */
export async function createScheduleSource(opts: {
  secretArn?: string;
  loadInjected?: () => Promise<RawReservation[]>;
}): Promise<ScheduleSource> {
  if (!opts.secretArn) return new MockSource({ loadInjected: opts.loadInjected });
  const secret = await new SecretsManagerClient({}).send(
    new GetSecretValueCommand({ SecretId: opts.secretArn }),
  );
  const creds = JSON.parse(secret.SecretString ?? '{}') as Partial<TwentyFiveLiveCreds>;
  const missing = missingCreds(creds);
  if (missing.length) {
    // Audit H4: never fall back silently. Until UMass IT grants 25Live access every stage runs on
    // the seeded mock campus on purpose; this line (and the "Demo data" badge) makes that visible.
    createLogger({ service: 'schedule-source' }).warn('schedule.mock_source', {
      stage: process.env.STAGE,
      missing,
    });
    return new MockSource({ loadInjected: opts.loadInjected });
  }
  return new RealTwentyFiveLiveSource(creds as TwentyFiveLiveCreds);
}

/** Which 25Live credential fields are absent (names only, never values). */
export const missingCreds = (c: Partial<TwentyFiveLiveCreds>) =>
  (['baseUrl', 'username', 'password'] as const).filter((k) => !c[k]);

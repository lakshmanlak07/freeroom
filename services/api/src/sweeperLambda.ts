/** EventBridge Scheduler target, every minute (PRD §0.2). Also reports schedule staleness. */
import { currentCorrelationId, withCorrelationId } from './correlation';
import { makeDb } from './data/db';
import { createLogger } from './logger';
import { metric } from './metrics';
import { sweep } from './sweeper';
import { lastSuccessfulSyncAt } from './sync/syncSchedule';

const db = makeDb({ table: process.env.TABLE_NAME! });
const base = createLogger({ service: 'sweeper' });

export const handler = () =>
  withCorrelationId(undefined, async () => {
    const now = new Date();
    const log = base.child({ correlationId: currentCorrelationId() });
    const result = await sweep(db, now);
    metric('AutoReleases', result.released);
    if (result.failed)
      log.error('sweep.item_failed', { failed: result.failed, errors: result.errors });
    // Measured here (every minute), not by sync itself, so a dead sync still raises the alarm.
    const last = await lastSuccessfulSyncAt(db);
    const staleness = last ? Math.round((now.getTime() - last.getTime()) / 60_000) : 24 * 60;
    metric('ScheduleStalenessMinutes', staleness, 'None');
    log.info('sweep.finished', { ...result, stalenessMinutes: staleness });
    return result;
  });

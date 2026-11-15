/** Dev only: EventBridge Scheduler every 2 h → reset + re-seed the demo (see demoReset.ts). */
import { currentCorrelationId, withCorrelationId } from './correlation';
import { makeDb } from './data/db';
import { resetDemo } from './demoReset';
import { createLogger } from './logger';
import { loadInjected } from './sync/syncSchedule';
import { createScheduleSource } from './twentyfive/source';

const db = makeDb({ table: process.env.TABLE_NAME! });
const base = createLogger({ service: 'demoReset' });

export const handler = () =>
  withCorrelationId(undefined, async () => {
    // Defense in depth: CDK only creates this function in demo mode, never in prod.
    if (process.env.STAGE === 'prod' || process.env.DEMO_MODE !== 'true') {
      throw new Error('demo reset refused outside demo mode');
    }
    const log = base.child({ correlationId: currentCorrelationId() });
    const source = await createScheduleSource({
      secretArn: process.env.TWENTYFIVE_LIVE_SECRET_ARN,
      loadInjected: () => loadInjected(db),
    });
    const r = await resetDemo({ db, source, now: new Date(), log }, 'schedule');
    log.info('demo.reset', { deleted: r.deleted, seeded: r.seeded.reservations });
    return { deleted: r.deleted, seeded: r.seeded };
  });

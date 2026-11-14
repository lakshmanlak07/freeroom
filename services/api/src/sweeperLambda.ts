/** EventBridge Scheduler target, every minute (PRD §0.2). */
import { makeDb } from './data/db';
import { createLogger } from './logger';
import { sweep } from './sweeper';

const db = makeDb({ table: process.env.TABLE_NAME! });
const log = createLogger({ service: 'sweeper' });

export const handler = async () => {
  const result = await sweep(db, new Date());
  log.info('sweep.finished', result);
  return result;
};

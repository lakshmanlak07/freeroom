/**
 * Correlation id for the current unit of work (HTTP request, sweeper/sync invocation). Stamped on
 * every audit event, so DynamoDB Streams carry it to onChange: API log → EVT item → onChange log
 * all share one id. AsyncLocalStorage avoids threading it through every data-layer call.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const store = new AsyncLocalStorage<string>();
export const currentCorrelationId = () => store.getStore();
export const withCorrelationId = <T>(id: string | undefined, fn: () => T): T =>
  store.run(id ?? randomUUID(), fn);

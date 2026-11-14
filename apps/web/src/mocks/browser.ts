import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { handlersP6 } from './handlersP6';

// P6 handlers first: their more specific routes (e.g. /reservations/:id/confirm) win.
export const worker = setupWorker(...handlersP6, ...handlers);

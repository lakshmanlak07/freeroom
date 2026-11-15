// Imported first in main.tsx: zod decides JIT at schema construction (when @freeroom/shared loads)
// and probes `new Function('')`, which our CSP (no 'unsafe-eval') reports as a violation.
import { config } from 'zod';

config({ jitless: true });

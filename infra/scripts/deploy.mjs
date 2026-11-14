// Usage: pnpm run deploy -- --stage dev|prod   (`pnpm deploy` is a pnpm built-in; use `run`)
import { spawnSync } from 'node:child_process';

const i = process.argv.indexOf('--stage');
const stage = i >= 0 ? process.argv[i + 1] : undefined;
if (stage !== 'dev' && stage !== 'prod') {
  console.error('Usage: pnpm run deploy -- --stage dev|prod');
  process.exit(1);
}
const r = spawnSync('npx', ['cdk', 'deploy', '--context', `stage=${stage}`], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);

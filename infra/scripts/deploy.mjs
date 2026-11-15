// Usage: pnpm run deploy -- --stage dev|prod   (`pnpm deploy` is a pnpm built-in; use `run`)
// build web → cdk deploy → first sync + demo users. Extra args after --stage pass to cdk (e.g. -c alarmEmail=…).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INFRA = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(INFRA, '..');
const args = process.argv.slice(2).filter((a) => a !== '--'); // pnpm passes a literal --
const i = args.indexOf('--stage');
const stage = i >= 0 ? args[i + 1] : undefined;
if (stage !== 'dev' && stage !== 'prod') {
  console.error('Usage: pnpm run deploy -- --stage dev|prod [cdk args]');
  process.exit(1);
}
const extra = args.filter((_, j) => j !== i && j !== i + 1);

const run = (cmd, cmdArgs, cwd) => {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('pnpm', ['--filter', '@freeroom/web', 'build'], ROOT);
run(
  'npx',
  [
    'cdk',
    'deploy',
    '--context',
    `stage=${stage}`,
    '--require-approval',
    'never',
    '--outputs-file',
    `cdk-outputs.${stage}.json`,
    ...extra,
  ],
  INFRA,
);
run('npx', ['tsx', 'scripts/postDeploy.ts', '--stage', stage], INFRA);

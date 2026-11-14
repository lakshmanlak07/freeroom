/**
 * Make sure DynamoDB Local is listening. Order: already running → Docker compose →
 * portable JRE + jar in <repo>/.local (no-Docker machines). Returns a stop function.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function reachable(endpoint: string) {
  try {
    await fetch(endpoint, { signal: AbortSignal.timeout(1000) });
    return true; // any HTTP answer (DynamoDB Local returns 400 to GET) means it's up
  } catch {
    return false;
  }
}

async function waitFor(endpoint: string, ms = 20_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await reachable(endpoint)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`DynamoDB Local did not start at ${endpoint}`);
}

export async function ensureDynamoLocal(endpoint = 'http://localhost:8000'): Promise<() => void> {
  if (await reachable(endpoint)) return () => {};

  const docker = spawnSync('docker', ['compose', 'up', '-d', 'dynamodb'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  if (docker.status === 0) {
    await waitFor(endpoint);
    return () => {};
  }

  const ddbDir = join(ROOT, '.local', 'ddb');
  const jreRoot = join(ROOT, '.local', 'jre');
  const jreDir = existsSync(jreRoot) ? readdirSync(jreRoot)[0] : undefined;
  const java =
    jreDir && join(jreRoot, jreDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (!java || !existsSync(java) || !existsSync(join(ddbDir, 'DynamoDBLocal.jar'))) {
    throw new Error(
      'DynamoDB Local unavailable: install Docker, or put DynamoDBLocal.jar in .local/ddb and a JRE 17+ in .local/jre',
    );
  }
  const port = new URL(endpoint).port || '8000';
  const child = spawn(
    java,
    [
      '-Djava.library.path=./DynamoDBLocal_lib',
      '-jar',
      'DynamoDBLocal.jar',
      '-inMemory',
      '-port',
      port,
    ],
    { cwd: ddbDir, stdio: 'ignore' },
  );
  await waitFor(endpoint);
  return () => child.kill();
}

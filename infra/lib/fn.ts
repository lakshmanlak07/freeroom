import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import type { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement, type IGrantable } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export type Stage = 'dev' | 'prod';

/** Local Vite dev server origins — trusted ONLY in the dev stage (never prod CORS/OAuth/map key). */
export const devOrigins = (stage: Stage, suffix = '') =>
  stage === 'dev' ? [`http://localhost:5173${suffix}`] : [];

export interface FnProps {
  stage: Stage;
  /** File under services/api/src exporting `handler`. */
  entry: string;
  environment?: Record<string, string>;
  timeoutSec?: number;
  memoryMb?: number;
  reservedConcurrency?: number;
}

/** Node 24 (20 is deprecated in Lambda) / ARM64 / esbuild (ESM, so top-level await works) with a 1-month log group. */
export function apiFn(scope: Construct, id: string, p: FnProps): NodejsFunction {
  const logGroup = new LogGroup(scope, `${id}Logs`, {
    retention: RetentionDays.ONE_MONTH,
    removalPolicy: p.stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
  });
  return new NodejsFunction(scope, id, {
    entry: join(ROOT, 'services/api/src', p.entry),
    handler: 'handler',
    runtime: Runtime.NODEJS_24_X,
    architecture: Architecture.ARM_64,
    memorySize: p.memoryMb ?? 512,
    timeout: Duration.seconds(p.timeoutSec ?? 15),
    reservedConcurrentExecutions: p.reservedConcurrency,
    projectRoot: ROOT,
    depsLockFilePath: join(ROOT, 'pnpm-lock.yaml'),
    logGroup,
    environment: { NODE_OPTIONS: '--enable-source-maps', ...p.environment },
    bundling: {
      format: OutputFormat.ESM,
      target: 'node24',
      minify: true,
      sourceMap: true,
      mainFields: ['module', 'main'],
      // CJS deps that call require() need it defined inside an ESM bundle.
      banner:
        "import{createRequire}from'node:module';const require=createRequire(import.meta.url);",
    },
  });
}

export const READ = ['GetItem', 'BatchGetItem', 'Query', 'ConditionCheckItem'];
export const WRITE = ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem'];

/**
 * Least-privilege table access: only the listed actions, only on items/index partitions whose
 * partition key matches one of `leadingKeys` (dynamodb:LeadingKeys).
 */
export function grantTable(
  grantee: IGrantable,
  table: ITable,
  actions: string[],
  leadingKeys: string[],
) {
  grantee.grantPrincipal.addToPrincipalPolicy(
    new PolicyStatement({
      actions: actions.map((a) => `dynamodb:${a}`),
      resources: [table.tableArn, `${table.tableArn}/index/*`],
      conditions: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': leadingKeys } },
    }),
  );
}

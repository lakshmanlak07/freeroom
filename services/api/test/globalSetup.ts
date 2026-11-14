import { ensureDynamoLocal } from '../scripts/ddbLocal';

/** Starts DynamoDB Local (Docker or .local JRE) unless already running (CI service container). */
export default async function setup() {
  return ensureDynamoLocal(process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000');
}

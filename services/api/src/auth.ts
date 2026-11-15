import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { Jwks } from 'aws-jwt-verify/jwk';
import { createHmac } from 'node:crypto';

/** Verified identity from a Cognito ID token. Only `sub` is used; role comes from our DB. */
export type VerifyIdToken = (token: string) => Promise<{ sub: string }>;

export function cognitoVerifier(
  cfg: { userPoolId: string; clientId: string },
  jwks?: Jwks,
): VerifyIdToken {
  const verifier = CognitoJwtVerifier.create({
    userPoolId: cfg.userPoolId,
    clientId: cfg.clientId,
    tokenUse: 'id',
  });
  if (jwks) verifier.cacheJwks(jwks);
  return async (token) => ({ sub: (await verifier.verify(token)).sub });
}

/** UID pepper from Secrets Manager, fetched once per container. */
export function secretsManagerPepper(secretArn: string): () => Promise<string> {
  let cached: Promise<string> | undefined;
  return () => {
    cached ??= new SecretsManagerClient({})
      .send(new GetSecretValueCommand({ SecretId: secretArn }))
      .then((r) => {
        if (!r.SecretString) throw new Error(`Secret ${secretArn.split(':').pop()} is empty`);
        return r.SecretString;
      });
    cached.catch(() => (cached = undefined));
    return cached;
  };
}

/** HMAC-SHA256(pepper, normalized University ID). The raw ID is never stored, logged, or returned. */
export const hashUniversityId = (pepper: string, universityId: string) =>
  createHmac('sha256', pepper).update(universityId.trim().toUpperCase()).digest('hex');

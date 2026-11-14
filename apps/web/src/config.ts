import { createContext, useContext } from 'react';

/** Runtime config written by CDK to /config.json (never baked into the bundle). */
export interface AppConfig {
  apiUrl: string;
  region: string;
  userPoolId?: string;
  clientId?: string;
  mapName?: string;
  mapApiKey?: string;
  demoMode: boolean;
}

const LOCAL: AppConfig = { apiUrl: 'http://localhost:3001', region: 'us-east-1', demoMode: true };

export async function loadConfig(): Promise<AppConfig> {
  try {
    const r = await fetch('/config.json', { cache: 'no-store' });
    if (r.ok && r.headers.get('content-type')?.includes('json')) {
      return { ...LOCAL, ...((await r.json()) as Partial<AppConfig>) };
    }
  } catch {
    // fall through to local defaults
  }
  return LOCAL;
}

/** Cognito when the deployment provides a pool; otherwise the dev `x-dev-user` header (local API / MSW). */
export const usesCognito = (c: AppConfig) => !!(c.userPoolId && c.clientId);

export const ConfigContext = createContext<AppConfig>(LOCAL);
export const useConfig = () => useContext(ConfigContext);

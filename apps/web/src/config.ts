import { createContext, useContext } from 'react';

/** Runtime config written by CDK to /config.json (never baked into the bundle). */
export interface AppConfig {
  apiUrl: string;
  region: string;
  userPoolId?: string;
  clientId?: string;
  mapApiKey?: string;
  demoMode: boolean;
  /** Prod only: the public demo site for the landing page's "Try the live demo". */
  demoUrl?: string;
  /** Feature flags: on in dev, off in prod until approved. */
  features?: { directions?: boolean; invites?: boolean };
}

/** Local: same-origin /api, proxied by Vite to the local API (deployed: CloudFront /api/*). */
const LOCAL: AppConfig = {
  apiUrl: '/api',
  region: 'us-east-1',
  demoMode: true,
  features: { directions: true, invites: true },
};

/** Feature flag helper (missing config = off). */
export const useFeature = (name: 'directions' | 'invites') => !!useConfig().features?.[name];

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

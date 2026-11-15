/**
 * Session + profile. Two modes:
 *  - cognito: Amplify SRP sign-in (loaded lazily only when the deployment has a user pool)
 *  - dev: the API's `x-dev-user` header (local API on :3001 and MSW mocks only)
 */
import type { MeResponse } from '@freeroom/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router';
import { ApiError, createApi, type Api } from '../api/client';
import { useConfig, usesCognito, type AppConfig } from '../config';
import { onMeFailure, signInPathFor } from './session';

type Status = 'loading' | 'signedOut' | 'needsRegistration' | 'ready' | 'error';

interface AuthState {
  status: Status;
  me: MeResponse | null;
  mode: 'cognito' | 'dev';
  api: Api;
  signIn(email: string, password: string): Promise<void>;
  signInDev(userId: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  confirmSignUp(email: string, code: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
};

const DEV_KEY = 'freeroom.devUser';
const store = {
  get: () => {
    try {
      return sessionStorage.getItem(DEV_KEY);
    } catch {
      return null;
    }
  },
  set: (v: string | null) => {
    try {
      if (v) sessionStorage.setItem(DEV_KEY, v);
      else sessionStorage.removeItem(DEV_KEY);
    } catch {
      // storage blocked: session lasts for this page only
    }
  },
};

let amplifyReady: Promise<typeof import('aws-amplify/auth')> | undefined;
function amplify(config: AppConfig) {
  amplifyReady ??= (async () => {
    const { Amplify } = await import('aws-amplify');
    Amplify.configure({
      Auth: { Cognito: { userPoolId: config.userPoolId!, userPoolClientId: config.clientId! } },
    });
    return import('aws-amplify/auth');
  })();
  return amplifyReady;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  // Audit M4: query keys don't carry the user, so a new session must start from an empty cache.
  const queryClient = useQueryClient();
  const mode = usesCognito(config) ? 'cognito' : 'dev';
  const [devUser, setDevUser] = useState<string | null>(() =>
    mode === 'dev' ? store.get() : null,
  );
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);

  const api = useMemo(
    () =>
      createApi(config.apiUrl, async (): Promise<Record<string, string>> => {
        if (mode === 'dev') return devUser ? { 'x-dev-user': devUser } : {};
        const auth = await amplify(config);
        const token = (await auth.fetchAuthSession()).tokens?.idToken?.toString();
        return token ? { authorization: `Bearer ${token}` } : {};
      }),
    [config, mode, devUser],
  );

  const refresh = useCallback(async () => {
    const signedIn =
      mode === 'dev'
        ? !!devUser
        : await amplify(config)
            .then((a) => a.getCurrentUser())
            .then(
              () => true,
              () => false,
            );
    if (!signedIn) {
      setMe(null);
      setStatus('signedOut');
      return;
    }
    // Session exists (e.g. restored on a hard reload / deep link): load the profile, retrying
    // transient failures instead of bouncing the user to /welcome.
    for (let attempt = 0; ; attempt++) {
      try {
        const profile = await api.me();
        setMe(profile);
        setStatus(profile ? 'ready' : 'needsRegistration');
        return;
      } catch (e) {
        const http = e instanceof ApiError ? e.status : undefined;
        const next = onMeFailure(attempt, http);
        if (next === 'retry') {
          if (mode === 'cognito' && http === 401) {
            await amplify(config)
              .then((a) => a.fetchAuthSession({ forceRefresh: true }))
              .catch(() => undefined);
          }
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
        if (next === 'signedOut') {
          setMe(null);
          setStatus('signedOut');
        } else setStatus('error');
        return;
      }
    }
  }, [api, config, devUser, mode]);

  useEffect(() => {
    refresh().catch(() => setStatus('error')); // never silently sign out a restored session
  }, [refresh]);

  const value: AuthState = {
    status,
    me,
    mode,
    api,
    refresh,
    async signInDev(userId) {
      queryClient.clear();
      store.set(userId);
      setStatus('loading');
      setDevUser(userId); // refresh runs via effect
    },
    async signIn(email, password) {
      const auth = await amplify(config);
      queryClient.clear();
      const r = await auth.signIn({ username: email, password });
      if (!r.isSignedIn) throw new Error(`Additional step required: ${r.nextStep.signInStep}`);
      await refresh();
    },
    async signUp(email, password) {
      const auth = await amplify(config);
      await auth.signUp({ username: email, password, options: { userAttributes: { email } } });
    },
    async confirmSignUp(email, code, password) {
      const auth = await amplify(config);
      await auth.confirmSignUp({ username: email, confirmationCode: code });
      await value.signIn(email, password);
    },
    async signOut() {
      if (mode === 'cognito') await (await amplify(config)).signOut();
      queryClient.clear();
      store.set(null);
      setDevUser(null);
      setMe(null);
      setStatus('signedOut');
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center bg-cream" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-muted">
        <span className="size-5 animate-spin rounded-full border-2 border-sand border-t-brown" />
        Loading FreeRoom…
      </div>
    </div>
  );
}

/** Signed out → /login. Signed in but unregistered → /register. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, refresh } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'error') {
    return (
      <div className="grid min-h-dvh place-items-center bg-cream p-6" role="alert">
        <div className="max-w-sm text-center">
          <p className="text-lg font-semibold">We couldn’t load your profile</p>
          <p className="mt-1 text-sm text-muted">You’re still signed in. Check your connection.</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-4 rounded-xl bg-brown px-4 py-2 font-semibold text-white"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (status === 'signedOut') {
    // Deep links come back here after sign-in (LoginPage honours state.from).
    return <Navigate to={signInPathFor(location.pathname)} replace state={{ from: location }} />;
  }
  if (status === 'needsRegistration') return <Navigate to="/register" replace />;
  return <>{children}</>;
}

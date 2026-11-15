/**
 * Session decisions, pure so they're unit-testable. A Cognito session restored on hard reload
 * must not be thrown away because one /me call failed (cold start, token mid-refresh): retry
 * first, sign out only on a persistent 401, otherwise show a retry screen.
 */
export type MeFailure = 'retry' | 'signedOut' | 'error';
export const ME_RETRIES = 2;

export function onMeFailure(attempt: number, httpStatus: number | undefined): MeFailure {
  if (attempt < ME_RETRIES) return 'retry';
  return httpStatus === 401 ? 'signedOut' : 'error';
}

/** Deep links (/map, /rooms/…) go to sign-in and come back; the bare root gets the landing page. */
export const signInPathFor = (pathname: string) => (pathname === '/' ? '/welcome' : '/login');

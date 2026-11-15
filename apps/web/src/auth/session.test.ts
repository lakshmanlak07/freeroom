import { describe, expect, it } from 'vitest';
import { onMeFailure, signInPathFor } from './session';

describe('session restore on hard reload / deep link', () => {
  it('retries /me failures before deciding', () => {
    expect(onMeFailure(0, 401)).toBe('retry');
    expect(onMeFailure(1, 503)).toBe('retry');
    expect(onMeFailure(0, undefined)).toBe('retry'); // network error
  });
  it('signs out only on a persistent 401; anything else keeps the session', () => {
    expect(onMeFailure(2, 401)).toBe('signedOut');
    expect(onMeFailure(2, 503)).toBe('error');
    expect(onMeFailure(2, undefined)).toBe('error');
  });
  it('deep links go to sign-in (and come back); the root gets the landing page', () => {
    expect(signInPathFor('/map')).toBe('/login');
    expect(signInPathFor('/rooms/LGRT-0101')).toBe('/login');
    expect(signInPathFor('/')).toBe('/welcome');
  });
});

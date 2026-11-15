/**
 * Light / Dark / System. The choice lives in localStorage (best effort: private windows can
 * throw) and is applied as `html.dark`. public/theme-init.js applies it before first paint with
 * the same key and rules, so there is no light flash (and no inline script under our CSP).
 */
import { useEffect, useSyncExternalStore } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
export const THEME_KEY = 'freeroom.theme';
const EVENT = 'freeroom:theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export const resolveTheme = (pref: ThemePref, systemDark: boolean): 'light' | 'dark' =>
  pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function setPref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // storage blocked: still applies for this page view
  }
  current = pref;
  apply(pref);
  window.dispatchEvent(new Event(EVENT));
}

function apply(pref: ThemePref) {
  document.documentElement.classList.toggle('dark', resolveTheme(pref, media().matches) === 'dark');
}

let current: ThemePref | null = null;
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  media().addEventListener('change', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    media().removeEventListener('change', cb);
  };
}

/** The stored preference and the theme actually showing (follows the OS while on System). */
export function useTheme() {
  const pref = useSyncExternalStore(subscribe, () => (current ??= readPref()));
  const systemDark = useSyncExternalStore(subscribe, () => media().matches);
  const theme = resolveTheme(pref, systemDark);
  useEffect(() => apply(pref), [pref, systemDark]);
  return { pref, theme, setPref };
}

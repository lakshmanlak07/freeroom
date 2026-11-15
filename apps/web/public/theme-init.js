/* global document, window */
// Runs before first paint (render-blocking, same-origin: CSP script-src 'self'). Mirrors
// src/lib/theme.ts: localStorage 'freeroom.theme' = light | dark, otherwise follow the OS.
(function () {
  var pref = null;
  try {
    pref = localStorage.getItem('freeroom.theme');
  } catch {
    /* storage blocked */
  }
  var dark =
    pref === 'dark' ||
    (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
})();

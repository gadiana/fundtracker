// Applies the saved light/dark mode and accent color before the page first paints, so it never
// flashes the wrong colors. The same choice is managed in the app by src/lib/theme.ts.
(function () {
  var theme = {};
  try {
    theme = JSON.parse(localStorage.getItem('sft-theme') || '{}') || {};
  } catch (e) {}
  var dark = theme.mode === 'dark' || (theme.mode !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  root.setAttribute('data-mode', dark ? 'dark' : 'light');
  root.setAttribute('data-accent', theme.accent || 'indigo');
})();

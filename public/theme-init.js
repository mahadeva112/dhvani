/*
 * Applies the saved theme before the app renders, so there is no flash of the
 * wrong background on load.
 *
 * This lives in its own file rather than inline in index.html so the Content
 * Security Policy can stay at `script-src 'self'` with no 'unsafe-inline'.
 */
(function () {
  try {
    var savedMode = localStorage.getItem('dhvani_theme_mode');
    var legacy = localStorage.getItem('dhvani_theme');
    var mode = savedMode || legacy || 'auto';
    var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var isDark = mode === 'dark' || (mode === 'auto' && systemDark);

    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch (e) {
    // Private mode or blocked storage: fall through to the markup default.
  }
})();

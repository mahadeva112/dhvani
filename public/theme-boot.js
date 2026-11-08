// The picked theme (components/theme.ts), set before the first paint so the app
// never flashes the other one. A file of its own: the server's CSP refuses inline scripts.
try {
  if (localStorage.getItem('dhvani_theme') === 'graphite') document.documentElement.dataset.theme = 'graphite';
} catch (e) {}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/**
 * Ctrl/Cmd + A selects text only inside a text box. Anywhere else the browser
 * would paint the whole app blue (every label, button and list), so it is
 * stopped here. A screen that gives Ctrl + A its own meaning (the Edit timing
 * timeline selects every clip) handles it first and is not affected.
 */
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'a') return;
  const target = e.target as HTMLElement | null;
  const editable =
    !!target &&
    (target.isContentEditable || !!target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
  if (!editable) e.preventDefault();
});

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
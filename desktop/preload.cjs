const { contextBridge, ipcRenderer } = require('electron');

/**
 * The page's only door into the desktop shell: app updates, nothing else.
 *
 * The window stays sandboxed with no Node. These five calls are all the page
 * can reach, and each one only asks the main process to act on the updater it
 * already owns. Browser and Docker builds have no preload, so
 * `window.dhvaniUpdates` is simply absent there and the UI hides itself.
 */
contextBridge.exposeInMainWorld('dhvaniUpdates', {
  getState: () => ipcRenderer.invoke('updates:get-state'),
  check: () => ipcRenderer.invoke('updates:check'),
  download: () => ipcRenderer.invoke('updates:download'),
  install: () => ipcRenderer.invoke('updates:install'),
  /** Builds that cannot install: show the downloaded new version in its folder. */
  showDownload: () => ipcRenderer.invoke('updates:show-download'),
  /** Calls back with every state change; returns the unsubscribe. */
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('updates:state', listener);
    return () => ipcRenderer.removeListener('updates:state', listener);
  },
  /** The Help menu's "Check for Updates…" asks the page to open its window. */
  onOpenRequest: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('updates:open', listener);
    return () => ipcRenderer.removeListener('updates:open', listener);
  },
});

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddybar', {
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onFocusSession: (cb) => ipcRenderer.on('focus-session', (_e, id) => cb(id)),
  resize: (width, height) => ipcRenderer.send('resize', { width, height }),
  decide: (requestId, decision) => ipcRenderer.send('decide', { requestId, decision }),
  dismiss: (id) => ipcRenderer.send('dismiss', id),
  openEditor: (id) => ipcRenderer.send('open-editor', id),
  menu: () => ipcRenderer.send('menu'),
  focus: () => ipcRenderer.send('focus'),
  hooksInstalled: () => ipcRenderer.invoke('hooks-installed'),
  installHooks: () => ipcRenderer.send('install-hooks'),
});

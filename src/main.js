'use strict';

const path = require('path');
const {
  app, BrowserWindow, ipcMain, screen, shell, Menu, Notification, globalShortcut, dialog,
} = require('electron');
const { SessionStore } = require('./sessions');
const { createServer } = require('./server');
const { readConfig, getToken, CONFIG_FILE } = require('./config');
const hooks = require('../scripts/hooks-setup');

const MARGIN = 12;
const isMac = process.platform === 'darwin';

let win = null;
let config = readConfig();
const store = new SessionStore();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: 220,
    height: 72,
    x: workArea.x + workArea.width - 220 - MARGIN,
    y: workArea.y + MARGIN,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    focusable: true,
    acceptFirstMouse: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, isMac ? 'floating' : 'screen-saver');
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    win.showInactive();
    pushState();
  });
}

function pushState() {
  if (win && !win.isDestroyed()) win.webContents.send('state', store.snapshot());
}

/** Keep the window glued to the top-right corner while its content grows/shrinks. */
function fitTo(width, height) {
  if (!win) return;
  const display = screen.getDisplayMatching(win.getBounds());
  const { workArea } = display;
  const w = Math.min(Math.ceil(width), workArea.width - MARGIN * 2);
  const h = Math.min(Math.ceil(height), workArea.height - MARGIN * 2);
  win.setBounds({ x: workArea.x + workArea.width - w - MARGIN, y: workArea.y + MARGIN, width: w, height: h });
}

function editorUrl(session) {
  const scheme = {
    vscode: 'vscode',
    'vscode-insiders': 'vscode-insiders',
    cursor: 'cursor',
    windsurf: 'windsurf',
  }[session.editor || config.editor] || 'vscode';
  let p = session.cwd.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p; // C:/x -> /C:/x
  return `${scheme}://file${encodeURI(p)}`;
}

function showMenu() {
  const installed = hooks.isInstalled();
  const menu = Menu.buildFromTemplate([
    { label: 'Buddybar', enabled: false },
    { type: 'separator' },
    installed
      ? { label: 'Claude Code hooks: installed ✓', enabled: false }
      : { label: 'Install Claude Code hooks…', click: installHooks },
    installed ? { label: 'Remove Claude Code hooks', click: removeHooks } : null,
    { label: 'Clear finished sessions', click: () => {
      for (const s of store.snapshot()) if (s.status === 'ended' || s.status === 'idle') store.dismiss(s.id);
    } },
    { label: 'Open settings file', click: () => shell.openPath(CONFIG_FILE) },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: 'Hide (Ctrl/Cmd+Alt+Shift+H to show)', click: () => win.hide() },
    { label: 'Quit Buddybar', role: 'quit' },
  ].filter(Boolean));
  menu.popup({ window: win });
}

async function installHooks() {
  try {
    const file = hooks.install({ port: config.port });
    await dialog.showMessageBox(win, {
      type: 'info',
      message: 'Hooks installed',
      detail: `Buddybar hooks were added to:\n${file}\n\nNew Claude Code sessions will show up in Buddybar.`,
    });
  } catch (e) {
    dialog.showErrorBox('Could not install hooks', String(e.message || e));
  }
}

function removeHooks() {
  try {
    hooks.uninstall();
  } catch (e) {
    dialog.showErrorBox('Could not remove hooks', String(e.message || e));
  }
}

function notifyAttention(session) {
  if (!config.notifications || !Notification.isSupported()) return;
  const p = session.pending || {};
  const n = new Notification({
    title: `${session.name} needs you`,
    body: p.kind === 'question'
      ? (p.questions[0] && p.questions[0].question) || 'Claude has a question'
      : `Allow ${p.tool}${p.text ? ': ' + p.text : ''}?`,
    silent: false,
  });
  n.on('click', () => {
    win.showInactive();
    win.webContents.send('focus-session', session.id);
  });
  n.show();
}

function registerIpc() {
  ipcMain.on('resize', (_e, { width, height }) => fitTo(width, height));
  ipcMain.on('decide', (_e, { requestId, decision }) => store.decide(requestId, decision));
  ipcMain.on('dismiss', (_e, id) => store.dismiss(id));
  ipcMain.on('menu', () => showMenu());
  ipcMain.on('open-editor', (_e, id) => {
    const s = store.sessions.get(id);
    if (s && s.cwd) shell.openExternal(editorUrl(s));
  });
  ipcMain.on('focus', () => win && win.focus());
  ipcMain.handle('hooks-installed', () => hooks.isInstalled());
  ipcMain.on('install-hooks', () => installHooks().then(pushState));
}

app.whenReady().then(async () => {
  if (isMac && app.dock) app.dock.hide();
  if (process.platform === 'win32') app.setAppUserModelId('dev.buddybar.app');

  registerIpc();
  createWindow();

  let pushTimer = null;
  store.on('change', () => {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushState, 30);
  });
  store.on('attention', notifyAttention);

  globalShortcut.register('CommandOrControl+Alt+Shift+H', () => {
    if (win.isVisible()) win.hide();
    else win.showInactive();
  });

  try {
    await createServer({ store, token: getToken(), port: config.port, waitSeconds: config.waitSeconds });
  } catch (e) {
    dialog.showErrorBox(
      'Buddybar',
      `Could not listen on 127.0.0.1:${config.port} (${e.code || e.message}).\n` +
        'Is another Buddybar already running? You can change the port in ~/.buddybar/config.json.'
    );
    app.quit();
  }
});

app.on('second-instance', () => win && win.showInactive());
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());

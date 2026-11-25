// Klaar — Electron main process
const {
  app, BrowserWindow, ipcMain, shell, Menu, Tray, nativeImage, nativeTheme, session, globalShortcut, screen
} = require('electron');
const path = require('path');
const fs = require('fs');
const { MicrosoftAccount } = require('./ms-main');

const USER = () => app.getPath('userData');
const DATA_FILE = () => path.join(USER(), 'klaar-data.json');
const STATE_FILE = () => path.join(USER(), 'window-state.json');
const DESKTOP_FILE = () => path.join(USER(), 'desktop-settings.json');
const ICON = path.join(__dirname, 'build', 'icon.png');
const startHidden = process.argv.includes('--hidden');
const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;

let win = null;
let quickWin = null;
let tray = null;
let ms = null;
let quitting = false;
let desktop = {
  tray: true,
  closeToTray: false,
  openAtLogin: false,
  hotkey: 'CommandOrControl+Alt+K',
  autoUpdate: true
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
}

if (process.platform === 'win32') app.setAppUserModelId('nl.zijlstra.klaar');

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSONAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, file + '.bak'); } catch { /* ignore */ }
  }
  fs.renameSync(tmp, file);
}

function lockDown(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
}

const webPrefs = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: true,
  // keep reminders and sync running while the window is hidden in the tray
  backgroundThrottling: false
};

// ---------------- main window ----------------
function createWindow() {
  const state = readJSON(STATE_FILE(), { width: 1200, height: 780 });
  win = new BrowserWindow({
    width: state.width || 1200,
    height: state.height || 780,
    x: state.x,
    y: state.y,
    minWidth: 420,
    minHeight: 480,
    title: 'Klaar',
    icon: ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#faf9f8',
    autoHideMenuBar: true,
    show: false,
    webPreferences: webPrefs
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => {
    if (!(startHidden && desktop.tray)) win.show();
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  lockDown(win.webContents);

  const saveState = () => {
    if (!win || win.isDestroyed()) return;
    try {
      writeJSONAtomic(STATE_FILE(), { ...win.getNormalBounds(), maximized: win.isMaximized() });
    } catch { /* ignore */ }
  };
  win.on('close', (e) => {
    saveState();
    if (!quitting && desktop.tray && desktop.closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
}

function showMain() {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------------- quick add window ----------------
function openQuickAdd() {
  if (quickWin && !quickWin.isDestroyed()) {
    quickWin.show();
    quickWin.focus();
    return;
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const w = 560;
  quickWin = new BrowserWindow({
    width: w,
    height: 132,
    x: Math.round(display.workArea.x + (display.workArea.width - w) / 2),
    y: Math.round(display.workArea.y + display.workArea.height * 0.22),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: webPrefs
  });
  quickWin.loadFile(path.join(__dirname, 'src', 'quickadd.html'));
  lockDown(quickWin.webContents);
  quickWin.once('ready-to-show', () => { quickWin.show(); quickWin.focus(); });
  quickWin.on('blur', () => { if (quickWin && !quickWin.isDestroyed()) quickWin.close(); });
  quickWin.on('closed', () => { quickWin = null; });
}

// ---------------- tray ----------------
function trayIcon() {
  const img = nativeImage.createFromPath(ICON);
  return img.resize({ width: process.platform === 'darwin' ? 18 : 16, quality: 'best' });
}

function updateTray() {
  if (!desktop.tray) {
    if (tray) { tray.destroy(); tray = null; }
    return;
  }
  if (!tray) {
    tray = new Tray(trayIcon());
    tray.setToolTip('Klaar');
    tray.on('click', () => (win && win.isVisible() && win.isFocused() ? win.hide() : showMain()));
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Klaar openen', click: showMain },
    { label: `Snel een taak toevoegen${desktop.hotkey ? '   (' + prettyKey(desktop.hotkey) + ')' : ''}`, click: openQuickAdd },
    { type: 'separator' },
    { label: 'Afsluiten', click: () => { quitting = true; app.quit(); } }
  ]));
}

function prettyKey(acc) {
  return acc.replace('CommandOrControl', process.platform === 'darwin' ? '⌘' : 'Ctrl');
}

// ---------------- hotkey, autostart ----------------
function registerHotkey() {
  globalShortcut.unregisterAll();
  if (!desktop.hotkey) return true;
  try {
    return globalShortcut.register(desktop.hotkey, openQuickAdd);
  } catch {
    return false;
  }
}

function applyLoginItem() {
  if (process.platform === 'linux' || isPortable) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!desktop.openAtLogin, args: ['--hidden'] });
  } catch { /* ignore */ }
}

// ---------------- auto update ----------------
let updater = null;
function setupUpdater() {
  if (!app.isPackaged || isPortable || process.platform === 'darwin' || !desktop.autoUpdate) return;
  try {
    updater = require('electron-updater').autoUpdater;
  } catch {
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  const send = (status, info) => { if (win && !win.isDestroyed()) win.webContents.send('update:status', { status, version: info && info.version }); };
  updater.on('update-available', (i) => send('downloading', i));
  updater.on('update-downloaded', (i) => send('ready', i));
  updater.on('error', () => send('error'));
  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 10000);
  setInterval(check, 6 * 3600 * 1000);
}

// ---------------- IPC ----------------
// Only accept IPC from our own pages
const fromApp = (e) => {
  try {
    return new URL(e.senderFrame.url).protocol === 'file:';
  } catch {
    return false;
  }
};
const guard = (fn) => (e, ...args) => (fromApp(e) ? fn(...args) : null);

ipcMain.handle('data:load', guard(() => readJSON(DATA_FILE(), null)));
ipcMain.handle('data:save', guard((data) => {
  if (!data || typeof data !== 'object' || !Array.isArray(data.tasks) || !Array.isArray(data.lists)) return false;
  writeJSONAtomic(DATA_FILE(), data);
  return true;
}));
ipcMain.handle('data:path', guard(() => DATA_FILE()));
ipcMain.handle('app:version', guard(() => app.getVersion()));
ipcMain.on('app:focus', (e) => { if (fromApp(e)) showMain(); });

ipcMain.handle('desktop:get', guard(() => ({
  ...desktop,
  platform: process.platform,
  portable: isPortable,
  canAutostart: process.platform !== 'linux' && !isPortable,
  canUpdate: app.isPackaged && !isPortable && process.platform !== 'darwin'
})));
ipcMain.handle('desktop:set', guard((patch) => {
  const allowed = ['tray', 'closeToTray', 'openAtLogin', 'hotkey', 'autoUpdate'];
  for (const k of allowed) {
    if (patch && k in patch) desktop[k] = k === 'hotkey' ? String(patch[k] || '').slice(0, 60) : !!patch[k];
  }
  try { writeJSONAtomic(DESKTOP_FILE(), desktop); } catch { /* ignore */ }
  updateTray();
  applyLoginItem();
  return { hotkeyOk: registerHotkey() };
}));

ipcMain.on('quickadd:submit', (e, text) => {
  if (!fromApp(e) || typeof text !== 'string' || !text.trim()) return;
  if (!win) createWindow();
  const deliver = () => win.webContents.send('quickadd:task', text.trim().slice(0, 1000));
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', deliver);
  else deliver();
  if (quickWin && !quickWin.isDestroyed()) quickWin.close();
});
ipcMain.on('quickadd:close', (e) => { if (fromApp(e) && quickWin && !quickWin.isDestroyed()) quickWin.close(); });
ipcMain.on('update:install', (e) => {
  if (fromApp(e) && updater) { quitting = true; updater.quitAndInstall(); }
});

// Microsoft
ipcMain.handle('ms:status', guard(async () => ({
  clientId: ms.clientId,
  account: ms.describe(await ms.account().catch(() => null))
})));
ipcMain.handle('ms:login', guard(async (clientId) => {
  try {
    return { ok: true, account: await ms.login(clientId) };
  } catch (err) {
    return { ok: false, error: String((err && (err.errorCode || err.message)) || err) };
  }
}));
ipcMain.handle('ms:logout', guard(async () => { await ms.logout(); return true; }));
ipcMain.handle('ms:graph', guard((req) => ms.graph(req || {})));

// ---------------- menu ----------------
function buildMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'Beeld',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'notifications'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'notifications');
  desktop = { ...desktop, ...readJSON(DESKTOP_FILE(), {}) };
  ms = new MicrosoftAccount(USER());
  buildMenu();
  createWindow();
  updateTray();
  registerHotkey();
  applyLoginItem();
  setupUpdater();
  app.on('activate', showMain);
});

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !(desktop.tray && desktop.closeToTray)) app.quit();
});

// Klaar — Electron main process
const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme, session } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_FILE = () => path.join(app.getPath('userData'), 'klaar-data.json');
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');

let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
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
  // keep one backup of the previous version
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, file + '.bak'); } catch { /* ignore */ }
  }
  fs.renameSync(tmp, file);
}

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
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#faf9f8',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });
  if (state.maximized) win.maximize();

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Open external links in the default browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The app never navigates away from its own page
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  const saveState = () => {
    if (!win || win.isDestroyed()) return;
    const b = win.getNormalBounds();
    try {
      writeJSONAtomic(STATE_FILE(), { ...b, maximized: win.isMaximized() });
    } catch { /* ignore */ }
  };
  win.on('close', saveState);
  win.on('closed', () => { win = null; });
}

// ---- IPC: storage ----
ipcMain.handle('data:load', (e) => (fromApp(e) ? readJSON(DATA_FILE(), null) : null));
// Only accept IPC from our own page
const fromApp = (e) => {
  try {
    return new URL(e.senderFrame.url).protocol === 'file:';
  } catch {
    return false;
  }
};
ipcMain.handle('data:save', (e, data) => {
  if (!fromApp(e)) return false;
  if (!data || typeof data !== 'object' || !Array.isArray(data.tasks) || !Array.isArray(data.lists)) return false;
  writeJSONAtomic(DATA_FILE(), data);
  return true;
});
ipcMain.handle('data:path', () => DATA_FILE());
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.on('app:focus', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

// Minimal menu (keeps standard shortcuts like copy/paste working on macOS)
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
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
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // Only notifications are allowed; camera, microphone, location etc. are always denied
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'notifications'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'notifications');
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

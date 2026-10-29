'use strict';

const path = require('path');
const {
  app,
  BrowserWindow,
  Menu,
  shell,
  dialog
} = require('electron');
const { loadConfig, saveConfig, appBaseDir } = require('./src/main/config');
const { registerIpc } = require('./src/main/ipc');
const { stopAllPreviews } = require('./src/main/preview');
const aurora = require('./src/main/aurora');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

const CONFIG_BASE = appBaseDir();
let config = loadConfig(CONFIG_BASE);
let mainWindow = null;
let ipc = null;

function getWindow() {
  return mainWindow;
}

function getConfig() {
  return config;
}

function setConfig(next) {
  config = next;
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  const maximized = mainWindow.isMaximized();
  config = { ...config, window: { ...config.window, ...bounds, maximized } };
  try {
    saveConfig(CONFIG_BASE, config);
  } catch {}
}

function createWindow() {
  const winConfig = config.window || {};
  mainWindow = new BrowserWindow({
    width: Math.max(960, winConfig.width || 1420),
    height: Math.max(640, winConfig.height || 900),
    x: winConfig.x,
    y: winConfig.y,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0f17',
    title: 'Northern Editor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  const showFallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      if (winConfig.maximized) mainWindow.maximize();
      mainWindow.show();
    }
  }, 1500);
  mainWindow.once('ready-to-show', () => {
    clearTimeout(showFallback);
    if (winConfig.maximized) mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('close', saveWindowState);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New project',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('menu:new-project')
        },
        {
          label: 'Open project folder...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              title: 'Open an Aurora3DS project',
              properties: ['openDirectory']
            });
            if (!result.canceled && result.filePaths[0]) {
              send('menu:open-project', result.filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => send('menu:settings')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Project',
      submenu: [
        {
          label: 'Save file',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('menu:save')
        },
        {
          label: 'Build',
          accelerator: 'CmdOrCtrl+B',
          click: () => send('menu:build')
        },
        {
          label: 'Run in PC preview',
          accelerator: 'CmdOrCtrl+R',
          click: () => send('menu:run')
        },
        {
          label: 'Run in 3DS emulator',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => send('menu:run-emulator')
        },
        { type: 'separator' },
        {
          label: 'App info (name, entry file)',
          accelerator: 'CmdOrCtrl+I',
          click: () => send('menu:app-info')
        },
        {
          label: 'Editor',
          accelerator: 'Alt+1',
          click: () => send('menu:mode', 'editor')
        },
        {
          label: 'Painter',
          accelerator: 'Alt+2',
          click: () => send('menu:mode', 'painter')
        },
        {
          label: 'Designer',
          accelerator: 'Alt+3',
          click: () => send('menu:mode', 'designer')
        },
        { type: 'separator' },
        {
          label: 'Open project folder',
          click: () => {
            if (config.lastProject) shell.openPath(config.lastProject);
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'AuroraOS SDK on GitHub',
          click: () => shell.openExternal('https://github.com/')
        },
        {
          label: 'devkitPro',
          click: () => shell.openExternal('https://devkitpro.org/wiki/Getting_Started')
        },
        {
          label: 'Check for AuroraOS updates',
          accelerator: 'CmdOrCtrl+Alt+U',
          click: async () => {
            send('aurora:progress', { text: 'Checking AuroraOS…' });
            try {
              const result = await aurora.updateFromGithub({ force: true });
              send('aurora:updated', {
                message: result.updated
                  ? `AuroraOS updated to ${result.version.short || 'the latest version'}.`
                  : `AuroraOS is up to date (${result.version.short || 'no version recorded'}).`,
                status: aurora.status()
              });
            } catch (error) {
              send('aurora:updated', { error: error.message, status: aurora.status() });
            }
          }
        },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Northern Editor',
              message: 'Northern Editor',
              detail:
                `Version ${app.getVersion()}\n\n` +
                'Make AuroraOS apps in C or Auric, paint their assets, lay out ' +
                'their screens with the designer, build them with the SDK and run ' +
                'them in the PC preview or a 3DS emulator.\n\n' +
                `AuroraOS: ${aurora.status().version.short || 'not bundled'} ` +
                `(${aurora.vendorRoot()})\n` +
                `Config: ${CONFIG_BASE}`
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY) {
  app.commandLine.appendSwitch('ozone-platform', 'wayland');
}

// Remove a stale single-instance lock left behind by a crashed/unclean exit.
try {
  const lockDir = path.join(require('os').homedir(), '.config', 'northern-editor');
  const lockPath = path.join(lockDir, 'SingletonLock');
  const target = require('fs').readlinkSync(lockPath);
  const pid = Number(String(target).split('-').pop());
  if (pid > 0) {
    try { process.kill(pid, 0); }
    catch (error) {
      require('fs').rmSync(lockPath, { force: true });
      require('fs').rmSync(path.join(lockDir, 'SingletonCookie'), { force: true });
      require('fs').rmSync(path.join(lockDir, 'SingletonSocket'), { force: true });
    }
  }
} catch (error) {}

/* Best-effort single-instance lock: never block the app from opening. */
try { app.requestSingleInstanceLock(); } catch (error) {}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
    /* Make sure the bundled AuroraOS SDK exists before the window opens. */
    let vendor = null;
    try {
      vendor = aurora.ensureVendor({ sourceSdk: config.sdkPath });
    } catch {}
    ipc = registerIpc({
      configBase: CONFIG_BASE,
      getConfig,
      setConfig,
      getWindow
    });
    buildMenu();
    createWindow();

    /* Refresh the bundled SDK from GitHub quietly, at most twice a day. */
    setTimeout(async () => {
      try {
        const result = await aurora.maybeAutoUpdate(config);
        if (result && result.updated) {
          send('aurora:updated', {
            message: `AuroraOS updated to ${result.version.short || 'the latest version'}.`,
            status: aurora.status()
          });
        }
      } catch {}
    }, 4000);

    if (vendor && vendor.copied) {
      send('aurora:updated', {
        message: `AuroraOS SDK copied into ${vendor.root}`,
        status: aurora.status()
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

app.on('before-quit', () => {
  stopAllPreviews();
  if (ipc) ipc.dispose();
  saveWindowState();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

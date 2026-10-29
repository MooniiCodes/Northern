'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_CONFIG = {
  sdkPath: '',
  emulatorRoot: '',
  pythonPath: '',
  toolchainPath: '',
  projectsRoot: '',
  emulatorPath: '',
  sdmcPath: '',
  emulatorArgs: '',
  recentProjects: [],
  window: { width: 1420, height: 900 }
};

function expandHome(value) {
  if (!value) return value;
  let out = String(value);
  if (out === '~') return os.homedir();
  if (out.startsWith('~/') || out.startsWith('~\\')) {
    out = path.join(os.homedir(), out.slice(2));
  }
  return path.resolve(out);
}

function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const testFile = path.join(dir, '.northern-write-test');
    fs.writeFileSync(testFile, 'ok');
    fs.rmSync(testFile, { force: true });
    return true;
  } catch (error) {
    return false;
  }
}

function appBaseDir() {
  const candidates = [];
  if (process.env.APPIMAGE) candidates.push(path.dirname(process.env.APPIMAGE));
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) {
      const exeDir = path.dirname(process.execPath);
      if (!exeDir.includes('/.mount_')) candidates.push(exeDir);
    }
  } catch (error) {
    // Running under tests or without Electron.
  }
  candidates.push(path.join(os.homedir(), '.config', 'northern-editor'));
  candidates.push(path.resolve(__dirname, '..', '..'));

  for (const dir of candidates) {
    if (dir && isWritableDir(dir)) return dir;
  }
  return path.resolve(__dirname, '..', '..');
}

function defaultProjectsRoot() {
  return path.join(appBaseDir(), 'Projects');
}

function configFile(baseDir) {
  return path.join(baseDir, 'config.json');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function loadConfig(baseDir) {
  const loaded = readJson(configFile(baseDir), {});
  const config = { ...DEFAULT_CONFIG, ...loaded };
  config.window = { ...DEFAULT_CONFIG.window, ...(loaded.window || {}) };
  config.recentProjects = Array.isArray(loaded.recentProjects)
    ? loaded.recentProjects.filter((p) => typeof p === 'string')
    : [];
  if (!config.projectsRoot) config.projectsRoot = defaultProjectsRoot();
  // Repair configs left over from read-only AppImage mounts.
  if (String(config.projectsRoot).includes('/.mount_')) {
    config.projectsRoot = defaultProjectsRoot();
  }
  try {
    fs.mkdirSync(config.projectsRoot, { recursive: true });
  } catch (error) {
    config.projectsRoot = defaultProjectsRoot();
    try { fs.mkdirSync(config.projectsRoot, { recursive: true }); } catch {}
  }
  return config;
}

function saveConfig(baseDir, config) {
  const next = { ...DEFAULT_CONFIG, ...config };
  writeJson(configFile(baseDir), next);
  return next;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = {
  appBaseDir,
  DEFAULT_CONFIG,
  expandHome,
  defaultProjectsRoot,
  configFile,
  readJson,
  writeJson,
  loadConfig,
  saveConfig,
  ensureDir
};

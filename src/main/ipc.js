'use strict';

const fs = require('fs');
const path = require('path');
const {
  ipcMain,
  dialog,
  shell,
  nativeImage,
  app
} = require('electron');
const { getEnvironment } = require('./sdk');
const {
  listProjects,
  createProject,
  openProject,
  readMeta,
  writeMeta,
  readIcon,
  saveIcon,
  readFile,
  writeFile,
  createFile,
  deleteFile,
  renameFile,
  moveFile,
  updateMeta,
  listAssets,
  readAsset,
  writeAsset,
  deleteAsset,
  readUi,
  writeUi,
  deleteProject
} = require('./projects');
const { readSymbols } = require('./symbols');
const aurora = require('./aurora');
const { buildProject, cancelBuild, isBuilding, outputPath } = require('./builder');
const {
  startPreview,
  stopPreview,
  isPreviewRunning,
  stopAllPreviews
} = require('./preview');
const { stageApp, launchEmulator } = require('./emulator');
const { bitsFromBgra } = require('../shared/icon');
const { saveConfig, ensureDir } = require('./config');

function registerIpc({ configBase, getConfig, setConfig, getWindow }) {
  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const remember = (dir) => {
    const config = getConfig();
    const recent = [dir, ...(config.recentProjects || []).filter((p) => p !== dir)].slice(0, 12);
    const next = { ...config, recentProjects: recent };
    setConfig(saveConfig(configBase, next));
  };

  ipcMain.handle('app:info', () => {
    const config = getConfig();
    const env = getEnvironment(config);
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      configBase,
      emulatorDir: path.resolve(__dirname, '..', '..', 'emulator'),
      env
    };
  });

  ipcMain.handle('env:get', () => {
    const config = getConfig();
    return { env: getEnvironment(config), config };
  });

  ipcMain.handle('config:get', () => getConfig());

  ipcMain.handle('config:save', (_event, patch) => {
    const next = { ...getConfig(), ...(patch || {}) };
    setConfig(saveConfig(configBase, next));
    return { config: getConfig(), env: getEnvironment(getConfig()) };
  });

  ipcMain.handle('projects:list', () => {
    const config = getConfig();
    const projectsRoot = getEnvironment(config).projectsRoot;
    const projects = listProjects(projectsRoot).map((p) => ({
      dir: p.dir,
      meta: p.meta,
      iconBits: p.iconBits
    }));
    return { projects, projectsRoot, recent: config.recentProjects || [] };
  });

  ipcMain.handle('projects:create', (_event, payload) => {
    const config = getConfig();
    const project = createProject({
      projectsRoot: getEnvironment(config).projectsRoot,
      name: payload && payload.name,
      language: payload && payload.language,
      templateId: payload && payload.templateId,
      iconBits: payload && payload.iconBits
    });
    remember(project.dir);
    return project;
  });

  ipcMain.handle('projects:delete', (_event, dir) => {
    const result = deleteProject(dir);
    const config = getConfig();
    const next = { ...config, recentProjects: (config.recentProjects || []).filter((p) => path.resolve(p) !== path.resolve(dir)) };
    setConfig(saveConfig(configBase, next));
    return result;
  });

  ipcMain.handle('projects:open', (_event, dir) => {
    const project = openProject(dir);
    remember(project.dir);
    return project;
  });

  ipcMain.handle('projects:forget', (_event, dir) => {
    const config = getConfig();
    const next = {
      ...config,
      recentProjects: (config.recentProjects || []).filter((p) => p !== dir)
    };
    setConfig(saveConfig(configBase, next));
    return getConfig();
  });

  ipcMain.handle('project:meta', (_event, payload) => {
    const { dir, patch } = payload || {};
    const result = updateMeta(dir, patch || {});
    return { ...result, dir: path.resolve(dir) };
  });

  ipcMain.handle('project:icon:get', (_event, dir) => {
    const meta = readMeta(dir);
    return readIcon(dir, meta);
  });

  ipcMain.handle('project:icon:set', (_event, payload) => {
    const dir = payload && payload.dir;
    const meta = readMeta(dir);
    const icon = saveIcon(dir, meta, payload && payload.bits);
    return { ...icon, dir: path.resolve(dir), meta };
  });

  const importIcon = (dir, image) => {
    if (!image || image.isEmpty()) throw new Error('That image could not be read.');
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const bits = bitsFromBgra(bitmap, size.width, size.height, 128);
    const meta = readMeta(dir);
    const icon = saveIcon(dir, meta, bits);
    return { ...icon, dir: path.resolve(dir), meta, sourceSize: size };
  };

  ipcMain.handle('project:icon:import', (_event, payload) => {
    const { dir, dataUrl, file } = payload || {};
    let image;
    if (dataUrl) image = nativeImage.createFromDataURL(dataUrl);
    else if (file) image = nativeImage.createFromPath(file);
    else throw new Error('No image was given.');
    return importIcon(dir, image);
  });

  ipcMain.handle('files:read', (_event, payload) => {
    const { dir, rel } = payload || {};
    return { ...readFile(dir, rel), dir: path.resolve(dir), rel };
  });

  ipcMain.handle('files:write', (_event, payload) => {
    const { dir, rel, text } = payload || {};
    return { ...writeFile(dir, rel, text), dir: path.resolve(dir), rel };
  });

  ipcMain.handle('files:create', (_event, payload) => {
    const { dir, rel, text } = payload || {};
    return { ...createFile(dir, rel, text || ''), dir: path.resolve(dir) };
  });

  ipcMain.handle('files:delete', (_event, payload) => {
    const { dir, rel } = payload || {};
    return { ...deleteFile(dir, rel), dir: path.resolve(dir) };
  });

  ipcMain.handle('files:rename', (_event, payload) => {
    const { dir, oldRel, newRel } = payload || {};
    return { ...renameFile(dir, oldRel, newRel), dir: path.resolve(dir) };
  });

  ipcMain.handle('files:move', (_event, payload) => {
    const { dir, rel, direction } = payload || {};
    return { ...moveFile(dir, rel, direction), dir: path.resolve(dir) };
  });

  ipcMain.handle('build:start', async (_event, payload) => {
    const { dir } = payload || {};
    const projectDir = path.resolve(dir);
    const result = await buildProject({
      dir: projectDir,
      config: getConfig(),
      onOutput: (line) => send('build:output', { dir: projectDir, ...line })
    });
    send('build:done', { dir: projectDir, ...result });
    return result;
  });

  ipcMain.handle('build:cancel', (_event, dir) => ({ ok: cancelBuild(dir) }));

  ipcMain.handle('build:state', (_event, dir) => ({
    building: isBuilding(dir),
    previewing: isPreviewRunning(dir)
  }));

  ipcMain.handle('preview:start', async (_event, payload) => {
    const { dir } = payload || {};
    const projectDir = path.resolve(dir);
    const result = await startPreview({
      dir: projectDir,
      config: getConfig(),
      onOutput: (line) => send('preview:output', { dir: projectDir, ...line }),
      onExit: (info) => send('preview:exit', { dir: projectDir, ...info })
    });
    return result;
  });

  ipcMain.handle('preview:stop', (_event, dir) => ({ ok: stopPreview(dir) }));

  ipcMain.handle('emulator:stage', (_event, dir) => stageApp({ dir, config: getConfig() }));

  ipcMain.handle('emulator:launch', (_event, dir) => launchEmulator({ dir, config: getConfig() }));

  ipcMain.handle('dialog:folder', async (_event, payload) => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: (payload && payload.title) || 'Choose a folder',
      defaultPath: payload && payload.defaultPath,
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:file', async (_event, payload) => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: (payload && payload.title) || 'Choose a file',
      defaultPath: payload && payload.defaultPath,
      properties: ['openFile'],
      filters: (payload && payload.filters) || []
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:save', async (_event, payload) => {
    const result = await dialog.showSaveDialog(getWindow(), {
      title: (payload && payload.title) || 'Save',
      defaultPath: payload && payload.defaultPath,
      filters: (payload && payload.filters) || []
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('shell:open', (_event, target) => shell.openPath(target));

  ipcMain.handle('shell:reveal', (_event, target) => {
    shell.showItemInFolder(target);
    return true;
  });

  ipcMain.handle('project:paths', (_event, dir) => {
    const projectDir = path.resolve(dir);
    const meta = readMeta(projectDir);
    return {
      dir: projectDir,
      dist: path.join(projectDir, 'dist'),
      output: outputPath(projectDir, meta),
      preview: path.join(projectDir, '.preview'),
      sd: path.join(projectDir, '.preview', 'sd'),
      readme: path.join(projectDir, 'README.md')
    };
  });

  ipcMain.handle('project:ensureDirs', (_event, dir) => {
    const projectDir = path.resolve(dir);
    ensureDir(path.join(projectDir, 'src'));
    ensureDir(path.join(projectDir, 'dist'));
    ensureDir(path.join(projectDir, '.preview'));
    return true;
  });

  ipcMain.handle('file:exists', (_event, target) => {
    try { return fs.existsSync(target); } catch { return false; }
  });

  ipcMain.handle('sdk:symbols', () => {
    const env = getEnvironment(getConfig());
    return env.sdk ? readSymbols(env.sdk) : { c: [], auric: [] };
  });

  ipcMain.handle('aurora:status', () => {
    const status = aurora.status();
    status.env = getEnvironment(getConfig());
    return status;
  });

  ipcMain.handle('aurora:update', async () => {
    const result = await aurora.updateFromGithub({ force: true, onProgress: (text) => {
      send('aurora:progress', { text });
    } });
    return {
      updated: Boolean(result.updated),
      from: result.previous,
      to: result.version,
      status: aurora.status(),
      env: getEnvironment(getConfig())
    };
  });

  ipcMain.handle('aurora:ensure', () => aurora.ensureVendor({ sourceSdk: getConfig().sdkPath }));

  ipcMain.handle('assets:list', (_event, dir) => listAssets(dir));

  ipcMain.handle('assets:read', (_event, payload) => {
    const { dir, rel } = payload || {};
    return { ...readAsset(dir, rel), dir: path.resolve(dir) };
  });

  ipcMain.handle('assets:write', (_event, payload) => {
    const { dir, rel, dataUrl } = payload || {};
    return { ...writeAsset(dir, rel, dataUrl), dir: path.resolve(dir) };
  });

  ipcMain.handle('assets:delete', (_event, payload) => {
    const { dir, rel } = payload || {};
    return deleteAsset(dir, rel);
  });

  ipcMain.handle('ui:read', (_event, dir) => ({ ...readUi(dir), dir: path.resolve(dir) }));

  ipcMain.handle('ui:write', (_event, payload) => {
    const { dir, layout } = payload || {};
    return writeUi(dir, layout);
  });

  return {
    dispose() {
      stopAllPreviews();
    }
  };
}

module.exports = { registerIpc };

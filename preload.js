'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

const listeners = new Map();

function on(channel, callback) {
  const wrapped = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, wrapped);
  listeners.set(callback, { channel, wrapped });
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
    listeners.delete(callback);
  };
}

contextBridge.exposeInMainWorld('aurora', {
  info: () => invoke('app:info'),
  env: () => invoke('env:get'),
  getConfig: () => invoke('config:get'),
  saveConfig: (patch) => invoke('config:save', patch),

  listProjects: () => invoke('projects:list'),
  createProject: (payload) => invoke('projects:create', payload),
  openProject: (dir) => invoke('projects:open', dir),
  deleteProject: (dir) => invoke('projects:delete', dir),
  forgetProject: (dir) => invoke('projects:forget', dir),
  updateMeta: (dir, patch) => invoke('project:meta', { dir, patch }),
  getIcon: (dir) => invoke('project:icon:get', dir),
  setIcon: (dir, bits) => invoke('project:icon:set', { dir, bits }),
  importIcon: (dir, dataUrl, file) =>
    invoke('project:icon:import', { dir, dataUrl, file }),
  projectPaths: (dir) => invoke('project:paths', dir),
  ensureDirs: (dir) => invoke('project:ensureDirs', dir),

  readFile: (dir, rel) => invoke('files:read', { dir, rel }),
  writeFile: (dir, rel, text) => invoke('files:write', { dir, rel, text }),
  createFile: (dir, rel, text) => invoke('files:create', { dir, rel, text }),
  deleteFile: (dir, rel) => invoke('files:delete', { dir, rel }),
  renameFile: (dir, oldRel, newRel) => invoke('files:rename', { dir, oldRel, newRel }),
  moveFile: (dir, rel, direction) => invoke('files:move', { dir, rel, direction }),

  listAssets: (dir) => invoke('assets:list', dir),
  readAsset: (dir, rel) => invoke('assets:read', { dir, rel }),
  writeAsset: (dir, rel, dataUrl) => invoke('assets:write', { dir, rel, dataUrl }),
  deleteAsset: (dir, rel) => invoke('assets:delete', { dir, rel }),

  readUi: (dir) => invoke('ui:read', dir),
  writeUi: (dir, layout) => invoke('ui:write', { dir, layout }),

  sdkSymbols: () => invoke('sdk:symbols'),
  auroraStatus: () => invoke('aurora:status'),
  auroraUpdate: () => invoke('aurora:update'),
  auroraEnsure: () => invoke('aurora:ensure'),

  build: (dir) => invoke('build:start', { dir }),
  cancelBuild: (dir) => invoke('build:cancel', dir),
  buildState: (dir) => invoke('build:state', dir),

  startPreview: (dir) => invoke('preview:start', { dir }),
  stopPreview: (dir) => invoke('preview:stop', dir),

  stageApp: (dir) => invoke('emulator:stage', dir),
  launchEmulator: (dir) => invoke('emulator:launch', dir),

  chooseFolder: (options) => invoke('dialog:folder', options),
  chooseFile: (options) => invoke('dialog:file', options),
  chooseSave: (options) => invoke('dialog:save', options),
  openPath: (target) => invoke('shell:open', target),
  revealPath: (target) => invoke('shell:reveal', target),
  fileExists: (target) => invoke('file:exists', target),

  onBuildOutput: (cb) => on('build:output', cb),
  onBuildDone: (cb) => on('build:done', cb),
  onPreviewOutput: (cb) => on('preview:output', cb),
  onPreviewExit: (cb) => on('preview:exit', cb),
  onMenu: (cb) => on('menu:command', cb),
  onMenuEvent: (name, cb) => on(name, cb),
  onAuroraProgress: (cb) => on('aurora:progress', cb),
  onAuroraUpdated: (cb) => on('aurora:updated', cb)
});

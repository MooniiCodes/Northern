'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { readMeta } = require('./projects');
const { getEnvironment, defaultSdmcPaths, exists } = require('./sdk');
const { outputPath } = require('./builder');

function appTarget(meta) {
  const folder = meta.language === 'auric' ? 'Aurora/Apps' : 'Aurora/Apps/C';
  return {
    folder,
    file: `${folder}/${meta.slug}.bin`,
    data: `${folder}/${meta.slug}`
  };
}

function pickSdmc(config, env) {
  const configured = config.sdmcPath ? path.resolve(config.sdmcPath) : '';
  if (configured && exists(configured)) return configured;
  const found = defaultSdmcPaths().find((p) => exists(p));
  return found || env.sdmcPath || defaultSdmcPaths()[0];
}

function stageApp({ dir, config }) {
  const projectDir = path.resolve(dir);
  const meta = readMeta(projectDir);
  const env = getEnvironment(config);
  const bin = outputPath(projectDir, meta);
  if (!fs.existsSync(bin)) {
    throw new Error('Build the app first: no .bin file in dist/.');
  }
  const sdmc = pickSdmc(config, env);
  if (!sdmc) throw new Error('Set the emulator SDMC folder in Settings.');
  const target = appTarget(meta);
  const destFile = path.join(sdmc, target.file);
  const destDir = path.join(sdmc, target.data);
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(bin, destFile);
  return {
    ok: true,
    sdmc,
    destFile,
    destDir,
    appPath: `/${target.file}`,
    appDir: `/${target.data}`,
    size: fs.statSync(destFile).size,
    meta
  };
}

function splitArgs(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

function emulatorFor(config, env) {
  if (config.emulatorPath) {
    const p = path.resolve(config.emulatorPath);
    if (exists(p)) return { path: p, name: path.basename(p) };
  }
  return env.emulators && env.emulators.length ? env.emulators[0] : null;
}

function launchEmulator({ dir, config }) {
  const env = getEnvironment(config);
  const emulator = emulatorFor(config, env);
  if (!emulator) {
    throw new Error(
      'No 3DS emulator found. Install Azahar, Citra or Lime3DS, or set its path in Settings.'
    );
  }
  const staged = stageApp({ dir, config });
  const args = splitArgs(config.emulatorArgs);
  const child = spawn(emulator.path, args, {
    cwd: path.dirname(emulator.path),
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();
  return {
    ...staged,
    emulator: emulator.path,
    emulatorName: emulator.name,
    args
  };
}

module.exports = {
  appTarget,
  pickSdmc,
  stageApp,
  launchEmulator,
  splitArgs,
  emulatorFor
};

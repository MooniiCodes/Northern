'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { expandHome, defaultProjectsRoot, ensureDir } = require('./config');
const { vendorRoot } = require('./aurora');

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function which(command, env = process.env) {
  if (!command) return null;
  if (command.includes('/') || command.includes('\\')) {
    return exists(command) ? command : null;
  }
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(finder, [command], {
    env,
    encoding: 'utf8',
    timeout: 5000
  });
  if (result.status !== 0) return null;
  const first = String(result.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return first || null;
}

function isSdkRoot(dir) {
  if (!dir) return false;
  return (
    exists(path.join(dir, 'sdk', 'aurcc.py')) &&
    exists(path.join(dir, 'auric-lang', 'compiler', 'aurc.py')) &&
    exists(path.join(dir, 'include', 'aurora.h'))
  );
}

function findSdkRoot(start) {
  if (!start) return null;
  const base = expandHome(start);
  const candidates = [
    base,
    path.join(base, 'SDK'),
    path.join(base, 'AuroraOS'),
    path.join(base, 'aurora'),
    path.join(base, 'Aurora'),
    path.dirname(base),
    path.join(path.dirname(base), 'AuroraOS')
  ];
  for (const candidate of candidates) {
    if (isSdkRoot(candidate)) return path.resolve(candidate);
  }
  return null;
}

function isEmulatorRoot(dir) {
  if (!dir) return false;
  return (
    exists(path.join(dir, 'pc_compat.c')) ||
    (exists(path.join(dir, 'build.sh')) && exists(path.join(dir, 'launcher.c')))
  );
}

function findEmulatorRoot(start) {
  if (!start) return null;
  const base = expandHome(start);
  const candidates = [
    base,
    path.join(base, 'EMU'),
    path.join(base, 'AuroraCEMU'),
    path.join(base, 'emulator'),
    path.dirname(base),
    path.join(path.dirname(base), 'AuroraCEMU')
  ];
  for (const candidate of candidates) {
    if (isEmulatorRoot(candidate)) return path.resolve(candidate);
  }
  return null;
}

function sdkPaths(sdkRoot) {
  if (!sdkRoot) return null;
  return {
    root: sdkRoot,
    aurcc: path.join(sdkRoot, 'sdk', 'aurcc.py'),
    aurc: path.join(sdkRoot, 'auric-lang', 'compiler', 'aurc.py'),
    auricRoot: path.join(sdkRoot, 'auric-lang'),
    auricRuntime: path.join(sdkRoot, 'auric-lang', 'runtime'),
    sdkInclude: path.join(sdkRoot, 'sdk', 'include'),
    sdkRuntime: path.join(sdkRoot, 'sdk', 'runtime'),
    assetsPak: path.join(sdkRoot, 'Aurora', 'assets.pak'),
    osInclude: path.join(sdkRoot, 'include')
  };
}

function detectPython(config = {}) {
  if (config.pythonPath) {
    const p = expandHome(config.pythonPath);
    if (exists(p)) return p;
    const found = which(config.pythonPath);
    if (found) return found;
  }
  for (const candidate of process.platform === 'win32'
    ? ['py', 'python', 'python3']
    : ['python3', 'python']) {
    const found = which(candidate);
    if (found) return found;
  }
  return null;
}

function detectPreviewDeps(env) {
  const cc = which('cc', env) || which('gcc', env) || which('clang', env);
  const pkgConfig = which('pkg-config', env);
  let sdl2 = false;
  let sdl2Ttf = false;
  let sdl2Image = false;
  let flags = '';
  if (pkgConfig) {
    const check = (pkgs) => spawnSync(pkgConfig, ['--exists', ...pkgs], {
      env,
      timeout: 5000
    }).status === 0;
    sdl2 = check(['sdl2']);
    sdl2Ttf = check(['SDL2_ttf']);
    sdl2Image = check(['SDL2_image']);
    if (sdl2) {
      /* The preview runtime draws with the built-in 8x8 font, so SDL2 alone
       * is enough. SDL2_image is used when present so PNG/JPEG assets load. */
      const pkgs = sdl2Image ? ['sdl2', 'SDL2_image'] : ['sdl2'];
      const result = spawnSync(pkgConfig, [
        '--cflags', '--libs', ...pkgs
      ], { env, encoding: 'utf8', timeout: 5000 });
      if (result.status === 0) flags = String(result.stdout || '').trim();
    }
  }
  return {
    cc,
    pkgConfig,
    sdl2,
    sdl2Ttf,
    sdl2Image,
    flags,
    ready: Boolean(cc && sdl2)
  };
}

function detectEmulators(config = {}, env = process.env) {
  const found = [];
  if (config.emulatorPath) {
    const p = expandHome(config.emulatorPath);
    if (exists(p)) found.push({ path: p, name: path.basename(p), source: 'settings' });
  }
  const names = [
    'azahar', 'azahar-qt', 'azahar-emu',
    'citra', 'citra-qt', 'citra-emu',
    'lime3ds', 'lime3ds-qt', 'lime3ds-emu'
  ];
  for (const name of names) {
    const p = which(name, env);
    if (p && !found.some((e) => e.path === p)) {
      found.push({ path: p, name, source: 'PATH' });
    }
  }
  return found;
}

function defaultSdmcPaths() {
  const home = os.homedir();
  const xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  const config = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [
    path.join(xdg, 'azahar-emu', 'sdmc'),
    path.join(xdg, 'citra-emu', 'sdmc'),
    path.join(xdg, 'lime3ds', 'sdmc'),
    path.join(config, 'azahar-emu', 'sdmc'),
    path.join(config, 'citra-emu', 'sdmc'),
    path.join(config, 'lime3ds', 'sdmc')
  ];
}

function readVersions(sdkRoot) {
  const out = { aurcc: '', auric: '' };
  try {
    const text = fs.readFileSync(path.join(sdkRoot, 'sdk', 'aurcc.py'), 'utf8');
    const m = text.match(/__version__\s*=\s*["']([^"']+)["']/);
    if (m) out.aurcc = m[1];
  } catch {}
  try {
    const text = fs.readFileSync(
      path.join(sdkRoot, 'auric-lang', 'compiler', '__init__.py'),
      'utf8'
    );
    const m = text.match(/__version__\s*=\s*["']([^"']+)["']/);
    if (m) out.auric = m[1];
  } catch {}
  return out;
}

function toolEnv(config = {}) {
  const env = { ...process.env };
  if (config.toolchainPath) {
    const bin = expandHome(config.toolchainPath);
    env.PATH = bin + path.delimiter + (env.PATH || '');
  }
  env.PYTHONUNBUFFERED = '1';
  env.PYTHONIOENCODING = 'utf-8';
  return env;
}

function getEnvironment(config = {}) {
  const env = toolEnv(config);
  const hub = path.join(os.homedir(), 'Documents', 'Aurora3DS');
  const sdkRoot =
    findSdkRoot(config.sdkPath) ||
    findSdkRoot(vendorRoot()) ||
    findSdkRoot(hub) ||
    findSdkRoot(path.join(os.homedir(), 'Documents', 'AuroraOS')) ||
    findSdkRoot(path.join(os.homedir(), 'AuroraOS'));

  const emulatorRoot =
    findEmulatorRoot(config.emulatorRoot) ||
    findEmulatorRoot(hub) ||
    findEmulatorRoot(path.join(os.homedir(), 'Documents', 'AuroraCEMU')) ||
    findEmulatorRoot(path.join(os.homedir(), 'AuroraCEMU'));

  let projectsRoot = config.projectsRoot
    ? expandHome(config.projectsRoot)
    : defaultProjectsRoot();
  try {
    ensureDir(projectsRoot);
  } catch {
    projectsRoot = defaultProjectsRoot();
    try { ensureDir(projectsRoot); } catch {}
  }

  const python = detectPython(config);
  const preview = detectPreviewDeps(env);
  const devkit = which('arm-none-eabi-gcc', env);
  const objcopy = which('arm-none-eabi-objcopy', env);
  const emulators = detectEmulators(config, env);
  const versions = sdkRoot ? readVersions(sdkRoot) : { aurcc: '', auric: '' };
  const sdk = sdkRoot ? sdkPaths(sdkRoot) : null;

  return {
    sdkPath: sdkRoot,
    sdk,
    sdkVersion: versions,
    emulatorRoot,
    projectsRoot,
    python,
    devkit,
    objcopy,
    toolchainPath: config.toolchainPath ? expandHome(config.toolchainPath) : '',
    preview,
    emulators,
    emulatorPath: config.emulatorPath ? expandHome(config.emulatorPath) : '',
    sdmcPath: config.sdmcPath
      ? expandHome(config.sdmcPath)
      : (defaultSdmcPaths().find((p) => exists(p)) || defaultSdmcPaths()[0]),
    canBuild: Boolean(sdkRoot && python && devkit),
    canPreview: Boolean(sdkRoot && python && preview.ready)
  };
}

module.exports = {
  exists,
  which,
  isSdkRoot,
  findSdkRoot,
  isEmulatorRoot,
  findEmulatorRoot,
  sdkPaths,
  detectPython,
  detectPreviewDeps,
  detectEmulators,
  defaultSdmcPaths,
  readVersions,
  toolEnv,
  getEnvironment
};

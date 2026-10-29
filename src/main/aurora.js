'use strict';

/* The AuroraOS SDK, vendored inside the studio as ./Aurora.
 *
 * Only the parts needed to build apps are kept (sdk, include, src, tools and
 * auric-lang).  The copy can be refreshed from TeamAuroraOS/AuroraOS on GitHub
 * without touching the rest of the studio.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = 'TeamAuroraOS/AuroraOS';
const BRANCH = 'main';
const VERSION_FILE = '.aurora.json';
const DIRS = ['sdk', 'include', 'src', 'tools', 'auric-lang'];
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

let updating = null;

function studioRoot() {
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) return process.resourcesPath;
  } catch (error) {}
  return path.resolve(__dirname, '..', '..');
}

function vendorRoot() {
  return path.join(studioRoot(), 'Aurora');
}

function versionPath(root = vendorRoot()) {
  return path.join(root, VERSION_FILE);
}

function readVersion(root = vendorRoot()) {
  try {
    return JSON.parse(fs.readFileSync(versionPath(root), 'utf8'));
  } catch {
    return { commit: '', short: '', source: '', checkedAt: '' };
  }
}

function writeVersion(root, data) {
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(versionPath(root), JSON.stringify(data, null, 2) + '\n', 'utf8');
  } catch {}
}

function hasTree(root = vendorRoot()) {
  try {
    return (
      DIRS.every((dir) => fs.existsSync(path.join(root, dir))) &&
      fs.existsSync(path.join(root, 'sdk', 'aurcc.py')) &&
      fs.existsSync(path.join(root, 'auric-lang', 'compiler', 'aurc.py')) &&
      fs.existsSync(path.join(root, 'include', 'aurora.h')) &&
      fs.existsSync(path.join(root, 'src', 'screen.c'))
    );
  } catch {
    return false;
  }
}

function copyTree(sourceRoot, destRoot) {
  fs.mkdirSync(destRoot, { recursive: true });
  for (const dir of DIRS) {
    const from = path.join(sourceRoot, dir);
    if (!fs.existsSync(from)) throw new Error(`AuroraOS is missing ${dir}/.`);
    const to = path.join(destRoot, dir);
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
  }
  const license = path.join(sourceRoot, 'LICENSE');
  if (fs.existsSync(license)) {
    try { fs.copyFileSync(license, path.join(destRoot, 'LICENSE')); } catch {}
  }
}

function localCandidates(sourceSdk) {
  const home = os.homedir();
  return [
    sourceSdk,
    path.join(home, 'Documents', 'AuroraOS'),
    path.join(home, 'Documents', 'Aurora3DS', 'SDK'),
    path.join(home, 'Documents', 'Aurora3DS', 'AuroraOS'),
    path.join(home, 'AuroraOS'),
    path.join(home, 'aurora')
  ].filter(Boolean);
}

function gitCommit(dir) {
  try {
    const result = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      timeout: 5000
    });
    if (result.status === 0) return String(result.stdout || '').trim();
  } catch {}
  return '';
}

/* Copy a local AuroraOS checkout into the studio the first time it starts. */
function ensureVendor({ sourceSdk } = {}) {
  const root = vendorRoot();
  if (hasTree(root)) return { ok: true, copied: false, root, version: readVersion(root) };

  for (const candidate of localCandidates(sourceSdk)) {
    if (!candidate || !hasTree(candidate)) continue;
    copyTree(candidate, root);
    const commit = gitCommit(candidate);
    const version = {
      commit,
      short: commit.slice(0, 7),
      source: `copy:${candidate}`,
      checkedAt: new Date().toISOString()
    };
    writeVersion(root, version);
    return { ok: true, copied: true, from: candidate, root, version };
  }

  return {
    ok: false,
    copied: false,
    root,
    error:
      'The AuroraOS SDK is not bundled yet. Connect to the internet and use ' +
      'Settings > Check for Aurora updates.'
  };
}

function apiHeaders() {
  return {
    'User-Agent': 'Aurora3DS-Studio',
    Accept: 'application/vnd.github+json'
  };
}

async function latestCommit() {
  const response = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
    headers: apiHeaders()
  });
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} ${response.statusText}.`);
  }
  const data = await response.json();
  return {
    sha: data.sha,
    short: String(data.sha || '').slice(0, 7),
    date: data.commit && data.commit.committer ? data.commit.committer.date : '',
    message: data.commit && data.commit.message ? data.commit.message.split('\n')[0] : ''
  };
}

function extract(tarPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  let result = spawnSync('tar', ['-xzf', tarPath, '-C', destDir, '--strip-components=1'], {
    encoding: 'utf8',
    timeout: 120000
  });
  if (result.status === 0) return;

  const script = [
    'import sys, tarfile, os',
    'src, dest = sys.argv[1], sys.argv[2]',
    'with tarfile.open(src) as tar:',
    '    members = tar.getmembers()',
    '    prefix = members[0].name.split("/")[0] if members else ""',
    '    for m in members:',
    '        parts = m.name.split("/")',
    '        rel = "/".join(parts[1:])',
    '        if not rel: continue',
    '        m.name = rel',
    '        tar.extract(m, dest)'
  ].join('\n');
  result = spawnSync('python3', ['-c', script, tarPath, destDir], {
    encoding: 'utf8',
    timeout: 120000
  });
  if (result.status !== 0) {
    throw new Error(
      `Could not unpack the AuroraOS download: ${(result.stderr || '').trim() || 'tar failed'}`
    );
  }
}

async function download(sha, file) {
  const response = await fetch(`https://codeload.github.com/${REPO}/tar.gz/${sha}`, {
    headers: { 'User-Agent': 'Aurora3DS-Studio' }
  });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}.`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(file, buffer);
  return buffer.length;
}

async function runUpdate({ force = false, onProgress = () => {} } = {}) {
  const root = vendorRoot();
  const previous = readVersion(root);
  onProgress('Checking GitHub…');
  const latest = await latestCommit();

  if (!force && latest.sha && previous.commit === latest.sha && hasTree(root)) {
    writeVersion(root, { ...previous, checkedAt: new Date().toISOString() });
    return { updated: false, version: readVersion(root), latest, root };
  }

  onProgress(`Downloading AuroraOS ${latest.short}…`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora3ds-'));
  const tarPath = path.join(temp, 'aurora.tar.gz');
  const extracted = path.join(temp, 'src');
  try {
    await download(latest.sha, tarPath);
    onProgress('Unpacking…');
    extract(tarPath, extracted);
    if (!hasTree(extracted)) {
      throw new Error('The downloaded AuroraOS archive did not contain the SDK.');
    }
    onProgress('Installing…');
    copyTree(extracted, root);
    const version = {
      commit: latest.sha,
      short: latest.short,
      date: latest.date,
      source: 'github',
      checkedAt: new Date().toISOString()
    };
    writeVersion(root, version);
    return { updated: true, previous, version, latest, root };
  } finally {
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
  }
}

function updateFromGithub(options = {}) {
  if (updating) return updating;
  updating = runUpdate(options).finally(() => {
    updating = null;
  });
  return updating;
}

async function maybeAutoUpdate(config = {}) {
  if (config.autoUpdateAurora === false) return { skipped: 'disabled' };
  const root = vendorRoot();
  if (!hasTree(root)) return { skipped: 'missing' };
  const version = readVersion(root);
  const checked = Date.parse(version.checkedAt || '');
  if (Number.isFinite(checked) && Date.now() - checked < CHECK_INTERVAL_MS) {
    return { skipped: 'recent', version };
  }
  try {
    return await updateFromGithub({ force: false });
  } catch (error) {
    writeVersion(root, { ...version, checkedAt: new Date().toISOString(), lastError: error.message });
    return { skipped: 'error', error: error.message };
  }
}

function status() {
  const root = vendorRoot();
  return {
    root,
    ready: hasTree(root),
    updating: Boolean(updating),
    version: readVersion(root),
    repo: REPO
  };
}

module.exports = {
  REPO,
  BRANCH,
  studioRoot,
  vendorRoot,
  versionPath,
  readVersion,
  writeVersion,
  hasTree,
  ensureVendor,
  latestCommit,
  updateFromGithub,
  maybeAutoUpdate,
  status
};

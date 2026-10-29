'use strict';

/* Northern Editor renderer. */

const api = window.aurora;

const TEMPLATES = [
  {
    id: 'c-hello',
    name: 'C: Hello window',
    language: 'c',
    description: 'Both screens, a moving ball and input. The friendliest place to start.'
  },
  {
    id: 'c-game',
    name: 'C: Multi-file game',
    language: 'c',
    description: 'main.c, game.c and game.h — the smallest useful multi-file project.'
  },
  {
    id: 'c-blank',
    name: 'C: Blank',
    language: 'c',
    description: 'A main() and a frame loop, nothing else.'
  },
  {
    id: 'auric-hello',
    name: 'Auric: Hello',
    language: 'auric',
    description: 'Draw text, wait for a button. The smallest Auric app.'
  },
  {
    id: 'auric-game',
    name: 'Auric: Multi-file game',
    language: 'auric',
    description: 'main.aur and game.aur joined into one program by the studio.'
  },
  {
    id: 'auric-paint',
    name: 'Auric: Paint',
    language: 'auric',
    description: 'A touch drawing app for the bottom screen.'
  },
  {
    id: 'auric-blank',
    name: 'Auric: Blank',
    language: 'auric',
    description: 'An empty Auric program.'
  }
];

const state = {
  env: null,
  config: null,
  projects: [],
  recent: [],
  current: null,
  files: {},
  tabs: [],
  activeFile: null,
  editor: null,
  iconEditor: null,
  iconTimer: null,
  building: false,
  previewing: false,
  painter: null,
  designer: null,
  output: [],
  panel: 'output',
  modalClose: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

/* ------------------------------------------------------------------ */
/* small UI helpers                                                   */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, className, onClick) {
  const b = el('button', className || 'btn', label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function toast(message, kind = 'ok', timeout = 3800) {
  const node = el('div', `toast ${kind === 'ok' ? '' : kind}`, message);
  $('#toast-root').appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    node.style.transition = 'all 160ms ease';
    setTimeout(() => node.remove(), 180);
  }, timeout);
}

function setStatus(text, kind) {
  const node = $('#status-text');
  node.textContent = text;
  node.style.color = kind === 'error' ? 'var(--danger)'
    : kind === 'warn' ? 'var(--warn)'
    : kind === 'ok' ? 'var(--accent)' : '';
}

function basename(rel) {
  return String(rel || '').split('/').pop();
}

function languageFor(rel) {
  if (rel.endsWith('.aur')) return 'auric';
  if (/\.(c|h)$/i.test(rel)) return 'c';
  if (/\.(s|S|ld)$/.test(rel)) return 'asm';
  if (rel.endsWith('.json')) return 'json';
  if (rel.endsWith('.md')) return 'markdown';
  return 'text';
}

function anyDirty() {
  return Object.values(state.files).some((f) => f.dirty);
}

function setDirty(on) {
  $('#project-dirty').classList.toggle('hidden', !on);
  document.title = `${on ? '• ' : ''}Northern Editor`;
}

function drawIconThumb(canvas, bits) {
  const size = 30;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#060a10';
  ctx.fillRect(0, 0, size, size);
  const cell = size / 32;
  ctx.fillStyle = '#64e8c8';
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      if (bits && bits[y] && bits[y][x]) {
        ctx.fillRect(Math.floor(x * cell), Math.floor(y * cell),
          Math.max(1, Math.ceil(cell)), Math.max(1, Math.ceil(cell)));
      }
    }
  }
}

function showEmpty(show) {
  $('#empty-state').classList.toggle('hidden', !show);
  $('#editor-host').classList.toggle('hidden', show);
}

function setMode(mode) {
  if (!mode) return;
  $$('.mode-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });
  ['editor', 'painter'].forEach((name) => {
    const view = $(`#view-${name}`);
    if (view) view.classList.toggle('hidden', name !== mode);
  });
  if (mode === 'painter') ensurePainter();
}

function ensurePainter() {
  if (state.painter) return state.painter;
  if (!window.Painter) return null;
  state.painter = new window.Painter({
    onDirty: () => {
      if (!state.current) return;
      clearTimeout(state.logoTimer);
      state.logoTimer = setTimeout(() => {
        if (!state.current || !state.painter) return;
        const dataUrl = state.painter.getDataUrl();
        const img = new Image();
        img.onload = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 32;
          canvas.height = 32;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 32, 32);
          const data = ctx.getImageData(0, 0, 32, 32).data;
          const bits = [];
          for (let y = 0; y < 32; y++) {
            bits[y] = [];
            for (let x = 0; x < 32; x++) {
              const i = (y * 32 + x) * 4;
              const alpha = data[i + 3];
              const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
              bits[y][x] = alpha > 127 && lum >= 128;
            }
          }
          state.current.icon = { bits };
          updateProjectInList();
          try { await api.setIcon(state.current.dir, bits); }
          catch (error) { toast(error.message, 'error'); }
        };
        img.src = dataUrl;
      }, 400);
    },
    onStatus: (text, kind) => setStatus(text, kind),
    onError: (message) => toast(message, 'error'),
    onLoadLogo: () => {
      if (!state.current) { toast('Open a project first.', 'warn'); return; }
      const bits = (state.current.icon && state.current.icon.bits) ||
        (state.iconEditor ? state.iconEditor.getBits() : null);
      if (bits) state.painter.setBits(bits);
      state.painter.setName('logo');
      toast('Loaded logo into painter.', 'ok');
    },
    onUseAsLogo: (dataUrl) => {
      if (!state.current) {
        toast('Open a project first.', 'warn');
        return;
      }
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        const bits = [];
        for (let y = 0; y < 32; y++) {
          bits[y] = [];
          for (let x = 0; x < 32; x++) {
            const i = (y * 32 + x) * 4;
            const alpha = data[i + 3];
            const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
            bits[y][x] = alpha > 127 && lum >= 128;
          }
        }
        if (state.iconEditor) state.iconEditor.setBits(bits);
        try {
          await api.setIcon(state.current.dir, bits);
          state.current.icon = { bits };
          updateProjectInList();
          toast('Logo updated from painter.', 'ok');
        } catch (error) {
          toast(error.message, 'error');
        }
      };
      img.onerror = () => toast('Could not read the painted image.', 'error');
      img.src = dataUrl;
    },
    onSave: async () => {
      if (!state.current) {
        toast('Open a project first.', 'warn');
        return;
      }
      const painter = state.painter;
      const rawName = (painter.getName() || `asset-${Date.now()}`).trim();
      let rel = rawName || `asset-${Date.now()}`;
      if (!/\.png$/i.test(rel)) rel += '.png';
      if (!rel.startsWith('assets/')) rel = `assets/${rel}`;
      try {
        await api.writeAsset(state.current.dir, rel, painter.getDataUrl());
        toast(`Saved ${rel}.`, 'ok');
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });
  return state.painter;
}

function ensureDesigner() {
  if (state.designer) return state.designer;
  if (!window.Designer) return null;
  state.designer = new window.Designer({
    getDir: () => (state.current ? state.current.dir : null),
    onStatus: (text, kind) => setStatus(text, kind),
    onError: (message) => toast(message, 'error')
  });
  if (state.current) state.designer.load(state.current.dir);
  return state.designer;
}

function updateButtons() {
  const build = $('#btn-build');
  const run = $('#btn-run');
  build.textContent = state.building ? 'Cancel build' : 'Build';
  build.classList.toggle('running', state.building);
  run.textContent = state.previewing ? 'Stop' : 'Run';
  run.classList.toggle('running', state.previewing);
  run.disabled = !state.current && !state.previewing;
  build.disabled = !state.current && !state.building;
  $('#btn-emulator').disabled = !state.current;
}

/* ------------------------------------------------------------------ */
/* environment                                                        */

function renderEnv() {
  const env = state.env || {};
  const node = $('#env-summary');
  node.innerHTML = '';
  const add = (label, value, ok) => {
    const line = el('div');
    line.append(`${label}: `);
    const b = el('b', ok ? 'ok' : 'bad', value);
    line.appendChild(b);
    node.appendChild(line);
  };
  add('SDK', env.sdkPath ? 'found' : 'not found', Boolean(env.sdkPath));
  add('Compiler', env.devkit ? 'devkitARM' : 'missing', Boolean(env.devkit));
  add('Preview', env.preview && env.preview.ready ? 'SDL2 ready' : 'needs SDL2',
    Boolean(env.preview && env.preview.ready));
  $('#status-sdk').textContent = env.sdkPath ? `SDK ${env.sdkPath}` : 'No SDK';
  if (env.sdkPath) $('#status-sdk').title = env.sdkPath;
}

/* ------------------------------------------------------------------ */
/* projects                                                           */

function renderProjectList() {
  const list = $('#project-list');
  list.innerHTML = '';
  if (!state.projects.length) {
    const empty = el('div', 'hint', 'No projects yet. Press + to make one.');
    empty.style.padding = '10px 8px';
    list.appendChild(empty);
    return;
  }
  for (const project of state.projects) {
    const item = el('div', 'project-item');
    item.dataset.dir = project.dir;
    if (state.current && state.current.dir === project.dir) item.classList.add('active');

    const thumb = el('canvas', 'project-thumb');
    drawIconThumb(thumb, project.iconBits);
    const body = el('div', 'project-item-body');
    body.appendChild(el('div', 'project-item-name', project.meta.name));
    const meta = el('div', 'project-item-meta');
    meta.appendChild(el('span', '', project.meta.language === 'auric' ? 'Auric' : 'C'));
    meta.appendChild(el('span', '', `${project.meta.files.length} files`));
    body.appendChild(meta);
    const del = el('button', 'btn tiny ghost danger', '×');
    del.title = 'Delete project';
    del.addEventListener('click', async (event) => {
      event.stopPropagation();
      const ok = await confirmDialog('Delete project', `Delete ${project.meta.name}? This cannot be undone.`);
      if (!ok) return;
      try {
        await api.deleteProject(project.dir);
        if (state.current && state.current.dir === project.dir) {
          state.current = null;
          state.files = {};
          state.tabs = [];
          state.activeFile = null;
          showEmpty(true);
          setStatus('Project deleted');
        }
        await refreshProjects();
        toast(`Deleted ${project.meta.name}.`);
      } catch (error) {
        toast(error.message, 'error');
      }
    });
    item.append(thumb, body, del);
    item.addEventListener('click', () => {
      openProject(project.dir).catch((error) => toast(error.message, 'error'));
    });
    list.appendChild(item);
  }
}

async function refreshProjects() {
  const data = await api.listProjects();
  state.projects = data.projects || [];
  state.recent = data.recent || [];
  if (state.config) state.config.projectsRoot = data.projectsRoot;
  renderProjectList();
}

function updateProjectInList() {
  if (!state.current) return;
  const entry = state.projects.find((p) => p.dir === state.current.dir);
  if (!entry) return;
  entry.meta = state.current.meta;
  if (state.current.icon && state.current.icon.bits) entry.iconBits = state.current.icon.bits;
  else if (state.iconEditor) entry.iconBits = state.iconEditor.getBits();
  renderProjectList();
}

async function openProject(dir) {
  if (!dir) return;
  if (state.current && state.current.dir === dir) return;
  try {
    await saveAll();
  } catch (error) {
    toast(`Could not save before switching: ${error.message}`, 'error');
    return;
  }
  let project;
  try {
    project = await api.openProject(dir);
  } catch (error) {
    toast(`Open failed: ${error.message}`, 'error');
    setStatus(`Open failed: ${error.message}`, 'error');
    return;
  }
  state.current = project;
  state.files = {};
  state.tabs = [];
  state.activeFile = null;
  state.output = [];
  state.building = false;
  state.previewing = false;
  renderOutput();
  await api.ensureDirs(project.dir);

  $('#project-name').textContent = project.meta.name;
  $('#project-language').textContent = project.meta.language === 'auric' ? 'AURIC' : 'C';
  $('#project-language').classList.remove('hidden');
  $('#app-name').value = project.meta.name;
  $('#app-language').textContent = project.meta.language === 'auric' ? 'Auric language' : 'C SDK';
  $('#app-entry').innerHTML = '';
  for (const file of project.meta.files) {
    const opt = el('option', '', file);
    opt.value = file;
    if (file === project.meta.entry) opt.selected = true;
    $('#app-entry').appendChild(opt);
  }
  $('#file-hint').textContent = project.meta.language === 'auric'
    ? 'All .aur files are joined in this order, then compiled. The entry file is placed last.'
    : 'Every .c and .s file is compiled together. Use the order arrows for Auric files.';

  renderFileList();
  renderTabs();
  updateButtons();
  showEmpty(false);
  await refreshProjects();
  renderProjectList();

  const first = project.meta.files.includes(project.meta.entry)
    ? project.meta.entry
    : project.meta.files[0];
  try {
    if (first) await openFile(first);
  } catch (error) {
    toast(`Open file failed: ${error.message}`, 'error');
    setStatus(`Open file failed: ${error.message}`, 'error');
  }
  setDirty(false);
  setStatus(`Opened ${project.meta.name}`, 'ok');
}

function loadIconEditor(bits) {
  if (!state.iconEditor) {
    state.iconEditor = new window.IconEditor($('#icon-host'), {
      onChange: (nextBits) => scheduleIconSave(nextBits)
    });
  }
  state.iconEditor.setBits(bits);
}

function scheduleIconSave(bits) {
  if (!state.current) return;
  const dir = state.current.dir;
  clearTimeout(state.iconTimer);
  state.iconTimer = setTimeout(async () => {
    if (!state.current || state.current.dir !== dir) return;
    try {
      await api.setIcon(dir, bits);
      state.current.icon = { bits };
      updateProjectInList();
    } catch (error) {
      toast(`Could not save the logo: ${error.message}`, 'error');
    }
  }, 450);
}

async function flushIcon() {
  if (!state.iconEditor || !state.current) return;
  clearTimeout(state.iconTimer);
  try {
    await api.setIcon(state.current.dir, state.iconEditor.getBits());
    state.current.icon = { bits: state.iconEditor.getBits() };
  } catch {}
}

/* ------------------------------------------------------------------ */
/* files                                                              */

function renderFileList() {
  const list = $('#file-list');
  list.innerHTML = '';
  if (!state.current) return;
  for (const rel of state.current.meta.files) {
    const row = el('div', 'file-row');
    if (rel === state.activeFile) row.classList.add('active');
    row.addEventListener('click', () => {
      openFile(rel).catch((error) => toast(error.message, 'error'));
    });
    row.appendChild(el('span', 'file-row-name', rel));
    if (rel === state.current.meta.entry) {
      row.appendChild(el('span', 'entry-badge', 'ENTRY'));
    }
    const up = button('↑', 'row-btn', (event) => {
      event.stopPropagation();
      moveFile(rel, 'up').catch((error) => toast(error.message, 'error'));
    });
    up.title = 'Move up';
    const down = button('↓', 'row-btn', (event) => {
      event.stopPropagation();
      moveFile(rel, 'down').catch((error) => toast(error.message, 'error'));
    });
    down.title = 'Move down';
    row.append(up, down);
    list.appendChild(row);
  }
}

function renderTabs() {
  const tabs = $('#file-tabs');
  tabs.innerHTML = '';
  for (const rel of state.tabs) {
    const file = state.files[rel];
    const tab = el('button', 'tab');
    tab.type = 'button';
    if (rel === state.activeFile) tab.classList.add('active');
    tab.appendChild(el('span', '', basename(rel)));
    if (file && file.dirty) tab.appendChild(el('span', 'tab-dot'));
    const close = el('span', 'tab-close', '×');
    close.title = 'Close tab';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closeTab(rel);
    });
    tab.appendChild(close);
    tab.addEventListener('click', () => {
      openFile(rel).catch((error) => toast(error.message, 'error'));
    });
    tabs.appendChild(tab);
  }
}

function ensureEditor() {
  if (state.editor) return state.editor;
  state.editor = new window.CodeEditor($('#editor-host'), {
    onChange: (text) => {
      const rel = state.activeFile;
      if (!rel || !state.files[rel]) return;
      const file = state.files[rel];
      file.text = text;
      file.dirty = text !== file.saved;
      renderTabs();
      setDirty(anyDirty());
    },
    onSave: () => {
      saveActive().catch((error) => toast(error.message, 'error'));
    },
    onCursor: ({ line, col }) => {
      $('#status-cursor').textContent = `Ln ${line}, Col ${col}`;
    }
  });
  return state.editor;
}

async function openFile(rel) {
  if (!state.current) return;
  if (!state.files[rel]) {
    const data = await api.readFile(state.current.dir, rel);
    state.files[rel] = {
      text: data.text,
      saved: data.text,
      language: data.language || languageFor(rel),
      dirty: false
    };
  }
  if (!state.tabs.includes(rel)) state.tabs.push(rel);
  state.activeFile = rel;
  const editor = ensureEditor();
  const file = state.files[rel];
  editor.setValue(file.text, file.language);
  showEmpty(false);
  renderTabs();
  renderFileList();
  editor.focus();
}

function closeTab(rel) {
  state.tabs = state.tabs.filter((r) => r !== rel);
  if (state.activeFile === rel) {
    state.activeFile = null;
    const next = state.tabs[state.tabs.length - 1];
    if (next) openFile(next).catch((error) => toast(error.message, 'error'));
    else {
      $('#editor-host').innerHTML = '';
      state.editor = null;
      showEmpty(true);
    }
  }
  renderTabs();
}

async function saveActive() {
  if (!state.current || !state.activeFile) return true;
  const rel = state.activeFile;
  const file = state.files[rel];
  if (!file) return true;
  if (!file.dirty) {
    setStatus('Nothing to save');
    return true;
  }
  await api.writeFile(state.current.dir, rel, file.text);
  file.saved = file.text;
  file.dirty = false;
  renderTabs();
  setDirty(anyDirty());
  setStatus(`Saved ${basename(rel)}`, 'ok');
  return true;
}

async function saveAll() {
  if (!state.current) return true;
  for (const [rel, file] of Object.entries(state.files)) {
    if (!file.dirty) continue;
    await api.writeFile(state.current.dir, rel, file.text);
    file.saved = file.text;
    file.dirty = false;
  }
  if (state.current) await flushIcon();
  renderTabs();
  setDirty(anyDirty());
  return true;
}

async function moveFile(rel, direction) {
  if (!state.current) return;
  await saveAll();
  const result = await api.moveFile(state.current.dir, rel, direction);
  state.current.meta = result.meta;
  renderFileList();
  renderAppInfo();
}

function renderAppInfo() {
  if (!state.current) return;
  const meta = state.current.meta;
  $('#app-name').value = meta.name;
  $('#project-name').textContent = meta.name;
  $('#app-language').textContent = meta.language === 'auric' ? 'Auric language' : 'C SDK';
  $('#project-language').textContent = meta.language === 'auric' ? 'AURIC' : 'C';
  const select = $('#app-entry');
  const previous = meta.entry;
  select.innerHTML = '';
  for (const file of meta.files) {
    const opt = el('option', '', file);
    opt.value = file;
    if (file === previous) opt.selected = true;
    select.appendChild(opt);
  }
}

async function saveAppInfo() {
  if (!state.current) return;
  const name = $('#app-name').value.trim();
  const entry = $('#app-entry').value;
  if (!name) {
    toast('The app needs a name.', 'warn');
    return;
  }
  try {
    const result = await api.updateMeta(state.current.dir, { name, entry });
    state.current.meta = result.meta;
    renderAppInfo();
    renderFileList();
    await refreshProjects();
    setStatus('App info saved', 'ok');
    toast('App info saved.');
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* output panel                                                       */

function appendOutput(payload) {
  if (payload.dir && state.current && payload.dir !== state.current.dir) return;
  const text = String(payload.text || '');
  const stream = payload.stream || 'stdout';
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) state.output.push({ stream, text: line });
  if (state.output.length > 4000) state.output.splice(0, state.output.length - 4000);
  renderOutput();
}

function renderOutput() {
  const out = $('#output');
  out.innerHTML = '';
  let entries = state.output;
  if (state.panel === 'problems') entries = entries.filter((e) => e.stream === 'stderr');
  else if (state.panel === 'info') {
    entries = entries.filter((e) => e.stream === 'info' || e.stream === 'success');
  }
  if (!entries.length) {
    out.appendChild(el('span', 'out-empty',
      state.panel === 'problems' ? 'No problems.' : 'Build or run the app to see output here.'));
    return;
  }
  for (const entry of entries) {
    const line = el('span', `out-line ${entry.stream}`, entry.text || ' ');
    out.appendChild(line);
  }
  out.scrollTop = out.scrollHeight;
}

function showPanel() {
  $('#bottom-panel').classList.remove('hidden');
}

function clearOutput() {
  state.output = [];
  renderOutput();
}

/* ------------------------------------------------------------------ */
/* build and run                                                      */

async function doBuild() {
  if (!state.current) {
    toast('Open or create a project first.', 'warn');
    return;
  }
  if (state.building) {
    await api.cancelBuild(state.current.dir);
    setStatus('Cancelling build…', 'warn');
    return;
  }
  try {
    await saveAll();
  } catch (error) {
    toast(`Could not save: ${error.message}`, 'error');
    return;
  }
  state.building = true;
  updateButtons();
  state.panel = 'output';
  $$('.panel-tab').forEach((t) => t.classList.toggle('active', t.dataset.panel === 'output'));
  showPanel();
  clearOutput();
  setStatus('Building…', 'warn');
  try {
    const result = await api.build(state.current.dir);
    state.building = false;
    updateButtons();
    if (result.ok) {
      setStatus(`Built ${basename(result.output || '')}`, 'ok');
      toast('Build finished.');
    } else if (result.cancelled) {
      setStatus('Build cancelled', 'warn');
    } else {
      setStatus('Build failed', 'error');
      toast('Build failed. See the output panel.', 'error');
    }
  } catch (error) {
    state.building = false;
    updateButtons();
    setStatus('Build failed', 'error');
    toast(error.message, 'error');
  }
}

async function doRun() {
  if (!state.current) {
    toast('Open or create a project first.', 'warn');
    return;
  }
  if (state.previewing) {
    await api.stopPreview(state.current.dir);
    state.previewing = false;
    updateButtons();
    setStatus('Preview stopped');
    return;
  }
  try {
    await saveAll();
  } catch (error) {
    toast(`Could not save: ${error.message}`, 'error');
    return;
  }
  state.panel = 'output';
  $$('.panel-tab').forEach((t) => t.classList.toggle('active', t.dataset.panel === 'output'));
  showPanel();
  clearOutput();
  setStatus('Preparing PC preview…', 'warn');
  try {
    const result = await api.startPreview(state.current.dir);
    if (result.ok) {
      state.previewing = true;
      setStatus('Preview running', 'ok');
    } else {
      state.previewing = false;
      setStatus('Preview failed', 'error');
      if (result.error) toast(result.error, 'error');
    }
  } catch (error) {
    state.previewing = false;
    setStatus('Preview failed', 'error');
    toast(error.message, 'error');
  }
  updateButtons();
}

async function doEmulator() {
  if (!state.current) return;
  try {
    await saveAll();
    const result = await api.launchEmulator(state.current.dir);
    toast(`Copied to ${result.destFile}\nLaunching ${result.emulatorName}…`, 'ok', 6000);
    setStatus('Launched 3DS emulator', 'ok');
  } catch (error) {
    toast(error.message, 'error', 6000);
    setStatus('3DS emulator launch failed', 'error');
  }
}

/* ------------------------------------------------------------------ */
/* modals                                                             */

function closeModal() {
  const root = $('#modal-root');
  root.classList.add('hidden');
  root.innerHTML = '';
  state.modalClose = null;
}

function openModal({ title, subtitle, body, footer }) {
  const root = $('#modal-root');
  root.innerHTML = '';
  root.classList.remove('hidden');
  const modal = el('div', 'modal');
  const head = el('div', 'modal-head');
  head.appendChild(el('h2', '', title));
  if (subtitle) head.appendChild(el('p', '', subtitle));
  const bodyNode = el('div', 'modal-body');
  if (body) bodyNode.appendChild(body);
  const foot = el('div', 'modal-foot');
  for (const item of footer || []) foot.appendChild(item);
  modal.append(head, bodyNode, foot);
  root.appendChild(modal);
  root.onclick = (event) => {
    if (event.target === root) closeModal();
  };
  state.modalClose = closeModal;
  return { body: bodyNode, footer: foot, close: closeModal, modal };
}

function field(label, input) {
  const wrap = el('label', 'field');
  wrap.appendChild(el('span', '', label));
  wrap.appendChild(input);
  return wrap;
}

function textInput(value = '', placeholder = '') {
  const input = el('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

function confirmDialog(title, message, confirmLabel = 'Delete') {
  return new Promise((resolve) => {
    const body = el('p', 'hint', message);
    body.style.fontSize = '13px';
    body.style.color = 'var(--muted)';
    const cancel = button('Cancel', 'btn', () => { closeModal(); resolve(false); });
    const ok = button(confirmLabel, 'btn danger', () => { closeModal(); resolve(true); });
    openModal({
      title,
      body,
      footer: [cancel, ok]
    });
  });
}

function newProjectModal() {
  let language = 'c';
  let templateId = 'c-hello';
  const body = el('div');
  const nameInput = textInput('MyApp', 'MyApp');
  body.appendChild(field('App name', nameInput));

  body.appendChild(el('span', 'field-label', 'Language'));
  const choices = el('div', 'choice-grid');
  const cChoice = el('button', 'choice active');
  cChoice.type = 'button';
  cChoice.innerHTML = '<b>C SDK</b><span>Native C with aurora_app.h. Every .c file is compiled together.</span>';
  const aChoice = el('button', 'choice');
  aChoice.type = 'button';
  aChoice.innerHTML = '<b>Auric</b><span>A small friendly language. .aur files are joined into one program.</span>';
  choices.append(cChoice, aChoice);
  body.appendChild(choices);

  const templateLabel = el('span', 'field-label', 'Template');
  body.appendChild(templateLabel);
  const templateList = el('div', 'template-list');
  body.appendChild(templateList);

  const error = el('div', 'error-text');
  body.appendChild(error);

  const renderTemplates = () => {
    templateList.innerHTML = '';
    for (const template of TEMPLATES.filter((t) => t.language === language)) {
      const item = el('button', 'template-item');
      item.type = 'button';
      if (template.id === templateId) item.classList.add('active');
      item.innerHTML = `<b>${template.name}</b><span>${template.description}</span>`;
      item.addEventListener('click', () => {
        templateId = template.id;
        renderTemplates();
      });
      templateList.appendChild(item);
    }
  };

  const setLanguage = (next) => {
    language = next;
    cChoice.classList.toggle('active', language === 'c');
    aChoice.classList.toggle('active', language === 'auric');
    const first = TEMPLATES.find((t) => t.language === language);
    templateId = first ? first.id : '';
    renderTemplates();
  };
  cChoice.addEventListener('click', () => setLanguage('c'));
  aChoice.addEventListener('click', () => setLanguage('auric'));
  renderTemplates();

  const cancel = button('Cancel', 'btn', closeModal);
  const create = button('Create project', 'btn primary', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      error.textContent = 'Give the app a name.';
      return;
    }
    create.disabled = true;
    error.textContent = '';
    try {
      const project = await api.createProject({ name, language, templateId });
      closeModal();
      await refreshProjects();
      await openProject(project.dir);
      toast(`Created ${project.meta.name}.`);
    } catch (err) {
      error.textContent = err.message;
      create.disabled = false;
    }
  });

  openModal({
    title: 'New project',
    subtitle: 'Pick a language and a starting point. You can change the files afterwards.',
    body,
    footer: [cancel, create]
  });
  nameInput.focus();
  nameInput.select();
}

function newFileModal() {
  if (!state.current) return;
  const ext = state.current.meta.language === 'auric' ? '.aur' : '.c';
  const input = textInput(`src/newfile${ext}`, `src/newfile${ext}`);
  const body = el('div');
  body.appendChild(field('File path', input));
  body.appendChild(el('p', 'hint',
    'Paths are relative to the project. Folders are created automatically.'));
  const error = el('div', 'error-text');
  body.appendChild(error);

  const cancel = button('Cancel', 'btn', closeModal);
  const create = button('Create file', 'btn primary', async () => {
    const rel = input.value.trim().replace(/\\/g, '/');
    if (!rel) {
      error.textContent = 'Give the file a path.';
      return;
    }
    create.disabled = true;
    try {
      const result = await api.createFile(state.current.dir, rel, '');
      state.current.meta = result.meta;
      renderFileList();
      renderAppInfo();
      closeModal();
      await openFile(result.file);
      toast(`Created ${result.file}.`);
    } catch (err) {
      error.textContent = err.message;
      create.disabled = false;
    }
  });
  openModal({
    title: 'New file',
    subtitle: 'Add another source file to this project.',
    body,
    footer: [cancel, create]
  });
  input.focus();
}

function renameFileModal() {
  if (!state.current || !state.activeFile) {
    toast('Open a file first.', 'warn');
    return;
  }
  const oldRel = state.activeFile;
  const input = textInput(oldRel, oldRel);
  const body = el('div');
  body.appendChild(field('New path', input));
  const error = el('div', 'error-text');
  body.appendChild(error);

  const cancel = button('Cancel', 'btn', closeModal);
  const rename = button('Rename', 'btn primary', async () => {
    const newRel = input.value.trim().replace(/\\/g, '/');
    if (!newRel || newRel === oldRel) {
      closeModal();
      return;
    }
    rename.disabled = true;
    try {
      await saveActive();
      const result = await api.renameFile(state.current.dir, oldRel, newRel);
      state.current.meta = result.meta;
      if (state.files[oldRel]) {
        state.files[newRel] = state.files[oldRel];
        delete state.files[oldRel];
      }
      state.tabs = state.tabs.map((r) => (r === oldRel ? newRel : r));
      state.activeFile = newRel;
      closeModal();
      renderFileList();
      renderTabs();
      renderAppInfo();
      toast(`Renamed to ${newRel}.`);
    } catch (err) {
      error.textContent = err.message;
      rename.disabled = false;
    }
  });
  openModal({
    title: 'Rename file',
    body,
    footer: [cancel, rename]
  });
  input.focus();
  input.select();
}

async function deleteActiveFile() {
  if (!state.current || !state.activeFile) {
    toast('Open a file first.', 'warn');
    return;
  }
  const rel = state.activeFile;
  if (rel === state.current.meta.entry) {
    toast('The entry file cannot be deleted. Choose another entry first.', 'warn');
    return;
  }
  const ok = await confirmDialog('Delete file', `Delete ${rel}? This cannot be undone.`);
  if (!ok) return;
  try {
    const result = await api.deleteFile(state.current.dir, rel);
    state.current.meta = result.meta;
    delete state.files[rel];
    state.tabs = state.tabs.filter((r) => r !== rel);
    state.activeFile = null;
    renderFileList();
    renderTabs();
    renderAppInfo();
    const next = state.current.meta.files[0];
    if (next) await openFile(next);
    else {
      $('#editor-host').innerHTML = '';
      state.editor = null;
      showEmpty(true);
    }
    toast(`Deleted ${rel}.`);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function settingsModal() {
  const config = { ...(state.config || {}) };
  const body = el('div');

  const makeRow = (label, value, browse, placeholder) => {
    const input = textInput(value || '', placeholder || '');
    const row = el('div', 'form-row');
    row.appendChild(input);
    if (browse) {
      const b = button('Browse…', 'btn', async () => {
        const picked = await browse();
        if (picked) input.value = picked;
      });
      row.appendChild(b);
    }
    body.appendChild(field(label, row));
    return input;
  };

  const python = makeRow('Python 3 (optional)', config.pythonPath,
    () => api.chooseFile({ title: 'Choose the Python interpreter' }), 'python3');
  const toolchain = makeRow('devkitARM bin folder (optional)', config.toolchainPath,
    () => api.chooseFolder({ title: 'Choose the devkitARM bin folder' }), '/opt/devkitpro/devkitARM/bin');
  const emulator = makeRow('3DS emulator (optional)', config.emulatorPath,
    () => api.chooseFile({ title: 'Choose Azahar, Citra or Lime3DS' }), '/usr/bin/azahar');
  const sdmc = makeRow('Emulator SDMC folder (optional)', config.sdmcPath,
    () => api.chooseFolder({ title: 'Choose the emulator SDMC folder' }), '~/.local/share/azahar-emu/sdmc');
  const emuArgs = makeRow('Emulator arguments (optional)', config.emulatorArgs, null, '--fullscreen');

  body.appendChild(el('p', 'hint',
    'The studio finds ~/Documents/Aurora3DS, ~/Documents/AuroraOS and devkitPro ' +
    'automatically. These fields are only needed when auto-detection misses them.'));

  const error = el('div', 'error-text');
  body.appendChild(error);

  const cancel = button('Cancel', 'btn', closeModal);
  const save = button('Save settings', 'btn primary', async () => {
    save.disabled = true;
    try {
      const patch = {
        sdkPath: (state.config && state.config.sdkPath) || '',
        projectsRoot: (state.config && state.config.projectsRoot) || '',
        pythonPath: python.value.trim(),
        toolchainPath: toolchain.value.trim(),
        emulatorPath: emulator.value.trim(),
        sdmcPath: sdmc.value.trim(),
        emulatorArgs: emuArgs.value.trim()
      };
      const result = await api.saveConfig(patch);
      state.config = result.config;
      state.env = result.env;
      renderEnv();
      await refreshProjects();
      closeModal();
      toast('Settings saved.');
      setStatus('Settings saved', 'ok');
    } catch (err) {
      error.textContent = err.message;
      save.disabled = false;
    }
  });

  openModal({
    title: 'Settings',
    subtitle: 'Where the SDK, compiler and emulator live.',
    body,
    footer: [cancel, save]
  });
}

/* ------------------------------------------------------------------ */
/* wiring                                                             */

function bindStatic() {
  $('#btn-new-project').addEventListener('click', newProjectModal);
  $('#btn-empty-new').addEventListener('click', newProjectModal);
  $('#btn-empty-open').addEventListener('click', openFolder);
  $('#btn-open-folder').addEventListener('click', openFolder);
  $('#btn-new-file').addEventListener('click', newFileModal);
  $('#btn-rename-file').addEventListener('click', renameFileModal);
  $('#btn-delete-file').addEventListener('click', deleteActiveFile);
  $('#btn-build').addEventListener('click', doBuild);
  $('#btn-run').addEventListener('click', doRun);
  $('#btn-emulator').addEventListener('click', doEmulator);
  $('#btn-settings').addEventListener('click', settingsModal);
  $('#btn-clear-output').addEventListener('click', clearOutput);
  $('#btn-close-panel').addEventListener('click', () => $('#bottom-panel').classList.add('hidden'));
  $$('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
  });


  $$('.panel-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.panel = tab.dataset.panel;
      $$('.panel-tab').forEach((t) => t.classList.toggle('active', t === tab));
      renderOutput();
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.modalClose) {
      state.modalClose();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveActive().catch((error) => toast(error.message, 'error'));
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      doBuild();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      doRun();
    }
  });
}

async function openFolder() {
  const dir = await api.chooseFolder({ title: 'Open an Aurora3DS project' });
  if (dir) {
    try {
      await openProject(dir);
    } catch (error) {
      toast(error.message, 'error');
    }
  }
}

async function importIcon() {
  if (!state.current) return;
  const file = await api.chooseFile({
    title: 'Choose a 32x32 PNG for the logo',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp'] }]
  });
  if (!file) return;
  try {
    const result = await api.importIcon(state.current.dir, null, file);
    state.current.icon = { bits: result.bits };
    state.current.meta = result.meta;
    if (state.iconEditor) state.iconEditor.setBits(result.bits);
    updateProjectInList();
    toast('Logo imported. Light pixels become the logo.');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function bindApiEvents() {
  api.onBuildOutput((payload) => appendOutput(payload));
  api.onPreviewOutput((payload) => appendOutput(payload));
  api.onPreviewExit((payload) => {
    if (!state.current || payload.dir !== state.current.dir) return;
    state.previewing = false;
    updateButtons();
    setStatus(payload.code === 0 ? 'Preview closed' : `Preview exited (${payload.code ?? '?'})`,
      payload.code === 0 ? 'ok' : 'warn');
  });
  api.onMenuEvent('menu:new-project', newProjectModal);
  api.onMenuEvent('menu:mode', (mode) => setMode(mode));
  api.onMenuEvent('menu:open-project', (dir) => {
    openProject(dir).catch((error) => toast(error.message, 'error'));
  });
  api.onMenuEvent('menu:settings', settingsModal);
  api.onMenuEvent('menu:save', () => saveActive().catch((error) => toast(error.message, 'error')));
  api.onMenuEvent('menu:build', doBuild);
  api.onMenuEvent('menu:run', doRun);
  api.onMenuEvent('menu:run-emulator', doEmulator);
}

async function init() {
  bindStatic();
  bindApiEvents();
  try {
    const info = await api.info();
    state.env = info.env;
    state.config = await api.getConfig();
    renderEnv();
    await refreshProjects();
    if (state.projects.length) {
      const recent = state.recent.find((dir) => state.projects.some((p) => p.dir === dir));
      const dir = recent || state.projects[0].dir;
      await openProject(dir);
    } else {
      showEmpty(true);
      setStatus('No projects yet — make one to get started.');
    }
  } catch (error) {
    toast(`Could not start the studio: ${error.message}`, 'error', 8000);
    showEmpty(true);
  }
  updateButtons();
}

init();

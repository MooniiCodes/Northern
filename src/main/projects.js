'use strict';

const fs = require('fs');
const path = require('path');
const {
  readJson,
  writeJson,
  ensureDir
} = require('./config');
const {
  isEditableFile,
  languageForFile
} = require('../shared/constants');
const {
  getTemplate,
  applyPlaceholders
} = require('../shared/templates');
const {
  defaultBits,
  normalizeBits,
  bitsFromIconText,
  iconTextFromBits
} = require('../shared/icon');

const META_NAME = 'aurora.json';
const SKIP_DIRS = new Set([
  'dist', '.build', '.preview', 'node_modules', '.git', '.idea', '.vscode'
]);

function safeName(name) {
  let out = String(name || '').trim();
  out = out.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!out) out = 'MyApp';
  return out.slice(0, 64);
}

function slugify(name) {
  const base = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '');
  return (base || 'App').slice(0, 48);
}

function uniqueDir(root, slug) {
  let dir = path.join(root, slug);
  let n = 2;
  while (fs.existsSync(dir)) {
    dir = path.join(root, `${slug}-${n}`);
    n++;
  }
  return dir;
}

function projectMetaPath(dir) {
  return path.join(dir, META_NAME);
}

function resolveInside(root, rel) {
  const base = path.resolve(root);
  const target = path.resolve(base, String(rel || ''));
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('That path is outside the project.');
  }
  return target;
}

function relPath(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

function walkFiles(dir, root, out, depth = 0) {
  if (depth > 8) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(abs, root, out, depth + 1);
    } else if (entry.isFile() && isEditableFile(entry.name)) {
      const rel = relPath(root, abs);
      if (rel !== META_NAME) out.push(rel);
    }
  }
}

function scanFiles(dir) {
  const out = [];
  walkFiles(dir, dir, out);
  out.sort((a, b) => {
    const aSrc = a.startsWith('src/') ? 0 : 1;
    const bSrc = b.startsWith('src/') ? 0 : 1;
    if (aSrc !== bSrc) return aSrc - bSrc;
    return a.localeCompare(b);
  });
  return out;
}

function inferMeta(dir) {
  const files = scanFiles(dir);
  const cEntry = files.find((f) => f.endsWith('.c')) || null;
  const auricEntry = files.find((f) => f.endsWith('.aur')) || null;
  const language = auricEntry && !cEntry ? 'auric' : 'c';
  const entry = language === 'auric' ? auricEntry : cEntry;
  return {
    name: path.basename(dir),
    slug: path.basename(dir),
    language,
    entry: entry || (language === 'auric' ? 'src/main.aur' : 'src/main.c'),
    files,
    icon: 'icon.icon',
    template: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeMeta(raw, dir) {
  const fallback = inferMeta(dir);
  const language = raw.language === 'auric' ? 'auric' : 'c';
  const meta = {
    ...fallback,
    ...raw,
    name: safeName(raw.name || fallback.name),
    slug: slugify(raw.slug || raw.name || path.basename(dir)),
    language,
    entry: raw.entry || fallback.entry,
    files: Array.isArray(raw.files) ? raw.files.filter((f) => typeof f === 'string') : fallback.files,
    icon: raw.icon || 'icon.icon',
    createdAt: raw.createdAt || fallback.createdAt,
    updatedAt: raw.updatedAt || fallback.updatedAt
  };
  return meta;
}

function reconcileFiles(dir, meta) {
  const onDisk = scanFiles(dir);
  const ordered = [];
  for (const file of meta.files) {
    if (onDisk.includes(file) && !ordered.includes(file)) ordered.push(file);
  }
  for (const file of onDisk) {
    if (!ordered.includes(file)) ordered.push(file);
  }
  meta.files = ordered;
  if (!meta.entry || !onDisk.includes(meta.entry)) {
    meta.entry =
      (meta.language === 'auric'
        ? ordered.find((f) => f.endsWith('.aur'))
        : ordered.find((f) => f.endsWith('.c'))) || meta.entry;
  }
  return meta;
}

function readMeta(dir) {
  const file = projectMetaPath(dir);
  const raw = readJson(file, null);
  const meta = raw ? normalizeMeta(raw, dir) : inferMeta(dir);
  reconcileFiles(dir, meta);
  return meta;
}

function writeMeta(dir, meta) {
  meta.updatedAt = new Date().toISOString();
  writeJson(projectMetaPath(dir), meta);
  return meta;
}

function iconPath(dir, meta) {
  return path.join(dir, meta.icon || 'icon.icon');
}

function readIcon(dir, meta) {
  const file = iconPath(dir, meta);
  try {
    const text = fs.readFileSync(file, 'utf8');
    return { bits: bitsFromIconText(text), text };
  } catch {
    const bits = defaultBits();
    return { bits, text: iconTextFromBits(bits) };
  }
}

function saveIcon(dir, meta, bits) {
  const normalized = normalizeBits(bits);
  const text = iconTextFromBits(normalized);
  fs.writeFileSync(iconPath(dir, meta), text, 'utf8');
  return { bits: normalized, text };
}

function writeProjectReadme(dir, meta) {
  const build =
    meta.language === 'auric'
      ? `python "${'<SDK>'}/auric-lang/compiler/aurc.py" build src/${path.basename(meta.entry || 'main.aur')} -o dist/${meta.slug}.bin --icon icon.icon`
      : `python "${'<SDK>'}/sdk/aurcc.py" build src -o dist/${meta.slug}.bin --icon icon.icon`;
  const text = `# ${meta.name}

An Aurora3DS app made with **Aurora3DS Studio**.

- Language: **${meta.language === 'auric' ? 'Auric' : 'C SDK'}**
- Entry: \`${meta.entry}\`
- Output: \`dist/${meta.slug}.bin\`

## Build

Open the project in Aurora3DS Studio and press **Build**, or run:

\`\`\`sh
${build}
\`\`\`

Copy \`dist/${meta.slug}.bin\` to \`SD:/Aurora/Apps/${meta.language === 'c' ? 'C/' : ''}\` on the 3DS.

## Run

Press **Run** in the studio to launch the built-in PC emulator. The emulator
uses SDL2 and opens a window with both Aurora screens.

## Files

${meta.files.map((f) => `- \`${f}\``).join('\n')}
`;
  fs.writeFileSync(path.join(dir, 'README.md'), text, 'utf8');
}

function createProject({ projectsRoot, name, language, templateId, iconBits }) {
  const displayName = safeName(name);
  const slug = slugify(displayName);
  const lang = language === 'auric' ? 'auric' : 'c';
  const template = getTemplate(templateId) || getTemplate(lang === 'auric' ? 'auric-hello' : 'c-hello');
  if (!template) throw new Error('Unknown template.');
  if (template.language !== lang) {
    throw new Error('That template is for a different language.');
  }

  if (!projectsRoot) throw new Error('Choose a projects folder in Settings first.');
  ensureDir(projectsRoot);
  const dir = uniqueDir(projectsRoot, slug);
  ensureDir(dir);
  ensureDir(path.join(dir, 'src'));
  ensureDir(path.join(dir, 'dist'));
  ensureDir(path.join(dir, '.build'));
  ensureDir(path.join(dir, '.preview'));
  ensureDir(path.join(dir, 'assets'));
  ensureDir(path.join(dir, 'data'));

  const files = {};
  for (const [rel, content] of Object.entries(template.files)) {
    const abs = resolveInside(dir, rel);
    ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, applyPlaceholders(content, displayName, slug), 'utf8');
    files[rel] = true;
  }

  const meta = {
    name: displayName,
    slug,
    language: lang,
    entry: template.entry,
    files: [...template.order],
    icon: 'icon.icon',
    template: template.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  saveIcon(dir, meta, iconBits || defaultBits());
  writeProjectReadme(dir, meta);
  reconcileFiles(dir, meta);
  writeMeta(dir, meta);

  return { dir, meta, icon: readIcon(dir, meta) };
}

function openProject(dir) {
  const base = path.resolve(dir);
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    throw new Error('Project folder not found.');
  }
  const meta = readMeta(base);
  if (!fs.existsSync(iconPath(base, meta))) saveIcon(base, meta, defaultBits());
  reconcileFiles(base, meta);
  writeMeta(base, meta);
  return { dir: base, meta, icon: readIcon(base, meta) };
}

function listProjects(projectsRoot) {
  if (!projectsRoot) return [];
  ensureDir(projectsRoot);
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(projectsRoot, entry.name);
    if (!fs.existsSync(projectMetaPath(dir))) {
      const files = scanFiles(dir);
      if (!files.some((f) => f.endsWith('.c') || f.endsWith('.aur'))) continue;
    }
    try {
      const meta = readMeta(dir);
      const icon = readIcon(dir, meta);
      out.push({ dir, meta, iconBits: icon.bits });
    } catch {
      // Ignore folders that are not projects.
    }
  }
  out.sort((a, b) => String(b.meta.updatedAt).localeCompare(String(a.meta.updatedAt)));
  return out;
}

function readFile(dir, rel) {
  const abs = resolveInside(dir, rel);
  const stat = fs.statSync(abs);
  if (stat.size > 2 * 1024 * 1024) {
    throw new Error('That file is larger than 2 MB.');
  }
  const text = fs.readFileSync(abs, 'utf8');
  return { text, language: languageForFile(path.basename(rel)) };
}

function writeFile(dir, rel, text) {
  const abs = resolveInside(dir, rel);
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, String(text), 'utf8');
  const meta = readMeta(dir);
  if (!meta.files.includes(rel)) {
    meta.files.push(rel);
    reconcileFiles(dir, meta);
    writeMeta(dir, meta);
  } else {
    writeMeta(dir, meta);
  }
  return { ok: true, meta };
}

function createFile(dir, rel, text = '') {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean) throw new Error('Give the file a name.');
  const abs = resolveInside(dir, clean);
  if (fs.existsSync(abs)) throw new Error('That file already exists.');
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, text, 'utf8');
  const meta = readMeta(dir);
  if (!meta.files.includes(clean)) meta.files.push(clean);
  reconcileFiles(dir, meta);
  writeMeta(dir, meta);
  return { meta, file: clean };
}

function deleteFile(dir, rel) {
  const meta = readMeta(dir);
  if (rel === meta.entry) throw new Error('The entry file cannot be deleted. Choose another entry first.');
  const abs = resolveInside(dir, rel);
  if (!fs.existsSync(abs)) throw new Error('That file does not exist.');
  fs.rmSync(abs, { force: true });
  meta.files = meta.files.filter((f) => f !== rel);
  reconcileFiles(dir, meta);
  writeMeta(dir, meta);
  return { meta };
}

function renameFile(dir, oldRel, newRel) {
  const clean = String(newRel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean) throw new Error('Give the file a name.');
  const oldAbs = resolveInside(dir, oldRel);
  const newAbs = resolveInside(dir, clean);
  if (!fs.existsSync(oldAbs)) throw new Error('That file does not exist.');
  if (fs.existsSync(newAbs)) throw new Error('A file with that name already exists.');
  ensureDir(path.dirname(newAbs));
  fs.renameSync(oldAbs, newAbs);
  const meta = readMeta(dir);
  meta.files = meta.files.map((f) => (f === oldRel ? clean : f));
  if (meta.entry === oldRel) meta.entry = clean;
  reconcileFiles(dir, meta);
  writeMeta(dir, meta);
  return { meta, file: clean };
}

function moveFile(dir, rel, direction) {
  const meta = readMeta(dir);
  const index = meta.files.indexOf(rel);
  if (index < 0) throw new Error('That file is not in the project list.');
  const next = direction === 'up' ? index - 1 : index + 1;
  if (next < 0 || next >= meta.files.length) return { meta };
  const files = [...meta.files];
  [files[index], files[next]] = [files[next], files[index]];
  meta.files = files;
  writeMeta(dir, meta);
  return { meta };
}

function updateMeta(dir, patch) {
  const meta = readMeta(dir);
  if (patch.name != null) meta.name = safeName(patch.name);
  if (patch.entry != null && meta.files.includes(patch.entry)) meta.entry = patch.entry;
  if (patch.icon != null) meta.icon = patch.icon;
  reconcileFiles(dir, meta);
  writeMeta(dir, meta);
  return { meta };
}

function collectBuildSources(dir, meta) {
  const files = meta.files.filter((rel) => {
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) return false;
    if (meta.language === 'auric') return rel.endsWith('.aur');
    return /\.(c|s|S)$/.test(rel);
  });
  if (meta.entry && !files.includes(meta.entry) && fs.existsSync(path.join(dir, meta.entry))) {
    files.push(meta.entry);
  }
  return files;
}

function collectAuricFiles(dir, meta) {
  const files = collectBuildSources(dir, meta);
  if (!files.includes(meta.entry) && fs.existsSync(path.join(dir, meta.entry))) {
    files.push(meta.entry);
  }
  // The entry file goes last so `main` is easy to find in the joined source.
  const entry = files.filter((f) => f === meta.entry);
  const rest = files.filter((f) => f !== meta.entry);
  return [...rest, ...entry];
}

function combinedAuricSource(dir, meta) {
  const files = collectAuricFiles(dir, meta);
  const parts = [];
  for (const rel of files) {
    const abs = resolveInside(dir, rel);
    parts.push(`// ===== ${rel} =====\n${fs.readFileSync(abs, 'utf8')}\n`);
  }
  return { files, source: parts.join('\n') };
}

/* ------------------------------------------------------------------ */
/* assets (PNG sprites painted in the Painter tab)                    */

const IMAGE_EXT = /\.(png|jpe?g|bmp)$/i;

function assetRel(rel) {
  let clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!clean) throw new Error('Give the asset a name.');
  if (!clean.startsWith('assets/')) clean = `assets/${clean}`;
  if (!IMAGE_EXT.test(clean)) clean += '.png';
  return clean;
}

function listAssets(dir) {
  const root = path.join(path.resolve(dir), 'assets');
  const out = [];
  const walk = (current, depth) => {
    if (depth > 4) return;
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs, depth + 1);
      } else if (IMAGE_EXT.test(entry.name)) {
        try {
          const stat = fs.statSync(abs);
          out.push({ rel: relPath(root, abs).split(path.sep).join('/'), size: stat.size });
        } catch {}
      }
    }
  };
  walk(root, 0);
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('That image could not be decoded.');
  const mime = match[1] || 'image/png';
  const data = match[2]
    ? Buffer.from(match[3], 'base64')
    : Buffer.from(decodeURIComponent(match[3]), 'binary');
  if (data.length > 16 * 1024 * 1024) throw new Error('That image is larger than 16 MB.');
  return { mime, data };
}

function writeAsset(dir, rel, dataUrl) {
  const clean = assetRel(rel);
  const abs = resolveInside(dir, clean);
  const { data } = parseDataUrl(dataUrl);
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, data);
  return { ok: true, rel: clean, size: data.length };
}

function readAsset(dir, rel) {
  const clean = assetRel(rel);
  const abs = resolveInside(dir, clean);
  const stat = fs.statSync(abs);
  if (stat.size > 16 * 1024 * 1024) throw new Error('That image is larger than 16 MB.');
  const data = fs.readFileSync(abs);
  const ext = path.extname(clean).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.bmp' ? 'image/bmp' : 'image/png';
  return {
    rel: clean,
    size: stat.size,
    dataUrl: `data:${mime};base64,${data.toString('base64')}`
  };
}

function deleteAsset(dir, rel) {
  const clean = assetRel(rel);
  const abs = resolveInside(dir, clean);
  fs.rmSync(abs, { force: true });
  return { ok: true, rel: clean };
}

/* ------------------------------------------------------------------ */
/* GUI designer layout                                                */

const UI_FILE = 'ui.json';

function emptyLayout() {
  return {
    version: 1,
    background: { top: '#000000', bottom: '#000000' },
    top: [],
    bottom: []
  };
}

function normalizeLayout(value) {
  const layout = emptyLayout();
  if (!value || typeof value !== 'object') return layout;
  if (value.background && typeof value.background === 'object') {
    if (typeof value.background.top === 'string') layout.background.top = value.background.top;
    if (typeof value.background.bottom === 'string') layout.background.bottom = value.background.bottom;
  }
  for (const screen of ['top', 'bottom']) {
    const list = Array.isArray(value[screen]) ? value[screen] : [];
    layout[screen] = list
      .filter((w) => w && typeof w === 'object')
      .slice(0, 120)
      .map((w, index) => ({
        id: String(w.id || `${screen}-${index}`),
        type: ['label', 'button', 'panel', 'circle', 'image'].includes(w.type)
          ? w.type : 'label',
        x: Number.isFinite(w.x) ? w.x : 8,
        y: Number.isFinite(w.y) ? w.y : 8,
        w: Number.isFinite(w.w) ? w.w : 100,
        h: Number.isFinite(w.h) ? w.h : 24,
        text: typeof w.text === 'string' ? w.text.slice(0, 200) : 'Label',
        color: typeof w.color === 'string' ? w.color : '#64e8c8',
        textColor: typeof w.textColor === 'string' ? w.textColor : '#ffffff',
        font: ['small', 'regular', 'bold', 'title'].includes(w.font) ? w.font : 'regular',
        asset: typeof w.asset === 'string' ? w.asset.slice(0, 200) : ''
      }));
  }
  return layout;
}

function readUi(dir) {
  const file = path.join(path.resolve(dir), UI_FILE);
  try {
    return { layout: normalizeLayout(JSON.parse(fs.readFileSync(file, 'utf8'))) };
  } catch {
    return { layout: null };
  }
}

function writeUi(dir, layout) {
  const file = path.join(path.resolve(dir), UI_FILE);
  const clean = normalizeLayout(layout);
  const text = JSON.stringify(clean, null, 2) + '\n';
  if (text.length > 512 * 1024) throw new Error('The layout is too large.');
  fs.writeFileSync(file, text, 'utf8');
  return { ok: true, layout: clean };
}

function deleteProject(dir) {
  const base = path.resolve(dir);
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    throw new Error('Project folder not found.');
  }
  fs.rmSync(base, { recursive: true, force: true });
  return { ok: true, dir: base };
}

module.exports = {
  META_NAME,
  safeName,
  slugify,
  resolveInside,
  scanFiles,
  readMeta,
  writeMeta,
  readIcon,
  saveIcon,
  createProject,
  openProject,
  deleteProject,
  listProjects,
  readFile,
  writeFile,
  createFile,
  deleteFile,
  renameFile,
  moveFile,
  updateMeta,
  collectBuildSources,
  collectAuricFiles,
  combinedAuricSource,
  listAssets,
  readAsset,
  writeAsset,
  deleteAsset,
  readUi,
  writeUi,
  emptyLayout,
  normalizeLayout,
  writeProjectReadme
};

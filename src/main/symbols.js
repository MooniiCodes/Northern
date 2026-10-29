'use strict';

/* Turns the AuroraOS headers and the Auric prelude into completion items. */

const fs = require('fs');
const path = require('path');

const cache = new Map();

const C_KEYWORDS = [
  'auto', 'break', 'case', 'const', 'continue', 'default', 'do', 'else', 'enum',
  'extern', 'for', 'goto', 'if', 'inline', 'register', 'restrict', 'return',
  'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'volatile',
  'while', 'true', 'false', 'NULL'
];

const AURIC_KEYWORDS = [
  'fn', 'let', 'const', 'if', 'else', 'while', 'return', 'true', 'false',
  'break', 'continue', 'and', 'or', 'not'
];

function unique(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || !item.label || seen.has(item.label)) continue;
    seen.add(item.label);
    out.push(item);
  }
  return out;
}

function parseC(header) {
  const items = [];
  const text = String(header || '');

  const defineRe = /^[ \t]*#define[ \t]+([A-Za-z_]\w*)(?:[ \t]+([^\n]*))?/gm;
  let match;
  while ((match = defineRe.exec(text))) {
    const label = match[1];
    if (!label || label.endsWith('_H') || label === 'AURORA_APP_H') continue;
    items.push({
      label,
      kind: 'constant',
      detail: (match[2] || '').trim() || 'macro'
    });
  }

  const enumRe = /(?:typedef\s+)?enum(?:\s+\w+)?\s*\{([^}]*)\}\s*(?:\w+)?\s*;/g;
  while ((match = enumRe.exec(text))) {
    for (const part of match[1].split(',')) {
      const name = (part.split('=')[0] || '').trim();
      if (/^[A-Za-z_]\w*$/.test(name)) {
        items.push({ label: name, kind: 'constant', detail: 'enum value' });
      }
    }
  }

  const functionRe = new RegExp(
    '(?:^|\\n)[ \\t]*(?:static[ \\t]+|extern[ \\t]+|inline[ \\t]+)*' +
    '([A-Za-z_][\\w \\t*]*?)[ \\t]+([A-Za-z_]\\w*)[ \\t]*' +
    '\\(([^;{}]*)\\)[ \\t]*(?:AURORA_\\w+\\([^)]*\\)[ \\t]*)?;',
    'g'
  );
  while ((match = functionRe.exec(text))) {
    const ret = match[1].replace(/\s+/g, ' ').trim();
    const name = match[2];
    if (C_KEYWORDS.includes(name) || ret.includes('typedef')) continue;
    const params = match[3].replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
    items.push({
      label: name,
      kind: 'function',
      detail: `${ret} ${name}(${params})`
    });
  }

  const typedefRe = /typedef\s+[^;{}]*?\b([A-Za-z_]\w*)\s*;/g;
  while ((match = typedefRe.exec(text))) {
    if (match[1] !== 'void') {
      items.push({ label: match[1], kind: 'type', detail: 'typedef' });
    }
  }

  const structRe = /(?:struct|union)\s+([A-Za-z_]\w*)\s*\{/g;
  while ((match = structRe.exec(text))) {
    items.push({ label: match[1], kind: 'type', detail: 'struct' });
  }

  for (const keyword of C_KEYWORDS) {
    items.push({ label: keyword, kind: 'keyword', detail: 'C keyword' });
  }

  return unique(items);
}

function parseAuric(prelude) {
  const items = [];
  const text = String(prelude || '');

  const builtinRe = /"([a-z_]\w*)"\s*:\s*Builtin\(\(([^)]*)\),\s*"([^"]+)"/g;
  let match;
  while ((match = builtinRe.exec(text))) {
    const name = match[1];
    const params = match[2]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .join(', ');
    const ret = match[3];
    items.push({
      label: name,
      kind: 'function',
      detail: `${name}(${params}) -> ${ret}`
    });
  }

  const constRe = /"([A-Za-z_]\w*)"\s*:\s*Const\(\s*"([^"]+)"/g;
  while ((match = constRe.exec(text))) {
    items.push({ label: match[1], kind: 'constant', detail: match[2] });
  }

  for (const keyword of AURIC_KEYWORDS) {
    items.push({ label: keyword, kind: 'keyword', detail: 'Auric keyword' });
  }

  return unique(items);
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readSymbols(sdk) {
  if (!sdk) return { c: [], auric: [] };
  const header = path.join(sdk.sdkInclude || '', 'aurora_app.h');
  const prelude = path.join(sdk.auricRoot || '', 'compiler', 'prelude.py');
  const key = `${header}|${prelude}`;
  const stamp = (() => {
    try {
      return `${fs.statSync(header).mtimeMs}|${fs.statSync(prelude).mtimeMs}`;
    } catch {
      return '';
    }
  })();
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp) return hit.value;
  const value = {
    c: parseC(readIfExists(header)),
    auric: parseAuric(readIfExists(prelude))
  };
  cache.set(key, { stamp, value });
  return value;
}

module.exports = {
  parseC,
  parseAuric,
  readSymbols
};

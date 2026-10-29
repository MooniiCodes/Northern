'use strict';

/* Syntax-check every JavaScript file in the project with Node itself. */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'dist', '.build', '.preview', 'build']);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
    if (SKIP.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

const files = walk(ROOT, []).sort();
let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`ok   ${path.relative(ROOT, file)}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${path.relative(ROOT, file)}`);
    const text = String(error.stderr || error.message || '');
    console.error(text.trim());
  }
}

console.log(`\n${files.length - failed}/${files.length} files passed.`);
process.exit(failed ? 1 : 0);

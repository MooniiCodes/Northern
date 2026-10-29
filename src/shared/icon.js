'use strict';

const { ICON_SIZE, DEFAULT_ICON_TEXT } = require('./constants');

const ON_CHARS = new Set(['#', '*', 'X', 'O', '@', '8']);

function emptyBits() {
  return Array.from({ length: ICON_SIZE }, () => Array(ICON_SIZE).fill(false));
}

function defaultBits() {
  return bitsFromIconText(DEFAULT_ICON_TEXT);
}

function bitsFromIconText(text) {
  const bits = emptyBits();
  const rows = String(text || '')
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(';'));

  for (let y = 0; y < ICON_SIZE; y++) {
    const row = rows[y] || '';
    for (let x = 0; x < ICON_SIZE; x++) {
      bits[y][x] = ON_CHARS.has(row[x] || ' ');
    }
  }
  return bits;
}

function iconTextFromBits(bits) {
  const rows = [];
  for (let y = 0; y < ICON_SIZE; y++) {
    let row = '';
    for (let x = 0; x < ICON_SIZE; x++) {
      row += bits[y] && bits[y][x] ? '#' : ' ';
    }
    rows.push(row);
  }
  return rows.join('\n') + '\n';
}

function normalizeBits(bits) {
  const out = emptyBits();
  if (!Array.isArray(bits)) return out;
  for (let y = 0; y < ICON_SIZE; y++) {
    for (let x = 0; x < ICON_SIZE; x++) {
      out[y][x] = Boolean(bits[y] && bits[y][x]);
    }
  }
  return out;
}

/**
 * Electron nativeImage.toBitmap() gives raw BGRA bytes. Turn a 32x32 bitmap
 * into a monochrome icon: a pixel is on when it is visible and bright.
 */
function bitsFromBgra(buffer, width, height, threshold = 128) {
  const bits = emptyBits();
  if (!buffer || width <= 0 || height <= 0) return bits;
  const sx = width / ICON_SIZE;
  const sy = height / ICON_SIZE;

  for (let y = 0; y < ICON_SIZE; y++) {
    for (let x = 0; x < ICON_SIZE; x++) {
      // Sample the source area around this cell, not just one pixel.
      let on = 0;
      let total = 0;
      const x0 = Math.floor(x * sx);
      const y0 = Math.floor(y * sy);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      for (let yy = y0; yy < y1 && yy < height; yy++) {
        for (let xx = x0; xx < x1 && xx < width; xx++) {
          const i = (yy * width + xx) * 4;
          const b = buffer[i];
          const g = buffer[i + 1];
          const r = buffer[i + 2];
          const a = buffer[i + 3];
          const lum = (r * 299 + g * 587 + b * 114) / 1000;
          if (a >= 96 && lum >= threshold) on++;
          total++;
        }
      }
      bits[y][x] = total > 0 && on * 2 >= total;
    }
  }
  return bits;
}

module.exports = {
  ICON_SIZE,
  emptyBits,
  defaultBits,
  bitsFromIconText,
  iconTextFromBits,
  normalizeBits,
  bitsFromBgra
};

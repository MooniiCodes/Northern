'use strict';

/* A 32x32 monochrome logo editor. */

const DEFAULT_ICON_TEXT = ` ##############################
################################
##                            ##
##                            ##
##          ########          ##
##        ############        ##
##       ####      ####       ##
##      ###          ###      ##
##     ###                    ##
##     ###                    ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##    ###                     ##
##     ###                    ##
##     ###                    ##
##      ###          ###      ##
##       ####      ####       ##
##        ############        ##
##          ########          ##
##                            ##
##                            ##
##                            ##
##                            ##
################################
 ##############################`;

function emptyIconBits() {
  return Array.from({ length: 32 }, () => Array(32).fill(false));
}

function iconBitsFromText(text) {
  const bits = emptyIconBits();
  const rows = String(text || '').split(/\r?\n/);
  for (let y = 0; y < 32; y++) {
    const row = rows[y] || '';
    for (let x = 0; x < 32; x++) {
      bits[y][x] = '#*XO@8'.includes(row[x] || ' ');
    }
  }
  return bits;
}

function defaultIconBits() {
  return iconBitsFromText(DEFAULT_ICON_TEXT);
}

function normalizeIconBits(bits) {
  const out = emptyIconBits();
  if (!Array.isArray(bits)) return out;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      out[y][x] = Boolean(bits[y] && bits[y][x]);
    }
  }
  return out;
}

class IconEditor {
  constructor(host, options = {}) {
    this.host = host;
    this.onChange = options.onChange || (() => {});
    this.bits = defaultIconBits();
    this.cell = 10;
    this.size = 32 * this.cell;
    this.painting = false;
    this.paintValue = false;
    this.hover = null;

    host.innerHTML = '';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'icon-canvas';
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.draw();
    });
    window.addEventListener('pointerup', () => {
      if (!this.painting) return;
      this.painting = false;
      this.onChange(this.getBits());
    });
    this.draw();
  }

  cellAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * 32);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * 32);
    if (x < 0 || y < 0 || x >= 32 || y >= 32) return null;
    return { x, y };
  }

  pointerDown(event) {
    const cell = this.cellAt(event);
    if (!cell) return;
    this.painting = true;
    this.paintValue = !this.bits[cell.y][cell.x];
    this.bits[cell.y][cell.x] = this.paintValue;
    this.canvas.setPointerCapture?.(event.pointerId);
    this.draw();
    this.onChange(this.getBits());
  }

  pointerMove(event) {
    const cell = this.cellAt(event);
    this.hover = cell;
    if (this.painting && cell) {
      if (this.bits[cell.y][cell.x] !== this.paintValue) {
        this.bits[cell.y][cell.x] = this.paintValue;
        this.onChange(this.getBits());
      }
    }
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const c = this.cell;
    ctx.fillStyle = '#0b0f17';
    ctx.fillRect(0, 0, this.size, this.size);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (!this.bits[y][x]) continue;
        ctx.fillStyle = '#64e8c8';
        ctx.fillRect(x * c, y * c, c, c);
      }
    }
    ctx.strokeStyle = 'rgba(120, 150, 180, 0.18)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 32; i++) {
      ctx.beginPath();
      ctx.moveTo(i * c + 0.5, 0);
      ctx.lineTo(i * c + 0.5, this.size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * c + 0.5);
      ctx.lineTo(this.size, i * c + 0.5);
      ctx.stroke();
    }
    if (this.hover) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      ctx.strokeRect(this.hover.x * c + 1, this.hover.y * c + 1, c - 2, c - 2);
    }
    ctx.strokeStyle = 'rgba(100, 232, 200, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, this.size - 1, this.size - 1);
  }

  setBits(bits) {
    this.bits = normalizeIconBits(bits);
    this.draw();
  }

  getBits() {
    return this.bits.map((row) => row.map(Boolean));
  }

  clear() {
    this.bits = emptyIconBits();
    this.draw();
    this.onChange(this.getBits());
  }

  invert() {
    this.bits = this.bits.map((row) => row.map((on) => !on));
    this.draw();
    this.onChange(this.getBits());
  }

  reset() {
    this.bits = defaultIconBits();
    this.draw();
    this.onChange(this.getBits());
  }
}

window.IconEditor = IconEditor;
window.defaultIconBits = defaultIconBits;

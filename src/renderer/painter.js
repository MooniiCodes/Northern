'use strict';

/* The Painter: a small pixel-art canvas for app assets and the Home Menu logo.
 * Draws to an off-screen ImageData buffer and blits onto a zoomed canvas. */

const PAINTER_COLORS = [
  '#000000', '#ffffff', '#5f728c', '#a0a0a0', '#1a2537',
  '#ff6b7a', '#ffcc66', '#b6e39a', '#64e8c8', '#4aa8ff',
  '#c9a7ff', '#f0b37e', '#00ff00', '#0000ff', '#ff00ff', '#ff7f00'
];

class Painter {
  constructor(options = {}) {
    this.onDirty = options.onDirty || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.onError = options.onError || (() => {});
    this.onUseAsLogo = options.onUseAsLogo || (() => {});
    this.onLoadLogo = options.onLoadLogo || (() => {});
    this.onSave = options.onSave || (() => {});

    this.canvas = document.querySelector('#paint-canvas');
    this.stage = document.querySelector('#paint-stage');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.size = 32;
    this.zoom = 10;
    this.grid = true;
    this.tool = 'pen';
    this.color = '#64e8c8';
    this.name = '';
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this.drawing = false;
    this.lastPixel = null;

    this.buffer = document.createElement('canvas');
    this.bufferCtx = this.buffer.getContext('2d', { willReadFrequently: true });

    this.bind();
    this.newCanvas(32, '');
  }

  /* ------------------------------------------------------------------ dom */

  bind() {
    document.querySelectorAll('#painter-tools .tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.setTool(btn.dataset.paintTool));
    });
    const color = document.querySelector('#paint-color');
    color.addEventListener('input', () => { this.color = color.value; });

    document.querySelector('#paint-size').addEventListener('change', (event) => {
      const next = Number(event.target.value);
      if (next !== this.size) this.resample(next);
    });
    document.querySelector('#paint-grid').addEventListener('change', (event) => {
      this.grid = event.target.checked;
      this.render();
    });

    document.querySelector('#paint-undo').addEventListener('click', () => this.undo());
    document.querySelector('#paint-redo').addEventListener('click', () => this.redo());
    document.querySelector('#paint-new').addEventListener('click', () => this.newCanvasPrompt());

    document.querySelector('#paint-logo').addEventListener('click', () => { if (this.onLoadLogo) this.onLoadLogo(); });
    document.querySelector('#paint-use-logo').addEventListener('click', () => this.useAsLogo());

    document.addEventListener('keydown', (event) => {
      if (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
        return;
      }
      if (!this.isVisible()) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === 'p') this.setTool('pen');
      if (event.key.toLowerCase() === 'e') this.setTool('eraser');
      if (event.key.toLowerCase() === 'f') this.setTool('fill');
      if (event.key.toLowerCase() === 'i') this.setTool('picker');
      if (event.key.toLowerCase() === 'o') this.pickColorDialog();
    });

    this.canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    this.canvas.addEventListener('pointerup', () => this.pointerUp());
    this.canvas.addEventListener('pointerleave', () => this.pointerUp());
    this.canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.pickAt(event);
    });
  }

  setTool(tool) {
    if (!['pen', 'eraser', 'fill', 'picker'].includes(tool)) return;
    this.tool = tool;
    if (tool === 'eraser') this.eraseColor = true;
    document.querySelectorAll('#painter-tools .tool-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.paintTool === tool);
    });
  }

  isVisible() {
    const view = document.querySelector('#view-painter');
    return view && !view.classList.contains('hidden');
  }

  pickColorDialog() {
    const input = document.querySelector('#paint-color');
    input.focus({ preventScroll: true });
    try { input.click(); } catch {}
  }

  /* ---------------------------------------------------------------- model */

  newCanvas(size, name) {
    this.size = size || this.size;
    this.buffer.width = this.size;
    this.buffer.height = this.size;
    this.image = this.bufferCtx.createImageData(this.size, this.size);
    this.setAll(0, 0, 0, 0);
    this.setName(name || '');
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.onDirty();
    this.render();
  }

  setAll(r, g, b, a) {
    const data = this.image.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }

  /* ------------------------------------------------------------------ dom */

  paintSize() {
    const select = document.querySelector('#paint-size');
    const value = select ? Number(select.value) : 0;
    return value >= 8 && value <= 256 ? value : this.size;
  }

  newCanvasPrompt() {
    this.newCanvas(this.paintSize(), '');
    this.onStatus('Blank canvas.', 'ok');
  }

  setName(name) {
    this.name = name;
    const hint = document.querySelector('#paint-name-hint');
    if (hint) {
      hint.textContent = this.name
        ? `${this.name}${this.dirty ? ' •' : ''}`
        : 'Nothing open — press New.';
    }
  }

  markDirty() {
    this.dirty = true;
    this.setName(this.name);
    this.onDirty();
  }

  markSaved(name) {
    this.dirty = false;
    this.setName(name || this.name);
    this.onDirty();
  }

  /* ----------------------------------------------------------- load/save */

  loadDataUrl(dataUrl, name) {
    const img = new Image();
    img.onload = () => {
      const width = Math.max(8, Math.min(256, img.width || 32));
      const height = Math.max(8, Math.min(256, img.height || width));
      this.buffer.width = width;
      this.buffer.height = height;
      this.bufferCtx.clearRect(0, 0, width, height);
      this.bufferCtx.drawImage(img, 0, 0, width, height);
      this.size = width;
      this.image = this.bufferCtx.getImageData(0, 0, width, height);
      this.undoStack = [];
      this.redoStack = [];
      this.dirty = false;
      const select = document.querySelector('#paint-size');
      if (select) select.value = ['', '16', '32', '64', '128', '256'].includes(String(width))
        ? String(width) : '';
      this.setName(name || '');
      this.render();
      this.onDirty();
    };
    img.onerror = () => this.onError('That image could not be read.');
    img.src = dataUrl;
  }

  /* Paint the app logo (a 32x32 one-bit image) into the canvas. */
  setBits(bits) {
    this.newCanvas(32, 'logo');
    const [r, g, b] = [100, 232, 200];
    const data = this.image.data;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (bits && bits[y] && bits[y][x]) {
          const i = (y * 32 + x) * 4;
          data[i] = accent[0];
          data[i + 1] = accent[1];
          data[i + 2] = accent[2];
          data[i + 3] = 255;
        }
      }
    }
    this.dirty = false;
    this.setName('logo');
    this.render();
    this.onDirty();
  }

  getDataUrl() {
    this.bufferCtx.putImageData(this.image, 0, 0);
    return this.buffer.toDataURL('image/png');
  }

  isDirty() {
    return this.dirty;
  }

  getName() {
    return this.name;
  }

  /* ---------------------------------------------------------- edit pixels */

  pixelAt(x, y) {
    const i = (y * this.size + x) * 4;
    return {
      r: this.image.data[i], g: this.image.data[i + 1],
      b: this.image.data[i + 2], a: this.image.data[i + 3]
    };
  }

  setPixel(x, y, r, g, b, a) {
    const i = (y * this.size + x) * 4;
    const data = this.image.data;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  }

  pushUndo() {
    const copy = new Uint8ClampedArray(this.image.data);
    this.undoStack.push(copy);
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }

  popUndo() {
    const copy = this.undoStack.pop();
    if (!copy) return;
    this.redoStack.push(new Uint8ClampedArray(this.image.data));
    this.image.data.set(copy);
    this.render();
    this.markDirty();
  }

  undo() {
    this.popUndo();
  }

  redo() {
    const copy = this.redoStack.pop();
    if (!copy) return;
    this.undoStack.push(new Uint8ClampedArray(this.image.data));
    this.image.data.set(copy);
    this.render();
    this.markDirty();
  }

  hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return [0, 0, 0];
    const value = parseInt(m[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  /* ------------------------------------------------------------ pointers */

  render() {
    document.querySelector('#paint-info').textContent = `${this.buffer.width} × ${this.buffer.height}`;
    const zoom = this.zoomFor();
    this.canvas.width = this.buffer.width * zoom;
    this.canvas.height = this.buffer.height * zoom;
    this.canvas.style.width = `${this.canvas.width}px`;
    this.canvas.style.height = `${this.canvas.height}px`;
    this.ctx.imageSmoothingEnabled = false;
    this.bufferCtx.putImageData(this.image, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.buffer, 0, 0, this.canvas.width, this.canvas.height);
    if (this.grid && zoom >= 6) {
      this.ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      this.ctx.lineWidth = 1;
      for (let x = 1; x < this.buffer.width; x++) {
        this.ctx.beginPath();
        this.ctx.moveTo(x * zoom + 0.5, 0);
        this.ctx.lineTo(x * zoom + 0.5, this.canvas.height);
        this.ctx.stroke();
      }
      for (let y = 1; y < this.buffer.height; y++) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, y * zoom + 0.5);
        this.ctx.lineTo(this.canvas.width, y * zoom + 0.5);
        this.ctx.stroke();
      }
    }
    const hint = document.querySelector('#paint-name-hint');
    if (hint) this.setName(this.name);
  }

  zoomFor() {
    const cell = Math.floor(Math.min(
      (this.stage.clientWidth - 48) / this.buffer.width,
      (this.stage.clientHeight - 48) / this.buffer.height
    ));
    return Math.max(2, Math.min(16, cell || 8));
  }

  eventPixel(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / rect.width * this.buffer.width);
    const y = Math.floor((event.clientY - rect.top) / rect.height * this.buffer.height);
    if (x < 0 || y < 0 || x >= this.buffer.width || y >= this.buffer.height) return null;
    return { x, y };
  }

  pointerDown(event) {
    const pixel = this.eventPixel(event);
    if (!pixel) return;
    try { this.canvas.setPointerCapture?.(event.pointerId); } catch (e) {}
    if (event.button === 2) { this.pickAt(event); return; }
    if (event.button !== 0 && event.button !== 1) return;
    if (this.tool === 'picker') { this.pickAt(event); return; }
    this.pushUndo();
    this.drawing = true;
    if (this.tool === 'fill') {
      this.flood(pixel.x, pixel.y);
      this.render();
      this.markDirty();
      this.drawing = false;
      return;
    }
    this.lastPixel = pixel;
    this.strokeAt(pixel, event.shiftKey);
  }

  pointerMove(event) {
    if (!this.drawing) return;
    const pixel = this.eventPixel(event);
    if (!pixel) return;
    const from = this.lastPixel || pixel;
    this.lineTo(from, pixel, event.shiftKey);
    this.lastPixel = pixel;
    this.render();
    this.markDirty();
  }

  pointerUp() {
    this.drawing = false;
    this.lastPixel = null;
  }

  pickAt(event) {
    const pixel = this.eventPixel(event);
    if (!pixel) return;
    const c = this.pixelAt(pixel.x, pixel.y);
    const hex = `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    const input = document.querySelector('#paint-color');
    input.value = hex;
    this.color = hex;
    this.onStatus(`Picked ${hex}`, 'ok');
  }

  paintPixels(x, y, erase) {
    if (erase) {
      this.setPixel(x, y, 0, 0, 0, 0);
      return;
    }
    const [r, g, b] = this.hexToRgb(this.color);
    this.setPixel(x, y, r, g, b, 255);
  }

  strokeAt(pixel) {
    this.paintPixels(pixel.x, pixel.y, this.tool === 'eraser');
    this.lastPixel = pixel;
    this.render();
    this.markDirty();
  }

  lineTo(from, to) {
    let { x, y } = from;
    const dx = Math.abs(to.x - x);
    const dy = Math.abs(to.y - y);
    const sx = x < to.x ? 1 : -1;
    const sy = y < to.y ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.paintPixels(x, y, this.tool === 'eraser');
      if (x === to.x && y === to.y) break;
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  flood(x, y) {
    const target = this.pixelAt(x, y);
    const [r, g, b] = this.hexToRgb(this.color);
    if (target.a === 255 && target.r === r && target.g === g && target.b === b && this.tool === 'pen') {
      return;
    }
    const stack = [[x, y]];
    const seen = new Uint8Array(this.size * this.size);
    const matches = (px) => {
      const c = this.pixelAt(px % this.size, Math.floor(px / this.size));
      return c.r === target.r && c.g === target.g && c.b === target.b && c.a === target.a;
    };
    const aim = this.tool === 'eraser' ? [0, 0, 0, 0] : [r, g, b, 255];
    if (target.r === aim[0] && target.g === aim[1] && target.b === aim[2] &&
        target.a === aim[3]) return;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const idx = cy * this.size + cx;
      if (seen[idx] || !matches(idx)) continue;
      seen[idx] = 1;
      if (aim[3] === 0) this.setPixel(cx, cy, 0, 0, 0, 0);
      else this.setPixel(cx, cy, aim[0], aim[1], aim[2], 255);
      if (cx > 0) stack.push([cx - 1, cy]);
      if (cx < this.size - 1) stack.push([cx + 1, cy]);
      if (cy > 0) stack.push([cx, cy - 1]);
      if (cy < this.size - 1) stack.push([cx, cy + 1]);
    }
  }

  resample(next) {
    this.pushUndo();
    const before = this.image.data;
    const canvas = document.createElement('canvas');
    canvas.width = this.buffer.width;
    canvas.height = this.buffer.height;
    canvas.getContext('2d').putImageData(this.image, 0, 0);
    this.buffer.width = next;
    this.buffer.height = next;
    const ctx = this.buffer.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, next, next);
    ctx.drawImage(canvas, 0, 0, next, next);
    this.size = next;
    this.image = ctx.getImageData(0, 0, next, next);
    this.render();
    this.markDirty();
  }

  newCanvasPromptDuplicate() {
    this.newCanvas(this.size, '');
    this.onStatus('Blank canvas.', 'ok');
  }

  useAsLogo() {
    if (this.isAllTransparent()) {
      this.onError('The canvas is empty.');
      return;
    }
    let source = this.buffer;
    if (this.buffer.width !== 32 || this.buffer.height !== 32) {
      source = document.createElement('canvas');
      source.width = 32;
      source.height = 32;
      const ctx = source.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const scale = Math.min(32 / this.buffer.width, 32 / this.buffer.height);
      const padX = Math.floor((32 - this.buffer.width * scale) / 2);
      const padY = Math.floor((32 - this.buffer.height * scale) / 2);
      ctx.drawImage(this.buffer, padX, padY,
        Math.round(this.buffer.width * scale), Math.round(this.buffer.height * scale));
    }
    this.onUseAsLogo(source.toDataURL('image/png'));
  }

  isAllTransparent() {
    const data = this.image.data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return false;
    }
    return true;
  }
}

window.Painter = Painter;

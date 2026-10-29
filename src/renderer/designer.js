'use strict';

class Designer {
  constructor(options = {}) {
    this.getDir = options.getDir || (() => null);
    this.onStatus = options.onStatus || (() => {});
    this.onError = options.onError || (() => {});

    this.screen = 'top';
    this.zoom = 1.5;
    this.widgets = { top: [], bottom: [] };
    this.selected = null;
    this.counter = 0;

    this.canvas = document.querySelector('#designer-canvas');
    this.props = document.querySelector('#designer-props');

    this.bind();
    this.setScreen('top');
    this.applyZoom();
  }

  isVisible() {
    const view = document.querySelector('#view-designer');
    return !!view && !view.classList.contains('hidden');
  }

  bind() {
    document.querySelectorAll('[data-designer-screen]').forEach((btn) => {
      btn.addEventListener('click', () => this.setScreen(btn.dataset.designerScreen));
    });
    const palette = document.querySelector('#designer-palette');
    if (palette) {
      palette.querySelectorAll('.widget-btn').forEach((btn) => {
        btn.addEventListener('click', () => this.addWidget(btn.dataset.widget));
      });
    }
    const del = document.querySelector('#designer-delete');
    if (del) del.addEventListener('click', () => this.deleteSelected());
    const clear = document.querySelector('#designer-clear');
    if (clear) clear.addEventListener('click', () => this.clearScreen());
    const gen = document.querySelector('#designer-generate');
    if (gen) gen.addEventListener('click', () => this.save());
    const zoom = document.querySelector('#designer-zoom');
    if (zoom) {
      zoom.addEventListener('change', (event) => {
        this.zoom = Number(event.target.value) || 1;
        this.applyZoom();
      });
    }
    document.addEventListener('keydown', (event) => {
      if (!this.isVisible()) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && this.selected) {
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        event.preventDefault();
        this.deleteSelected();
      }
    });
  }

  setScreen(name) {
    if (name !== 'top' && name !== 'bottom') return;
    this.screen = name;
    document.querySelectorAll('[data-designer-screen]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.designerScreen === name);
    });
    if (this.canvas) {
      this.canvas.dataset.screen = name;
      this.canvas.style.width = (name === 'top' ? 400 : 320) + 'px';
      this.canvas.style.height = '240px';
    }
    this.selected = null;
    this.render();
    this.renderProps();
  }

  applyZoom() {
    if (this.canvas) this.canvas.style.transform = `scale(${this.zoom})`;
  }

  addWidget(type) {
    const w = {
      id: `${this.screen}-${this.counter++}`,
      type: type || 'label',
      x: 20,
      y: 20,
      w: 100,
      h: 24,
      text: 'Label',
      color: '#64e8c8',
      textColor: '#ffffff',
      font: 'regular',
      asset: ''
    };
    if (type === 'button') { w.text = 'Button'; w.w = 90; w.h = 28; }
    if (type === 'panel') { w.w = 120; w.h = 60; w.color = '#1a2537'; }
    if (type === 'circle') { w.w = 40; w.h = 40; w.color = '#64e8c8'; }
    if (type === 'image') { w.text = ''; w.w = 64; w.h = 64; w.color = '#2b3d56'; }
    this.widgets[this.screen].push(w);
    this.selected = w.id;
    this.render();
    this.renderProps();
  }

  render() {
    if (!this.canvas) return;
    this.canvas.innerHTML = '';
    const list = this.widgets[this.screen] || [];
    list.forEach((w) => {
      const el = document.createElement('div');
      el.className = `dw dw-${w.type}` + (this.selected === w.id ? ' selected' : '');
      el.style.left = w.x + 'px';
      el.style.top = w.y + 'px';
      el.style.width = w.w + 'px';
      el.style.height = w.h + 'px';
      if (w.type !== 'label') el.style.background = w.color || '#2b3d56';
      else el.style.background = 'transparent';
      if (w.type === 'label' || w.type === 'button') {
        el.textContent = w.text || '';
        el.style.color = w.textColor || '#ffffff';
      }
      if (w.type === 'image') el.textContent = w.asset ? w.asset : 'img';
      if (w.type === 'circle') el.style.background = w.color || '#64e8c8';

      const handle = document.createElement('div');
      handle.className = 'dw-resize';
      el.appendChild(handle);

      el.addEventListener('click', (event) => {
        event.stopPropagation();
        this.selected = w.id;
        this.render();
        this.renderProps();
      });

      this.makeDraggable(el, w, handle);
      this.canvas.appendChild(el);
    });

    this.canvas.onclick = (event) => {
      if (event.target === this.canvas) {
        this.selected = null;
        this.render();
        this.renderProps();
      }
    };
  }

  makeDraggable(el, w, handle) {
    let dragging = false;
    let resizing = false;
    let startX = 0;
    let startY = 0;
    let origX = 0;
    let origY = 0;
    let origW = 0;
    let origH = 0;

    el.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      if (event.target === handle) resizing = true;
      else dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      origX = w.x;
      origY = w.y;
      origW = w.w;
      origH = w.h;
      try { el.setPointerCapture(event.pointerId); } catch (e) {}
    });

    el.addEventListener('pointermove', (event) => {
      if (!dragging && !resizing) return;
      const dx = (event.clientX - startX) / this.zoom;
      const dy = (event.clientY - startY) / this.zoom;
      if (dragging) {
        w.x = Math.round(origX + dx);
        w.y = Math.round(origY + dy);
      }
      if (resizing) {
        w.w = Math.max(8, Math.round(origW + dx));
        w.h = Math.max(8, Math.round(origH + dy));
      }
      el.style.left = w.x + 'px';
      el.style.top = w.y + 'px';
      el.style.width = w.w + 'px';
      el.style.height = w.h + 'px';
    });

    const end = () => {
      if (dragging || resizing) this.renderProps();
      dragging = false;
      resizing = false;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointerleave', end);
  }

  deleteSelected() {
    if (!this.selected) return;
    this.widgets[this.screen] = this.widgets[this.screen].filter((w) => w.id !== this.selected);
    this.selected = null;
    this.render();
    this.renderProps();
  }

  clearScreen() {
    this.widgets[this.screen] = [];
    this.selected = null;
    this.render();
    this.renderProps();
  }

  renderProps() {
    if (!this.props) return;
    const w = (this.widgets[this.screen] || []).find((x) => x.id === this.selected);
    if (!w) {
      this.props.innerHTML = '<p class="hint">Select a widget.</p>';
      return;
    }
    this.props.innerHTML = '';
    const addField = (label, value, onChange, type = 'text') => {
      const row = document.createElement('div');
      row.className = 'form-row';
      const span = document.createElement('span');
      span.textContent = label;
      const input = document.createElement('input');
      input.type = type;
      input.value = value;
      input.addEventListener('change', () => onChange(input.value));
      if (type === 'number') {
        input.addEventListener('input', () => {
          const n = Number(input.value);
          if (Number.isFinite(n)) onChange(n);
        });
      }
      row.append(span, input);
      this.props.appendChild(row);
    };

    addField('Type', w.type, (v) => { w.type = v; this.render(); }, 'text');
    addField('X', w.x, (v) => { w.x = Number(v) || 0; this.render(); }, 'number');
    addField('Y', w.y, (v) => { w.y = Number(v) || 0; this.render(); }, 'number');
    addField('W', w.w, (v) => { w.w = Math.max(8, Number(v) || 8); this.render(); }, 'number');
    addField('H', w.h, (v) => { w.h = Math.max(8, Number(v) || 8); this.render(); }, 'number');
    addField('Text', w.text, (v) => { w.text = v; this.render(); }, 'text');
    addField('Color', w.color, (v) => { w.color = v; this.render(); }, 'text');
    addField('Text color', w.textColor, (v) => { w.textColor = v; this.render(); }, 'text');
    const fontSelect = document.createElement('select');
    fontSelect.className = 'panel-select';
    ['small', 'regular', 'bold', 'title'].forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      if (f === w.font) opt.selected = true;
      fontSelect.appendChild(opt);
    });
    fontSelect.addEventListener('change', () => { w.font = fontSelect.value; this.render(); });
    const fontRow = document.createElement('div');
    fontRow.className = 'form-row';
    const fontLabel = document.createElement('span');
    fontLabel.textContent = 'Font';
    fontRow.append(fontLabel, fontSelect);
    this.props.appendChild(fontRow);
  }

  async load(dir) {
    if (!dir) return;
    try {
      const res = await window.aurora.readUi(dir);
      if (res && res.layout) {
        this.widgets.top = Array.isArray(res.layout.top) ? res.layout.top : [];
        this.widgets.bottom = Array.isArray(res.layout.bottom) ? res.layout.bottom : [];
        this.render();
      }
    } catch (error) {
      this.onError(error.message);
    }
  }

  async save() {
    const dir = this.getDir();
    if (!dir) {
      this.onError('Open a project first.');
      return;
    }
    const layout = {
      version: 1,
      background: { top: '#000000', bottom: '#000000' },
      top: this.widgets.top,
      bottom: this.widgets.bottom
    };
    try {
      await window.aurora.writeUi(dir, layout);
      this.onStatus('UI layout saved.', 'ok');
    } catch (error) {
      this.onError(error.message);
    }
  }
}

window.Designer = Designer;

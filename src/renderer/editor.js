'use strict';

/* A small syntax-highlighted code editor: a transparent textarea over a
 * highlighted <pre>, with a line-number gutter, an autocomplete popup and a
 * find bar. No external editor library. */

const C_KEYWORDS = new Set([
  'auto', 'break', 'case', 'const', 'continue', 'default', 'do', 'else',
  'enum', 'extern', 'for', 'goto', 'if', 'inline', 'register', 'restrict',
  'return', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union',
  'volatile', 'while', '_Bool', 'true', 'false', 'NULL'
]);
const C_TYPES = new Set([
  'bool', 'char', 'double', 'float', 'int', 'long', 'short', 'signed',
  'unsigned', 'void', 'size_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'int8_t', 'int16_t', 'int32_t', 'int64_t', 'u8', 'u16', 'u32', 'u64',
  's8', 's16', 's32', 's64',
  'Screen', 'GfxFont', 'GfxImage', 'FsEntry',
  'FsDir', 'SysTime', 'SysLanguage', 'HttpResponse'
]);
const C_CONSTANTS = new Set([
  'SCREEN_TOP', 'SCREEN_BOTTOM', 'SCREEN_TOP_WIDTH', 'SCREEN_BOTTOM_WIDTH',
  'SCREEN_HEIGHT', 'FONT_MONO', 'FONT_SMALL', 'FONT_REGULAR', 'FONT_BOLD',
  'FONT_TITLE', 'COLOR_BLACK', 'COLOR_WHITE', 'COLOR_GRAY', 'COLOR_DARK_GRAY',
  'COLOR_RED', 'COLOR_GREEN', 'COLOR_BLUE', 'COLOR_CYAN', 'COLOR_MAGENTA',
  'COLOR_YELLOW', 'COLOR_ORANGE', 'COLOR_AURORA', 'KEY_A', 'KEY_B',
  'KEY_SELECT', 'KEY_START', 'KEY_RIGHT', 'KEY_LEFT', 'KEY_UP', 'KEY_DOWN',
  'KEY_R', 'KEY_L', 'KEY_X', 'KEY_Y', 'KEY_TOUCH', 'KEY_CPAD_RIGHT',
  'KEY_CPAD_LEFT', 'KEY_CPAD_UP', 'KEY_CPAD_DOWN', 'KEY_DPAD', 'KEY_CPAD',
  'SYS_TEMP_UNKNOWN', 'SYS_LANG_ENGLISH', 'SYS_LANG_SPANISH',
  'SYS_LANG_FRENCH'
]);

const AURIC_KEYWORDS = new Set([
  'fn', 'let', 'if', 'else', 'while', 'return', 'true', 'false', 'break',
  'continue', 'and', 'or', 'not'
]);
const AURIC_BUILTINS = new Set([
  'screen', 'print', 'print_int', 'clear', 'fill_rect', 'wait_key', 'delay',
  'keys_down', 'keys_held', 'touch_down', 'touch_held', 'touch_up', 'touch_x',
  'touch_y', 'touch_in', 'buffered', 'present', 'rand', 'millis', 'load_sound',
  'play_sound', 'play_music', 'stop_music', 'stop_sounds', 'net_connect',
  'net_online', 'net_error', 'net_address', 'http_get', 'http_post',
  'http_param', 'http_param_int', 'http_header', 'http_text', 'http_length',
  'http_lines', 'http_line', 'http_save', 'http_download', 'json_has',
  'json_int', 'json_float', 'json_bool', 'json_string', 'json_count',
  'json_index'
]);
const AURIC_CONSTANTS = new Set([
  'BLACK', 'WHITE', 'RED', 'GREEN', 'BLUE', 'CYAN', 'MAGENTA', 'YELLOW',
  'ORANGE', 'AURORA', 'GRAY', 'DARK_GRAY', 'TOP', 'BOTTOM', 'KEY_A', 'KEY_B',
  'KEY_SELECT', 'KEY_START', 'KEY_RIGHT', 'KEY_LEFT', 'KEY_UP', 'KEY_DOWN',
  'KEY_R', 'KEY_L', 'KEY_X', 'KEY_Y'
]);

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function span(cls, text) {
  return `<span class="tok-${cls}">${escapeHtml(text)}</span>`;
}

function isIdentStart(c) {
  return /[A-Za-z_]/.test(c);
}
function isIdent(c) {
  return /[A-Za-z0-9_]/.test(c);
}
function isDigit(c) {
  return c >= '0' && c <= '9';
}

function scanString(code, i) {
  const quote = code[i];
  let j = i + 1;
  while (j < code.length) {
    if (code[j] === '\\') { j += 2; continue; }
    if (code[j] === quote) { j++; break; }
    if (code[j] === '\n') break;
    j++;
  }
  return j;
}

function highlightCode(code, language) {
  if (language === 'markdown') return highlightMarkdown(code);
  if (language === 'json') return highlightJson(code);
  if (language !== 'c' && language !== 'auric' && language !== 'asm') {
    return escapeHtml(code);
  }
  const isAuric = language === 'auric';
  const keywords = isAuric ? AURIC_KEYWORDS : C_KEYWORDS;
  const types = isAuric ? new Set() : C_TYPES;
  const builtins = isAuric ? AURIC_BUILTINS : new Set();
  const constants = isAuric ? AURIC_CONSTANTS : C_CONSTANTS;

  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') {
      let j = code.indexOf('\n', i);
      if (j < 0) j = code.length;
      out += span('comment', code.slice(i, j));
      i = j;
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      let j = code.indexOf('*/', i + 2);
      j = j < 0 ? code.length : j + 2;
      out += span('comment', code.slice(i, j));
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const j = scanString(code, i);
      out += span(c === '"' ? 'string' : 'char', code.slice(i, j));
      i = j;
      continue;
    }
    if (c === '#' && (i === 0 || code[i - 1] === '\n')) {
      let j = code.indexOf('\n', i);
      if (j < 0) j = code.length;
      out += span('preprocessor', code.slice(i, j));
      i = j;
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(code[i + 1]))) {
      let j = i + 1;
      while (j < code.length && /[0-9a-fA-FxX._]/.test(code[j])) j++;
      out += span('number', code.slice(i, j));
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < code.length && isIdent(code[j])) j++;
      const word = code.slice(i, j);
      if (keywords.has(word)) out += span('keyword', word);
      else if (types.has(word)) out += span('type', word);
      else if (builtins.has(word)) out += span('builtin', word);
      else if (constants.has(word)) out += span('constant', word);
      else out += escapeHtml(word);
      i = j;
      continue;
    }
    out += escapeHtml(c);
    i++;
  }
  return out;
}

function highlightJson(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '"') {
      const j = scanString(code, i);
      const text = code.slice(i, j);
      let k = j;
      while (k < code.length && /\s/.test(code[k])) k++;
      out += span(code[k] === ':' ? 'key' : 'string', text);
      i = j;
      continue;
    }
    if (isDigit(c) || c === '-') {
      let j = i + 1;
      while (j < code.length && /[0-9.eE+-]/.test(code[j])) j++;
      out += span('number', code.slice(i, j));
      i = j;
      continue;
    }
    const m = /^(true|false|null)/.exec(code.slice(i));
    if (m) {
      out += span('constant', m[1]);
      i += m[1].length;
      continue;
    }
    out += escapeHtml(c);
    i++;
  }
  return out;
}

function highlightMarkdown(code) {
  return code.split('\n').map((line) => {
    if (/^#{1,6}\s/.test(line)) return span('keyword', line);
    if (/^\s*```/.test(line)) return span('comment', line);
    if (/^\s*[-*+]\s/.test(line)) return span('builtin', line);
    if (/^\s*>/.test(line)) return span('comment', line);
    return escapeHtml(line);
  }).join('\n');
}

/* ------------------------------------------------------------------ */

const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
const IDENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)$/;

class CodeEditor {
  constructor(host, options = {}) {
    this.host = host;
    this.onChange = options.onChange || (() => {});
    this.onSave = options.onSave || (() => {});
    this.onCursor = options.onCursor || (() => {});
    this.getCompletions = options.getCompletions || null;
    this.language = 'c';
    this.value = '';
    this.changeTimer = null;

    host.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'code-editor';
    root.innerHTML = `
      <div class="code-gutter"><div class="code-lines"></div></div>
      <div class="code-scroll">
        <pre class="code-highlight" aria-hidden="true"><code></code></pre>
        <textarea class="code-input" spellcheck="false" autocomplete="off"
          autocapitalize="off" autocorrect="off" wrap="off"></textarea>
        <div class="ac-popup hidden">
          <div class="ac-list"></div>
          <div class="ac-foot"></div>
        </div>
        <div class="find-bar hidden">
          <input class="fb-input" type="text" placeholder="Find">
          <span class="fb-count"></span>
          <button class="fb-btn fb-prev" type="button" title="Previous (Shift+Enter)">↑</button>
          <button class="fb-btn fb-next" type="button" title="Next (Enter)">↓</button>
          <button class="fb-btn fb-close" type="button" title="Close (Esc)">×</button>
        </div>
      </div>`;
    host.appendChild(root);
    this.root = root;
    this.lines = root.querySelector('.code-lines');
    this.pre = root.querySelector('.code-highlight');
    this.code = root.querySelector('code');
    this.input = root.querySelector('.code-input');
    this.scroll = root.querySelector('.code-scroll');
    this.popup = root.querySelector('.ac-popup');
    this.acList = root.querySelector('.ac-list');
    this.acFoot = root.querySelector('.ac-foot');
    this.findBar = root.querySelector('.find-bar');
    this.findInput = root.querySelector('.fb-input');
    this.findCount = root.querySelector('.fb-count');

    this.ac = null; /* { items, index, start, prefix } */
    this.findState = null; /* { query, index } */

    this.ensureMirror();
    this.bindEvents();
  }

  /* ---------------------------------------------------------------- basic */

  setLanguage(language) {
    this.language = language || 'text';
    this.render();
  }

  setValue(value, language) {
    if (language) this.language = language;
    this.value = String(value ?? '');
    this.input.value = this.value;
    this.hideCompletions();
    this.closeFind();
    this.render();
    this.syncScroll();
  }

  getValue() {
    return this.input.value;
  }

  focus() {
    this.input.focus();
  }

  ensureMirror() {
    if (this.mirror) return;
    const m = document.createElement('div');
    m.className = 'code-mirror';
    document.body.appendChild(m);
    this.mirror = m;
  }

  caretPixel() {
    const cs = getComputedStyle(this.input);
    const m = this.mirror;
    m.style.font = cs.font;
    m.style.padding = cs.padding;
    m.style.width = `${this.input.clientWidth}px`;
    m.textContent = this.input.value.slice(0, this.input.selectionStart);
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    m.appendChild(marker);
    const point = {
      x: marker.offsetLeft - this.input.scrollLeft,
      y: marker.offsetTop - this.input.scrollTop,
      height: parseFloat(cs.lineHeight) || 20
    };
    m.textContent = '';
    return point;
  }

  /* ---------------------------------------------------------------- events */

  bindEvents() {
    this.input.addEventListener('input', () => this.handleInput());
    this.input.addEventListener('scroll', () => this.syncScroll());
    this.input.addEventListener('keydown', (event) => this.handleKeyDown(event));
    this.input.addEventListener('click', () => {
      this.hideCompletions();
      this.reportCursor();
    });
    this.input.addEventListener('blur', () => setTimeout(() => this.hideCompletions(), 150));
    this.acList.addEventListener('mousedown', (event) => {
      const item = event.target.closest('.ac-item');
      if (!item) return;
      event.preventDefault();
      this.applyCompletion(item.dataset.index);
    });
    this.findInput.addEventListener('input', () => this.search());
    this.findInput.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') this.gotoMatch(event.shiftKey ? -1 : 1);
      if (event.key === 'Escape') this.closeFind(true);
    });
    this.root.querySelector('.fb-next').addEventListener('click', () => this.gotoMatch(1));
    this.root.querySelector('.fb-prev').addEventListener('click', () => this.gotoMatch(-1));
    this.root.querySelector('.fb-close').addEventListener('click', () => this.closeFind(true));
  }

  handleInput() {
    this.value = this.input.value;
    this.render();
    this.reportCursor();
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => this.onChange(this.value), 120);
    this.updateCompletions(false);
  }

  /* ------------------------------------------------------------ completion */

  updateCompletions(force) {
    if (!this.getCompletions) return;
    if (!force && this.value === '') {
      this.hideCompletions();
      return;
    }
    const pos = this.input.selectionStart;
    const before = this.value.slice(0, pos);
    const match = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(before);
    const prefix = match ? match[1] : '';
    if (!force && prefix.length < 2) {
      this.hideCompletions();
      return;
    }
    const start = pos - prefix.length;
    let items = [];
    try {
      items = this.getCompletions({ language: this.language, prefix }) || [];
    } catch {
      items = [];
    }
    const lower = prefix.toLowerCase();
    const ranked = items.filter((item) => item && item.label &&
      (!prefix || String(item.label).toLowerCase().startsWith(lower)));
    ranked.sort((a, b) =>
      (a.rank || 0) - (b.rank || 0) ||
      Number(b.kind === 'snippet') - Number(a.kind === 'snippet') ||
      a.label.length - b.label.length);
    if (!ranked.length ||
        (ranked.length === 1 && ranked[0].label === prefix && !force)) {
      this.hideCompletions();
      return;
    }
    this.ac = { items: ranked.slice(0, 300), index: 0, start, prefix };
    this.renderCompletions();
  }

  renderCompletions() {
    const ac = this.ac;
    this.acList.innerHTML = '';
    for (const [i, item] of ac.items.entries()) {
      const row = document.createElement('div');
      row.className = `ac-item${i === ac.index ? ' active' : ''}`;
      row.dataset.index = String(i);
      const kind = document.createElement('span');
      kind.className = `ac-kind ${item.kind || ''}`;
      kind.textContent = item.kind || 'word';
      const label = document.createElement('span');
      label.className = 'ac-label';
      label.textContent = item.label;
      const detail = document.createElement('span');
      detail.className = 'ac-detail';
      detail.textContent = item.detail || '';
      row.append(kind, label, detail);
      this.acList.appendChild(row);
    }
    const active = this.acList.querySelector('.ac-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
    const activeItem = ac.items[ac.index];
    this.acFoot.style.display = activeItem && activeItem.detail ? 'block' : 'none';
    this.acFoot.textContent = activeItem && activeItem.detail ? activeItem.detail : '';

    const point = this.caretPixel();
    const popupWidth = Math.max(220, Math.min(460, this.popup.offsetWidth || 340));
    const popupHeight = Math.min(ac.items.length * 28 + 20, 260);
    const left = Math.max(8, Math.min(point.x, this.input.clientWidth - popupWidth - 8));
    let top = point.y + point.height + 4;
    if (top + popupHeight > this.input.clientHeight) {
      top = Math.max(0, point.y - popupHeight - 4);
    }
    this.popup.style.width = `${popupWidth}px`;
    this.popup.style.left = `${left}px`;
    this.popup.style.top = `${top}px`;
    this.popup.classList.remove('hidden');
  }

  moveCompletion(delta) {
    if (!this.ac) return;
    const count = this.ac.items.length;
    this.ac.index = (this.ac.index + delta + count) % count;
    this.renderCompletions();
  }

  applyCompletion(source) {
    const ac = this.ac;
    if (!ac) return;
    const index = typeof source === 'number' ? source : ac.index;
    const item = ac.items[index];
    if (!item) { this.hideCompletions(); return; }
    let text = item.insert || item.label;
    let caret = text.length;
    const marker = text.indexOf('$0');
    if (marker >= 0) {
      caret = marker;
      text = text.replace('$0', '');
    } else if (item.kind === 'function' && !text.includes('(')) {
      text += '()';
      caret = text.length - 1;
    }
    this.hideCompletions();
    this.input.setRangeText(text, ac.start, this.input.selectionStart, 'end');
    this.input.setSelectionRange(ac.start + caret, ac.start + caret);
    this.handleInput();
  }

  hideCompletionsDom() {
    this.popup.classList.add('hidden');
    this.acList.innerHTML = '';
    this.acFoot.textContent = '';
  }

  hideCompletions() {
    this.ac = null;
    this.hideCompletionsDom();
  }

  /* ----------------------------------------------------------------- find */

  openFind() {
    this.findBar.classList.remove('hidden');
    const selection = this.getSelectedText();
    if (selection && !selection.includes('\n')) this.findInput.value = selection;
    this.findInput.focus();
    this.findInput.select();
    this.search();
  }

  closeFind(refocus) {
    this.findBar.classList.add('hidden');
    this.findState = null;
    if (refocus) this.input.focus();
  }

  matchPositions() {
    const state = this.findState;
    if (!state || !state.query) return [];
    const haystack = this.input.value.toLowerCase();
    const needle = state.query.toLowerCase();
    const positions = [];
    if (!needle) return positions;
    let i = haystack.indexOf(needle);
    while (i !== -1) {
      positions.push(i);
      i = haystack.indexOf(needle, i + needle.length);
    }
    return positions;
  }

  selectFind(index) {
    const state = this.findState;
    if (!state) return;
    const positions = this.matchPositions();
    if (!positions.length) {
      this.findCount.textContent = 'no match';
      return;
    }
    state.index = ((index % positions.length) + positions.length) % positions.length;
    const at = positions[state.index];
    this.findCount.textContent = `${state.index + 1} / ${positions.length}`;
    this.input.focus();
    this.input.setSelectionRange(at, at + state.query.length);
    const before = this.input.value.slice(0, at);
    const line = before.split('\n').length;
    const lineHeight = 13 * 1.55;
    const target = Math.max(0, (line - 3) * lineHeight);
    if (target < this.input.scrollTop || target > this.input.scrollTop + this.input.clientHeight - 60) {
      this.input.scrollTop = target;
    }
    this.reportCursor();
  }

  search() {
    const query = this.findInput.value;
    if (!query) {
      this.findCount.textContent = '';
      this.findState = null;
      return;
    }
    if (!this.findState || this.findState.query !== query) {
      this.findState = { query, index: -1 };
    }
    const positions = this.matchPositions();
    if (!positions.length) {
      this.findCount.textContent = 'no match';
      return;
    }
    const caret = this.input.selectionStart;
    let index = positions.findIndex((p) => p + query.length > caret);
    if (index === -1) index = 0;
    this.selectFind(index);
  }

  gotoMatch(direction) {
    if (!this.findState || !this.findState.query) return;
    this.selectFind((this.findState.index ?? -1) + direction);
  }

  getSelectedText() {
    return this.input.value.slice(
      this.input.selectionStart, this.input.selectionEnd
    );
  }

  /* ------------------------------------------------------------- spelling */

  syncScroll() {
    this.pre.scrollTop = this.input.scrollTop;
    this.pre.scrollLeft = this.input.scrollLeft;
    this.lines.style.transform = `translateY(${-this.input.scrollTop}px)`;
    if (this.ac) this.hideCompletions();
  }

  render() {
    const text = this.input.value;
    this.code.innerHTML = highlightCode(text, this.language) + '\n';
    const count = text.split('\n').length;
    let numbers = '';
    for (let i = 1; i <= count; i++) numbers += `${i}\n`;
    this.lines.textContent = numbers;
  }

  reportCursor() {
    const pos = this.input.selectionStart;
    const before = this.input.value.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    this.onCursor({ line, col });
  }

  /* ------------------------------------------------------------ shortcuts */

  currentLines() {
    const start = this.value.lastIndexOf('\n', this.input.selectionStart - 1) + 1;
    const end = this.value.indexOf('\n', this.input.selectionEnd);
    return { from: start, to: end === -1 ? this.value.length : end };
  }

  toggleComment() {
    const { from, to } = this.currentLines();
    const block = this.value.slice(from, to);
    const lines = block.split('\n');
    const real = lines.filter((line) => line.trim() !== '');
    const allCommented = real.length > 0 && real.every((line) => /^\s*\/\//.test(line));
    const next = lines.map((line) => {
      if (line.trim() === '') return line;
      if (allCommented) return line.replace(/^(\s*)\/\/ ?/, '$1');
      return `// ${line}`;
    }).join('\n');
    this.input.setRangeText(next, from, to, 'end');
    this.handleInput();
  }

  duplicateLines() {
    const { from, to } = this.currentLines();
    if (this.input.selectionStart !== this.input.selectionEnd) {
      const selected = this.getSelectedText();
      this.input.setRangeText(selected, this.input.selectionEnd, this.input.selectionEnd, 'end');
    } else {
      const block = this.value.slice(from, to);
      this.input.setRangeText(`\n${block}`, to, to, 'end');
    }
    this.handleInput();
  }

  moveLines(direction) {
    const text = this.value;
    const from = text.lastIndexOf('\n', this.input.selectionStart - 1) + 1;
    let to = text.indexOf('\n', this.input.selectionEnd);
    if (to === -1) to = text.length;
    const block = text.slice(from, to);

    if (direction < 0) {
      if (from === 0) return;
      const prevEnd = from - 1;
      const prevStart = text.lastIndexOf('\n', prevEnd - 1) + 1;
      const prev = text.slice(prevStart, prevEnd);
      const replacement = `${block}\n${prev}`;
      this.input.setRangeText(replacement, prevStart, to, 'end');
      this.input.setSelectionRange(prevStart, prevStart + block.length);
    } else {
      if (to >= text.length) return;
      const nextStart = to + 1;
      const nextEnd = (text.indexOf('\n', nextStart) + 1 || text.length + 1) - 1;
      const next = text.slice(nextStart, nextEnd);
      const replacement = `${next}\n${block}`;
      this.input.setRangeText(replacement, from, nextEnd, 'end');
      this.input.setSelectionRange(nextStart, nextStart + block.length);
    }
    this.handleInput();
  }

  autoClosePair(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const open = event.key;
    const close = PAIRS[open];
    if (!close) return false;
    const start = this.input.selectionStart;
    const end = this.input.selectionEnd;
    const next = this.value[end] || '';
    if (start === end) {
      if (open === close && next === open) {
        event.preventDefault();
        this.input.setSelectionRange(start + 1, start + 1);
        this.handleInput();
        return true;
      }
      if (!next || !isIdent(next) && next !== open) {
        event.preventDefault();
        this.input.setRangeText(open + close, start, end, 'end');
        this.input.setSelectionRange(start + 1, start + 1);
        this.handleInput();
        return true;
      }
    } else if (open !== close) {
      event.preventDefault();
      const selected = this.getSelectedText();
      this.input.setRangeText(open + selected + close, start, end, 'end');
      this.input.setSelectionRange(start + selected.length + 2, start + selected.length + 2);
      this.handleInput();
      return true;
    }
    return false;
  }

  skipClosePair(event) {
    const closers = new Set([')', ']', '}', '"', "'"]);
    if (!closers.has(event.key)) return false;
    const start = this.input.selectionStart;
    if (start !== this.input.selectionEnd) return false;
    if (this.value[start] === event.key) {
      event.preventDefault();
      this.input.setSelectionRange(start + 1, start + 1);
      return true;
    }
    return false;
  }

  handleKeyDown(event) {
    if (event.isComposing) return;

    if (this.ac) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.moveCompletion(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.moveCompletion(-1);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        this.applyCompletion();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hideCompletions();
        return;
      }
    }

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.onSave();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.openFind();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === '/') {
      event.preventDefault();
      this.toggleComment();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && !event.shiftKey) {
      event.preventDefault();
      this.duplicateLines();
      return;
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      this.moveLines(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (event.key === 'Escape') {
      if (!this.findBar.classList.contains('hidden')) {
        this.closeFind(true);
      }
      return;
    }
    if (event.key === 'Tab') {
      this.indent(event);
      return;
    }
    if (this.skipClosePair(event)) return;
    if (this.autoClosePair(event)) return;
    if (event.key === 'Enter') {
      this.smartEnter(event);
    }
  }

  indent(event) {
    event.preventDefault();
    const start = this.input.selectionStart;
    const end = this.input.selectionEnd;
    const text = this.input.value;
    if (start !== end && text.slice(start, end).includes('\n')) {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const block = text.slice(lineStart, end);
      const changed = event.shiftKey
        ? block.replace(/^ {1,2}/gm, '')
        : block.replace(/^/gm, '  ');
      this.input.setRangeText(changed, lineStart, end, 'select');
    } else if (event.shiftKey) {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const removed = /^( {1,2}|\t)/.exec(text.slice(lineStart));
      if (removed) {
        this.input.setRangeText('', lineStart, lineStart + removed[0].length, 'end');
        this.input.setSelectionRange(
          Math.max(lineStart, start - removed[0].length),
          Math.max(lineStart, end - removed[0].length)
        );
      }
    } else {
      this.input.setRangeText('  ', start, end, 'end');
    }
    this.handleInput();
  }

  smartEnter(event) {
    const start = this.input.selectionStart;
    const before = this.input.value.slice(0, start);
    const line = before.slice(before.lastIndexOf('\n') + 1);
    const indent = (line.match(/^[ \t]*/) || [''])[0];
    const trimmed = line.trimEnd();
    let extra = /[{[(]\s*$/.test(trimmed) ? '  ' : '';
    if (/^[)}\]]\s*$/.test(this.input.value.slice(start).trimStart())) {
      extra = extra || '';
    }
    /* Close a lone opening brace on its own: put the closing brace on the
       next line when the user is between `X {` and `}`. */
    const after = this.input.value.slice(start);
    if (event && extra === '  ' && /^\s*\}/.test(after) && /[{[]\s*$/.test(trimmed)) {
      event.preventDefault();
      this.input.setRangeText(
        `\n${indent}${extra}\n${indent}`,
        start, this.input.selectionEnd, 'end'
      );
      this.input.setSelectionRange(start + indent.length + 3, start + indent.length + 3);
      this.handleInput();
      return;
    }
    if (indent || extra) {
      event.preventDefault();
      this.input.setRangeText(`\n${indent}${extra}`, start, this.input.selectionEnd, 'end');
      this.handleInput();
    }
  }
}

window.CodeEditor = CodeEditor;
window.highlightCode = highlightCode;

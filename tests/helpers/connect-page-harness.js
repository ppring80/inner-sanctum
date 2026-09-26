'use strict';

// tests/helpers/connect-page-harness.js
//
// TEST-ONLY. Never loaded by Netlify or any customer-facing page.
//
// Runs the REAL connect-league.html page (every <script> in document order:
// the inline scripts plus the repo-local /league-connection.js and
// /provider-adapters.js) inside a Node vm context backed by a deliberately
// small fake browser. Scripts the page injects later (league-connection.js
// appends /team-context.js on DOMContentLoaded) are loaded from the repo too,
// so post-connect behavior matches the browser.
//
// No production connection logic is duplicated here. The fake only provides
// the browser primitives the page touches: a tiny HTML parser that builds a
// nested element tree, a minimal CSS selector matcher (tag, #id, .class,
// [attr], [attr=value], descendant combinator, comma lists), classList,
// events, Map-backed localStorage/sessionStorage, a fetch recorder, a
// window.open stub, CustomEvent/dispatchEvent, and a controllable timer queue
// so asynchronous effects (setTimeout) can be flushed deterministically.
//
// Phase 0 of the mobile league-connect project: these harness-driven tests
// freeze the proven desktop CBS/ESPN connection behavior.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PAGE_URL = 'https://theinnersanctum.xyz/connect-league';
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'source', 'track', 'wbr'
]);
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&middot;/g, '·')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function escapeText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ------------------------------------------------------------------ */
/* Minimal selector matcher                                            */
/* ------------------------------------------------------------------ */

function parseCompound(compound) {
  const parts = { tag: null, id: null, classes: [], attrs: [] };
  const re = /\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]|([#.]?)([\w-]+)/g;
  let match;
  let consumed = '';
  while ((match = re.exec(compound)) !== null) {
    consumed += match[0];
    if (match[1]) {
      const value = match[2] ?? match[3] ?? match[4];
      parts.attrs.push({ name: match[1], value: value === undefined ? null : value });
    } else if (match[5] === '#') {
      parts.id = match[6];
    } else if (match[5] === '.') {
      parts.classes.push(match[6]);
    } else {
      parts.tag = match[6].toLowerCase();
    }
  }
  if (consumed !== compound) {
    throw new Error('connect-page-harness: unsupported selector "' + compound + '"');
  }
  return parts;
}

function parseSelector(selector) {
  return String(selector)
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean)
    .map((group) => group.split(/\s+/).map(parseCompound));
}

function matchesCompound(el, parts) {
  if (!el || el.nodeType !== 1) return false;
  if (parts.tag && el.tagName.toLowerCase() !== parts.tag) return false;
  if (parts.id && el.id !== parts.id) return false;
  for (const cls of parts.classes) {
    if (!el.classList.contains(cls)) return false;
  }
  for (const attr of parts.attrs) {
    const actual = el.getAttribute(attr.name);
    if (actual === null) return false;
    if (attr.value !== null && actual !== attr.value) return false;
  }
  return true;
}

function matchesChain(el, chain) {
  if (!matchesCompound(el, chain[chain.length - 1])) return false;
  let index = chain.length - 2;
  let ancestor = el.parentNode;
  while (index >= 0 && ancestor) {
    if (matchesCompound(ancestor, chain[index])) index -= 1;
    ancestor = ancestor.parentNode;
  }
  return index < 0;
}

function matchesSelector(el, selector) {
  return parseSelector(selector).some((chain) => matchesChain(el, chain));
}

/* ------------------------------------------------------------------ */
/* Fake DOM                                                            */
/* ------------------------------------------------------------------ */

class FakeClassList {
  constructor(el) { this._el = el; }
  _list() { return String(this._el.className || '').split(/\s+/).filter(Boolean); }
  _write(list) { this._el.className = list.join(' '); }
  contains(name) { return this._list().includes(name); }
  add(...names) {
    const list = this._list();
    names.forEach((n) => { if (!list.includes(n)) list.push(n); });
    this._write(list);
  }
  remove(...names) { this._write(this._list().filter((n) => !names.includes(n))); }
  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : Boolean(force);
    if (on) this.add(name); else this.remove(name);
    return on;
  }
}

class FakeNode {
  constructor(doc) {
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
    this._listeners = {};
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, reference) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    const index = reference ? this.childNodes.indexOf(reference) : -1;
    if (index >= 0) this.childNodes.splice(index, 0, child);
    else this.childNodes.push(child);
    this._markDirty();
    if (this.ownerDocument && this.ownerDocument._onInsert) this.ownerDocument._onInsert(child);
    return child;
  }
  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    this._markDirty();
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  _markDirty() {}
  addEventListener(type, fn, options) {
    if (typeof fn !== 'function') return;
    const capture = options === true || Boolean(options && options.capture);
    const once = Boolean(options && typeof options === 'object' && options.once);
    (this._listeners[type] || (this._listeners[type] = [])).push({ fn, capture, once });
  }
  removeEventListener(type, fn) {
    this._listeners[type] = (this._listeners[type] || []).filter((l) => l.fn !== fn);
  }
  dispatchEvent(event) {
    const list = (this._listeners[event.type] || []).slice();
    list.forEach((entry) => {
      if (entry.once) this.removeEventListener(event.type, entry.fn);
      entry.fn.call(this, event);
    });
    return !event.defaultPrevented;
  }
  listenerEntries(type) { return (this._listeners[type] || []).slice(); }
  querySelectorAll(selector) {
    const results = [];
    const chains = parseSelector(selector);
    const walk = (node) => {
      node.children.forEach((child) => {
        if (chains.some((chain) => matchesChain(child, chain))) results.push(child);
        walk(child);
      });
    };
    walk(this);
    return results;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getElementsByTagName(tag) { return this.querySelectorAll(String(tag).toLowerCase()); }
}

class FakeText extends FakeNode {
  constructor(doc, text) { super(doc); this.nodeType = 3; this.data = String(text); }
  get textContent() { return this.data; }
  get outerHTML() { return escapeText(this.data); }
}

class FakeElement extends FakeNode {
  constructor(doc, tagName) {
    super(doc);
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.nodeName = this.tagName;
    this._attributes = new Map();
    this.style = {};
    this.dataset = {};
    this.classList = new FakeClassList(this);
    this.value = '';
    this.disabled = false;
    this._innerHTML = '';
    this._htmlDirty = false;
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id', value); }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  // Reflected attributes the page scripts set as properties.
  get src() { return this.getAttribute('src') || ''; }
  set src(value) { this.setAttribute('src', value); }
  get href() { return this.getAttribute('href') || ''; }
  set href(value) { this.setAttribute('href', value); }
  get type() { return this.getAttribute('type') || ''; }
  set type(value) { this.setAttribute('type', value); }
  setAttribute(name, value) {
    this._attributes.set(String(name), String(value));
    if (String(name).startsWith('data-')) {
      const key = String(name).slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
      this.dataset[key] = String(value);
    }
  }
  getAttribute(name) {
    return this._attributes.has(String(name)) ? this._attributes.get(String(name)) : null;
  }
  hasAttribute(name) { return this._attributes.has(String(name)); }
  removeAttribute(name) { this._attributes.delete(String(name)); }
  _markDirty() { this._htmlDirty = true; if (this.parentNode) this.parentNode._markDirty(); }
  get innerHTML() {
    if (!this._htmlDirty) return this._innerHTML;
    return this.childNodes.map((n) => n.outerHTML).join('');
  }
  set innerHTML(html) {
    this.childNodes.forEach((n) => { n.parentNode = null; });
    this.childNodes = [];
    this._innerHTML = String(html);
    parseInto(this.ownerDocument, this, this._innerHTML);
    this._htmlDirty = false;
    if (this.parentNode) this.parentNode._markDirty();
  }
  get textContent() {
    if (RAW_TEXT_TAGS.has(this.tagName.toLowerCase())) return decodeEntities(this._innerHTML);
    return this.childNodes.map((n) => n.textContent).join('');
  }
  set textContent(text) { this.innerHTML = escapeText(text); }
  get outerHTML() {
    const attrs = Array.from(this._attributes.entries())
      .map(([k, v]) => ' ' + k + '="' + String(v).replace(/"/g, '&quot;') + '"')
      .join('');
    const tag = this.tagName.toLowerCase();
    if (VOID_TAGS.has(tag)) return '<' + tag + attrs + '>';
    return '<' + tag + attrs + '>' + this.innerHTML + '</' + tag + '>';
  }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) {
    let node = this;
    while (node && node.nodeType === 1) {
      if (matchesSelector(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
  focus() {}
  blur() {}
  click() {
    const event = createEvent('click', { bubbles: true });
    event.target = this;
    this.dispatchEvent(event);
  }
}

function parseInto(doc, parent, html) {
  const tokenRe = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/gi;
  const stack = [{ el: parent, innerStart: 0 }];
  let lastIndex = 0;
  let match;

  const top = () => stack[stack.length - 1];
  const pushText = (text) => {
    if (text) top().el.childNodes.push(Object.assign(new FakeText(doc, decodeEntities(text)), { parentNode: top().el }));
  };

  while ((match = tokenRe.exec(html)) !== null) {
    pushText(html.slice(lastIndex, match.index));
    lastIndex = tokenRe.lastIndex;

    if (match[1]) {
      const closing = match[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].el.tagName.toLowerCase() === closing) {
          while (stack.length > i) {
            const frame = stack.pop();
            frame.el._innerHTML = html.slice(frame.innerStart, match.index);
            frame.el._htmlDirty = false;
          }
          break;
        }
      }
      continue;
    }
    if (!match[2]) continue;

    const tag = match[2].toLowerCase();
    const el = new FakeElement(doc, tag);
    const attrRe = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let attr;
    while ((attr = attrRe.exec(match[3] || '')) !== null) {
      const value = attr[2] ?? attr[3] ?? attr[4] ?? '';
      el.setAttribute(attr[1], decodeEntities(value));
    }
    el.parentNode = top().el;
    top().el.childNodes.push(el);

    if (RAW_TEXT_TAGS.has(tag)) {
      const closeRe = new RegExp('</' + tag + '\\s*>', 'ig');
      closeRe.lastIndex = tokenRe.lastIndex;
      const close = closeRe.exec(html);
      const end = close ? close.index : html.length;
      el._innerHTML = html.slice(tokenRe.lastIndex, end);
      tokenRe.lastIndex = close ? closeRe.lastIndex : html.length;
      lastIndex = tokenRe.lastIndex;
      continue;
    }
    if (!VOID_TAGS.has(tag) && !match[4]) stack.push({ el, innerStart: tokenRe.lastIndex });
  }
  pushText(html.slice(lastIndex));
  while (stack.length > 1) {
    const frame = stack.pop();
    frame.el._innerHTML = html.slice(frame.innerStart);
  }
}

function createEvent(type, init) {
  return {
    type,
    bubbles: Boolean(init && init.bubbles),
    detail: init && init.detail !== undefined ? init.detail : null,
    defaultPrevented: false,
    immediatePropagationStopped: false,
    propagationStopped: false,
    target: null,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    stopImmediatePropagation() { this.immediatePropagationStopped = true; this.propagationStopped = true; }
  };
}

class FakeDocument extends FakeNode {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.nodeType = 9;
    this.readyState = 'loading';
    this.documentElement = new FakeElement(this, 'html');
    this.documentElement.parentNode = this;
    this.childNodes = [this.documentElement];
    this._onInsert = null;
  }
  get head() { return this.documentElement.querySelector('head'); }
  get body() { return this.documentElement.querySelector('body'); }
  createElement(tag) { return new FakeElement(this, tag); }
  createTextNode(text) { return new FakeText(this, text); }
  getElementById(id) {
    const find = (node) => {
      for (const child of node.children) {
        if (child.id === id) return child;
        const found = find(child);
        if (found) return found;
      }
      return null;
    };
    return find(this);
  }
}

function makeStorage() {
  const map = new Map();
  return {
    _map: map,
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i] ?? null; },
    getItem(k) { return map.has(String(k)) ? map.get(String(k)) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); }
  };
}

/* ------------------------------------------------------------------ */
/* Page loader                                                         */
/* ------------------------------------------------------------------ */

/**
 * Load the real connect-league page.
 *
 * options:
 *   userAgent       default: desktop Chrome
 *   fetchResponder  async (url, init) => ({ status, body }) ; default 200 {}
 *   openResult      value returned by window.open (default: a popup stub);
 *                   pass null to simulate a blocked popup
 *   domReady        fire DOMContentLoaded after scripts (default true)
 */
function loadConnectPage(options = {}) {
  const document = new FakeDocument();
  const timers = [];
  let timerSeq = 0;
  const fetchCalls = [];
  const openCalls = [];
  const loadedScripts = [];
  const skippedScripts = [];
  const reloads = [];

  const popup = { closed: false, focusCalls: 0, focus() { this.focusCalls += 1; }, close() { this.closed = true; } };

  const windowListeners = new FakeNode(document);
  const window = {
    document,
    navigator: {
      userAgent: options.userAgent || DESKTOP_UA,
      clipboard: { writeText: async () => {} }
    },
    location: {
      href: PAGE_URL,
      origin: 'https://theinnersanctum.xyz',
      protocol: 'https:',
      host: 'theinnersanctum.xyz',
      hostname: 'theinnersanctum.xyz',
      pathname: '/connect-league',
      search: '',
      hash: '',
      reload() { reloads.push(Date.now()); },
      assign() {},
      replace() {}
    },
    history: { replaceState() {}, pushState() {} },
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    crypto: webcrypto,
    console,
    JSON, Math, Date, Promise, URL, URLSearchParams, TextEncoder, TextDecoder,
    Intl, Number, String, Boolean, Array, Object, RegExp, Error, TypeError,
    Map, Set, WeakMap, Symbol, parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    queueMicrotask,
    setTimeout(fn, ms, ...args) {
      timerSeq += 1;
      timers.push({ id: timerSeq, fn, ms: Number(ms) || 0, args });
      return timerSeq;
    },
    clearTimeout(id) {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    setInterval() { return 0; },
    clearInterval() {},
    requestAnimationFrame(fn) { return window.setTimeout(fn, 16); },
    alert() {}, confirm() { return true; }, prompt() { return null; },
    scrollTo() {},
    getComputedStyle() { return {}; },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
    addEventListener: (...a) => windowListeners.addEventListener(...a),
    removeEventListener: (...a) => windowListeners.removeEventListener(...a),
    dispatchEvent: (e) => windowListeners.dispatchEvent(e),
    open(url, name) {
      openCalls.push({ url, name });
      return Object.prototype.hasOwnProperty.call(options, 'openResult') ? options.openResult : popup;
    },
    async fetch(url, init) {
      fetchCalls.push({ url: String(url), init: init || {} });
      const res = options.fetchResponder
        ? await options.fetchResponder(String(url), init || {})
        : { status: 200, body: {} };
      const status = res.status ?? 200;
      const bodyText = typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? {});
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => 'application/json' },
        json: async () => JSON.parse(bodyText),
        text: async () => bodyText
      };
    }
  };
  window.CustomEvent = function CustomEvent(type, init) { return createEvent(type, init); };
  window.Event = function Event(type, init) { return createEvent(type, init); };
  window.MutationObserver = class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} takeRecords() { return []; } };
  window.HTMLElement = FakeElement;
  window.Element = FakeElement;
  window.Node = FakeNode;
  window.window = window;
  window.self = window;
  window.globalThis = window;
  window.top = window;
  window.parent = window;

  const context = vm.createContext(window);

  function runScript(code, filename) {
    vm.runInContext(code, context, { filename });
  }

  function executeScriptElement(el) {
    const src = el.getAttribute('src');
    if (src) {
      if (/^\/[\w./-]+\.js$/.test(src) && fs.existsSync(path.join(REPO_ROOT, src))) {
        runScript(readRepoFile(src.slice(1)), src.slice(1));
        loadedScripts.push(src);
        el.dispatchEvent(createEvent('load'));
      } else {
        skippedScripts.push(src);
      }
      return;
    }
    runScript(el._innerHTML, 'connect-league.html#inline-script-' + loadedScripts.length);
    loadedScripts.push('inline');
  }

  const html = readRepoFile('connect-league.html');
  const htmlStart = html.search(/<html[\s>]/i);
  const inner = html.slice(html.indexOf('>', htmlStart) + 1, html.lastIndexOf('</html>'));
  parseInto(document, document.documentElement, inner);

  // Scripts the page injects after load (for example team-context.js) run when inserted.
  document._onInsert = (node) => {
    if (node.nodeType === 1 && node.tagName === 'SCRIPT' && node.getAttribute('src')) {
      executeScriptElement(node);
    }
  };

  const pageScripts = document.querySelectorAll('script');
  pageScripts.forEach(executeScriptElement);

  const harness = {
    window,
    document,
    context,
    fetchCalls,
    openCalls,
    loadedScripts,
    skippedScripts,
    reloads,
    popup,
    timers,
    run(code, filename) { return vm.runInContext(code, context, { filename: filename || 'harness-eval.js' }); },
    domReady() {
      document.readyState = 'interactive';
      document.dispatchEvent(createEvent('DOMContentLoaded'));
      document.readyState = 'complete';
    },
    /** Run queued timers (and the microtasks between them) until idle. */
    async settle(maxRounds = 50) {
      for (let round = 0; round < maxRounds; round += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        if (!timers.length) return;
        timers.sort((a, b) => a.ms - b.ms || a.id - b.id);
        const next = timers.shift();
        next.fn(...next.args);
      }
      throw new Error('connect-page-harness: timers did not settle');
    },
    getStoredState() {
      const raw = window.localStorage.getItem('innerSanctum_leagueConnections');
      return raw ? JSON.parse(raw) : null;
    },
    windowListeners(type) { return windowListeners.listenerEntries(type); },
    documentListeners(type) { return document.listenerEntries(type); },
    createEvent
  };

  if (options.domReady !== false) harness.domReady();
  return harness;
}

/* ------------------------------------------------------------------ */
/* Chrome extension worker loader (for ESPN/CBS delivery contracts)    */
/* ------------------------------------------------------------------ */

/**
 * Load the real extension background worker (service-worker-v050.js, which
 * importScripts("service-worker.js")) with a recording chrome API stub.
 */
function loadExtensionWorker(options = {}) {
  const executeScriptCalls = [];
  const runtimeListeners = [];
  const updatedListeners = [];
  const sanctumUrl = options.sanctumUrl || PAGE_URL;
  const chrome = {
    runtime: { onMessage: { addListener(fn) { runtimeListeners.push(fn); } } },
    tabs: {
      onUpdated: { addListener(fn) { updatedListeners.push(fn); } },
      onRemoved: { addListener() {} },
      async get(id) { return { id, url: sanctumUrl, active: true }; },
      async query() { return []; },
      async create(opts) { return { id: 900, url: opts.url, active: true }; },
      async update(id, opts) { return { id, ...(opts || {}) }; },
      async sendMessage() { return { success: true }; }
    },
    storage: { session: { async get() { return {}; }, async set() {}, async remove() {} } },
    scripting: {
      async executeScript(details) {
        executeScriptCalls.push(details);
        return [{ result: null }];
      }
    }
  };
  const extDir = path.join(REPO_ROOT, 'cbs-extension');
  const sandbox = { chrome, console, setTimeout, clearTimeout, Date, Promise, Set, Map };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  sandbox.importScripts = (...files) => {
    files.forEach((file) => {
      vm.runInContext(fs.readFileSync(path.join(extDir, file), 'utf8'), context, { filename: 'cbs-extension/' + file });
    });
  };
  vm.runInContext(
    fs.readFileSync(path.join(extDir, 'service-worker-v050.js'), 'utf8'),
    context,
    { filename: 'cbs-extension/service-worker-v050.js' }
  );
  return { chrome, context, sandbox, executeScriptCalls, runtimeListeners, updatedListeners };
}

/**
 * Execute a function captured from chrome.scripting.executeScript inside the
 * page, the way Chrome does for world "MAIN": the function is serialized with
 * toString() and invoked with JSON-cloned args in the page's global scope.
 */
function runInjectedFunction(harness, details) {
  const args = JSON.parse(JSON.stringify(details.args || []));
  harness.context.__phase0InjectedArgs = args;
  try {
    return harness.run('(' + details.func.toString() + ').apply(null, __phase0InjectedArgs)', 'executeScript-func.js');
  } finally {
    delete harness.context.__phase0InjectedArgs;
  }
}

/* ------------------------------------------------------------------ */
/* Golden normalization                                                */
/* ------------------------------------------------------------------ */

const VOLATILE_KEYS = new Set(['syncedAt', 'connectedAt']);

function normalizeVolatile(value) {
  if (Array.isArray(value)) return value.map(normalizeVolatile);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).sort().forEach((key) => {
      out[key] = VOLATILE_KEYS.has(key) && typeof value[key] === 'string'
        ? '<normalized-timestamp>'
        : normalizeVolatile(value[key]);
    });
    return out;
  }
  return value;
}

/** Record every call to selected LeagueConnection methods (delegating to the real ones). */
function spyLeagueConnection(harness, methods = ['connect', 'update', 'updateConnection']) {
  const LC = harness.window.LeagueConnection;
  const calls = [];
  methods.forEach((name) => {
    const original = LC[name];
    if (typeof original !== 'function') return;
    LC[name] = function (...args) {
      calls.push({ method: name, provider: typeof args[0] === 'string' ? args[0] : null });
      return original.apply(this, args);
    };
  });
  return calls;
}

module.exports = {
  REPO_ROOT,
  PAGE_URL,
  DESKTOP_UA,
  loadConnectPage,
  loadExtensionWorker,
  runInjectedFunction,
  normalizeVolatile,
  spyLeagueConnection,
  matchesSelector,
  readRepoFile
};

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bridgeSource = fs.readFileSync(
  path.join(__dirname, '..', 'cbs-extension', 'sanctum-content-bridge.js'),
  'utf8'
);

class FakeElement {
  constructor(document, options = {}) {
    this.ownerDocument = document;
    this.id = options.id || '';
    this.className = options.className || '';
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.disabled = false;
    this._innerHTML = options.innerHTML || '';
    this._textContent = options.textContent || '';
  }

  hasClass(name) {
    return this.className.split(/\s+/).filter(Boolean).includes(name);
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.ownerDocument.notifyChildListMutation();
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set textContent(value) {
    this._textContent = String(value);
    this.ownerDocument.notifyChildListMutation();
  }

  get textContent() {
    return this._textContent;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    this.ownerDocument.registerTree(child);
    this.ownerDocument.notifyChildListMutation();
    return child;
  }

  insertBefore(child, reference) {
    child.parentNode = this;
    const index = this.children.indexOf(reference);
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    this.ownerDocument.registerTree(child);
    this.ownerDocument.notifyChildListMutation();
    return child;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((part) => part.trim());
    const matches = [];

    function visit(node) {
      node.children.forEach((child) => {
        if (selectors.some((part) => child.matches(part))) matches.push(child);
        visit(child);
      });
    }

    visit(this);
    return matches;
  }

  matches(selector) {
    if (selector.startsWith('.')) return this.hasClass(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return false;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (selector === '.provider-form' && node.hasClass('provider-form')) return node;
      if (selector === '.platform-btn' && node.hasClass('platform-btn')) return node;
      if (selector === '#providerForms .connect-btn' && node.hasClass('connect-btn')) {
        let parent = node.parentNode;
        while (parent) {
          if (parent.id === 'providerForms') return node;
          parent = parent.parentNode;
        }
      }
      node = node.parentNode;
    }
    return null;
  }
}

class FakeDocument {
  constructor(queueMicrotaskImpl) {
    this.queueMicrotaskImpl = queueMicrotaskImpl;
    this.elementsById = new Map();
    this.observers = [];
    this.clickListeners = [];
    this.documentElement = new FakeElement(this, { id: 'documentElement' });

    this.providerForms = new FakeElement(this, { id: 'providerForms' });
    this.documentElement.children.push(this.providerForms);
    this.providerForms.parentNode = this.documentElement;
    this.registerTree(this.documentElement);

    this.platforms = {
      cbs: new FakeElement(this, { id: 'platform-cbs', className: 'platform-btn selected' }),
      espn: new FakeElement(this, { id: 'platform-espn', className: 'platform-btn' })
    };
    this.documentElement.children.push(this.platforms.cbs, this.platforms.espn);
    this.platforms.cbs.parentNode = this.documentElement;
    this.platforms.espn.parentNode = this.documentElement;
    this.registerTree(this.platforms.cbs);
    this.registerTree(this.platforms.espn);

    this.renderProvider('cbs');
  }

  registerTree(node) {
    if (node.id) this.elementsById.set(node.id, node);
    node.children.forEach((child) => this.registerTree(child));
  }

  unregisterTree(node) {
    if (node.id) this.elementsById.delete(node.id);
    node.children.forEach((child) => this.unregisterTree(child));
  }

  createElement() {
    return new FakeElement(this);
  }

  getElementById(id) {
    return this.elementsById.get(id) || null;
  }

  querySelector(selector) {
    const selectedMatch = selector.match(/^#platform-(cbs|espn)\.selected$/);
    if (selectedMatch) {
      const element = this.platforms[selectedMatch[1]];
      return element.hasClass('selected') ? element : null;
    }
    return this.documentElement.querySelector(selector);
  }

  addEventListener(type, listener, capture) {
    if (type === 'click') this.clickListeners.push({ listener, capture: Boolean(capture) });
  }

  addObserver(observer) {
    this.observers.push(observer);
  }

  notifyChildListMutation() {
    this.observers.forEach((observer) => {
      this.queueMicrotaskImpl(() => observer.callback());
    });
  }

  renderProvider(provider) {
    this.providerForms.children.forEach((child) => this.unregisterTree(child));
    this.providerForms.children = [];

    const form = new FakeElement(this, { className: 'provider-form' });
    const group = new FakeElement(this, { className: 'pf-group' });
    const privateFields = new FakeElement(this, { id: provider === 'espn' ? 'espnPrivateFields' : '' });
    const result = new FakeElement(this, { id: provider + 'Result', className: 'result-box' });
    const button = new FakeElement(this, { className: 'connect-btn', textContent: 'Connect ' + provider.toUpperCase() });
    const note = new FakeElement(this, { className: 'connect-note', textContent: 'Original note' });

    [group, privateFields, result, button, note].forEach((child) => {
      child.parentNode = form;
      form.children.push(child);
    });
    form.parentNode = this.providerForms;
    this.providerForms.children.push(form);
    this.registerTree(form);
    this.activeProvider = provider;
    this.notifyChildListMutation();
  }

  selectProvider(provider) {
    this.platforms.cbs.className = 'platform-btn' + (provider === 'cbs' ? ' selected' : '');
    this.platforms.espn.className = 'platform-btn' + (provider === 'espn' ? ' selected' : '');
    this.renderProvider(provider);
  }

  dispatchPlatformClick(provider, flushMicrotasks) {
    const event = createClickEvent(this.platforms[provider]);
    this.clickListeners.filter((entry) => entry.capture).forEach((entry) => entry.listener(event));
    assert.strictEqual(event.immediateStopped, false, 'provider click must not be stopped by extension bridge');
    this.selectProvider(provider);
    flushMicrotasks();
  }

  dispatchConnectClick(flushMicrotasks) {
    const button = this.providerForms.querySelector('.connect-btn');
    const event = createClickEvent(button);
    this.clickListeners.filter((entry) => entry.capture).forEach((entry) => entry.listener(event));
    flushMicrotasks();
    return event;
  }
}

function createClickEvent(target) {
  return {
    target,
    defaultPrevented: false,
    immediateStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      this.immediateStopped = true;
    }
  };
}

(function run() {
  const microtasks = [];
  let microtaskExecutions = 0;

  function queueMicrotaskImpl(callback) {
    microtasks.push(callback);
  }

  function flushMicrotasks(limit = 100) {
    let localExecutions = 0;
    while (microtasks.length > 0) {
      if (localExecutions >= limit) {
        assert.fail('MutationObserver/refresh microtasks did not converge within ' + limit + ' executions');
      }
      const callback = microtasks.shift();
      callback();
      localExecutions += 1;
      microtaskExecutions += 1;
    }
    return localExecutions;
  }

  const document = new FakeDocument(queueMicrotaskImpl);
  const sentMessages = [];

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }

    observe(target, options) {
      assert.strictEqual(target, document.documentElement);
      assert.strictEqual(options.childList, true);
      assert.strictEqual(options.subtree, true);
      document.addObserver(this);
    }
  }

  const context = vm.createContext({
    document,
    MutationObserver: FakeMutationObserver,
    queueMicrotask: queueMicrotaskImpl,
    chrome: {
      runtime: {
        sendMessage(message) {
          sentMessages.push({ type: message.type });
          return Promise.resolve({ success: true });
        }
      }
    },
    console
  });

  vm.runInContext(bridgeSource, context, { filename: 'sanctum-content-bridge.js' });
  flushMicrotasks();

  assert.strictEqual(document.activeProvider, 'cbs', 'CBS should be displayed initially');

  document.dispatchPlatformClick('espn', flushMicrotasks);
  assert.strictEqual(document.activeProvider, 'espn', 'CBS → ESPN must display ESPN form');
  assert.ok(document.querySelector('#platform-espn.selected'), 'ESPN tile must be selected');
  assert.strictEqual(document.getElementById('cbsResult'), null, 'CBS form must be removed after ESPN selection');
  assert.ok(document.getElementById('espnResult'), 'ESPN form must be present after selection');
  assert.strictEqual(
    document.providerForms.querySelector('.connect-btn').textContent,
    'Connect ESPN League',
    'ESPN bridge customization must complete after selection'
  );

  document.dispatchPlatformClick('cbs', flushMicrotasks);
  assert.strictEqual(document.activeProvider, 'cbs', 'ESPN → CBS must display CBS form');
  assert.ok(document.querySelector('#platform-cbs.selected'), 'CBS tile must be selected');
  assert.strictEqual(document.getElementById('espnResult'), null, 'ESPN form must be removed after CBS selection');
  assert.ok(document.getElementById('cbsResult'), 'CBS form must be present after selection');

  ['espn', 'cbs', 'espn', 'cbs', 'espn'].forEach((provider) => {
    const before = microtaskExecutions;
    document.dispatchPlatformClick(provider, flushMicrotasks);
    const delta = microtaskExecutions - before;
    assert.ok(delta < 30, 'provider switch microtasks must stay bounded; got ' + delta + ' for ' + provider);
    assert.strictEqual(document.activeProvider, provider, 'repeated switching must end on requested provider');
  });

  sentMessages.length = 0;
  const espnClick = document.dispatchConnectClick(flushMicrotasks);
  assert.strictEqual(espnClick.defaultPrevented, true, 'ESPN Connect click should be owned by extension bridge');
  assert.strictEqual(espnClick.immediateStopped, true, 'ESPN Connect click should stop competing handlers');
  assert.deepStrictEqual(sentMessages, [{ type: 'INNER_SANCTUM_START_ESPN_CONNECT' }]);

  document.dispatchPlatformClick('cbs', flushMicrotasks);
  sentMessages.length = 0;
  const cbsClick = document.dispatchConnectClick(flushMicrotasks);
  assert.strictEqual(cbsClick.defaultPrevented, true, 'CBS Connect click should be owned by extension bridge');
  assert.strictEqual(cbsClick.immediateStopped, true, 'CBS Connect click should stop competing handlers');
  assert.deepStrictEqual(sentMessages, [{ type: 'INNER_SANCTUM_START_CBS_CONNECT' }]);

  console.log('ESPN provider-selection behavioral regression tests passed.');
})();

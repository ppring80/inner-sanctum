'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'cbs-extension', 'sanctum-content-bridge.js'),
  'utf8'
);

(function run() {
  assert.match(source, /const ESPN_INFO_HTML/);
  assert.match(source, /const ESPN_BUTTON_TEXT/);
  assert.match(source, /const ESPN_NOTE_TEXT/);

  assert.match(source, /info && info\.innerHTML !== ESPN_INFO_HTML/);
  assert.match(source, /button && button\.textContent !== ESPN_BUTTON_TEXT/);
  assert.match(source, /note && note\.textContent !== ESPN_NOTE_TEXT/);

  assert.match(source, /new MutationObserver\(queueEspnRefresh\)/);
  assert.match(source, /observer\.observe\(document\.documentElement, \{ childList: true, subtree: true \}\)/);

  assert.match(source, /event\.target\.closest\("\.platform-btn"\)/);
  assert.match(source, /queueEspnRefresh\(\);/);

  assert.doesNotMatch(
    source,
    /if \(info\) \{\s*info\.innerHTML\s*=/,
    'ESPN refresh must not rewrite identical HTML on every mutation'
  );
  assert.doesNotMatch(
    source,
    /if \(button\) button\.textContent\s*=/,
    'ESPN refresh must not rewrite identical button text on every mutation'
  );
  assert.doesNotMatch(
    source,
    /if \(note\) \{\s*note\.textContent\s*=/,
    'ESPN refresh must not rewrite identical note text on every mutation'
  );

  console.log('ESPN provider-selection freeze regression tests passed.');
})();

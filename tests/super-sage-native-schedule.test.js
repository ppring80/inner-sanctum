'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
const block = toml.match(/\[functions\."refresh-super-sage-evidence"\]\s*schedule\s*=\s*"([^"]+)"/);
assert(block, 'Super SAGE must have a native Netlify schedule');
assert.equal(block[1], '30 14 * 9-12 2,5', 'Preserve existing Tuesday/Friday UTC schedule');
assert(!fs.existsSync(path.join(root, '.github/workflows/super-sage-evidence-refresh.yml')),
  'Credential-dependent GitHub scheduler must not remain active');
const writer = require('../netlify/functions/refresh-super-sage-evidence');
assert.equal(typeof writer.handler, 'function', 'Reuse existing evidence writer unchanged');
const source = fs.readFileSync(path.join(root, 'netlify/functions/refresh-super-sage-evidence.js'), 'utf8');
assert(source.includes('collectSources(fetch, { timeoutMs: 8000 })'), 'Scheduled collector uses bounded per-request timeouts');
const collector = require('../netlify/functions/_newswire-sources');
(async () => {
  const delays = [];
  const fakeFetch = async (_url, options) => {
    delays.push(options.signal);
    return { ok: true, text: async () => '<rss></rss>' };
  };
  await collector.collectSources(fakeFetch, { timeoutMs: 8000 });
  assert.equal(delays.length, 3, 'Two news feeds plus NFL discovery');
  assert(delays.every(signal => signal && !signal.aborted), 'Every request receives an active timeout signal');
  console.log('Super SAGE native scheduling configuration PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

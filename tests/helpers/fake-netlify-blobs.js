'use strict';

// tests/helpers/fake-netlify-blobs.js
//
// TEST-ONLY in-memory stand-in for @netlify/blobs, implementing the subset the
// connection-handoff function uses with Netlify's real semantics:
// get / getWithMetadata (with ETag) / setJSON (onlyIfNew, onlyIfMatch ->
// { modified, etag }) / delete. Every operation yields to the event loop first
// so concurrent handler calls genuinely interleave (race tests).

const Module = require('module');
const path = require('path');

function createFakeBlobs() {
  const stores = new Map();
  const log = [];
  let etagSeq = 0;

  const tick = () => new Promise((resolve) => setImmediate(resolve));

  function getStore(options) {
    const name = typeof options === 'string' ? options : options.name;
    if (!stores.has(name)) stores.set(name, new Map());
    const data = stores.get(name);
    return {
      async get(key, opts) {
        await tick();
        log.push({ store: name, op: 'get', key });
        if (!data.has(key)) return null;
        const raw = data.get(key).raw;
        return opts && opts.type === 'json' ? JSON.parse(raw) : raw;
      },
      async getWithMetadata(key, opts) {
        await tick();
        log.push({ store: name, op: 'getWithMetadata', key });
        if (!data.has(key)) return null;
        const entry = data.get(key);
        return {
          data: opts && opts.type === 'json' ? JSON.parse(entry.raw) : entry.raw,
          etag: entry.etag,
          metadata: {}
        };
      },
      async setJSON(key, value, opts = {}) {
        await tick();
        log.push({ store: name, op: 'setJSON', key });
        const exists = data.has(key);
        if (opts.onlyIfNew && exists) return { modified: false };
        if (opts.onlyIfMatch && (!exists || data.get(key).etag !== opts.onlyIfMatch)) return { modified: false };
        etagSeq += 1;
        const etag = '"etag-' + etagSeq + '"';
        data.set(key, { raw: JSON.stringify(value), etag });
        return { modified: true, etag };
      },
      async delete(key) {
        await tick();
        log.push({ store: name, op: 'delete', key });
        data.delete(key);
      }
    };
  }

  return {
    stores,
    log,
    module: { connectLambda() {}, getStore },
    keys(name) { return stores.has(name) ? Array.from(stores.get(name).keys()) : []; },
    raw(name, key) { return stores.has(name) && stores.get(name).has(key) ? stores.get(name).get(key).raw : null; }
  };
}

/** Load a Netlify function with @netlify/blobs replaced by the fake. */
function loadFunctionWithFakeBlobs(relativePath, fake) {
  const fnPath = path.join(__dirname, '..', '..', relativePath);
  const fakePath = path.join(__dirname, '__fake_netlify_blobs_phase1__.js');
  require.cache[fakePath] = { id: fakePath, filename: fakePath, loaded: true, exports: fake.module };
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@netlify/blobs') return fakePath;
    return originalResolve.call(this, request, ...rest);
  };
  try {
    delete require.cache[require.resolve(fnPath)];
    return require(fnPath);
  } finally {
    Module._resolveFilename = originalResolve;
  }
}

module.exports = { createFakeBlobs, loadFunctionWithFakeBlobs };

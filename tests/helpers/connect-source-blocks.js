'use strict';

// tests/helpers/connect-source-blocks.js
//
// TEST-ONLY. Extracts the protected connect-league.html blocks for the
// TEMPORARY mobile-connect project freeze (tests/desktop-connect-freeze.test.js)
// and hashes the protected files. The scanner understands strings, template
// literals and comments so braces inside markup strings cannot truncate a block.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

const PROTECTED_FILES = [
  'provider-adapters.js',
  'league-connection.js',
  'netlify/functions/league-snapshot.js'
];
const PROTECTED_DIRS = ['cbs-extension'];

// Each block: where it starts, and which bracket closes it.
const PROTECTED_BLOCKS = {
  cbsListenerConstants: { kind: 'statements', startMarker: 'var CBS_CAPTURE_MESSAGE =', endMarker: 'var CHATGPT_LINK_STORAGE_KEY =' },
  startCbsConnect: { kind: 'balanced', startMarker: 'function startCbsConnect() {', open: '{' },
  receiveCbsConnection: { kind: 'balanced', startMarker: 'window.receiveCbsConnection =', open: '{' },
  cbsMessageListener: { kind: 'balanced', anchor: 'CBS CROSS-ORIGIN MESSAGE RECEIVER', startMarker: 'window.addEventListener(', open: '(' },
  renderProviderForm: { kind: 'balanced', startMarker: 'function renderProviderForm() {', open: '{' },
  buildCbsForm: { kind: 'balanced', startMarker: 'function buildCbsForm() {', open: '{' },
  buildEspnForm: { kind: 'balanced', startMarker: 'function buildEspnForm() {', open: '{' }
};

const CLOSERS = { '{': '}', '(': ')' };

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function findBalancedEnd(source, openIndex, open) {
  const close = CLOSERS[open];
  let depth = 0;
  let i = openIndex;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && next === '*') { i = source.indexOf('*/', i + 2) + 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      i += 1;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === open) depth += 1;
    if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  throw new Error('connect-source-blocks: unbalanced block starting at ' + openIndex);
}

function extractBlock(source, name) {
  const spec = PROTECTED_BLOCKS[name];
  if (!spec) throw new Error('Unknown protected block ' + name);
  const from = spec.anchor ? source.indexOf(spec.anchor) : 0;
  if (from < 0) throw new Error('Protected block anchor not found for ' + name + ': ' + spec.anchor);
  const start = source.indexOf(spec.startMarker, from);
  if (start < 0) throw new Error('Protected block not found: ' + name + ' (' + spec.startMarker + ')');
  if (source.indexOf(spec.startMarker, start + 1) >= 0 && !spec.anchor) {
    throw new Error('Protected block marker is not unique: ' + name);
  }
  if (spec.kind === 'statements') {
    const end = source.indexOf(spec.endMarker, start);
    if (end < 0) throw new Error('Protected block end not found: ' + name);
    return source.slice(start, end).trim();
  }
  const openIndex = source.indexOf(spec.open, start);
  const endIndex = findBalancedEnd(source, openIndex, spec.open);
  return source.slice(start, endIndex + 1);
}

function listFiles(dir) {
  const out = [];
  fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true }).forEach((entry) => {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(rel));
    else out.push(rel);
  });
  return out.sort();
}

function computeFreezeState() {
  const files = {};
  PROTECTED_DIRS.forEach((dir) => {
    listFiles(dir).forEach((rel) => { files[rel] = sha256(fs.readFileSync(path.join(REPO_ROOT, rel))); });
  });
  PROTECTED_FILES.forEach((rel) => { files[rel] = sha256(fs.readFileSync(path.join(REPO_ROOT, rel))); });

  const page = fs.readFileSync(path.join(REPO_ROOT, 'connect-league.html'), 'utf8');
  const blocks = {};
  Object.keys(PROTECTED_BLOCKS).forEach((name) => {
    const text = extractBlock(page, name);
    blocks[name] = { sha256: sha256(text), length: text.length };
  });
  return { files, blocks };
}

module.exports = {
  REPO_ROOT,
  PROTECTED_FILES,
  PROTECTED_DIRS,
  PROTECTED_BLOCKS,
  extractBlock,
  computeFreezeState,
  sha256
};

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extensionDir = path.join(root, 'cbs-extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));

(function run() {
  assert.strictEqual(manifest.manifest_version, 3, 'Chrome Web Store build must use Manifest V3');
  assert.strictEqual(manifest.name, 'The Inner Sanctum — Connect');
  assert.strictEqual(manifest.version, '0.5.2');
  assert.strictEqual(manifest.background?.service_worker, 'service-worker-v050.js');

  const expectedPermissions = ['scripting', 'storage', 'tabs'];
  assert.deepStrictEqual([...(manifest.permissions || [])].sort(), expectedPermissions);

  const expectedHosts = [
    'https://*.football.cbssports.com/*',
    'https://fantasy.espn.com/*',
    'https://lm-api-reads.fantasy.espn.com/*',
    'https://theinnersanctum.xyz/*',
    'https://www.theinnersanctum.xyz/*'
  ].sort();
  assert.deepStrictEqual([...(manifest.host_permissions || [])].sort(), expectedHosts);

  const expectedIcons = {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png'
  };
  assert.deepStrictEqual(manifest.icons, expectedIcons);
  assert.deepStrictEqual(manifest.action?.default_icon, {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png'
  });

  Object.entries(expectedIcons).forEach(([size, relativePath]) => {
    const fullPath = path.join(extensionDir, relativePath);
    assert.ok(fs.existsSync(fullPath), `Missing ${size}px extension icon: ${relativePath}`);
    const png = fs.readFileSync(fullPath);
    assert.strictEqual(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${relativePath} must be PNG`);
  });

  const jsFiles = fs.readdirSync(extensionDir).filter((name) => name.endsWith('.js'));
  jsFiles.forEach((name) => {
    const source = fs.readFileSync(path.join(extensionDir, name), 'utf8');
    assert.doesNotMatch(source, /\beval\s*\(/, `${name} must not use eval()`);
    assert.doesNotMatch(source, /\bnew\s+Function\s*\(/, `${name} must not use new Function()`);
    assert.doesNotMatch(source, /<script[^>]+src=["']https?:\/\//i, `${name} must not load remote script code`);
  });

  const privacyPath = path.join(root, 'chrome-web-store-privacy.html');
  assert.ok(fs.existsSync(privacyPath), 'Chrome Web Store privacy notice must exist');
  const privacy = fs.readFileSync(privacyPath, 'utf8');
  assert.match(privacy, /Chrome Web Store User Data Policy/i);
  assert.match(privacy, /Limited Use/i);
  assert.match(privacy, /SWID/i);
  assert.match(privacy, /does not collect.*password/i);

  console.log('Chrome Web Store packaging regression tests passed.');
})();

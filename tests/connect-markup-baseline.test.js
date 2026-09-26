'use strict';

// tests/connect-markup-baseline.test.js
//
// Phase 0 (mobile league-connect): freezes the DESKTOP provider-form markup the
// Chrome extension depends on. Only the relevant provider-form innerHTML and
// platform buttons are snapshotted (never the whole page), so unrelated page
// edits do not fail this suite.
//
// Note: the ESPN form as rendered by the page still contains the dormant
// legacy espn_s2/SWID fields. That is CURRENT behavior and is recorded as-is;
// removing it is the separate P1 security cleanup, which will re-baseline this
// golden intentionally. What this suite enforces now is that the no-extension
// safety guard never exposes those fields.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DESKTOP_UA, loadConnectPage, matchesSelector } = require('./helpers/connect-page-harness');
const scenarios = require('./helpers/connect-golden-scenarios');

const golden = JSON.parse(
  fs.readFileSync(path.join(scenarios.FIXTURE_DIR, 'connect-markup.golden.json'), 'utf8')
).observations;

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log('  ok - ' + name);
}

(async function run() {
  const observed = await scenarios.runMarkupScenarios();

  await test('baseline is recorded under a desktop browser', async () => {
    assert.strictEqual(observed.userAgent, DESKTOP_UA);
    assert.ok(!/Android|iPhone|iPad|Mobile/i.test(observed.userAgent));
  });

  await test('CBS provider form markup equals the golden (disconnected and connected)', async () => {
    assert.deepStrictEqual(observed.cbs, golden.cbs);
  });

  await test('CBS keeps its extension-dependent hooks', async () => {
    const row = observed.cbs.disconnected.platformRow;
    assert.ok(row.some((b) => b.id === 'platform-cbs' && /\bselected\b/.test(b.className)),
      '#platform-cbs exists and is the selected provider by default');
    const form = observed.cbs.disconnected.providerForm;
    assert.ok(/\bprovider-form\b/.test(form.className));
    assert.ok(form.innerHTML.includes('class="connect-btn" onclick="startCbsConnect()"'));
    assert.ok(form.innerHTML.includes('id="cbsResult"'));

    const harness = loadConnectPage();
    const button = harness.document.querySelector('#providerForms .connect-btn');
    assert.ok(button, '#providerForms .connect-btn resolves');
    assert.strictEqual(button.getAttribute('onclick'), 'startCbsConnect()');
    assert.ok(harness.document.querySelector('#platform-cbs.selected'), '#platform-cbs.selected resolves');
    const result = harness.document.getElementById('cbsResult');
    assert.ok(result.closest('.provider-form'), '#cbsResult sits inside .provider-form (extension status target)');
    assert.strictEqual(result.closest('.provider-form').querySelector('.connect-btn'), button);
  });

  await test('ESPN page-rendered markup equals the golden', async () => {
    assert.deepStrictEqual(observed.espn.renderedByPage, golden.espn.renderedByPage);
    const row = observed.espn.renderedByPage.platformRow;
    assert.ok(row.some((b) => b.id === 'platform-espn' && /\bselected\b/.test(b.className)));
  });

  await test('ESPN no-extension safety guard markup equals the golden and keeps extension hooks', async () => {
    assert.deepStrictEqual(observed.espn.afterNoExtensionSafetyGuard, golden.espn.afterNoExtensionSafetyGuard);
    const html = observed.espn.afterNoExtensionSafetyGuard.providerForm.innerHTML;
    assert.ok(html.includes('class="connect-btn"'));
    assert.ok(html.includes('id="espnResult"'));
  });

  await test('the safe fallback never exposes espnS2 or espnSwid', async () => {
    const html = observed.espn.afterNoExtensionSafetyGuard.providerForm.innerHTML;
    assert.ok(!/espnS2|espnSwid|espn_s2/.test(html.replace(/SWID or espn_s2 copy\/paste is required/, '')),
      'no credential input may appear in the guarded form');
    ['#espnS2', '#espnSwid', '#espnLeagueType', '#espnPrivateFields'].forEach((selector) => {
      assert.ok(!html.includes('id="' + selector.slice(1) + '"'), selector + ' must not render');
    });
  });

  await test('selector helper sanity (guards the harness itself)', async () => {
    const harness = loadConnectPage();
    const btn = harness.document.querySelector('#providerForms .connect-btn');
    assert.ok(matchesSelector(btn, '#providerForms .connect-btn'));
    assert.ok(!matchesSelector(btn, '#platformRow .connect-btn'));
  });

  console.log('connect-markup-baseline.test.js: ' + passed + ' passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

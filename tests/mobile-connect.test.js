'use strict';

// tests/mobile-connect.test.js
//
// Phase 1 (mobile league-connect): mobile-connect.js running inside the REAL
// connect-league page (Phase 0 harness), under desktop and mobile browsers.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DESKTOP_UA,
  loadConnectPage,
  loadExtensionWorker,
  runInjectedFunction
} = require('./helpers/connect-page-harness');
const scenarios = require('./helpers/connect-golden-scenarios');
const { createFakeBlobs, loadFunctionWithFakeBlobs } = require('./helpers/fake-netlify-blobs');

const MARKUP_GOLDEN = JSON.parse(
  fs.readFileSync(path.join(scenarios.FIXTURE_DIR, 'connect-markup.golden.json'), 'utf8')
).observations;

const UA = {
  windowsChrome: DESKTOP_UA,
  windowsEdgeTouch: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  linuxChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
  ipadLegacy: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1'
};

const CODE = 'Q'.repeat(20) + 'handoffTestCode_-0123456'; // 43 base64url chars
const FORBIDDEN_COPY = /bookmarklet|bookmark|swid|espn_s2|browser-assisted|extension|blob|capability|token/i;

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log('  ok - ' + name);
}

async function waitFor(check, label, rounds = 400) {
  for (let i = 0; i < rounds; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('timed out waiting for ' + label);
}

function providerForm(h) {
  const form = h.document.querySelector('#providerForms .provider-form');
  return form ? { className: form.className, innerHTML: form.innerHTML } : null;
}

async function selectEspnLikeACustomer(h) {
  const button = h.document.getElementById('platform-espn');
  button.onclick();
  const click = h.createEvent('click', { bubbles: true });
  click.target = button;
  h.document.getElementById('platformRow').dispatchEvent(click);
  h.documentListeners('click').filter((l) => !l.capture).forEach((l) => l.fn.call(h.document, click));
  await h.settle();
}

async function realCbsRecord() {
  const h = loadConnectPage();
  await h.window.receiveCbsConnection(scenarios.readInput('cbs-capture.input.json'));
  await h.settle();
  return scenarios.clone(h.window.LeagueConnection.getConnection('cbs'));
}

async function realEspnRecord() {
  const worker = loadExtensionWorker();
  const h = loadConnectPage();
  await worker.context.deliverEspnToSanctum(scenarios.SANCTUM_TAB_ID, scenarios.readInput('espn-capture.input.json'));
  runInjectedFunction(h, worker.executeScriptCalls.pop());
  await h.settle();
  return scenarios.clone(h.window.LeagueConnection.getConnection('espn'));
}

function claimResponder(response) {
  const calls = [];
  const responder = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body || '{}') });
    if (typeof response === 'function') return response(url, init);
    return response;
  };
  return { calls, responder };
}

function mobilePage(options) {
  return loadConnectPage({ userAgent: UA.androidChrome, ...options });
}

// Production form is the fragment; the query form is compatibility only.
const FRAGMENT_LINK = 'https://theinnersanctum.xyz/connect-league#handoff=' + CODE;
const QUERY_LINK = 'https://theinnersanctum.xyz/connect-league?handoff=' + CODE;

async function openHandoffLink(options) {
  const h = loadConnectPage({ url: FRAGMENT_LINK, domReady: false, ...options });
  return h;
}

function allBrowserStorage(h) {
  const dump = (storage) => Array.from(storage._map.entries()).map(([k, v]) => k + '=' + v).join('\n');
  return dump(h.window.localStorage) + '\n' + dump(h.window.sessionStorage);
}

function spyRefresh(h) {
  const calls = [];
  const original = h.window.refreshChatGptLinkIfNeeded;
  h.window.refreshChatGptLinkIfNeeded = function (provider) { calls.push(provider); return original.apply(this, arguments); };
  return calls;
}

(async function run() {
  /* ---------------- device detection ---------------- */

  await test('device detection: desktops (touch laptops included) are never mobile', async () => {
    const detect = loadConnectPage().window.InnerSanctumDeviceConnect.detectDevice;
    [[UA.windowsChrome, 0], [UA.windowsEdgeTouch, 10], [UA.macSafari, 0], [UA.macChrome, 0], [UA.linuxChrome, 5], [UA.macSafari, 1]]
      .forEach(([userAgent, maxTouchPoints]) => {
        assert.deepStrictEqual(JSON.parse(JSON.stringify(detect({ userAgent, maxTouchPoints }))), { mobile: false, kind: 'desktop' }, userAgent + ' / ' + maxTouchPoints);
      });
  });

  await test('device detection: Android, iPhone and iPad (incl. iPadOS desktop-style UA) are mobile', async () => {
    const detect = loadConnectPage().window.InnerSanctumDeviceConnect.detectDevice;
    const kind = (userAgent, maxTouchPoints = 5) => detect({ userAgent, maxTouchPoints }).kind;
    assert.strictEqual(kind(UA.androidChrome), 'android');
    assert.strictEqual(kind(UA.androidTablet), 'android');
    assert.strictEqual(kind(UA.iphoneSafari), 'iphone');
    assert.strictEqual(kind(UA.iphoneChrome), 'iphone');
    assert.strictEqual(kind(UA.ipadLegacy), 'ipad');
    assert.strictEqual(kind(UA.macSafari, 5), 'ipad', 'iPadOS Safari reports Macintosh with touch');
  });

  /* ---------------- desktop non-interference ---------------- */

  for (const [label, userAgent, maxTouchPoints] of [
    ['Windows Chrome', UA.windowsChrome, 0],
    ['Mac Safari', UA.macSafari, 0],
    ['touch-screen Windows laptop', UA.windowsEdgeTouch, 10]
  ]) {
    await test('desktop (' + label + '): CBS and ESPN provider forms are not rewritten', async () => {
      const h = loadConnectPage({ userAgent, maxTouchPoints });
      assert.strictEqual(h.window.InnerSanctumDeviceConnect.device.mobile, false);
      assert.deepStrictEqual(providerForm(h), MARKUP_GOLDEN.cbs.disconnected.providerForm);
      await selectEspnLikeACustomer(h);
      assert.deepStrictEqual(providerForm(h), MARKUP_GOLDEN.espn.afterNoExtensionSafetyGuard.providerForm);
      assert.strictEqual(h.document.querySelector('.is-mobile-connect'), null);
      assert.strictEqual(h.document.getElementById('isDeviceHandoffPanel'), null, 'no panel until a league is connected');
    });
  }

  await test('desktop: a connected CBS league gets a separate "Send to my phone" panel outside the provider form', async () => {
    const h = loadConnectPage();
    await h.window.receiveCbsConnection(scenarios.readInput('cbs-capture.input.json'));
    await h.settle();
    const panel = h.document.getElementById('isDeviceHandoffPanel');
    assert.ok(panel, 'panel rendered');
    assert.strictEqual(panel.closest('#providerForms'), null, 'panel is not inside #providerForms');
    assert.strictEqual(panel.parentNode, h.document.getElementById('providerForms').parentNode);
    assert.strictEqual(panel.querySelector('.connect-btn'), null, 'panel never uses the extension-intercepted class');
    assert.strictEqual(panel.querySelector('.is-handoff-btn').textContent, 'Send to my phone');
    const form = h.document.querySelector('#providerForms .provider-form');
    assert.ok(form.innerHTML.includes('onclick="startCbsConnect()"'), 'CBS desktop form is untouched');
  });

  /* ---------------- desktop Send to my phone ---------------- */

  await test('desktop: Send to my phone posts the finished record (never the ChatGPT link) and shows link + QR + expiry', async () => {
    const created = { code: 'A'.repeat(43), expiresAt: '2026-09-26T18:10:00.000Z' };
    const { calls, responder } = claimResponder({ status: 200, body: { success: true, ...created } });
    const h = loadConnectPage({ fetchResponder: responder });
    h.window.localStorage.setItem('innerSanctum_chatgptLeagueLinks', JSON.stringify({ cbs: { linkToken: 'chatgpt-secret-token' } }));
    await h.window.receiveCbsConnection(scenarios.readInput('cbs-capture.input.json'));
    await h.settle();
    calls.length = 0;

    h.document.querySelector('#isDeviceHandoffPanel .is-handoff-btn').click();
    await waitFor(() => h.document.querySelector('#isDeviceHandoffPanel .is-handoff-link'), 'handoff link');
    await waitFor(() => h.document.querySelector('#isDeviceHandoffPanel .is-handoff-qr svg path'), 'QR code');

    const handoffCalls = calls.filter((c) => /connection-handoff/.test(c.url));
    assert.strictEqual(handoffCalls.length, 1);
    assert.strictEqual(handoffCalls[0].body.action, 'create');
    assert.deepStrictEqual(handoffCalls[0].body.record, scenarios.clone(h.window.LeagueConnection.getConnection('cbs')));
    assert.ok(!JSON.stringify(handoffCalls[0].body).includes('chatgpt-secret-token'), 'ChatGPT link never sent');

    const link = h.document.querySelector('#isDeviceHandoffPanel .is-handoff-link').getAttribute('value');
    assert.strictEqual(link, 'https://theinnersanctum.xyz/connect-league#handoff=' + created.code, 'fragment form');
    assert.ok(!link.includes('?handoff='), 'generated links never use the query form');
    assert.ok(!h.document.getElementById('isDeviceHandoffPanel').innerHTML.includes('?handoff='));
    const path = h.document.querySelector('#isDeviceHandoffPanel .is-handoff-qr svg path').getAttribute('d');
    assert.ok(path.length > 500, 'QR modules drawn');
    const note = h.document.querySelector('#isDeviceHandoffPanel .is-handoff-note').textContent;
    assert.match(note, /works once and expires in 10 minutes/);
    assert.ok(!FORBIDDEN_COPY.test(h.document.getElementById('isDeviceHandoffPanel').textContent));
  });

  await test('desktop: a failed create shows a safe error and allows retry', async () => {
    const { responder } = claimResponder({ status: 429, body: { success: false, error: 'Too many links were created. Please wait a few minutes and try again.' } });
    const h = loadConnectPage({ fetchResponder: responder });
    await h.window.receiveCbsConnection(scenarios.readInput('cbs-capture.input.json'));
    await h.settle();
    const button = h.document.querySelector('#isDeviceHandoffPanel .is-handoff-btn');
    button.click();
    await waitFor(() => h.document.querySelector('#isDeviceHandoffPanel .is-handoff-status.error'), 'error');
    assert.match(h.document.querySelector('#isDeviceHandoffPanel .is-handoff-status.error').textContent, /Too many links/);
    await waitFor(() => button.disabled === false, 'button re-enabled');
  });

  /* ---------------- mobile UI ---------------- */

  for (const [label, userAgent, maxTouchPoints] of [
    ['Android Chrome', UA.androidChrome, 5],
    ['iPhone Safari', UA.iphoneSafari, 5],
    ['iPad Safari (desktop-style UA)', UA.macSafari, 5]
  ]) {
    await test('mobile (' + label + '): CBS and ESPN show one provider-neutral flow, no desktop-only instructions', async () => {
      const h = loadConnectPage({ userAgent, maxTouchPoints });
      assert.strictEqual(h.window.InnerSanctumDeviceConnect.device.mobile, true);
      const cbs = h.document.querySelector('#providerForms .is-mobile-connect');
      assert.ok(cbs, 'CBS mobile form');
      assert.strictEqual(cbs.getAttribute('data-provider'), 'cbs');
      assert.ok(cbs.textContent.includes('Already connected on a computer? Bring your league to this device.'));
      assert.strictEqual(h.document.querySelector('#providerForms .connect-btn'), null, 'no unusable connect button');
      assert.ok(!FORBIDDEN_COPY.test(h.document.getElementById('providerForms').textContent));

      await selectEspnLikeACustomer(h);
      const espn = h.document.querySelector('#providerForms .is-mobile-connect');
      assert.strictEqual(espn.getAttribute('data-provider'), 'espn');
      assert.ok(espn.textContent.includes('Already connected on a computer? Bring your league to this device.'));
      assert.ok(!/not active in this browser/.test(h.document.getElementById('providerForms').textContent));
      assert.ok(!FORBIDDEN_COPY.test(h.document.getElementById('providerForms').textContent));
      assert.strictEqual(h.document.getElementById('isDeviceHandoffPanel'), null, 'no Send to my phone panel on mobile');
    });
  }

  /* ---------------- handoff import ---------------- */

  for (const [provider, makeRecord] of [['cbs', realCbsRecord], ['espn', realEspnRecord]]) {
    await test('handoff imports ' + provider.toUpperCase() + ': URL cleaned before claim, saved, ChatGPT refresh, success UI', async () => {
      const record = await makeRecord();
      const { calls, responder } = claimResponder({ status: 200, body: { success: true, record } });
      const h = await openHandoffLink({ userAgent: UA.iphoneSafari, maxTouchPoints: 5, fetchResponder: responder });

      assert.ok(!h.window.location.href.includes(CODE), 'code removed at script load, before anything else');
      const refreshCalls = spyRefresh(h);
      h.domReady();
      await h.window.InnerSanctumDeviceConnect.whenImported();
      await h.settle();

      const first = h.timeline[0];
      assert.strictEqual(first.type, 'replaceState');
      assert.strictEqual(first.url, '/connect-league');
      h.timeline.filter((e) => e.type === 'fetch').forEach((e) => assert.ok(!e.locationHref.includes(CODE)));
      assert.deepStrictEqual(calls[0].body, { action: 'claim', code: CODE });

      assert.deepStrictEqual(scenarios.clone(h.window.LeagueConnection.getConnection(provider)), record);
      assert.strictEqual(h.window.LeagueConnection.getConnectionsByProvider(provider).length, 1);
      assert.deepStrictEqual(refreshCalls, [provider]);
      assert.strictEqual(h.window.selectedProvider, provider);

      const box = h.document.getElementById('isMobileConnectResult');
      assert.strictEqual(box.className, 'result-box success show');
      assert.ok(box.textContent.includes('League connected'));
      assert.ok(box.textContent.includes(record.leagueName));
      assert.ok(h.document.querySelector('.is-mobile-connect').textContent.includes('League synced'));
      assert.ok(!FORBIDDEN_COPY.test(h.document.getElementById('providerForms').textContent));
    });
  }

  await test('re-sending the same league updates it in place (update, not a duplicate connect)', async () => {
    const record = await realCbsRecord();
    const refreshed = scenarios.clone(record);
    refreshed.roster.push({ cbsPlayerId: '1', name: 'New Player', position: 'WR', nflTeam: 'KC', status: 'active', projectedPoints: null });
    refreshed.syncedAt = new Date(Date.parse(record.syncedAt) + 60000).toISOString();
    const { responder } = claimResponder({ status: 200, body: { success: true, record: refreshed } });
    const h = await openHandoffLink({ userAgent: UA.androidChrome, fetchResponder: responder });
    h.window.LeagueConnection.connect('cbs', record);
    const methods = [];
    ['connect', 'update'].forEach((m) => {
      const original = h.window.LeagueConnection[m];
      h.window.LeagueConnection[m] = function () { methods.push(m); return original.apply(this, arguments); };
    });
    h.domReady();
    await h.window.InnerSanctumDeviceConnect.whenImported();
    await h.settle();
    assert.deepStrictEqual(methods, ['update']);
    const all = h.window.LeagueConnection.getConnectionsByProvider('cbs');
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].roster.length, refreshed.roster.length);
  });

  await test('a different league of the same provider is added alongside, never overwritten', async () => {
    const record = await realCbsRecord();
    const other = scenarios.clone(record);
    other.leagueId = 'another-league'; other.league.id = 'another-league'; other.leagueName = 'Another League';
    other.league.name = 'Another League'; delete other.connectionId;
    const { responder } = claimResponder({ status: 200, body: { success: true, record: other } });
    const h = await openHandoffLink({ userAgent: UA.androidChrome, fetchResponder: responder });
    h.window.LeagueConnection.connect('cbs', record);
    h.domReady();
    await h.window.InnerSanctumDeviceConnect.whenImported();
    await h.settle();
    const leagues = h.window.LeagueConnection.getConnectionsByProvider('cbs').map((c) => c.leagueId).sort();
    assert.deepStrictEqual(leagues, ['another-league', 'phase0league']);
    const original = h.window.LeagueConnection.getConnectionsByProvider('cbs').find((c) => c.leagueId === 'phase0league');
    assert.deepStrictEqual(scenarios.clone(original.roster), record.roster);
  });

  for (const [label, response, expected] of [
    ['expired or already used', { status: 410, body: { success: false, error: 'This link has expired or was already used. On your computer, choose Send to my phone to get a new one.' } }, /expired or was already used/],
    ['rate limited', { status: 429, body: { success: false, error: 'Too many attempts. Please wait a few minutes and try again.' } }, /Too many attempts/],
    ['server returned an unusable record', { status: 200, body: { success: true, record: { provider: 'cbs', leagueId: 'x' } } }, /could not be added/],
    ['network unreachable', () => { throw new TypeError('Failed to fetch'); }, /couldn't reach Inner Sanctum/],
    ['hostile error text', { status: 410, body: { success: false, error: '<img src=x onerror=alert(1)>' } }, /<img src=x onerror=alert\(1\)>/]
  ]) {
    await test('failed handoff (' + label + ') renders a safe, useful error and stores nothing', async () => {
      const { responder } = claimResponder(response);
      const h = await openHandoffLink({ userAgent: UA.androidChrome, fetchResponder: responder });
      h.domReady();
      await h.window.InnerSanctumDeviceConnect.whenImported();
      await h.settle();
      assert.ok(!h.window.location.href.includes(CODE), 'code removed even when the claim fails');
      const box = h.document.getElementById('isMobileConnectResult');
      assert.strictEqual(box.className, 'result-box error show');
      assert.match(box.textContent, expected);
      assert.ok(!/<img|<script/i.test(box.innerHTML), 'error text is escaped, never markup');
      assert.strictEqual(h.getStoredState(), null);
    });
  }

  await test('compatibility: a ?handoff= link still imports and is removed before the claim', async () => {
    const record = await realEspnRecord();
    const { calls, responder } = claimResponder({ status: 200, body: { success: true, record } });
    const h = loadConnectPage({ url: QUERY_LINK, userAgent: UA.iphoneSafari, maxTouchPoints: 5, domReady: false, fetchResponder: responder });
    assert.ok(!h.window.location.href.includes(CODE), 'removed at script evaluation');
    assert.strictEqual(h.timeline[0].type, 'replaceState');
    assert.strictEqual(h.timeline[0].url, '/connect-league');
    h.domReady();
    await h.window.InnerSanctumDeviceConnect.whenImported();
    h.timeline.filter((e) => e.type === 'fetch').forEach((e) => assert.ok(!e.locationHref.includes(CODE)));
    assert.strictEqual(calls[0].body.code, CODE);
    assert.deepStrictEqual(scenarios.clone(h.window.LeagueConnection.getConnection('espn')), record);
    assert.ok(!allBrowserStorage(h).includes(CODE), 'never persisted');
  });

  await test('other fragment/query content is preserved when the code is removed', async () => {
    const h = loadConnectPage({
      url: 'https://theinnersanctum.xyz/connect-league?ref=qr#handoff=' + CODE + '&tab=espn',
      userAgent: UA.androidChrome, domReady: false,
      fetchResponder: async () => ({ status: 410, body: { success: false, error: 'This link has expired or was already used.' } })
    });
    assert.strictEqual(h.historyCalls[0].url, '/connect-league?ref=qr#tab=espn');
    assert.ok(!h.window.location.href.includes(CODE));
  });

  await test('a link opened in an already-open tab (fragment change, no reload) is imported and removed', async () => {
    const record = await realCbsRecord();
    const { calls, responder } = claimResponder({ status: 200, body: { success: true, record } });
    const h = loadConnectPage({ userAgent: UA.androidChrome, fetchResponder: responder });
    assert.strictEqual(calls.length, 0, 'nothing claimed on a normal visit');
    Object.assign(h.window.location, { hash: '#handoff=' + CODE, href: FRAGMENT_LINK });
    h.window.dispatchEvent(h.createEvent('hashchange'));
    assert.ok(!h.window.location.href.includes(CODE), 'removed synchronously in the hashchange handler');
    await h.window.InnerSanctumDeviceConnect.whenImported();
    await h.settle();
    assert.deepStrictEqual(calls.map((c) => c.body), [{ action: 'claim', code: CODE }]);
    assert.deepStrictEqual(scenarios.clone(h.window.LeagueConnection.getConnection('cbs')), record);
    h.timeline.filter((e) => e.type === 'fetch').forEach((e) => assert.ok(!e.locationHref.includes(CODE)));
  });

  /* ---------------- end to end through the real handler ---------------- */

  await test('end to end: desktop Send to my phone -> phone opens link -> league connected; link cannot be reused', async () => {
    const fake = createFakeBlobs();
    const handoff = loadFunctionWithFakeBlobs('netlify/functions/connection-handoff.js', fake);
    const viaHandler = async (url, init) => {
      if (!/connection-handoff/.test(url)) return { status: 200, body: {} };
      const res = await handoff.handler({
        httpMethod: init.method,
        headers: { origin: 'https://theinnersanctum.xyz', 'x-nf-client-connection-ip': '203.0.113.20' },
        body: init.body
      });
      return { status: res.statusCode, body: JSON.parse(res.body) };
    };

    const desktop = loadConnectPage({ fetchResponder: viaHandler });
    await desktop.window.receiveCbsConnection(scenarios.readInput('cbs-capture.input.json'));
    await desktop.settle();
    desktop.document.querySelector('#isDeviceHandoffPanel .is-handoff-btn').click();
    await waitFor(() => desktop.document.querySelector('#isDeviceHandoffPanel .is-handoff-link'), 'link');
    const link = desktop.document.querySelector('#isDeviceHandoffPanel .is-handoff-link').getAttribute('value');
    assert.match(link, /^https:\/\/theinnersanctum\.xyz\/connect-league#handoff=[A-Za-z0-9_-]{43}$/);
    assert.ok(!link.includes('?handoff='));
    const secret = link.split('#handoff=')[1];
    assert.ok(!allBrowserStorage(desktop).includes(secret), 'desktop never stores the code');

    const phone = loadConnectPage({ url: link, userAgent: UA.androidChrome, fetchResponder: viaHandler });
    await phone.window.InnerSanctumDeviceConnect.whenImported();
    await phone.settle();

    // After a successful claim the code exists nowhere on the phone or server.
    assert.ok(!phone.window.location.href.includes(secret), 'not in the address bar');
    assert.ok(!allBrowserStorage(phone).includes(secret), 'not in localStorage/sessionStorage');
    assert.ok(!phone.document.documentElement.outerHTML.includes(secret), 'not in the page DOM');
    phone.timeline.filter((e) => e.type === 'fetch').forEach((e) => {
      assert.ok(!e.url.includes(secret), 'never in a request URL');
      assert.ok(!e.locationHref.includes(secret), 'already removed from the page URL when requests start');
    });
    fake.stores.forEach((entries, storeName) => {
      entries.forEach((entry, key) => {
        assert.ok(!key.includes(secret), 'not a storage key in ' + storeName);
        assert.ok(!entry.raw.includes(secret), 'not a stored value in ' + storeName);
      });
    });
    assert.deepStrictEqual(
      scenarios.clone(phone.window.LeagueConnection.getConnection('cbs')),
      scenarios.clone(desktop.window.LeagueConnection.getConnection('cbs'))
    );
    assert.strictEqual(phone.document.getElementById('isMobileConnectResult').className, 'result-box success show');

    const second = loadConnectPage({ url: link, userAgent: UA.iphoneSafari, maxTouchPoints: 5, fetchResponder: viaHandler });
    await second.window.InnerSanctumDeviceConnect.whenImported();
    assert.match(second.document.getElementById('isMobileConnectResult').textContent, /expired or was already used/);
    assert.strictEqual(second.getStoredState(), null);
  });

  console.log('mobile-connect.test.js: ' + passed + ' passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

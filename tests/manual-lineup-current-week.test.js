'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('manual-lineup-week.js', 'utf8');
const endpoint = fs.readFileSync('netlify/functions/current-nfl-week.js', 'utf8');
const RealDate = Date;
function clock(iso) {
  return class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [iso])); }
    static now() { return new RealDate(iso).getTime(); }
  };
}
async function current(iso) {
  const sandbox = { exports: {}, require: p => require('../netlify/functions/' + p), Date: clock(iso) };
  vm.runInNewContext(endpoint, sandbox);
  const response = await sandbox.exports.handler({ httpMethod: 'GET' });
  assert.equal(response.headers['Cache-Control'], 'no-store');
  return { response, data: JSON.parse(response.body) };
}
function page(fetch, iso = '2026-10-02T02:00:00Z') {
  const events = {}, timers = [];
  const select = { value: '', options: [{ textContent: 'Loading current week…' }], addEventListener: (name, fn) => { events[name] = fn; } };
  const sandbox = {
    document: { getElementById: () => select },
    window: { addEventListener: (name, fn) => { events[name] = fn; } },
    fetch, Date: clock(iso), clearTimeout: () => {},
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }
  };
  vm.runInNewContext(source, sandbox);
  return { select, events, timers };
}
const drain = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  assert.equal((await current('2026-10-06T05:59:59Z')).data.week, 4);
  const rollover = await current('2026-10-06T06:00:00Z');
  assert.equal(rollover.data.week, 5);
  assert.equal(rollover.data.nextRolloverAt, '2026-10-13T06:00:00.000Z');
  assert.equal((await current('2026-09-14T12:00:00Z')).data.week, 1);
  assert.equal((await current('2027-01-01T12:00:00Z')).response.statusCode, 503);
  let data = (await current('2026-10-02T02:00:00Z')).data;
  const p = page(async () => ({ ok: true, json: async () => data }));
  await drain();
  assert.equal(p.select.value, '4', 'fresh manual form opens on Week 4');
  assert(p.timers[0].delay > 0, 'open form schedules Tuesday rollover');
  data = rollover.data;
  await p.timers[0].fn();
  assert.equal(p.select.value, '5', 'open form advances at rollover');
  p.select.value = '3'; p.events.change();
  await p.events.focus();
  assert.equal(p.select.value, '3', 'focus respects explicit week selection');
  let finish;
  const racing = page(() => new Promise(resolve => { finish = resolve; }));
  racing.select.value = '2'; racing.events.change();
  finish({ ok: true, json: async () => data }); await drain();
  assert.equal(racing.select.value, '2', 'late response cannot overwrite user choice');
  const failed = page(async () => { throw Error('offline'); }); await drain();
  assert.equal(failed.select.value, '');
  assert.equal(failed.select.options[0].textContent, 'Select NFL week');
  assert.equal(failed.timers[0].delay, 60000, 'transient failure retries automatically');
  const html = fs.readFileSync('sanctum.html', 'utf8');
  assert(html.includes('<script src="/manual-lineup-week.js"></script>'));
  assert(html.includes('<option value="" selected disabled>Loading current week…</option>'));
  assert(html.includes("var week = document.getElementById('lineupWeek').value;\n  if (!week)"), 'advice cannot silently send a missing week');
  console.log('manual-lineup-current-week.test.js passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

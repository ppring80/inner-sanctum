'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { jobsForWeek, nextJob } = require('../netlify/functions/_weekly-refresh-recovery');
const { weeklyReadiness } = require('../netlify/functions/_weekly-sage-readiness');
const { runHealthChecks, verifyCore } = require('../scripts/verify-weekly-tools');

async function main() {
  const rows = jobsForWeek(2026, 8).map(job => ({ ...job, ready: true, status: { status: 'ready' } }));
  const trend = rows.find(row => row.store === 'risers-fallers');
  trend.ready = false;
  trend.status = { status: 'failed', error: 'Tank01 refresh blocked by the shared daily safety budget.', lastFailure: { budgetReason: 'daily-limit' } };
  const before = JSON.stringify(rows);
  const result = weeklyReadiness(rows, 2026, 8);
  assert.equal(result.ready, true);
  assert.equal(result.core.status, 'READY');
  assert.equal(result.supplementary.status, 'DEGRADED');
  assert.equal(result.supplementary.jobs.find(job => job.job === trend.job).error, trend.status.error);
  assert.equal(result.supplementary.jobs.find(job => job.job === trend.job).budgetReason, 'daily-limit');
  assert.equal(nextJob(rows).job, trend.job, 'Supplementary evidence must still be scheduled');
  assert.equal(JSON.stringify(rows), before, 'Reporting must not modify jobs or retry state');
  for (const store of ['weekly-sage-schedule', 'weekly-sage-defense', 'qb-snapshot', 'rb-snapshot', 'wr-snapshot', 'te-snapshot', 'k-snapshot', 'def-snapshot', 'player-data', 'weekly-projections', 'opportunity-intel']) {
    const missing = rows.find(row => row.store === store);
    assert.equal(weeklyReadiness(rows.map(row => row === missing ? { ...row, ready: false } : row), 2026, 8).ready, false, store + ' cannot degrade to supplementary');
    assert.equal(weeklyReadiness(rows.filter(row => row !== missing), 2026, 8).ready, false, store + ' missing status must fail closed');
  }
  assert.equal(weeklyReadiness([], 2026, 8).ready, false);
  assert.equal(weeklyReadiness(rows, 2026, 19).ready, false);

  // Exercise the real status and coordinator reporting boundaries, not a second readiness calculation.
  let builds = 0;
  const recovery = require('../netlify/functions/_weekly-refresh-recovery');
  function load(file, currentRows) {
    const sandbox = { exports: {}, Date, URL, process: { env: { URL: 'https://fixture.invalid' } },
      fetch: async () => { builds++; return { ok: true }; },
      require(name) {
        if (name === '@netlify/blobs') return { connectLambda() {}, getStore: () => ({ get: async () => ({ availabilityMode: 'tank01-full-player-list-v1', updatedAt: new Date().toISOString(), teamsSucceeded: 32, teamsFailed: 0, playerCount: 1000 }) }) };
        if (name === './_weekly-refresh-recovery.js') return { ...recovery, inspectJobs: async () => currentRows, resolveCurrentNFLWeek: () => 8, sign: () => 'synthetic' };
        if (name === './_tank01-refresh-guard.js') return { requireTank01RefreshAuthorization: () => null };
        if (name === './_club-availability-run') return { STORE: 'synthetic' };
        return require('../netlify/functions/' + name);
      }
    };
    vm.runInNewContext(fs.readFileSync('netlify/functions/' + file, 'utf8'), sandbox);
    return sandbox.exports.handler;
  }
  // Bind the real season to a fixed acceptance week without changing global time.
  const season = new Date().getUTCFullYear();
  const currentRows = rows.map(row => ({ ...row, season: String(season) }));
  const status = await load('weekly-sage-status.js', currentRows)({ httpMethod: 'GET' });
  assert.equal(status.statusCode, 200);
  const data = JSON.parse(status.body);
  assert.equal(data.ready, true);
  assert.equal(data.supplementary.status, 'DEGRADED');
  const coordinator = JSON.parse((await load('recover-weekly-sage.js', currentRows)({})).body);
  assert.equal(coordinator.ready, true);
  assert.equal(coordinator.dispatched, trend.job);
  assert.equal(builds, 1, 'Classification must not suppress supplementary recovery');
  const missingDef = currentRows.map(row => row.store === 'def-snapshot' ? { ...row, ready: false } : row);
  assert.equal((await load('weekly-sage-status.js', missingDef)({ httpMethod: 'GET' })).statusCode, 503);

  let supplementaryChecks = 0;
  const report = await runHealthChecks({ coreCheck: async () => ({ week: 8, supplementaryFailures: [{ check: trend.job, error: trend.status.error, budgetReason: 'daily-limit' }] }), supplementaryCheck: async () => { supplementaryChecks++; throw Error('Public trends unavailable'); } });
  assert.equal(report.core.status, 'PASS');
  assert.equal(report.supplementary.status, 'DEGRADED');
  assert.equal(report.supplementary.failures.length, 2);
  const failed = await runHealthChecks({ coreCheck: async () => { throw Error('DEF missing'); }, supplementaryCheck: async () => { supplementaryChecks++; throw Error('Public trends unavailable'); } });
  assert.equal(failed.core.status, 'FAIL');
  assert.equal(failed.supplementary.status, 'DEGRADED');
  const unsafe=await runHealthChecks({coreCheck:async()=>({week:8}),supplementaryCheck:async()=>{throw Object.assign(Error('Preview exposed full paid lists'),{critical:true});}});
  assert.equal(unsafe.core.status,'FAIL','Privacy protection remains a hard monitor failure');
  assert.equal(supplementaryChecks, 2, 'Supplementary check still executes when core fails');
  const savedFetch = global.fetch;
  let requests = 0;
  const healthStatus = {ready:true,core:{ready:true},week:require('../netlify/functions/_current-nfl-week').resolveCurrentNFLWeek(new Date()),
    supplementary:result.supplementary,injuryTransactions:{retired:true,fresh:false},
    playerAvailability:{availabilityMode:'tank01-full-player-list-v1',fresh:true,teamsSucceeded:32,teamsFailed:0,playerCount:3853}};
  try {
    global.fetch = async () => { requests++; return {status:200,json:async()=>requests===1?healthStatus:{metadata:{complete:false}}}; };
    await assert.rejects(verifyCore());
    assert.equal(requests,2,'Retired transactions must not reject valid full-player availability');
    for (const patch of [{fresh:false},{teamsSucceeded:31},{teamsFailed:1},{playerCount:999},{availabilityMode:'legacy'}]) {
      requests=0;
      global.fetch=async()=>{requests++;return{status:200,json:async()=>({...healthStatus,playerAvailability:{...healthStatus.playerAvailability,...patch}})};};
      await assert.rejects(verifyCore(), /availability/i);
      assert.equal(requests,1,'Incomplete availability must fail before customer checks');
    }
  } finally { global.fetch=savedFetch; }
  console.log('PASS: Week 8 core/supplementary split, required evidence fail-closed, status/coordinator parity, unchanged dispatch and independent monitor checks.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

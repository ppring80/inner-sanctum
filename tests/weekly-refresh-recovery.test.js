'use strict';
const assert = require('assert');
const { jobsForWeek, cacheKey, stateKey, completeCache, canRetry, nextJob, sign, verify, runJob, resolveCurrentNFLWeek } = require('../netlify/functions/_weekly-refresh-recovery');

function memoryStores() {
  const stores = new Map();
  return ({ name }) => {
    if (!stores.has(name)) {
      const records = new Map(); let revision = 0;
      stores.set(name, {
        get: async key => records.get(key)?.data || null,
        getWithMetadata: async key => records.get(key) || null,
        setJSON: async (key, data, options = {}) => {
          const previous = records.get(key);
          if ((options.onlyIfNew && previous) || (options.onlyIfMatch && previous?.etag !== options.onlyIfMatch)) return { modified: false };
          records.set(key, { data: structuredClone(data), etag: String(++revision) });
          return { modified: true };
        }
      });
    }
    return stores.get(name);
  };
}

async function main() {
  assert.equal(resolveCurrentNFLWeek(new Date('2026-09-29T05:59:59Z')), 3);
  assert.equal(resolveCurrentNFLWeek(new Date('2026-09-29T06:00:00Z')), 4);
  const jobs = jobsForWeek(2026, 4);
  assert.deepEqual(jobs.filter(j => j.store === 'weekly-sage-schedule').map(j => j.week), [1,2,3,4]);
  assert.deepEqual(jobs.filter(j => j.store === 'weekly-sage-defense').map(j => j.week), [1,2,3]);
  assert.equal(jobs.filter(j => j.store.endsWith('-snapshot')).length, 6);
  const injury = jobs.find(j => j.store === 'player-data');
  const availability = {updatedAt:new Date().toISOString(),teamsSucceeded:32,teamsFailed:0,players:Object.fromEntries(Array.from({length:1000},(_,i)=>[i,{longName:'Player '+i}]))};
  assert.equal(cacheKey(injury),'playerData');
  assert(completeCache(availability,injury));
  assert(!completeCache({...availability,teamsSucceeded:31,teamsFailed:1},injury));
  assert(!completeCache({...availability,updatedAt:new Date(Date.now()-9*3600000).toISOString()},injury));
  const job = jobs.find(j => j.job === 'refresh-qb-snapshot');
  const snapshot = { evidenceType: job.evidenceType, season: '2026', targetWeek: 4, seasonType: 'reg', population: [{name: 'QB'}], failures: [], nextStep: {ready:true} };
  assert(completeCache(snapshot, job));
  const rbJob = jobs.find(j => j.job === 'refresh-rb-snapshot');
  assert(completeCache({...snapshot,evidenceType:rbJob.evidenceType,nextStep:{recommended:'rank'}},rbJob),'RB readiness uses its real snapshot contract');
  assert(!completeCache({...snapshot,targetWeek:3}, job));
  assert(!completeCache({...snapshot,failures:['provider failed']}, job));
  assert(!completeCache({...snapshot,nextStep:{ready:false}}, job));
  const getStore = memoryStores();
  let providerReservations = 0;
  const build = async () => {
    providerReservations++;
    await getStore({name:job.store}).setJSON(cacheKey(job), snapshot);
    return {statusCode:200, body:'{}'};
  };
  await Promise.all(Array.from({length:8}, () => runJob(job, {}, {getStore, build})));
  assert.equal(providerReservations, 1, 'duplicate background deliveries must reserve provider budget only once');
  await runJob(job, {}, {getStore, build});
  assert.equal(providerReservations, 1, 'completed weeks never rebuild');
  const other = jobs.find(j => j.job === 'refresh-rb-snapshot');
  const now = Date.parse('2026-09-30T06:00:00Z');
  let failures = 0;
  const fail = async () => { failures++; return {statusCode:429,body:JSON.stringify({error:'Budget exhausted'})}; };
  await runJob(other, {}, {getStore,build:fail,now});
  await runJob(other, {}, {getStore,build:fail,now:now+60*1000});
  assert.equal(failures,1,'failure retries must back off');
  await runJob(other, {}, {getStore,build:fail,now:now+31*60*1000});
  await runJob(other, {}, {getStore,build:fail,now:now+62*60*1000});
  assert.equal(failures,2,'retry ceiling is two attempts per UTC day');
  const state = await getStore({name:'weekly-sage-refresh-status'}).get(stateKey(other));
  assert.equal(state.status,'failed'); assert.equal(state.statusCode,429);
  assert(canRetry(state, now+24*60*60*1000),'budget-blocked jobs recover automatically next day');
  const rows = jobs.map(j => ({...j,ready:!j.store.endsWith('-snapshot')}));
  rows.find(j=>j.job===job.job).status={leaseUntil:now+60*1000};
  assert.equal(nextJob(rows,now).job,'refresh-rb-snapshot','one running position does not block other positions');
  rows[0].ready=false;
  assert.equal(nextJob(rows,now).job,'refresh-weekly-sage-schedule','missing schedule blocks downstream builds');
  process.env.TANK01_REFRESH_TOKEN = 'test-only-refresh-secret';
  const body=JSON.stringify({job:job.job,issuedAt:now}); const signature=sign(body);
  assert(verify(body,signature,now));
  assert(!verify(body+' ',signature,now));
  assert(!verify(body,signature,now+6*60*1000));
  assert(!verify(body,'bad',now));
  delete process.env.TANK01_REFRESH_TOKEN;
  console.log('Weekly rollover, dependency recovery, atomic duplicate protection, retry limits, and signed jobs passed.');
}
main().catch(e=>{ console.error(e);process.exitCode=1; });

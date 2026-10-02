'use strict';
const { connectLambda, getStore } = require('@netlify/blobs');
const { inspectJobs, resolveCurrentNFLWeek } = require('./_weekly-refresh-recovery.js');
exports.handler = async event => {
  if (event.httpMethod !== 'GET') return { statusCode: 405 };
  connectLambda(event);
  try {
    const season = new Date().getUTCFullYear();
    const week = resolveCurrentNFLWeek(new Date(), season);
    const rows = await inspectJobs(getStore, season, week);
    const jobs = rows.map(row => ({ job: row.job, week: row.week, ready: row.ready, state: row.status && row.status.status || 'pending', lastAttempt: row.status && row.status.startedAt || null, error: row.status && row.status.error || null }));
    const ready = rows.length > 0 && rows.every(row => row.ready);
    const injuryStore=getStore({name:require('./_injury-transactions').STORE});
    const [injuries,health]=await Promise.all([injuryStore.get('latest',{type:'json'}),injuryStore.get('health',{type:'json'})]);
    const age=Date.now()-Date.parse(injuries?.checkedAt||'');
    const injuryTransactions={checkedAt:injuries?.checkedAt||null,fresh:Number.isFinite(age)&&age>=0&&age<2*3600000,records:injuries?.records?.length||0,lastChanges:injuries?.lastChanges||[],health};
    return { statusCode: ready ? 200 : 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ season, week, ready, jobs, injuryTransactions }) };
  } catch (_) {
    return { statusCode: 503, body: JSON.stringify({ ready: false, error: 'Weekly cache status could not be checked.' }) };
  }
};

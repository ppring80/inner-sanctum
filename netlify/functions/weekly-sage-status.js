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
    return { statusCode: ready ? 200 : 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ season, week, ready, jobs }) };
  } catch (_) {
    return { statusCode: 503, body: JSON.stringify({ ready: false, error: 'Weekly cache status could not be checked.' }) };
  }
};

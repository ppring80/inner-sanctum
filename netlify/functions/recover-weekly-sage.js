'use strict';
const { connectLambda, getStore } = require('@netlify/blobs');
const { requireTank01RefreshAuthorization } = require('./_tank01-refresh-guard.js');
const { inspectJobs, nextJob, sign, resolveCurrentNFLWeek } = require('./_weekly-refresh-recovery.js');

exports.handler = async event => {
  const denied = requireTank01RefreshAuthorization(event);
  if (denied) return denied;
  connectLambda(event);
  // Independent official evidence: stale-only, shared lease, zero Tank01 calls.
  // The authenticated Netlify recovery loop supplies retries without a GitHub secret.
  try { await require("./refresh-injury-transactions").handler(event); }
  catch(error) { console.error("INJURY_RECOVERY_FAILED", error.message); }
  const season = new Date().getUTCFullYear();
  const week = resolveCurrentNFLWeek(new Date(), season);
  const rows = await inspectJobs(getStore, season, week);
  // Resolve dependencies in order. Never bypass a failed schedule/defense job.
  if (!rows.length || rows.every(row => row.ready)) return { statusCode: 200, body: JSON.stringify({ season, week, ready: rows.length > 0, skipped: !rows.length }) };
  const missing = nextJob(rows);
  if (!missing) return { statusCode: 200, body: JSON.stringify({ season, week, ready: false, waitingForRetry: true }) };
  const origin = process.env.URL;
  if (!origin || !/^https:\/\//.test(origin)) throw new Error('Netlify URL is required for weekly recovery.');
  const body = JSON.stringify({ job: missing.job, season: missing.season, week: missing.week, targetWeek: week, issuedAt: Date.now() });
  const result = await fetch(new URL('/.netlify/functions/weekly-sage-refresh-background', origin), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Weekly-Refresh-Signature': sign(body) }, body
  });
  if (!result.ok) throw new Error(`Weekly background dispatch failed: HTTP ${result.status}`);
  return { statusCode: 200, body: JSON.stringify({ season, week, ready: false, dispatched: missing.job, evidenceWeek: missing.week }) };
};

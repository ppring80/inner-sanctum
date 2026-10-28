'use strict';
const { connectLambda, getStore } = require('@netlify/blobs');
const { requireTank01RefreshAuthorization } = require('./_tank01-refresh-guard.js');
const { inspectJobs, nextJob, sign, resolveCurrentNFLWeek } = require('./_weekly-refresh-recovery.js');

const { weeklyReadiness } = require('./_weekly-sage-readiness');

exports.handler = async event => {
  const denied = requireTank01RefreshAuthorization(event);
  if (denied) return denied;
  connectLambda(event);
  // Official transactions run on their own hourly schedule and authenticated
  // recovery workflow. Never await that network collector here: a stalled
  // source must not consume the weekly watchdog before Tank01 jobs dispatch.
  const season = new Date().getUTCFullYear();
  const week = resolveCurrentNFLWeek(new Date(), season);
  const rows = await inspectJobs(getStore, season, week);
  const readiness = weeklyReadiness(rows, season, week);
  // Resolve dependencies in order. Never bypass a failed schedule/defense job.
  if (!rows.length || rows.every(row => row.ready)) return { statusCode: 200, body: JSON.stringify({ season, week, ...readiness, skipped: !rows.length }) };
  const missing = nextJob(rows);
  if (!missing) return { statusCode: 200, body: JSON.stringify({ season, week, ...readiness, waitingForRetry: true }) };
  const origin = process.env.URL;
  if (!origin || !/^https:\/\//.test(origin)) throw new Error('Netlify URL is required for weekly recovery.');
  const body = JSON.stringify({ job: missing.job, season: missing.season, week: missing.week, targetWeek: week, issuedAt: Date.now() });
  const result = await fetch(new URL('/.netlify/functions/weekly-sage-refresh-background', origin), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Weekly-Refresh-Signature': sign(body) }, body
  });
  if (!result.ok) throw new Error(`Weekly background dispatch failed: HTTP ${result.status}`);
  return { statusCode: 200, body: JSON.stringify({ season, week, ...readiness, dispatched: missing.job, evidenceWeek: missing.week }) };
};

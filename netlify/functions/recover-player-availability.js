'use strict';

const { connectLambda, getStore } = require('@netlify/blobs');
const { requireTank01RefreshAuthorization } = require('./_tank01-refresh-guard');
const { criticalCheckpoint } = require('./_availability-refresh-rhythm');
const { jobsForWeek, resolveCurrentNFLWeek, runJob } = require('./_weekly-refresh-recovery');
const { handler: refreshPlayerData } = require('./refresh-player-data');

exports.handler = async event => {
  const denied = requireTank01RefreshAuthorization(event);
  if (denied) return denied;
  connectLambda(event);

  const now = new Date();
  const season = now.getUTCFullYear();
  const week = resolveCurrentNFLWeek(now, season);
  const job = jobsForWeek(season, week).find(row => row.store === 'player-data');
  if (!job) return { statusCode: 200, body: JSON.stringify({ skipped: true }) };

  // Kickoff evidence is optional here. Cache age and practice checkpoints
  // remain enforceable if the weekly schedule store cannot be read.
  const schedule = await getStore({ name: 'weekly-sage-schedule' })
    .get(`week:${season}:${week}:reg`, { type: 'json' })
    .catch(() => null);
  const matchingSchedule = schedule && String(schedule.season) === String(season) &&
    Number(schedule.week ?? schedule.targetWeek) === week ? schedule : null;
  job.criticalCheckpoint = criticalCheckpoint(matchingSchedule, now.getTime());

  const result = await runJob(job, event, {
    getStore,
    build: (_job, invocation) => refreshPlayerData(invocation)
  });
  return {
    statusCode: result.status === 'failed' ? 502 : 200,
    body: JSON.stringify({ status: result.status, skipped: Boolean(result.skipped) })
  };
};

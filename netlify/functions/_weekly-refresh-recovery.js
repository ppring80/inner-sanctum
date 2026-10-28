'use strict';

const crypto = require('crypto');
const { resolveCurrentNFLWeek } = require('./_current-nfl-week.js');
const STATE_STORE = 'weekly-sage-refresh-status';
const LEASE_MS = 20 * 60 * 1000;
const RETRY_MS = 30 * 60 * 1000;
const { retryState, failure: defenseFailure, DEFENSE_POLICY, BACKOFF_MS } = require('./_weekly-defense-failure');
const { dailyRuns, criticalCheckpoint } = require('./_availability-refresh-rhythm.js');

function jobsForWeek(season, targetWeek) {
  if (!Number.isInteger(targetWeek) || targetWeek < 1 || targetWeek > 18) return [];
  const jobs = [];
  const add = (job, store, week, evidenceType) => jobs.push({ job, store, season: String(season), week, seasonType: 'reg', evidenceType });
  for (let week = 1; week <= targetWeek; week++) add('refresh-weekly-sage-schedule', 'weekly-sage-schedule', week, 'weekly-sage-schedule');
  for (let week = 1; week < targetWeek; week++) add('refresh-weekly-sage-defense', 'weekly-sage-defense', week, 'weekly-sage-defense-week');
  for (const position of (targetWeek >= 2 ? ['qb', 'rb', 'wr', 'te', 'k', 'def'] : [])) add(`refresh-${position}-snapshot`, `${position}-snapshot`, targetWeek, `weekly-sage-${position}-snapshot`);
  for (let week = 1; week < targetWeek; week++) add('refresh-opportunity-intel','opportunity-intel',week,'weekly-opportunity');
  if (targetWeek >= 3) add('refresh-risers-fallers','risers-fallers',targetWeek-1,'weekly-trends');
  add('refresh-player-data', 'player-data', targetWeek, 'player-availability-cache');
  add('refresh-weekly-projections', 'weekly-projections', targetWeek, 'weekly-projection-cache');
  add('refresh-sage-newswire', 'sage-newswire', targetWeek, 'editorial-with-sources');
  add('refresh-role-evidence', 'sage-role-events', targetWeek, 'verified-role-history');
  jobs[jobs.length-1].optional=true;
  return jobs;
}
const cacheKey = job => ['opportunity-intel','risers-fallers'].includes(job.store) ? 'latest' : job.store === 'player-data' ? 'playerData' : job.store === 'sage-role-events' ? `season:${job.season}` : job.store === 'sage-newswire' ? 'latest' : `week:${job.season}:${job.week}:${job.seasonType}`;
const stateKey = job => `${job.job}:${cacheKey(job)}${['opportunity-intel','risers-fallers'].includes(job.store) ? ':'+job.season+':'+job.week : ''}`;

function completeCache(value, job, now = Date.now()) {
  if (job.store === 'opportunity-intel') return Boolean(value && String(value.season) === job.season && Math.max(...(value.weeksRequested || [])) >= job.week && value.gamesFound > 0 && value.gamesFailed === 0 && Object.keys(value.records || {}).length > 0);
  if (job.store === 'risers-fallers') return Boolean(value && String(value.season) === job.season && Number(value.currentWeek) === job.week && Number(value.previousWeek) === job.week-1 && Object.keys(value.allDeltas || {}).length > 0);
  if (job.store === 'player-data') {
    if(value?.availabilityMode!==require('./_tank01-player-cache').MODE)return false;
    const updated = value && Date.parse(value.updatedAt), age = now-updated;
    return Boolean(value && value.teamsSucceeded === 32 && value.teamsFailed === 0 && Object.keys(value.players || {}).length >= 1000 && Number.isFinite(age) && age >= 0 && age < 8*60*60*1000 && (!job.criticalCheckpoint || updated >= job.criticalCheckpoint.at || age < 30*60*1000));
  }
  if (job.store === 'sage-role-events') {
    const age=now-Date.parse(value?.dedicatedCollection?.checkedAt);
    return Boolean(value?.version===1&&String(value.season)===job.season&&Array.isArray(value.events)&&value.dedicatedCollection.indexesSucceeded>0&&Number.isFinite(age)&&age>=0&&age<6*60*60*1000);
  }
  if (job.store === 'sage-newswire') {
    const age = value && now-Date.parse(value.updatedAt);
    return Boolean(value && value.mode === 'editorial-with-sources' && value.collection?.automaticStories > 0 && Array.isArray(value.stories) && value.stories.length && Number.isFinite(age) && age >= 0 && age < 6*60*60*1000);
  }
  if (job.store === 'weekly-projections') return require('./_weekly-projections.js').validCache(value, job.season, job.week, require('./_weekly-projections.js').REFRESH_MS,now);
  if (!value || value.evidenceType !== job.evidenceType || String(value.season) !== job.season || Number(value.targetWeek ?? value.week) !== job.week || value.seasonType !== job.seasonType) return false;
  if (job.store === 'weekly-sage-schedule') return Array.isArray(value.games) && value.games.length > 0 && value.gamesReturned === value.games.length;
  if (job.store === 'weekly-sage-defense') return value.schedule && value.schedule.completedGames > 0 && value.schedule.completedGames === value.schedule.gamesReturned && value.schedule.processedGames === value.schedule.completedGames && Array.isArray(value.gameResults) && value.gameResults.every(game => game.status === 'processed');
  if (['k-snapshot', 'def-snapshot'].includes(job.store)) return Array.isArray(value.population) && value.population.length > 0 && value.populationSummary && value.populationSummary.weeksWithEvidence === value.populationSummary.weeksScanned;
  return Array.isArray(value.population) && value.population.length > 0 && Array.isArray(value.failures) && value.failures.length === 0 && (job.store === 'rb-snapshot' || value.nextStep?.ready === true);
}

async function inspectJobs(getStore, season, week, now = Date.now()) {
  const state = getStore({ name: STATE_STORE });
  const schedule = await getStore({name:'weekly-sage-schedule'}).get(`week:${season}:${week}:reg`,{type:'json'});
  const matchingSchedule = schedule && String(schedule.season) === String(season) && Number(schedule.week ?? schedule.targetWeek) === week ? schedule : null;
  const checkpoint = criticalCheckpoint(matchingSchedule, now);
  return Promise.all(jobsForWeek(season,week).map(async job => {
    const [cached,status] = await Promise.all([
      getStore({name:job.store}).get(cacheKey(job),{type:'json'}),
      state.get(stateKey(job),{type:'json'})
    ]);
    const policyJob = job.store === 'player-data' ? {...job,criticalCheckpoint:checkpoint,criticalDue:Boolean(checkpoint)} : job;
    return {...policyJob,ready:completeCache(cached,policyJob,now),status:job.store === 'weekly-sage-defense' && status ? {...status,retryPolicy:DEFENSE_POLICY,attemptLimit:4} : job.store === 'player-data' && status ? {...status,attemptLimit:dailyRuns(now)} : status};
  }));
}

function canRetry(status, now = Date.now()) {
  if (!status) return true;
  if (Number(status.leaseUntil) > now || Number(status.retryAfter) > now) return false;
  if (status.retryPolicy === DEFENSE_POLICY) {
    if (Number(status.attempts || 0) >= 4) return false;
    if (status.failure?.category === 'budget') return status.day !== new Date(now).toISOString().slice(0, 10);
    return status.failure?.retryable !== false;
  }
  return status.day !== new Date(now).toISOString().slice(0, 10) || Number(status.attempts || 0) < Number(status.attemptLimit || 2);
}

function nextJob(rows, now = Date.now()) {
  const critical = rows.find(row=>row.store === 'player-data' && row.criticalDue && !row.ready && canRetry(row.status,now));
  if (critical) return critical;
  // Availability, projections and reporting have no defensive-statistics or snapshot
  // dependency. A failed rankings build must not starve these shared feeds.
  const independent = ['player-data','weekly-projections','sage-role-events','sage-newswire'].map(store=>rows.find(row=>row.store===store&&!row.ready&&canRetry(row.status,now))).find(Boolean);
  if (independent) return independent;
  for (const group of ['weekly-sage-schedule', 'weekly-sage-defense', 'positions', 'auxiliary']) {
    const pending = rows.filter(row => !row.ready && (group === 'positions' ? row.store.endsWith('-snapshot') : group === 'auxiliary' ? ['player-data','opportunity-intel','risers-fallers','weekly-projections','sage-newswire'].includes(row.store) : row.store === group));
    if (pending.length) return pending.find(row => canRetry(row.status, now) && (row.store !== 'opportunity-intel' || !rows.some(prior => prior.store === row.store && prior.week < row.week && !prior.ready))) || null;
  }
  return null;
}

function signingSecret() { return process.env.TANK01_REFRESH_TOKEN || process.env.TANK01_API_KEY; }
function sign(body) {
  const secret = signingSecret();
  if (!secret) throw new Error('Weekly recovery signing secret is not configured.');
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}
function verify(body, signature, now = Date.now()) {
  if (typeof body !== 'string' || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false;
  try {
    const parsed = JSON.parse(body);
    if (!Number.isFinite(parsed.issuedAt) || Math.abs(now - parsed.issuedAt) > 5 * 60 * 1000) return false;
    return crypto.timingSafeEqual(Buffer.from(sign(body), 'hex'), Buffer.from(signature, 'hex'));
  } catch (_) { return false; }
}

async function runJob(job, event, dependencies) {
  const { getStore, build, now = Date.now() } = dependencies;
  const cache = getStore({ name: job.store });
  if (completeCache(await cache.get(cacheKey(job), { type: 'json' }), job, now)) return { status: 'ready', skipped: true };
  const state = getStore({ name: STATE_STORE });
  const key = stateKey(job);
  const previous = await state.getWithMetadata(key, { type: 'json' });
  const defensive = job.store === 'weekly-sage-defense';
  const priorStatus = previous && (defensive ? {...previous.data, retryPolicy: DEFENSE_POLICY, attemptLimit: 4} : job.store === 'player-data' ? {...previous.data,attemptLimit:dailyRuns(now)} : previous.data);
  if (!canRetry(priorStatus, now)) return { status: 'waiting', skipped: true };
  const day = new Date(now).toISOString().slice(0, 10);
  const lastFailure=previous?.data?.lastFailure||null;
  const value = { ...(lastFailure?{lastFailure}:{}), status: 'running', day, ...(defensive?{retryPolicy:DEFENSE_POLICY}:{}), attemptLimit: defensive ? 4 : job.store === 'player-data' ? dailyRuns(now) : ['weekly-projections','sage-newswire','sage-role-events'].includes(job.store) ? 8 : 2, attempts: previous && (defensive || previous.data.day === day) ? Number(previous.data.attempts || 0) + 1 : 1, startedAt: new Date(now).toISOString(), leaseUntil: now + LEASE_MS };
  const claimed = await state.setJSON(key, value, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
  if (!claimed.modified) return { status: 'waiting', skipped: true };
  try {
    if (completeCache(await cache.get(cacheKey(job), { type: 'json' }), job, now)) {
      await state.setJSON(key, { ...value, status: 'ready', leaseUntil: 0 });
      return { status: 'ready', skipped: true };
    }
    // Claim precedes the existing builder's atomic provider budget reservation.
    const result = await build(job, event);
    let response = {};
    try { response = JSON.parse(result.body || '{}'); } catch (_) {}
    // Each builder validates completeness before writing and returns cached:true.
    // Do not reject its successful write because the Lambda edge read can lag.
    const ready = result.statusCode === 200 && (response.cached === true || (response.writeOccurred === true && response.gamesFailed === 0 && response.noOp === false && Number(response.targetWeek) === job.week) || completeCache(await cache.get(cacheKey(job), { type: 'json' }), job));
    const detail = response.error || null;
    const failure = defensive && !ready ? retryState(response, result.statusCode) : null;
    const final = { ...value, status: ready ? 'ready' : 'failed', leaseUntil: 0, retryAfter: ready ? now + 2*60*1000 : (defensive ? Date.now() + BACKOFF_MS[Math.min(value.attempts-1,2)] : now + RETRY_MS), finishedAt: new Date().toISOString(), statusCode: result.statusCode, error: detail };
    if (failure) {
      final.failure = failure;
      final.blockedReason = value.attempts >= 4 ? 'defense_attempt_limit' : !failure.retryable ? `defense_${failure.category}` : null;
    }
    if(!ready)final.lastFailure={day,at:final.finishedAt,statusCode:result.statusCode,error:detail,budgetReason:response.budget?.reason||null,attempts:value.attempts,...(failure?{failure,blockedReason:final.blockedReason}:{})};
    await state.setJSON(key, final);
    console.log('WEEKLY_REFRESH_RESULT', JSON.stringify({ job: job.job, week: job.week, ...final }));
    return final;
  } catch (error) {
    const final = { ...value, status: 'failed', leaseUntil: 0, retryAfter: now + RETRY_MS, finishedAt: new Date().toISOString(), error: 'Weekly refresh worker failed; inspect function logs.' };
    if (defensive) {
      final.failure = defenseFailure('processing');
      final.blockedReason = 'defense_processing';
    }
    final.lastFailure={day,at:final.finishedAt,statusCode:null,error:final.error,budgetReason:null,attempts:value.attempts,...(defensive?{failure:final.failure,blockedReason:final.blockedReason}:{})};
    await state.setJSON(key, final);
    console.error('WEEKLY_REFRESH_FAILED', job.job, job.week, defensive ? final.failure.category : error.message);
    return final;
  }
}

module.exports = { STATE_STORE, jobsForWeek, cacheKey, stateKey, completeCache, inspectJobs, canRetry, nextJob, sign, verify, runJob, resolveCurrentNFLWeek };

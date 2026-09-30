'use strict';

const crypto = require('crypto');
const { resolveCurrentNFLWeek } = require('./_current-nfl-week.js');
const STATE_STORE = 'weekly-sage-refresh-status';
const LEASE_MS = 20 * 60 * 1000;
const RETRY_MS = 30 * 60 * 1000;

function jobsForWeek(season, targetWeek) {
  if (!Number.isInteger(targetWeek) || targetWeek < 1 || targetWeek > 18) return [];
  const jobs = [];
  const add = (job, store, week, evidenceType) => jobs.push({ job, store, season: String(season), week, seasonType: 'reg', evidenceType });
  for (let week = 1; week <= targetWeek; week++) add('refresh-weekly-sage-schedule', 'weekly-sage-schedule', week, 'weekly-sage-schedule');
  for (let week = 1; week < targetWeek; week++) add('refresh-weekly-sage-defense', 'weekly-sage-defense', week, 'weekly-sage-defense-week');
  for (const position of (targetWeek >= 2 ? ['qb', 'rb', 'wr', 'te', 'k', 'def'] : [])) add(`refresh-${position}-snapshot`, `${position}-snapshot`, targetWeek, `weekly-sage-${position}-snapshot`);
  add('refresh-weekly-projections', 'weekly-projections', targetWeek, 'weekly-projection-cache');
  add('refresh-sage-newswire', 'sage-newswire', targetWeek, 'source-headlines');
  return jobs;
}
const cacheKey = job => job.store === 'sage-newswire' ? 'latest' : `week:${job.season}:${job.week}:${job.seasonType}`;
const stateKey = job => `${job.job}:${cacheKey(job)}`;

function completeCache(value, job) {
  if (job.store === 'sage-newswire') {
    const age = value && Date.now()-Date.parse(value.updatedAt);
    return Boolean(value && value.mode === 'source-headlines' && Array.isArray(value.stories) && value.stories.length && Number.isFinite(age) && age >= 0 && age < 6*60*60*1000);
  }
  if (job.store === 'weekly-projections') return require('./_weekly-projections.js').validCache(value, job.season, job.week, require('./_weekly-projections.js').REFRESH_MS);
  if (!value || value.evidenceType !== job.evidenceType || String(value.season) !== job.season || Number(value.targetWeek ?? value.week) !== job.week || value.seasonType !== job.seasonType) return false;
  if (job.store === 'weekly-sage-schedule') return Array.isArray(value.games) && value.games.length > 0 && value.gamesReturned === value.games.length;
  if (job.store === 'weekly-sage-defense') return value.schedule && value.schedule.completedGames > 0 && value.schedule.completedGames === value.schedule.gamesReturned && value.schedule.processedGames === value.schedule.completedGames && Array.isArray(value.gameResults) && value.gameResults.every(game => game.status === 'processed');
  if (['k-snapshot', 'def-snapshot'].includes(job.store)) return Array.isArray(value.population) && value.population.length > 0 && value.populationSummary && value.populationSummary.weeksWithEvidence === value.populationSummary.weeksScanned;
  return Array.isArray(value.population) && value.population.length > 0 && Array.isArray(value.failures) && value.failures.length === 0 && (job.store === 'rb-snapshot' || value.nextStep?.ready === true);
}

async function inspectJobs(getStore, season, week) {
  const state = getStore({ name: STATE_STORE });
  const rows = [];
  for (const job of jobsForWeek(season, week)) {
    const cached = await getStore({ name: job.store }).get(cacheKey(job), { type: 'json', consistency: 'strong' });
    const status = await state.get(stateKey(job), { type: 'json', consistency: 'strong' });
    rows.push({ ...job, ready: completeCache(cached, job), status });
  }
  return rows;
}

function canRetry(status, now = Date.now()) {
  if (!status) return true;
  if (Number(status.leaseUntil) > now || Number(status.retryAfter) > now) return false;
  return status.day !== new Date(now).toISOString().slice(0, 10) || Number(status.attempts || 0) < Number(status.attemptLimit || 2);
}

function nextJob(rows, now = Date.now()) {
  for (const group of ['weekly-sage-schedule', 'weekly-sage-defense', 'positions', 'auxiliary']) {
    const pending = rows.filter(row => !row.ready && (group === 'positions' ? row.store.endsWith('-snapshot') : group === 'auxiliary' ? ['weekly-projections','sage-newswire'].includes(row.store) : row.store === group));
    if (pending.length) return pending.find(row => canRetry(row.status, now)) || null;
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
  if (completeCache(await cache.get(cacheKey(job), { type: 'json', consistency: 'strong' }), job)) return { status: 'ready', skipped: true };
  const state = getStore({ name: STATE_STORE });
  const key = stateKey(job);
  const previous = await state.getWithMetadata(key, { type: 'json', consistency: 'strong' });
  if (!canRetry(previous && previous.data, now)) return { status: 'waiting', skipped: true };
  const day = new Date(now).toISOString().slice(0, 10);
  const value = { status: 'running', day, attemptLimit: ['weekly-projections','sage-newswire'].includes(job.store) ? 8 : 2, attempts: previous && previous.data.day === day ? Number(previous.data.attempts || 0) + 1 : 1, startedAt: new Date(now).toISOString(), leaseUntil: now + LEASE_MS };
  const claimed = await state.setJSON(key, value, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
  if (!claimed.modified) return { status: 'waiting', skipped: true };
  try {
    if (completeCache(await cache.get(cacheKey(job), { type: 'json', consistency: 'strong' }), job)) {
      await state.setJSON(key, { ...value, status: 'ready', leaseUntil: 0 });
      return { status: 'ready', skipped: true };
    }
    // Claim precedes the existing builder's atomic provider budget reservation.
    const result = await build(job, event);
    const ready = result.statusCode === 200 && completeCache(await cache.get(cacheKey(job), { type: 'json', consistency: 'strong' }), job);
    let detail = null;
    try { const response = JSON.parse(result.body || '{}'); detail = response.error || null; } catch (_) {}
    const final = { ...value, status: ready ? 'ready' : 'failed', leaseUntil: 0, retryAfter: ready ? 0 : now + RETRY_MS, finishedAt: new Date().toISOString(), statusCode: result.statusCode, error: detail };
    await state.setJSON(key, final);
    console.log('WEEKLY_REFRESH_RESULT', JSON.stringify({ job: job.job, week: job.week, ...final }));
    return final;
  } catch (error) {
    const final = { ...value, status: 'failed', leaseUntil: 0, retryAfter: now + RETRY_MS, finishedAt: new Date().toISOString(), error: 'Weekly refresh worker failed; inspect function logs.' };
    await state.setJSON(key, final);
    console.error('WEEKLY_REFRESH_FAILED', job.job, job.week, error.message);
    return final;
  }
}

module.exports = { STATE_STORE, jobsForWeek, cacheKey, stateKey, completeCache, inspectJobs, canRetry, nextJob, sign, verify, runJob, resolveCurrentNFLWeek };

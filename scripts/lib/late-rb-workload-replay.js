'use strict';

// Replay only. Inputs are normalized, verified facts and a complete team workload.
// This module does not read feeds or write customer projections.
function replayLeadBack({event, baseline, asOf}) {
  const stop = reason => ({ applied: false, reason });
  if (!event || !baseline || event.status !== 'OUT' || event.successorRole !== 'EXPECTED_LEAD' ||
      event.statusVerified !== true || event.roleVerified !== true) return stop('unverified_change');
  const {season, week, team, starterId, successorId} = event;
  if (!starterId || !successorId || starterId === successorId || !team ||
      season !== baseline.season || week !== baseline.week || team !== baseline.team) return stop('context_mismatch');
  const times = [baseline.asOf, event.statusAt, event.roleAt, asOf, event.kickoff].map(Date.parse);
  if (times.some(t => !Number.isFinite(t)) || times[0] >= Math.min(times[1], times[2]) ||
      Math.max(times[1], times[2]) > times[3] || times[3] >= times[4]) return stop('timing_unverified');
  const {starter, successor} = baseline;
  if (starter?.id !== starterId || successor?.id !== successorId) return stop('identity_mismatch');
  const fields = ['carries', 'targets', 'goalLineCarries'];
  const valid = b => fields.every(k => Number.isFinite(b[k]) && b[k] >= 0) && b.goalLineCarries <= b.carries;
  if (!valid(starter) || !valid(successor) || starter.carries <= 0) return stop('workload_unavailable');
  // Lead-role scenario, not a calibrated forecast. Transfer opportunities, never points.
  const workload = Object.fromEntries(fields.map(k => [k, starter[k] + successor[k]]));
  return { applied: true, scenario: 'full_vacated_workload', before: Object.fromEntries(fields.map(k => [k, successor[k]])), workload };
}
module.exports = { replayLeadBack };

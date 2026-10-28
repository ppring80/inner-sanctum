'use strict';

const { jobsForWeek } = require('./_weekly-refresh-recovery');

// Reporting only. This classification never changes dispatch, retry or budgets.
function readinessTier(job) {
  return job.store === 'risers-fallers' || job.optional ? 'supplementary' : 'core';
}

function weeklyReadiness(rows, season, week) {
  const expected = jobsForWeek(season, week);
  const summarize = tier => {
    const jobs = expected.filter(job => readinessTier(job) === tier).map(job => {
      const row = rows.find(row => row.job === job.job && String(row.season) === String(job.season) && row.week === job.week);
      return {
        job: job.job, week: job.week, ready: row?.ready === true,
        state: row?.status?.status || 'pending',
        error: row?.status?.error || null,
        budgetReason: row?.status?.lastFailure?.budgetReason || null,
        reason: !row ? 'status_missing' : row.ready ? null : row.status?.error ? 'refresh_failed' : 'evidence_not_ready'
      };
    });
    const ready = (tier !== 'core' || expected.length > 0) && jobs.every(job => job.ready);
    return { ready, status: ready ? 'READY' : tier === 'core' ? 'NOT_READY' : 'DEGRADED', jobs };
  };
  const core = summarize('core'), supplementary = summarize('supplementary');
  return { ready: core.ready, core, supplementary };
}

module.exports = { readinessTier, weeklyReadiness };

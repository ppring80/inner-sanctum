'use strict';
const { connectLambda, getStore } = require('@netlify/blobs');
const { jobsForWeek, verify, runJob, inspectJobs, nextJob } = require('./_weekly-refresh-recovery.js');

// Static imports keep every builder in the background function bundle.
const builders = {
  'refresh-opportunity-intel': require('./refresh-opportunity-intel.js'),
  'refresh-risers-fallers': require('./refresh-risers-fallers.js'),
  'refresh-player-data': require('./refresh-player-data.js'),
  'refresh-sage-newswire': require('./refresh-sage-newswire.js'),
  'refresh-weekly-projections': require('./refresh-weekly-projections.js'),
  'refresh-weekly-sage-schedule': require('./refresh-weekly-sage-schedule.js'),
  'refresh-weekly-sage-defense': require('./refresh-weekly-sage-defense.js'),
  'refresh-qb-snapshot': require('./refresh-qb-snapshot.js'),
  'refresh-rb-snapshot': require('./refresh-rb-snapshot.js'),
  'refresh-wr-snapshot': require('./refresh-wr-snapshot.js'),
  'refresh-te-snapshot': require('./refresh-te-snapshot.js'),
  'refresh-k-snapshot': require('./refresh-k-snapshot.js'),
  'refresh-def-snapshot': require('./refresh-def-snapshot.js')
};

exports.handler = async event => {
  const header = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === 'x-weekly-refresh-signature');
  if (event.httpMethod !== 'POST' || !verify(event.body, header && header[1])) return { statusCode: 401 };
  const request = JSON.parse(event.body);
  const job = jobsForWeek(request.season, request.targetWeek).find(row => row.job === request.job && row.week === request.week);
  if (!job) return { statusCode: 400 };
  connectLambda(event);
  const dependencies = {
    getStore,
    build: (selected, incoming) => builders[selected.job].handler({
      ...incoming,
      // Verified internal invocation; never expose the refresh/API secret.
      httpMethod: undefined,
      headers: { ...incoming.headers, host: new URL(process.env.URL).host, 'x-forwarded-proto': 'https' },
      queryStringParameters: selected.job === 'refresh-opportunity-intel' ? {} : { season: selected.season, week: String(selected.week), seasonType: selected.seasonType }
    })
  };
  const started = Date.now();
  let selected = job;
  while (selected && Date.now() - started < 12 * 60 * 1000) {
    const result = await runJob(selected, event, dependencies);
    if (result.status === 'failed' || result.status === 'waiting') return { statusCode: result.status === 'failed' ? 500 : 200 };
    // Continue in dependency order within the background time allowance.
    // A large initial backfill can resume on the next watchdog tick.
    selected = nextJob(await inspectJobs(getStore, request.season, request.targetWeek));
  }
  return { statusCode: 200 };
};

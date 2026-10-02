'use strict';

const { resolveCurrentNFLWeek, WEEK_TWO_START_UTC, MILLISECONDS_PER_WEEK } = require('./_current-nfl-week.js');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return { statusCode: 405 };
  const now = new Date();
  const season = now.getUTCFullYear();
  const week = resolveCurrentNFLWeek(now, season);
  const nextRolloverAt = week && week < 18
    ? new Date(WEEK_TWO_START_UTC + (week - 1) * MILLISECONDS_PER_WEEK).toISOString()
    : null;
  return {
    statusCode: week ? 200 : 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ season, week, nextRolloverAt })
  };
};

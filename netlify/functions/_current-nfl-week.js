'use strict';

// Shared 2026 in-season week boundary. A recommendation week changes only
// after Monday Night Football has safely concluded: Tuesday 06:00 UTC.
const WEEK_TWO_START_UTC = Date.UTC(2026, 8, 15, 6, 0, 0);
const MILLISECONDS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function resolveCurrentNFLWeek(now = new Date(), season = 2026) {
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime()) || Number(season) !== 2026) return null;
  if (current.getTime() < WEEK_TWO_START_UTC) return 1;
  const week = Math.floor((current.getTime() - WEEK_TWO_START_UTC) / MILLISECONDS_PER_WEEK) + 2;
  return Math.max(1, Math.min(18, week));
}

module.exports = {
  resolveCurrentNFLWeek,
  WEEK_TWO_START_UTC,
  MILLISECONDS_PER_WEEK
};

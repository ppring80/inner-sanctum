'use strict';

// TEST-ONLY helpers for synthetic opportunity snapshots. The leakage guard's
// authority is the raw observations (_rawGames week + dated gameID), so every
// synthetic record must carry raw games for exactly the weeks it claims.
// Week w is dated on the Thursday of that NFL week in 2026 (Week 1 = 2026-09-10).

function gameDay(week) {
  const d = new Date(Date.UTC(2026, 8, 10 + 7 * (Number(week) - 1)));
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function rawGames(weeks, opportunities = 8) {
  return weeks.map((w) => ({ week: w, gameID: `${gameDay(w)}_AAA@BBB`, carries: 0, targets: opportunities, opportunities }));
}

// Give each record raw games for `weeks`; an empty record set gets one filler
// record so the snapshot still has observations to audit.
function withRawGames({ weeks, records, season = 2026, computedAt = '2026-10-01T00:00:00Z', weeksRequested = weeks }) {
  const entries = Object.entries(records || {});
  const base = entries.length ? entries : [['filler player|WR', {}]];
  return {
    season, computedAt, weeksRequested,
    records: Object.fromEntries(base.map(([k, r]) => [k, { ...r, _rawGames: rawGames(weeks) }]))
  };
}

module.exports = { gameDay, rawGames, withRawGames };

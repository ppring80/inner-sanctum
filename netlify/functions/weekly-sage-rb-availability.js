// RB eligibility and backfield-opportunity rules.
// Confirmed unavailable players are removed before scoring. Dated weekly facts
// expire with that week. Generic "Exempt/Commissioner Permission" is not hard
// unavailable because it also covers administrative exemptions.

const HARD_UNAVAILABLE = new Set([
  "OUT", "IR", "INACTIVE", "INJURED RESERVE", "RESERVE/INJURED",
  "SUSPENDED", "COMMISSIONER EXEMPT", "COMMISSIONER'S EXEMPT LIST",
  "COMMISSIONER EXEMPT NO PLAY", "PUP", "RESERVE/PUP", "NFI", "RESERVE/NFI"
]);

const WEEKLY_FACTS = Object.freeze({
  "2026:2": Object.freeze({
    joshjacobs: Object.freeze({
      status: "COMMISSIONER_EXEMPT_NO_PLAY", eligible: false,
      name: "Josh Jacobs", team: "GB",
      source: "NFL Commissioner Exempt List",
      reason: "Not permitted to participate until removed from the list."
    }),
    dylansampson: Object.freeze({
      status: "IR", eligible: false, source: "NFL roster transaction",
      name: "Dylan Sampson", team: "CLE",
      reason: "Placed on injured reserve."
    }),
    jordanmason: Object.freeze({
      status: "OUT", eligible: false, source: "Week 2 injury status",
      name: "Jordan Mason", team: "MIN",
      reason: "Unavailable for Week 2; backfield opportunity must be reassigned."
    })
  })
});

function normalizeName(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/[^a-z0-9]/g, "");
}

function normalizeStatus(value) {
  return String(value || "").trim().replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ").toUpperCase();
}

function availabilityForPlayer(player, season, week) {
  const weekly = WEEKLY_FACTS[`${season}:${Number(week)}`] || {};
  const fact = weekly[normalizeName(player && (player.name || player.longName))];
  if (fact) return { ...fact };

  const status = normalizeStatus(player && (
    player.eligibilityStatus || player.injuryStatus ||
    player.availabilityStatus || player.rosterStatus || player.status
  ));
  const hardUnavailable = player && player.eligible !== true && (
    player.eligible === false || HARD_UNAVAILABLE.has(status)
  );
  return {
    status: status || null,
    eligible: !hardUnavailable,
    source: status ? "provider" : null,
    reason: hardUnavailable ? `Provider reports ${status || "ineligible"}.` : null
  };
}

function weeklyUnavailableFacts(season, week) {
  const weekly = WEEKLY_FACTS[`${season}:${Number(week)}`] || {};
  return Object.values(weekly)
    .filter(fact => fact.eligible === false)
    .map(fact => ({
      name: fact.name,
      team: fact.team,
      availability: { ...fact }
    }));
}

function applyBackfieldOpportunityAdjustments({ leaderboard, unavailablePlayers }) {
  const unavailableTeams = new Map();
  (unavailablePlayers || []).forEach(player => {
    const team = String(player.team || "").toUpperCase();
    if (!team) return;
    if (!unavailableTeams.has(team)) unavailableTeams.set(team, []);
    unavailableTeams.get(team).push(player);
  });

  const adjustments = [];
  unavailableTeams.forEach((missing, team) => {
    const active = leaderboard
      .filter(player => String(player.team || "").toUpperCase() === team)
      .sort((a, b) => Number(b.sage.rankingScore) - Number(a.sage.rankingScore));
    active.forEach((player, index) => {
      const boost = index === 0 ? 10 : 4;
      player.sage.rankingScore = Math.min(100, Number(player.sage.rankingScore || 0) + boost);
      player.sage.backfieldOpportunity = {
        applied: true, boost,
        unavailableTeammates: missing.map(item => ({
          name: item.name, status: item.availability && item.availability.status
        }))
      };
      adjustments.push({ player: player.name, team, boost });
    });
  });
  return adjustments;
}

module.exports = {
  HARD_UNAVAILABLE, WEEKLY_FACTS, normalizeName, normalizeStatus,
  availabilityForPlayer, weeklyUnavailableFacts, applyBackfieldOpportunityAdjustments
};

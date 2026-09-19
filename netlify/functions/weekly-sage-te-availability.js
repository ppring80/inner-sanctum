const HARD_INELIGIBLE = new Set(["OUT", "IR", "PUP", "SUSPENDED", "EXEMPT"]);

// Dated facts deliberately expire after the target week. These are verified
// exceptions, not a season-long player-status database.
const WEEKLY_STATUS = Object.freeze({
  "2026:2": Object.freeze({
    "chig okonkwo": Object.freeze({
      status: "OUT",
      reason: "Ruled out for Week 2; exclude from the playable TE population."
    }),
    "brock bowers": Object.freeze({
      status: "DOUBTFUL",
      reason: "Doubtful for Week 2; retain for ranking visibility but flag the availability risk."
    })
  })
});

function normalizeName(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function availabilityForPlayer(player, season, week) {
  const fact = WEEKLY_STATUS[`${season}:${Number(week)}`]?.[normalizeName(player && player.name)];
  if (!fact) return { eligible: true, status: "ACTIVE", reason: null };
  return {
    eligible: !HARD_INELIGIBLE.has(fact.status),
    status: fact.status,
    reason: fact.reason
  };
}

module.exports = { availabilityForPlayer, WEEKLY_STATUS };

const HARD_INELIGIBLE = new Set([
  "OUT", "IR", "INACTIVE", "INJURED RESERVE", "RESERVE/INJURED",
  "SUSPENDED", "EXEMPT", "COMMISSIONER EXEMPT",
  "COMMISSIONER'S EXEMPT LIST", "COMMISSIONER EXEMPT NO PLAY",
  "PUP", "RESERVE/PUP", "NFI", "RESERVE/NFI", "UNSIGNED", "RELEASED", "WAIVED", "CUT", "PS", "PRACTICE SQUAD"
]);

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
  }),
  "2026:3": Object.freeze({
    "brock bowers": Object.freeze({
      status: "QUESTIONABLE",
      reason: "Questionable for Week 3 with a knee injury after missing Friday practice."
    }),
    "dallas goedert": Object.freeze({
      status: "OUT",
      reason: "Ruled out for Week 3 with a knee injury."
    }),
    "mason taylor": Object.freeze({
      status: "OUT",
      reason: "Ruled out for Week 3 with a thumb injury."
    }),
    "chig okonkwo": Object.freeze({
      status: "OUT",
      reason: "Ruled out for Week 3 with a hamstring injury."
    }),
    "colby parkinson": Object.freeze({
      status: "QUESTIONABLE",
      reason: "Questionable for Week 3 with a knee injury."
    })
  })
});

function normalizeName(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeStatus(value) {
  return String(value || "").trim().replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ").toUpperCase();
}

function availabilityForPlayer(player, season, week) {
  const fact = WEEKLY_STATUS[`${season}:${Number(week)}`]?.[normalizeName(player && player.name)];
  if (fact) return {
    eligible: !HARD_INELIGIBLE.has(fact.status),
    status: fact.status,
    source: "weekly fact",
    reason: fact.reason
  };

  const statuses = player ? [player.eligibilityStatus, player.injuryStatus,
    player.availabilityStatus, player.rosterStatus, player.status].map(normalizeStatus).filter(Boolean) : [];
  const status = statuses.find(value => HARD_INELIGIBLE.has(value)) ||
    (player?.active === false ? "INACTIVE" : statuses[0]) || "";
  const hardUnavailable = player && (
    player.eligible === false || HARD_INELIGIBLE.has(status)
  );
  return {
    eligible: !hardUnavailable,
    status: status || null,
    source: status ? "provider" : null,
    reason: hardUnavailable ? `Provider reports ${status || "ineligible"}.` : null
  };
}

module.exports = { HARD_INELIGIBLE, normalizeStatus, availabilityForPlayer, WEEKLY_STATUS };

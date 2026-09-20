// WR weekly eligibility rules. Provider statuses are authoritative when the
// cached snapshot contains them. Soft injury designations remain rankable so
// the UI can show the risk; hard-unavailable players are routed to `inactive`.

const HARD_UNAVAILABLE = new Set([
  "OUT", "IR", "INACTIVE", "INJURED RESERVE", "RESERVE/INJURED",
  "SUSPENDED", "COMMISSIONER EXEMPT", "COMMISSIONER'S EXEMPT LIST",
  "COMMISSIONER EXEMPT NO PLAY", "PUP", "RESERVE/PUP", "NFI", "RESERVE/NFI"
]);

// Dated verified exceptions supplement provider statuses when the cached WR
// snapshot has not yet received a late injury-report change.
const WEEKLY_STATUS = Object.freeze({
  "2026:2": Object.freeze({
    "zay flowers": Object.freeze({
      status: "OUT",
      reason: "Ruled out for Week 2 against New Orleans with a hamstring injury."
    }),
    "nico collins": Object.freeze({
      status: "OUT",
      reason: "Ruled out for Week 2 against Cincinnati with a hamstring injury."
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
    eligible: !HARD_UNAVAILABLE.has(fact.status),
    status: fact.status,
    source: "weekly fact",
    reason: fact.reason
  };

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

module.exports = {
  HARD_UNAVAILABLE, WEEKLY_STATUS, normalizeName, normalizeStatus,
  availabilityForPlayer
};

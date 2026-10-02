// WR weekly eligibility rules. Provider statuses are authoritative when the
// cached snapshot contains them. Soft injury designations remain rankable so
// the UI can show the risk; hard-unavailable players are routed to `inactive`.

const HARD_UNAVAILABLE = new Set([
  "OUT", "IR", "INACTIVE", "INJURED RESERVE", "RESERVE/INJURED",
  "SUSPENDED", "COMMISSIONER EXEMPT", "COMMISSIONER'S EXEMPT LIST",
  "COMMISSIONER EXEMPT NO PLAY", "PUP", "RESERVE/PUP", "NFI", "RESERVE/NFI", "UNSIGNED", "RELEASED", "WAIVED", "CUT"
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
  }),
  "2026:3": Object.freeze({
    "nico collins": Object.freeze({ status: "OUT", reason: "Ruled out for Week 3 with a hamstring injury." }),
    "puka nacua": Object.freeze({ status: "DOUBTFUL", reason: "Doubtful for Week 3 after missing practice all week with a hip/groin injury." }),
    "zay flowers": Object.freeze({ status: "QUESTIONABLE", reason: "Questionable for Week 3 with a hamstring injury after limited practice." }),
    "dj moore": Object.freeze({ status: "QUESTIONABLE", reason: "Questionable for Week 3 with a shoulder injury." }),
    "keon coleman": Object.freeze({ status: "QUESTIONABLE", reason: "Questionable for Week 3 with an ankle injury." }),
    "mike evans": Object.freeze({ status: "QUESTIONABLE", reason: "Questionable for Week 3 with a hip injury." }),
    "michael pittman": Object.freeze({ status: "QUESTIONABLE", reason: "Questionable for Week 3 with a foot injury." }),
    "marvin mims": Object.freeze({ status: "QUESTIONABLE", reason: "Questionable for Week 3 with a foot injury." }),
    "xavier legette": Object.freeze({ status: "QUESTIONABLE", reason: "Questionable for Week 3 with a knee injury." }),
    "jalen coker": Object.freeze({ status: "QUESTIONABLE", reason: "Questionable for Week 3 with an ankle injury." }),
    "marquise brown": Object.freeze({ status: "OUT", reason: "Ruled out for Week 3 with an ankle injury." }),
    "andrei iosivas": Object.freeze({ status: "OUT", reason: "Ruled out for Week 3 with a thumb injury." }),
    "alec pierce": Object.freeze({ status: "OUT", reason: "Ruled out for Week 3 with a heel injury." }),
    "demarcus robinson": Object.freeze({ status: "OUT", reason: "Ruled out for Week 3 with an ankle injury." }),
    "devonta smith": Object.freeze({ status: "ACTIVE", reason: "Full participant Saturday with no Week 3 game designation." })
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

  const statuses = player ? [player.eligibilityStatus, player.injuryStatus,
    player.availabilityStatus, player.rosterStatus, player.status].map(normalizeStatus).filter(Boolean) : [];
  const status = statuses.find(value => HARD_UNAVAILABLE.has(value)) ||
    (player?.active === false ? "INACTIVE" : statuses[0]) || "";
  const hardUnavailable = player && (
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

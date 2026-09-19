// QB eligibility and confirmed-starter rules.
// Weekly facts are dated and expire automatically outside their target week.

const HARD_UNAVAILABLE = new Set([
  "OUT", "IR", "INACTIVE", "INJURED RESERVE", "RESERVE/INJURED",
  "SUSPENDED", "COMMISSIONER EXEMPT", "COMMISSIONER EXEMPT NO PLAY",
  "PUP", "RESERVE/PUP", "NFI", "RESERVE/NFI"
]);

const WEEKLY_STARTERS = Object.freeze({
  "2026:2": Object.freeze({
    ARI: "Jacoby Brissett", ATL: "Cooper Rush", BAL: "Lamar Jackson",
    BUF: "Josh Allen", CAR: "Bryce Young", CHI: "Caleb Williams",
    CIN: "Joe Burrow", CLE: "Deshaun Watson", DAL: "Dak Prescott",
    DEN: "Bo Nix", DET: "Jared Goff", GB: "Jordan Love",
    HOU: "C.J. Stroud", IND: "Daniel Jones", JAX: "Trevor Lawrence",
    KC: "Patrick Mahomes", LV: "Kirk Cousins", LAC: "Justin Herbert",
    LAR: "Matthew Stafford", MIA: "Malik Willis", MIN: "Carson Wentz",
    NE: "Drake Maye", NO: "Tyler Shough", NYG: "Jaxson Dart",
    NYJ: "Geno Smith", PHI: "Jalen Hurts", PIT: "Aaron Rodgers",
    SEA: "Drew Lock", SF: "Brock Purdy", TB: "Baker Mayfield",
    TEN: "Cam Ward", WSH: "Jayden Daniels"
  })
});

const WEEKLY_FACTS = Object.freeze({
  "2026:2": Object.freeze({
    kylermurray: Object.freeze({
      name: "Kyler Murray", team: "MIN", status: "OUT", eligible: false,
      source: "Week 2 injury status",
      reason: "Ruled out for Week 2 with a concussion; Carson Wentz will start."
    }),
    carsonwentz: Object.freeze({
      name: "Carson Wentz", team: "MIN", status: "CONFIRMED_STARTER",
      eligible: true, source: "Week 2 starter announcement",
      reason: "Confirmed Minnesota starter for Week 2."
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
  const key = `${season}:${Number(week)}`;
  const facts = WEEKLY_FACTS[key] || {};
  const name = player && (player.name || player.longName || player.playerName);
  const fact = facts[normalizeName(name)];
  if (fact) return { ...fact };

  const status = normalizeStatus(player && (
    player.eligibilityStatus || player.injuryStatus ||
    player.availabilityStatus || player.rosterStatus || player.status
  ));
  if (player && player.eligible !== true && (
    player.eligible === false || HARD_UNAVAILABLE.has(status)
  )) {
    return {
      status: status || "INELIGIBLE", eligible: false, source: "provider",
      reason: `Provider reports ${status || "ineligible"}.`
    };
  }

  const team = String(player && (player.team || player.currentTeam) || "").toUpperCase();
  const starter = (WEEKLY_STARTERS[key] || {})[team];
  if (starter && normalizeName(starter) !== normalizeName(name)) {
    return {
      status: "NOT_CONFIRMED_STARTER", eligible: false,
      source: "weekly starter map",
      reason: `${starter} is the confirmed Week ${Number(week)} starter for ${team}.`,
      confirmedStarter: starter
    };
  }

  return {
    status: starter ? "CONFIRMED_STARTER" : (status || null),
    eligible: true,
    source: starter ? "weekly starter map" : (status ? "provider" : null),
    confirmedStarter: starter || null
  };
}

module.exports = {
  HARD_UNAVAILABLE, WEEKLY_STARTERS, WEEKLY_FACTS,
  normalizeName, normalizeStatus, availabilityForPlayer
};

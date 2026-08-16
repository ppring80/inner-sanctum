// netlify/functions/refresh-opportunity-intel.js
//
// OPPORTUNITY INTELLIGENCE — Phase 1 (Aug 15 2026) — collection/cache
// ONLY. This function is deliberately NOT wired into netlify.toml's
// scheduled-function list yet, and NOTHING reads its output cache
// except the companion read-only diagnostic endpoint
// (opportunity-intel.js) built alongside it. Draft Command Center,
// auction recommendations, player-comparison.js, Sanctum/chat, and
// Weekly Rankings are completely untouched by this file's existence —
// confirmed by grep: no other file in this repo references the
// "opportunity-intel" Blobs store name introduced here.
//
// MODEL: this file follows the exact architecture already proven
// twice in this codebase — refresh-player-data.js (scheduled fetch +
// Blobs cache + separate read-only file) and refresh-risers-fallers.js
// (getNFLGamesForWeek -> getNFLBoxScore per game, Promise.allSettled,
// cross-reference position from the "player-data" cache rather than
// guessing). Nothing new architecturally; this is that same shape
// applied to a new fact (workload) instead of target share.
//
// WORKLOAD DEFINITION (per Aug 15 2026 Opportunity Intelligence audit):
//   opportunities = Rushing.carries + Receiving.targets
// RB/WR/TE only in Phase 1 — QB workload deliberately not designed yet.
//
// MISSING-DATA SEMANTICS (the one genuinely new piece of logic here,
// everything else is reused pattern):
//   - A player HAS a real box-score entry for a game (they were on the
//     field, playerStats has their line) but that entry's Rushing
//     and/or Receiving sub-object, or the specific carries/targets
//     field inside it, is absent -> normalize that specific missing
//     field to 0. This is a real, valid "0 opportunities that game"
//     data point (e.g. a pass-catching TE who ran zero pass routes
//     that specific week still has a real, valid game record).
//   - A player has NO box-score entry at all for a given game (bye
//     week, inactive, not on the roster that week, the fetch for that
//     game failed) -> that game is EXCLUDED entirely: not a zero, not
//     counted in gamesSampled, not part of any average. A missing
//     record must never silently become a zero-opportunity game.
//
// DESIGN DECISIONS NOT EXPLICITLY SPECIFIED, MADE HERE, FLAGGED FOR
// REVIEW (see report): avgLast3/avgLast5 each independently require
// that many VALID games to exist before returning a number -- both are
// null with fewer than the corresponding count, exactly mirroring the
// explicit trend rule ("null until 6 valid games exist"), rather than
// silently averaging over fewer games than the field name implies.
// gamesSampled reports the TOTAL count of valid games found for that
// player across the whole fetched window (not capped at 5) -- the most
// literal, useful diagnostic signal of "how much real data did we
// actually find," independent of which specific averages that data
// was enough to fill in.

const { connectLambda, getStore } = require("@netlify/blobs");

const TANK01_HOST = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";
const TARGET_POSITIONS = ["RB", "WR", "TE"]; // QB deliberately excluded, per instruction

async function fetchTank01(endpoint, params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const url = `https://${TANK01_HOST}/${endpoint}${queryString ? "?" + queryString : ""}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": TANK01_HOST,
      "x-rapidapi-key": process.env.TANK01_API_KEY,
    },
  });

  if (!response.ok) throw new Error(`Tank01 API error: ${response.status} on ${endpoint}`);
  return await response.json();
}

// Same convention as refresh-risers-fallers.js's fetchGameIDsForWeek —
// completed games only (gameStatusCode "2"), reused verbatim.
async function fetchGameIDsForWeek(week, season) {
  try {
    const resp = await fetchTank01("getNFLGamesForWeek", { week: String(week), season: String(season) });
    const games = Array.isArray(resp?.body) ? resp.body : [];
    return games
      .filter((g) => g.gameStatusCode === "2")
      .map((g) => ({ gameID: g.gameID, week: Number(week) }))
      .filter((g) => Boolean(g.gameID));
  } catch (e) {
    console.log(`fetchGameIDsForWeek failed for week ${week}, season ${season}:`, e.message);
    return [];
  }
}

// Fetch box scores for a list of {gameID, week} objects in parallel,
// return a flat array of every player stat line with its week attached
// (week is needed downstream for chronological sorting/trend windows).
async function fetchPlayerStatsForGames(gameEntries) {
  const results = await Promise.allSettled(
    gameEntries.map((g) => fetchTank01("getNFLBoxScore", { gameID: g.gameID }))
  );

  const allPlayers = [];
  const failedGameIDs = [];
  results.forEach((result, i) => {
    const { gameID, week } = gameEntries[i];
    if (result.status === "fulfilled") {
      const playerStats = result.value?.body?.playerStats;
      if (playerStats && typeof playerStats === "object") {
        Object.values(playerStats).forEach((p) => allPlayers.push(Object.assign({}, p, { week, gameID })));
      } else {
        console.log(`No playerStats object in box score for ${gameID}`);
        failedGameIDs.push(gameID);
      }
    } else {
      console.log(`Box score fetch failed for ${gameID}:`, result.reason?.message);
      failedGameIDs.push(gameID);
    }
  });
  return { allPlayers, failedGameIDs };
}

// ── CORE MISSING-DATA NORMALIZATION ──────────────────────────────
// Given one player's raw box-score stat line (they DID have a real
// entry -- this function is never called for a player with no entry
// at all, that exclusion happens one level up), extract carries and
// targets, normalizing an absent field/sub-object to 0. Returns null
// ONLY if something about the record itself looks structurally wrong
// (see STOP-AND-REPORT note below) -- not for ordinary zero-usage games.
function extractOpportunitiesFromStatLine(statLine) {
  if (!statLine || typeof statLine !== "object") return null;

  // A totally missing Rushing/Receiving sub-object is normal and
  // expected for many players (a pure receiver has no Rushing object;
  // a pure runner may have no Receiving object) -- normalize to 0,
  // not an error.
  const rushingObj = statLine.Rushing;
  const receivingObj = statLine.Receiving;

  const carriesRaw = rushingObj && rushingObj.carries !== undefined ? rushingObj.carries : 0;
  const targetsRaw = receivingObj && receivingObj.targets !== undefined ? receivingObj.targets : 0;

  const carries = parseInt(carriesRaw, 10);
  const targets = parseInt(targetsRaw, 10);

  // If a value IS present but doesn't parse to a real number, that's a
  // genuine structural surprise worth surfacing rather than silently
  // treating as 0 -- distinct from "field absent" (which is a
  // confirmed, expected, normal case per the missing-data semantics
  // above). Returns null so the caller can flag it as a normalization
  // failure rather than record a fabricated number.
  if (isNaN(carries) || isNaN(targets)) {
    return null;
  }

  return { carries, targets, opportunities: carries + targets };
}

// ── Build one player's opportunityIntelligence object from their
// sorted (oldest -> newest) list of valid {week, carries, targets,
// opportunities} games. ──
//
// PHASE 2 ADDITION (Aug 15 2026): carries and targets are now tracked
// as their own independent metric series (rushing.*/receiving.*),
// mirroring the exact same lastGame/avgLast3/avgLast5/trend/
// gamesSampled shape as the combined opportunities series -- per
// explicit instruction to preserve them independently, not just their
// sum. All three series (opportunities, rushing, receiving) are built
// by the SAME generic windowedMetrics() helper below, so the
// null-threshold rules (avgLast3 needs 3 games, avgLast5 needs 5,
// trend needs 6) apply identically and can't drift between the three.
//
// PHASE 2 ADDITION: signals[] -- descriptive, consumer-facing
// classifications derived from the numbers above. These are LABELS,
// not scores: nothing in this file (or anywhere Opportunity
// Intelligence is read today -- confirmed, still zero consumers)
// automatically moves a recommendation. This mirrors the exact
// pattern already proven and shipped in player-comparison.js, where
// injury/tier/bye/scoring-format are informational "reasons" a
// presentation layer explains, never an automatic score mover unless
// a human deliberately wires one in later. See SIGNAL THRESHOLDS
// below -- every constant is named, documented, and explicitly a
// reasoned starting value, not empirically derived (same discipline
// as player-comparison.js's CMP_* constants) -- flag for review
// before any consumer treats them as settled.
function buildOpportunityIntelligence(validGames, position) {
  // validGames must already be sorted chronologically ascending.
  const sorted = validGames.slice().sort((a, b) => a.week - b.week);
  const n = sorted.length;

  const opportunitiesMetrics = windowedMetrics(sorted, (g) => g.opportunities);
  const rushingMetrics = windowedMetrics(sorted, (g) => g.carries);
  const receivingMetrics = windowedMetrics(sorted, (g) => g.targets);

  const signals = buildSignals(sorted, opportunitiesMetrics, rushingMetrics, receivingMetrics, position);

  return {
    opportunities: opportunitiesMetrics,
    meta: {
      computedAt: new Date().toISOString(),
      sourcePositions: [position],
    },
    historical: {},
    rushing: rushingMetrics,
    receiving: receivingMetrics,
    highValue: {},
    persistence: {},
    signals,
  };
}

// Generic windowed-metric builder: same lastGame/avgLast3/avgLast5/
// trend/gamesSampled shape and same null-threshold rules, applied to
// whichever per-game value `valueFn` extracts (opportunities, carries,
// or targets). Extracted as one shared function specifically so the
// three metric series can never silently diverge in their averaging/
// trend logic.
function windowedMetrics(sortedGames, valueFn) {
  const n = sortedGames.length;
  const values = sortedGames.map((g) => ({ week: g.week, value: valueFn(g) }));

  const lastGame = n >= 1 ? values[n - 1].value : null;
  const avgLast3 = n >= 3 ? averageValues(values.slice(-3)) : null;
  const avgLast5 = n >= 5 ? averageValues(values.slice(-5)) : null;

  let trend = null;
  if (n >= 6) {
    const last3 = averageValues(values.slice(-3));
    const prev3 = averageValues(values.slice(-6, -3));
    trend = round2(last3 - prev3);
  }

  return {
    lastGame,
    avgLast3: avgLast3 === null ? null : round2(avgLast3),
    avgLast5: avgLast5 === null ? null : round2(avgLast5),
    trend,
    gamesSampled: n,
  };
}

function averageValues(entries) {
  return entries.reduce((sum, e) => sum + e.value, 0) / entries.length;
}

// ═══════════════════════════════════════════════════════════════════
// SIGNAL THRESHOLDS — reasoned starting values, NOT empirically
// derived (no historical outcome data exists anywhere in this
// codebase to fit these against, same honest caveat as
// player-comparison.js's CMP_* constants). Named and isolated here so
// any future tuning is a one-line, reviewable change, not a hunt
// through the classification logic itself.
// ═══════════════════════════════════════════════════════════════════
const SIGNAL_MIN_GAMES_FOR_ROLE = 1; // role composition needs at least 1 real game to say anything at all
const SIGNAL_ROLE_DOMINANT_SHARE = 0.7; // >=70% of opportunities from one side (carries or targets) -> "-dominant"
const SIGNAL_TREND_EXPANDING = 3; // trend >= +3 opportunities/game -> "expanding role"
const SIGNAL_TREND_DECLINING = -3; // trend <= -3 opportunities/game -> "declining usage"
// Volume tiers are intentionally POSITION-AWARE -- a workhorse RB and
// a high-volume WR/TE do not sit at the same raw opportunity count.
// Based on the ROLE the position typically plays (RB workload =
// carries+targets combined tends to run higher than a WR/TE's
// targets-only workload), not on any measured percentile -- flag for
// review once real multi-season data exists to check these against.
const SIGNAL_VOLUME_TIERS = {
  RB: { highVolume: 18, moderateVolume: 10 },
  WR: { highVolume: 8, moderateVolume: 5 },
  TE: { highVolume: 7, moderateVolume: 4 },
};
const SIGNAL_LIMITED_SAMPLE_GAMES = 3; // fewer than this -> flag as an early/limited sample

function buildSignals(sortedGames, opportunitiesMetrics, rushingMetrics, receivingMetrics, position) {
  const signals = [];
  const n = sortedGames.length;

  // ── Sample-size flag -- always emitted when there's at least 1 game,
  // so a consumer never has to separately re-derive "how much do I
  // trust this." ──
  if (n >= 1) {
    signals.push({
      type: "sampleSize",
      value: n < SIGNAL_LIMITED_SAMPLE_GAMES ? "limited" : "adequate",
      detail: { gamesSampled: n, threshold: SIGNAL_LIMITED_SAMPLE_GAMES },
    });
  }

  // ── Role composition: carries vs. targets share of the most recent
  // reliable window (avgLast3 if available, else the single lastGame).
  // Never fires with zero total opportunities (undefined share). ──
  const roleBasis = rushingMetrics.avgLast3 !== null && receivingMetrics.avgLast3 !== null
    ? { carries: rushingMetrics.avgLast3, targets: receivingMetrics.avgLast3, window: "avgLast3" }
    : n >= SIGNAL_MIN_GAMES_FOR_ROLE
      ? { carries: rushingMetrics.lastGame, targets: receivingMetrics.lastGame, window: "lastGame" }
      : null;

  if (roleBasis) {
    const total = roleBasis.carries + roleBasis.targets;
    if (total > 0) {
      const carriesShare = roleBasis.carries / total;
      const targetsShare = roleBasis.targets / total;
      let value = "balanced";
      if (carriesShare >= SIGNAL_ROLE_DOMINANT_SHARE) value = "rushing-dominant";
      else if (targetsShare >= SIGNAL_ROLE_DOMINANT_SHARE) value = "receiving-dominant";
      signals.push({
        type: "roleComposition",
        value,
        detail: { carriesShare: round2(carriesShare), targetsShare: round2(targetsShare), basedOn: roleBasis.window },
      });
    }
  }

  // ── Trend classification: translates the numeric opportunities
  // trend (null until 6 valid games exist -- same rule as everywhere
  // else) into a decision-ready label. Never fires while trend is null
  // -- an "insufficient data" signal would be redundant with the
  // sampleSize signal above, so it's simply omitted rather than
  // duplicated. ──
  if (opportunitiesMetrics.trend !== null) {
    let value = "stable";
    if (opportunitiesMetrics.trend >= SIGNAL_TREND_EXPANDING) value = "expanding";
    else if (opportunitiesMetrics.trend <= SIGNAL_TREND_DECLINING) value = "declining";
    signals.push({
      type: "trendClassification",
      value,
      detail: { trend: opportunitiesMetrics.trend, expandingThreshold: SIGNAL_TREND_EXPANDING, decliningThreshold: SIGNAL_TREND_DECLINING },
    });
  }

  // ── Volume tier: position-aware, uses avgLast3 if available (a
  // steadier signal than any single game), else lastGame. ──
  const volumeBasis = opportunitiesMetrics.avgLast3 !== null ? opportunitiesMetrics.avgLast3
    : opportunitiesMetrics.lastGame !== null ? opportunitiesMetrics.lastGame
    : null;
  const tiers = SIGNAL_VOLUME_TIERS[position];
  if (volumeBasis !== null && tiers) {
    let value = "role-player";
    if (volumeBasis >= tiers.highVolume) value = "high-volume";
    else if (volumeBasis >= tiers.moderateVolume) value = "moderate-volume";
    signals.push({
      type: "volumeTier",
      value,
      detail: { basisValue: volumeBasis, position, highVolumeThreshold: tiers.highVolume, moderateVolumeThreshold: tiers.moderateVolume },
    });
  }

  return signals;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

exports.handler = async (event) => {
  connectLambda(event);

  const params = event.queryStringParameters || {};
  const season = params.season || "2026";
  // Deliberately bounded Phase 1 test window -- explicit weeks list
  // (comma-separated) if given, else defaults to a small 3-week window.
  // No default expands beyond what's explicitly requested; this
  // function will NOT silently pull a full season on its own.
  const weeks = params.weeks
    ? params.weeks.split(",").map((w) => parseInt(w.trim(), 10)).filter((w) => !isNaN(w))
    : [1, 2, 3];

  console.log(`Opportunity Intelligence Phase 1: fetching weeks [${weeks.join(",")}], season ${season}`);

  // ── Step 1: game IDs for every requested week ──
  const gameEntryLists = await Promise.all(weeks.map((w) => fetchGameIDsForWeek(w, season)));
  const allGameEntries = [].concat(...gameEntryLists);

  if (allGameEntries.length === 0) {
    const msg = `No completed games found for weeks [${weeks.join(",")}], season ${season} -- aborting, nothing cached.`;
    console.log(msg);
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: msg }) };
  }

  // ── Step 2: box scores for every game (this is the real Tank01 call
  // volume -- see report for the estimated-volume table) ──
  const { allPlayers, failedGameIDs } = await fetchPlayerStatsForGames(allGameEntries);

  // ── Step 3: position cross-reference from the EXISTING "player-data"
  // cache -- same reused pattern as refresh-risers-fallers.js. A player
  // missing from that cache is excluded rather than guessing their
  // position (and therefore excluded from Opportunity Intelligence
  // entirely for this run, same "don't guess" discipline as the
  // established precedent). ──
  let positionLookup = {};
  try {
    const store = getStore({ name: "player-data" });
    const cached = await store.get("playerData", { type: "json" });
    if (cached?.players) positionLookup = cached.players;
  } catch (e) {
    console.log("player-data cache read failed (non-fatal, all players will be excluded this run):", e.message);
  }

  // ── Step 4: group valid per-game records by player, applying
  // missing-data normalization and the RB/WR/TE position filter. ──
  const perPlayerGames = {}; // playerID -> [{week, opportunities, carries, targets}]
  const normalizationFailures = [];
  let excludedNoPositionMatch = 0;

  allPlayers.forEach((statLine) => {
    const playerID = statLine.playerID;
    if (!playerID) return;

    const posInfo = positionLookup[playerID];
    if (!posInfo || !posInfo.pos || TARGET_POSITIONS.indexOf(posInfo.pos) === -1) {
      excludedNoPositionMatch++;
      return;
    }

    const extracted = extractOpportunitiesFromStatLine(statLine);
    if (extracted === null) {
      normalizationFailures.push({ playerID, longName: statLine.longName, gameID: statLine.gameID, week: statLine.week });
      return;
    }

    if (!perPlayerGames[playerID]) perPlayerGames[playerID] = { longName: statLine.longName, pos: posInfo.pos, games: [] };
    perPlayerGames[playerID].games.push({
      week: statLine.week,
      gameID: statLine.gameID,
      carries: extracted.carries,
      targets: extracted.targets,
      opportunities: extracted.opportunities,
    });
  });

  // ── Step 5: build final opportunityIntelligence records + write cache ──
  const records = {};
  Object.keys(perPlayerGames).forEach((playerID) => {
    const { longName, pos, games } = perPlayerGames[playerID];
    const key = `${normalizePlayerName(longName)}|${pos}`;
    records[key] = Object.assign(
      { playerID, longName, pos },
      buildOpportunityIntelligence(games, pos)
    );
    // Per-game detail retained alongside the summary object for this
    // diagnostic phase (NOT part of the illustrative schema itself,
    // additive) -- exactly what the manual-inspection/validation
    // requirement needs, without changing the schema consumers would
    // eventually read.
    records[key]._rawGames = games.slice().sort((a, b) => a.week - b.week);
  });

  const result = {
    computedAt: new Date().toISOString(),
    season,
    weeksRequested: weeks,
    gamesFound: allGameEntries.length,
    gamesFailed: failedGameIDs.length,
    playersRecorded: Object.keys(records).length,
    excludedNoPositionMatch,
    normalizationFailures,
    records,
  };

  try {
    const store = getStore({ name: "opportunity-intel" });
    await store.setJSON(`window:${season}:${weeks.join("-")}`, result);
    await store.setJSON("latest", result);
    console.log(
      `Opportunity Intelligence cached: ${Object.keys(records).length} players, ${allGameEntries.length} games fetched (${failedGameIDs.length} failed), ${excludedNoPositionMatch} stat lines excluded (no RB/WR/TE position match), ${normalizationFailures.length} normalization failures`
    );
  } catch (e) {
    console.log("Failed to write opportunity-intel cache:", e.message);
    return { statusCode: 500, body: JSON.stringify({ error: "Cache write failed", detail: e.message }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      season,
      weeksRequested: weeks,
      gamesFound: allGameEntries.length,
      gamesFailed: failedGameIDs.length,
      playersRecorded: Object.keys(records).length,
      excludedNoPositionMatch,
      normalizationFailureCount: normalizationFailures.length,
    }),
  };
};

// Same normalization convention used everywhere else in this codebase
// (shared-player-data.js's normalizePlayerName), duplicated here per
// this project's established cross-runtime-boundary pattern rather
// than importing across the client/server split. MUST be byte-for-byte
// identical to shared-player-data.js's real implementation -- a first
// draft of this function mistakenly copied draft.html's simpler
// hyphenated key() helper instead (a DIFFERENT convention used only
// for that page's own internal DOM element IDs), which would have
// produced keys ("ja-marr-chase") that could never match the real
// player-data cache's keys ("jamarr chase") for any name containing a
// hyphen, apostrophe, period, or suffix. Caught and fixed during this
// implementation's own self-check, before any cache was written under
// the wrong convention -- see report.
function normalizePlayerName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[.''']/g, "")
    .replace(/-/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Exported for direct unit testing of the pure computation logic,
// independent of the live Tank01 fetch / Blobs cache (see
// opportunity-intel-calc.test.js). exports.handler above is the real
// production entry point; these are the pieces that can be verified
// without live network access.
module.exports.extractOpportunitiesFromStatLine = extractOpportunitiesFromStatLine;
module.exports.buildOpportunityIntelligence = buildOpportunityIntelligence;
module.exports.normalizePlayerName = normalizePlayerName;
module.exports.windowedMetrics = windowedMetrics;
module.exports.buildSignals = buildSignals;

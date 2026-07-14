const { connectLambda, getStore } = require("@netlify/blobs");

// ═══════════════════════════════════════════════════════════════════════
// RISERS & FALLERS — Feature #131
//
// Computes week-over-week deltas in target share and snap share for
// every pass-catcher (WR/RB/TE) league-wide, so the frontend can show
// "who's trending up/down" beyond raw box score counting stats.
//
// BUILT ON TWO LIVE-VERIFIED SOURCES (confirmed 2026-07-14, not
// guessed — same discipline as refresh-player-data.js's live team
// list and diagnostic-box-score.js's confirmed field shapes):
//
// 1. getNFLGamesForWeek?week=X&season=Y — CONFIRMED via
//    diagnostic-games-for-week.js live run: takes plain `week` +
//    `season` params (not gameWeek, not a combined param), and
//    returns the game array DIRECTLY as `body` (not nested under a
//    named sub-key like `body.games`). Each game object's `gameID`
//    field is already in the exact "YYYYMMDD_AWAY@HOME" format
//    getNFLBoxScore expects — no translation needed between the two
//    endpoints.
//
// 2. getNFLBoxScore?gameID=X — CONFIRMED via diagnostic-box-score.js
//    live run: individual player stat lines live at
//    body.playerStats["<playerID>"], each with (when applicable):
//      Receiving: { targets, receptions, recYds, recTD, recAvg, longRec }
//      snapCounts: { offSnap, offSnapPct, defSnap, defSnapPct, stSnap, stSnapPct }
//    offSnapPct is ALREADY a computed percentage (e.g. 0.83) — no
//    math needed for snap share. targets is a RAW COUNT, not a
//    share — target share must be computed here by summing every
//    player's targets on the same teamID within the same gameID,
//    then dividing each player's targets by that team total. This
//    file does that grouping/summing step explicitly (see
//    computeTeamTargetTotals below) rather than assuming Tank01
//    provides a pre-computed share, since it does not.
//
// POSITION DATA: getNFLBoxScore's playerStats entries do NOT include
// a position field (confirmed — Dallas Goedert's real sample entry
// has no "pos" key, just team/snapCounts/Receiving/name/ID). Position
// is cross-referenced from the existing "player-data" Blobs cache
// (built daily by refresh-player-data.js from getNFLTeamRoster, which
// DOES include pos), keyed by the same playerID Tank01 uses
// consistently across its own endpoints. If a playerID isn't in that
// cache (e.g. cache hasn't run yet, or a rare ID mismatch), that
// player is simply excluded from this week's riser/faller list rather
// than guessing their position — same fail-soft pattern used
// throughout this codebase (chat.js's getLiveNFLContext, etc.).
//
// SCHEDULE: weekly, not daily — target/snap share only meaningfully
// changes once a full week of games has completed, unlike
// refresh-player-data's daily roster/injury refresh. Add to
// netlify.toml:
//
//   [functions."refresh-risers-fallers"]
//     schedule = "0 12 * * 3"
//
// (Wednesday noon UTC — every week's games, including Monday Night
// Football, are final by then. Adjust if MNF ever runs later in a
// given week, e.g. an international game slate.)
//
// MANUAL TEST MODE: hitting this function's URL directly with
// ?week=X&season=Y query params overrides the auto-computed current
// week — this is how to test against real, completed 2025 games
// before the 2026 season provides real Week 2+ data. Example:
//   /.netlify/functions/refresh-risers-fallers?week=2&season=2025
//
// 30-SECOND SCHEDULED FUNCTION LIMIT: a full week is ~13-16 games.
// Box score fetches for both the current AND previous week (needed
// to compute a delta) means up to ~32 Tank01 calls in one run.
// Promise.allSettled fires each week's games in parallel (same
// pattern as refresh-player-data.js's 32-team parallel fetch) so
// wall time tracks the slowest single call, not the sum of all of
// them. If real-world timing ever approaches the 30s cap as the
// season progresses, the two weeks' fetches could be split into two
// separate scheduled runs — not done here since parallel-within-a-
// week plus sequential-between-weeks hasn't been measured against
// the real cap yet with actual data volume.
// ═══════════════════════════════════════════════════════════════════════

const TANK01_HOST = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

// Threshold for what counts as a meaningful riser/faller, in
// PERCENTAGE POINTS of share (not relative %). E.g. 0.10 means a
// player who went from 15% to 26% target share (+11 points) qualifies
// as a riser; 15% to 22% (+7 points) does not. Tunable without
// touching any other logic in this file.
const RISER_FALLER_THRESHOLD = 0.10;

async function fetchTank01(endpoint, params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const url = `https://${TANK01_HOST}/${endpoint}${queryString ? "?" + queryString : ""}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": TANK01_HOST,
      "x-rapidapi-key": process.env.TANK01_API_KEY
    }
  });

  if (!response.ok) throw new Error(`Tank01 API error: ${response.status} on ${endpoint}`);
  return await response.json();
}

// ── Current NFL week calculator — SAME convention as chat.js's
// getCurrentNFLWeek(), duplicated here rather than shared across the
// runtime boundary (this project's established pattern — see adp.js's
// duplicated MISSING_DEF_FALLBACK comment for why). UPDATE
// seasonStart each year.
function getCurrentNFLWeek() {
  const seasonStart = new Date("2026-09-09");
  const now = new Date();
  if (now < seasonStart) return 1;
  const diffDays = Math.floor((now - seasonStart) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.min(18, Math.floor(diffDays / 7) + 1));
}

// ── Fetch the list of gameIDs for a given week/season, completed
// games only. gameStatusCode "2" = Completed (confirmed via Tank01's
// own published Game Status Code guide) — mid-week manual runs during
// a live week will simply exclude any not-yet-played games rather
// than erroring, same fail-soft convention as everywhere else here.
async function fetchGameIDsForWeek(week, season) {
  try {
    const resp = await fetchTank01("getNFLGamesForWeek", { week: String(week), season: String(season) });
    const games = Array.isArray(resp?.body) ? resp.body : [];
    return games
      .filter(g => g.gameStatusCode === "2")
      .map(g => g.gameID)
      .filter(Boolean);
  } catch (e) {
    console.log(`fetchGameIDsForWeek failed for week ${week}, season ${season}:`, e.message);
    return [];
  }
}

// ── Fetch box scores for a list of gameIDs in parallel, return a
// flat array of every player stat line across all of them, tagged
// with which gameID/teamID they belong to (already present on each
// entry per the confirmed shape, kept here for clarity at call sites).
async function fetchPlayerStatsForGames(gameIDs) {
  const results = await Promise.allSettled(
    gameIDs.map(gameID => fetchTank01("getNFLBoxScore", { gameID }))
  );

  const allPlayers = [];
  results.forEach((result, i) => {
    const gameID = gameIDs[i];
    if (result.status === "fulfilled") {
      const playerStats = result.value?.body?.playerStats;
      if (playerStats && typeof playerStats === "object") {
        Object.values(playerStats).forEach(p => allPlayers.push(p));
      } else {
        console.log(`No playerStats object in box score for ${gameID}`);
      }
    } else {
      console.log(`Box score fetch failed for ${gameID}:`, result.reason?.message);
    }
  });
  return allPlayers;
}

// ── Sum targets by teamID within a single week's player pool, so
// each player's individual target share can be computed as
// targets / teamTotalTargets for THEIR OWN team's game that week.
// Grouped by "teamID + gameID" (not just teamID) in case a bye-week
// edge case or data quirk ever put the same teamID in two entries in
// one batch — keeps the denominator scoped to the correct single game.
function computeTeamTargetTotals(players) {
  const totals = {}; // key: `${teamID}_${gameID}` -> summed targets
  players.forEach(p => {
    if (!p.Receiving || !p.teamID || !p.gameID) return;
    const targets = parseInt(p.Receiving.targets, 10) || 0;
    const key = `${p.teamID}_${p.gameID}`;
    totals[key] = (totals[key] || 0) + targets;
  });
  return totals;
}

// ── Build a per-player summary map for one week: playerID -> {
//   longName, team, targets, targetSharePct, offSnapPct
// }. Only includes players with a Receiving stat line — this
// feature is scoped to pass-catchers (WR/RB/TE), matching the
// original #131 scope (target share / snap share trends), not
// QBs/defense/kickers.
function buildWeekSummary(players) {
  const teamTargetTotals = computeTeamTargetTotals(players);
  const summary = {};

  players.forEach(p => {
    if (!p.Receiving || !p.playerID) return;
    const targets = parseInt(p.Receiving.targets, 10) || 0;
    const teamKey = `${p.teamID}_${p.gameID}`;
    const teamTotal = teamTargetTotals[teamKey] || 0;
    const targetSharePct = teamTotal > 0 ? targets / teamTotal : 0;
    const offSnapPct = p.snapCounts ? parseFloat(p.snapCounts.offSnapPct) || 0 : 0;

    summary[p.playerID] = {
      longName: p.longName,
      team: p.teamAbv || p.team,
      targets,
      targetSharePct,
      offSnapPct
    };
  });

  return summary;
}

exports.handler = async (event) => {
  connectLambda(event);

  const params = event.queryStringParameters || {};
  const season = params.season || "2026";
  const currentWeek = params.week ? parseInt(params.week, 10) : getCurrentNFLWeek();
  const previousWeek = currentWeek - 1;

  if (previousWeek < 1) {
    const msg = `No previous week to compare against (currentWeek=${currentWeek}) — Risers & Fallers needs at least Week 2.`;
    console.log(msg);
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: msg }) };
  }

  console.log(`Risers & Fallers: computing week ${previousWeek} -> week ${currentWeek}, season ${season}`);

  // Fetch both weeks' game lists, then both weeks' player stats — in
  // parallel across games WITHIN each week (see fetchPlayerStatsForGames),
  // but the two weeks themselves are fetched sequentially below since
  // that keeps total in-flight requests bounded and easier to reason
  // about within the 30s cap; revisit if timing ever becomes tight.
  const [currentGameIDs, previousGameIDs] = await Promise.all([
    fetchGameIDsForWeek(currentWeek, season),
    fetchGameIDsForWeek(previousWeek, season)
  ]);

  if (currentGameIDs.length === 0 || previousGameIDs.length === 0) {
    const msg = `Missing completed games for one or both weeks (current: ${currentGameIDs.length}, previous: ${previousGameIDs.length}) — aborting, nothing cached.`;
    console.log(msg);
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: msg }) };
  }

  const [currentPlayers, previousPlayers] = await Promise.all([
    fetchPlayerStatsForGames(currentGameIDs),
    fetchPlayerStatsForGames(previousGameIDs)
  ]);

  const currentSummary = buildWeekSummary(currentPlayers);
  const previousSummary = buildWeekSummary(previousPlayers);

  // ── Cross-reference position from the existing player-data cache
  // (built daily by refresh-player-data.js). Players not found there
  // are excluded rather than guessing position — see file header.
  let positionLookup = {};
  try {
    const store = getStore({ name: "player-data" });
    const cached = await store.get("playerData", { type: "json" });
    if (cached?.players) positionLookup = cached.players;
  } catch (e) {
    console.log("player-data cache read failed (non-fatal, positions will be missing):", e.message);
  }

  // ── Compute deltas for every player present in BOTH weeks ──
  const deltas = {};
  const risers = [];
  const fallers = [];

  Object.keys(currentSummary).forEach(playerID => {
    const curr = currentSummary[playerID];
    const prev = previousSummary[playerID];
    if (!prev) return; // no previous-week data to compare against — skip, don't guess a baseline

    const posInfo = positionLookup[playerID];
    if (!posInfo || !posInfo.pos) return; // can't confirm this is a WR/RB/TE — exclude rather than assume

    const targetShareDelta = curr.targetSharePct - prev.targetSharePct;
    const snapShareDelta = curr.offSnapPct - prev.offSnapPct;

    const entry = {
      playerID,
      longName: curr.longName,
      team: curr.team,
      pos: posInfo.pos,
      current: { targetSharePct: curr.targetSharePct, offSnapPct: curr.offSnapPct, targets: curr.targets },
      previous: { targetSharePct: prev.targetSharePct, offSnapPct: prev.offSnapPct, targets: prev.targets },
      targetShareDelta,
      snapShareDelta
    };

    deltas[playerID] = entry;

    if (targetShareDelta >= RISER_FALLER_THRESHOLD || snapShareDelta >= RISER_FALLER_THRESHOLD) {
      risers.push(entry);
    } else if (targetShareDelta <= -RISER_FALLER_THRESHOLD || snapShareDelta <= -RISER_FALLER_THRESHOLD) {
      fallers.push(entry);
    }
  });

  // Sort risers/fallers by the larger of their two deltas, descending
  // magnitude, so the frontend can just take the top N without
  // re-sorting itself.
  const biggestMove = e => Math.max(Math.abs(e.targetShareDelta), Math.abs(e.snapShareDelta));
  risers.sort((a, b) => biggestMove(b) - biggestMove(a));
  fallers.sort((a, b) => biggestMove(b) - biggestMove(a));

  const result = {
    computedAt: new Date().toISOString(),
    season,
    currentWeek,
    previousWeek,
    threshold: RISER_FALLER_THRESHOLD,
    playerCount: Object.keys(deltas).length,
    risers,
    fallers,
    allDeltas: deltas
  };

  try {
    const store = getStore({ name: "risers-fallers" });
    await store.setJSON(`week:${season}:${currentWeek}`, result);
    await store.setJSON("latest", result); // convenient single key for the frontend to always read "most recent"
    console.log(
      `Risers & Fallers cached: week ${previousWeek}->${currentWeek}, ${Object.keys(deltas).length} players compared, ${risers.length} risers, ${fallers.length} fallers`
    );
  } catch (e) {
    console.log("Failed to write risers-fallers cache:", e.message);
    return { statusCode: 500, body: JSON.stringify({ error: "Cache write failed", detail: e.message }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      currentWeek,
      previousWeek,
      playerCount: result.playerCount,
      risersCount: risers.length,
      fallersCount: fallers.length
    })
  };
};

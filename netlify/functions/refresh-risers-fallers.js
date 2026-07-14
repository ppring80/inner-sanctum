
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
//    then dividing each player's targets by that team total.
//
// POSITION DATA: cross-referenced from the existing "player-data"
// Blobs cache (built daily by refresh-player-data.js from
// getNFLTeamRoster, which DOES include pos), keyed by the same
// playerID Tank01 uses consistently across its own endpoints. A
// player missing from that cache is excluded rather than guessing
// their position.
//
// ═══════════════════════════════════════════════════════════════════
// RANKING FIX — 2026-07-14, same-day revision after first real test
// run against 2025 Week 1->2 data surfaced a real problem:
//
// ORIGINAL LOGIC (first version): classified ANY player as a
// riser/faller if EITHER their target share delta OR their snap
// share delta crossed the threshold, and sorted by whichever of the
// two deltas was larger in magnitude.
//
// WHY THAT WAS WRONG, with real evidence from the test run: the #1
// "riser" was Tyler Johnson (NYJ) — his target share actually FELL
// (9.5% -> 4.8%) and his target count dropped 2->1, but he ranked #1
// anyway because his SNAP share jumped 52%->96%, almost certainly
// mop-up-duty/special-teams snaps in a blowout, not a real
// fantasy-relevant usage trend. Several other top "risers" had the
// same shape: 1 total target, snap share swinging wildly, target
// share barely moving or even dropping. Snap share on a tiny number
// of targets is noise, not signal, for a feature whose whole point
// is surfacing real usage trends.
//
// FIX: two changes, both below.
//   (a) MIN_TARGET_FLOOR — a player must have at least this many
//       targets in AT LEAST ONE of the two weeks being compared to
//       be considered at all. Filters out the 0-1-target noise cases
//       entirely, before ranking logic ever runs.
//   (b) Classification and sorting now use TARGET SHARE DELTA ONLY.
//       Snap share delta is still computed and still shown on every
//       entry (real, useful context — e.g. confirms a target-share
//       riser is also seeing real expanded playing time, or flags
//       when it isn't), but it no longer independently crowns
//       someone a riser/faller on its own. Target share is the
//       metric fantasy players actually mean by "trending up" —
//       snap share alone, especially on low-target players, isn't a
//       reliable proxy for that.
// ═══════════════════════════════════════════════════════════════

const TANK01_HOST = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

// Target share threshold, in PERCENTAGE POINTS (not relative %). E.g.
// 0.10 means a player who went from 15% to 26% target share (+11
// points) qualifies as a riser; 15% to 22% (+7 points) does not.
const TARGET_SHARE_THRESHOLD = 0.10;

// Minimum targets required in at least ONE of the two weeks compared,
// before a player is considered for riser/faller status at all. Filters
// out the "went from 1 target to 1 target but their target SHARE
// number bounced around because their team barely threw the ball"
// class of noise. 3 was chosen as a reasonable floor — enough to
// represent a real, if secondary, role in the passing game, while
// still catching real breakout stories (e.g. a player going from a
// non-factor 1-2 targets to a real 6-9 target role would clear this
// floor via their NEW week's count even if their OLD week's count
// didn't). Tunable without touching any other logic in this file.
const MIN_TARGET_FLOOR = 3;

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
// runtime boundary (this project's established pattern). UPDATE
// seasonStart each year.
function getCurrentNFLWeek() {
  const seasonStart = new Date("2026-09-09");
  const now = new Date();
  if (now < seasonStart) return 1;
  const diffDays = Math.floor((now - seasonStart) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.min(18, Math.floor(diffDays / 7) + 1));
}

// ── Fetch the list of gameIDs for a given week/season, completed
// games only. gameStatusCode "2" = Completed.
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
// flat array of every player stat line across all of them.
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

// ── Sum targets by teamID+gameID within a single week's player pool,
// so each player's individual target share can be computed as
// targets / teamTotalTargets for THEIR OWN team's game that week.
function computeTeamTargetTotals(players) {
  const totals = {};
  players.forEach(p => {
    if (!p.Receiving || !p.teamID || !p.gameID) return;
    const targets = parseInt(p.Receiving.targets, 10) || 0;
    const key = `${p.teamID}_${p.gameID}`;
    totals[key] = (totals[key] || 0) + targets;
  });
  return totals;
}

// ── Build a per-player summary map for one week. Only includes
// players with a Receiving stat line — this feature is scoped to
// pass-catchers (WR/RB/TE), not QBs/defense/kickers.
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
  let filteredByFloor = 0;

  Object.keys(currentSummary).forEach(playerID => {
    const curr = currentSummary[playerID];
    const prev = previousSummary[playerID];
    if (!prev) return; // no previous-week data to compare against — skip, don't guess a baseline

    const posInfo = positionLookup[playerID];
    if (!posInfo || !posInfo.pos) return; // can't confirm this is a WR/RB/TE — exclude rather than assume

    // MIN_TARGET_FLOOR: require real target volume in at least one of
    // the two weeks before this player is even considered. See file
    // header for the real evidence (Tyler Johnson, etc.) that
    // motivated this filter.
    if (Math.max(curr.targets, prev.targets) < MIN_TARGET_FLOOR) {
      filteredByFloor++;
      return;
    }

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
      snapShareDelta // kept as context on every entry, no longer a classification trigger — see RANKING FIX note above
    };

    deltas[playerID] = entry;

    // Classification and ranking now driven by TARGET SHARE ALONE.
    // Snap share is real, useful context shown on the entry (a target
    // share riser whose snap share also jumped is a stronger story
    // than one whose snap share didn't move at all) but no longer
    // independently qualifies someone as a riser/faller — see file
    // header for why.
    if (targetShareDelta >= TARGET_SHARE_THRESHOLD) {
      risers.push(entry);
    } else if (targetShareDelta <= -TARGET_SHARE_THRESHOLD) {
      fallers.push(entry);
    }
  });

  // Sort by target share delta magnitude alone — biggest real target
  // share swings first, in both directions.
  risers.sort((a, b) => b.targetShareDelta - a.targetShareDelta);
  fallers.sort((a, b) => a.targetShareDelta - b.targetShareDelta);

  const result = {
    computedAt: new Date().toISOString(),
    season,
    currentWeek,
    previousWeek,
    threshold: TARGET_SHARE_THRESHOLD,
    minTargetFloor: MIN_TARGET_FLOOR,
    playerCount: Object.keys(deltas).length,
    filteredByFloor,
    risers,
    fallers,
    allDeltas: deltas
  };

  try {
    const store = getStore({ name: "risers-fallers" });
    await store.setJSON(`week:${season}:${currentWeek}`, result);
    await store.setJSON("latest", result);
    console.log(
      `Risers & Fallers cached: week ${previousWeek}->${currentWeek}, ${Object.keys(deltas).length} players compared (${filteredByFloor} filtered by target floor), ${risers.length} risers, ${fallers.length} fallers`
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
      filteredByFloor,
      risersCount: risers.length,
      fallersCount: fallers.length
    })
  };
};

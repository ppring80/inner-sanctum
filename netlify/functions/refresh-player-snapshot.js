const { connectLambda, getStore } = require("@netlify/blobs");

// ═══════════════════════════════════════════════════════════════════════
// PLAYER SNAPSHOT V1 — NON-PRODUCTION PROTOTYPE (Aug 2026)
//
// PURPOSE: generate a simple, customer-facing-STYLE (but not yet
// customer-EXPOSED) description of a player's team role, offensive
// context, and career stage, so the rules can be sanity-checked
// against real games before any production rollout. This is NOT the
// SAGE recommendation engine and does not touch it, read it, or write
// anything it reads.
//
// NOT IMPLEMENTED IN THIS FILE: availabilityProfile. Every snapshot
// hardcodes "NOT_CURRENTLY_SUPPORTED" for that field — see the
// research turn's writeup for why: the roster cache only ever holds a
// single current-moment injury designation, overwritten daily, with
// no retained history. There is nothing here that infers, predicts,
// or scores injury risk in any way.
//
// TANK01 CALL REUSE — read this before assuming a call is "new":
//   - Roster data (pos/team/exp/injury): reused AS-IS from the
//     existing "player-data" Blobs store built by
//     refresh-player-data.js's daily cron. ZERO new Tank01 calls for
//     this part — this function only READS that cache.
//   - Box score data (carries/targets/receptions/snapCounts/
//     passAttempts): refresh-risers-fallers.js already calls
//     getNFLGamesForWeek + getNFLBoxScore on its OWN schedule, but its
//     own cached OUTPUT (the "risers-fallers" Blobs store) only
//     retains targets/targetSharePct/offSnapPct for players who
//     cleared its MIN_TARGET_FLOOR filter — it does not retain
//     carries, passAttempts, or team-level rush/pass totals at all,
//     and it only ever compares two adjacent weeks, never a rolling
//     multi-week window. Reusing THAT cache directly is not possible
//     without either (a) modifying refresh-risers-fallers.js's own
//     extraction logic (explicitly out of scope — "do not modify
//     existing files", and real risk to a working, scheduled
//     production pipeline for a non-production prototype), or (b)
//     this function independently calling the SAME two already-paid-
//     for Tank01 endpoints, over its own small rolling window, using
//     the IDENTICAL fetch pattern already proven in that file. (b) is
//     what's implemented below. This is a real, additional set of
//     Tank01 calls this function makes on its own -- documented
//     honestly in the deliverable, not glossed over -- but it is the
//     SAME two endpoints already integrated into this codebase, not a
//     new provider or a new kind of call, and it never runs on a
//     customer page load or per-player -- only via manual/scheduled
//     batch execution of this one function.
//
// NO CUSTOMER-FACING CODE READS THIS FILE. Nothing in draft.html,
// auction.html, Tier List, Weekly Rankings, or Sanctum/chat.js was
// touched to build this, and nothing here calls into any of them.
// ═══════════════════════════════════════════════════════════════════════

const TANK01_HOST = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

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

// Same convention as refresh-risers-fallers.js's own getCurrentNFLWeek()
// -- duplicated rather than shared across the runtime boundary, matching
// this project's established pattern (each Netlify function is a
// standalone Lambda; there's no shared-module import path already in
// use here worth introducing for one small helper). Update seasonStart
// each year.
function getCurrentNFLWeek() {
  const seasonStart = new Date("2026-09-09");
  const now = new Date();
  if (now < seasonStart) return 1;
  const diffDays = Math.floor((now - seasonStart) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.min(18, Math.floor(diffDays / 7) + 1));
}

async function fetchGameIDsForWeek(week, season) {
  try {
    const resp = await fetchTank01("getNFLGamesForWeek", { week: String(week), season: String(season) });
    const games = Array.isArray(resp?.body) ? resp.body : [];
    return games
      .filter(g => g.gameStatusCode === "2") // Completed only -- same convention as refresh-risers-fallers.js
      .map(g => g.gameID)
      .filter(Boolean);
  } catch (e) {
    console.log(`fetchGameIDsForWeek failed for week ${week}, season ${season}:`, e.message);
    return [];
  }
}

// Returns a flat array of every player stat line across all given
// gameIDs, each annotated with the gameID it came from (Tank01's own
// box score body does not repeat gameID on every player line in the
// confirmed shape, so it's attached here for later per-game grouping).
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
        Object.values(playerStats).forEach(p => allPlayers.push(Object.assign({}, p, { gameID })));
      } else {
        console.log(`No playerStats object in box score for ${gameID}`);
      }
    } else {
      console.log(`Box score fetch failed for ${gameID}:`, result.reason?.message);
    }
  });
  return allPlayers;
}

// ─────────────────────────────────────────────────────────────────
// WINDOW SELECTION — "most recent games where practical," not merely
// "most recent weeks." Fetches up to WINDOW_WEEKS calendar weeks
// ending at the current week, but every per-player average below is
// computed over the games that player ACTUALLY appears in within that
// window -- a bye week or a missed game simply produces fewer data
// points for that player, never a zero or a distorted average. This
// is what satisfies "do not let missed games automatically distort
// the player's usage averages" without any special-case bye-week
// logic being needed.
// ─────────────────────────────────────────────────────────────────
const WINDOW_WEEKS = 6; // "approximately most recent 6 PLAYER GAMES where practical" -- see header

async function fetchRecentGameWindow(season, currentWeek) {
  const startWeek = Math.max(1, currentWeek - (WINDOW_WEEKS - 1));
  const weeks = [];
  for (let w = startWeek; w <= currentWeek; w++) weeks.push(w);

  // ROOT-CAUSE FIX: the proven working pattern in
  // refresh-risers-fallers.js NEVER fetches more than 2 weeks'
  // getNFLGamesForWeek calls concurrently (Promise.all([currentWeek,
  // previousWeek]) -- always exactly 2). This function previously
  // fired ALL requested weeks concurrently via
  // Promise.all(weeks.map(...)) -- up to 6 simultaneous
  // getNFLGamesForWeek calls for the default 6-week window, 3x the
  // concurrency the proven pattern ever uses. Combined with
  // fetchGameIDsForWeek's own try/catch silently swallowing any
  // failure into an empty array (logged, never surfaced or retried),
  // a rate-limited/failed request for any of those simultaneous calls
  // silently contributed zero games for that week, with no error
  // visible anywhere in the cached output -- matching the observed
  // symptom exactly (only 16 total games across a requested 6-week
  // window, consistent with only one week's real slate actually
  // succeeding). Fetching weeks SEQUENTIALLY here, one at a time,
  // matches the proven file's more conservative concurrency and
  // removes this specific failure mode. Per-game concurrency within a
  // single week's box scores (fetchPlayerStatsForGames below) is
  // UNCHANGED and still matches refresh-risers-fallers.js's own
  // existing Promise.allSettled-per-week pattern exactly -- only the
  // WEEK-LIST fetch concurrency changed.
  const gamesPerWeek = {};
  const allGameIDs = [];
  for (const w of weeks) {
    const ids = await fetchGameIDsForWeek(w, season);
    gamesPerWeek[w] = ids.length;
    allGameIDs.push(...ids);
  }
  if (allGameIDs.length === 0) return { players: [], weeksUsed: weeks, gamesUsed: 0, gamesPerWeek };

  const players = await fetchPlayerStatsForGames(allGameIDs);
  return { players, weeksUsed: weeks, gamesUsed: allGameIDs.length, gamesPerWeek };
}

// ─────────────────────────────────────────────────────────────────
// PER-GAME, PER-TEAM AGGREGATES
//
// Two DIFFERENT team-level totals are computed, deliberately kept
// separate because they answer different questions:
//   - teamPassRushTotals: ALL players' pass attempts and rush
//     attempts (INCLUDING QB carries/scrambles) on a team in a game.
//     Used for Offensive Style, where "how often does this offense
//     run vs. pass" should legitimately include QB scrambles as rush
//     plays.
//   - teamRbCarryTotals: rush attempts summed ONLY across players
//     whose position (cross-referenced from the roster cache, never
//     trusted from the box score itself -- same discipline
//     refresh-risers-fallers.js already uses for position data) is
//     RB. Used for RB carry share, which must explicitly EXCLUDE QB
//     rush attempts per the locked spec.
//
// SACKS: the confirmed Tank01 fields for this project (Rushing:
// carries/rushYds/rushTD; Passing: passAttempts/passCompletions/
// passYds/passTD) do not include a separate sacks field in either
// category. If Tank01 follows the common NFL statistical convention
// of excluding sacks from BOTH passAttempts and Rushing.carries
// (recording them as a distinct "times sacked" stat instead), then
// the pass-rate ratio below (passAttempts / (passAttempts +
// rushAttempts)) is unaffected either way -- sacked plays simply
// don't appear in the denominator or numerator. This has NOT been
// independently re-verified with a fresh live diagnostic in this
// session; it is carried over as an assumption from the already-
// confirmed field list, not a new claim, and is flagged here
// explicitly rather than silently assumed.
// ─────────────────────────────────────────────────────────────────
function buildTeamAggregates(players, rosterByPlayerID) {
  const teamPassRushTotals = {}; // key: `${teamID}_${gameID}` -> {passAttempts, rushAttempts}
  const teamRbCarryTotals = {};  // key: `${teamID}_${gameID}` -> rbCarries
  const teamTargetTotals = {};   // key: `${teamID}_${gameID}` -> targets (WR/RB/TE only, matches existing convention)

  players.forEach(p => {
    if (!p.teamID || !p.gameID) return;
    const key = `${p.teamID}_${p.gameID}`;
    const carries = parseInt(p.Rushing?.carries, 10) || 0;
    const passAttempts = parseInt(p.Passing?.passAttempts, 10) || 0;
    const targets = parseInt(p.Receiving?.targets, 10) || 0;

    if (!teamPassRushTotals[key]) teamPassRushTotals[key] = { passAttempts: 0, rushAttempts: 0 };
    teamPassRushTotals[key].passAttempts += passAttempts;
    teamPassRushTotals[key].rushAttempts += carries;

    const roster = rosterByPlayerID[p.playerID];
    if (roster && roster.pos === "RB") {
      teamRbCarryTotals[key] = (teamRbCarryTotals[key] || 0) + carries;
    }

    if (p.Receiving) {
      teamTargetTotals[key] = (teamTargetTotals[key] || 0) + targets;
    }
  });

  return { teamPassRushTotals, teamRbCarryTotals, teamTargetTotals };
}

// ─────────────────────────────────────────────────────────────────
// PER-PLAYER AGGREGATION ACROSS THE WINDOW
//
// Averages every metric ONLY over games the player actually has a
// stat line in -- never over the fixed number of weeks fetched. This
// is the mechanism that satisfies "do not let missed games
// automatically distort the player's usage averages": a player who
// missed 2 of 6 fetched weeks simply has gamesUsed=4, and every
// average below divides by 4, not 6.
// ─────────────────────────────────────────────────────────────────
function buildPlayerAggregates(players, rosterByPlayerID, teamAggregates) {
  const { teamPassRushTotals, teamRbCarryTotals, teamTargetTotals } = teamAggregates;
  const perPlayer = {};

  players.forEach(p => {
    if (!p.playerID || !p.teamID || !p.gameID) return;
    const roster = rosterByPlayerID[p.playerID];
    if (!roster || !roster.pos) return; // can't confirm position -- exclude rather than assume, same as refresh-risers-fallers.js

    const key = `${p.teamID}_${p.gameID}`;
    const carries = parseInt(p.Rushing?.carries, 10) || 0;
    const targets = parseInt(p.Receiving?.targets, 10) || 0;
    const receptions = parseInt(p.Receiving?.receptions, 10) || 0;
    const passAttempts = parseInt(p.Passing?.passAttempts, 10) || 0;
    const offSnapPct = p.snapCounts ? (parseFloat(p.snapCounts.offSnapPct) || 0) : null;

    const teamTargetTotal = teamTargetTotals[key] || 0;
    const targetSharePct = (p.Receiving && teamTargetTotal > 0) ? targets / teamTargetTotal : 0;

    const rbRoomTotal = teamRbCarryTotals[key] || 0;
    const rbCarryShare = (roster.pos === "RB" && rbRoomTotal > 0) ? carries / rbRoomTotal : 0;

    const teamTotals = teamPassRushTotals[key] || { passAttempts: 0, rushAttempts: 0 };

    if (!perPlayer[p.playerID]) {
      perPlayer[p.playerID] = {
        playerID: p.playerID,
        longName: roster.longName || p.longName,
        pos: roster.pos,
        team: roster.team || p.teamAbv || p.team,
        // Historical team abbreviation, captured from the box score
        // entry itself (2025 games in this run) -- distinct from
        // `team` above, which prefers the CURRENT roster cache and is
        // the exact source of the currentTeam/usageTeam mismatch bug
        // this field exists to fix. p.teamAbv is the same field
        // refresh-risers-fallers.js already relies on for team
        // display, so this is not a new assumption about the data.
        usageTeamAbv: p.teamAbv || p.team,
        tank01TeamID: p.teamID, // distinct from `team` (the display abbreviation) -- needed to key back into teamAggregates, which groups by Tank01's numeric teamID
        games: []
      };
    }
    perPlayer[p.playerID].games.push({
      gameID: p.gameID,
      carries,
      targets,
      receptions,
      passAttempts,
      offSnapPct,
      targetSharePct,
      rbCarryShare,
      teamPassAttempts: teamTotals.passAttempts,
      teamRushAttempts: teamTotals.rushAttempts
    });
  });

  return perPlayer;
}

function avg(nums) {
  const valid = nums.filter(n => typeof n === "number" && !Number.isNaN(n));
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

// ═══════════════════════════════════════════════════════════════════
// CLASSIFICATION RULES — V1 LOCKED INITIAL CALIBRATION
//
// Every threshold below is a NON-PRODUCTION starting calibration,
// explicitly meant to be sanity-checked against real output before
// any customer exposure -- not a claim of correctness.
// ═══════════════════════════════════════════════════════════════════

const MIN_GAMES_FOR_ANY_CONFIDENCE = 2; // below this, always Role Uncertain regardless of the numbers
const MIN_GAMES_FOR_HIGH_CONFIDENCE = 4;

function classifyRB(agg, teamRbAvgCarryShares) {
  const avgSnapPct = avg(agg.games.map(g => g.offSnapPct));
  const avgTargetShare = avg(agg.games.map(g => g.targetSharePct));
  const avgRBCarryShare = avg(agg.games.map(g => g.rbCarryShare));
  const gamesUsed = agg.games.length;

  const evidence = { avgSnapPct, avgTargetShare, avgRBCarryShare, gamesUsed };

  if (gamesUsed < MIN_GAMES_FOR_ANY_CONFIDENCE) {
    return { teamRole: null, roleDescription: "Role Uncertain", roleConfidence: "LOW", evidence };
  }

  const isRbRoomLeader = teamRbAvgCarryShares[agg.team] && teamRbAvgCarryShares[agg.team].leaderPlayerID === agg.playerID;

  let teamRole = null, roleDescription = null;

  if (avgSnapPct >= 0.65 && avgRBCarryShare >= 0.55 && avgTargetShare >= 0.10) {
    teamRole = "RB1"; roleDescription = "RB1 · Three-Down Back";
  } else if (avgSnapPct >= 0.55 && avgRBCarryShare >= 0.55 && avgTargetShare < 0.10) {
    teamRole = "RB1"; roleDescription = "RB1 · Lead Runner";
  } else if (avgSnapPct >= 0.45 && avgSnapPct <= 0.60 && isRbRoomLeader) {
    teamRole = "RB1"; roleDescription = "RB1 · Committee Lead";
  } else if (isRbRoomLeader) {
    // Confirmed room-leader coverage-gap fix: a player who leads his
    // team's RB room in carry share, but whose snap share falls
    // outside the specific Committee Lead window above (and who
    // didn't clear Three-Down Back or Lead Runner either), must not
    // fall through to the generic secondary-usage fallback below --
    // Rule 5 (Committee Back) explicitly excludes room leaders
    // already, and the fallback (Rule 6) was designed for genuinely
    // marginal/secondary usage, not for someone carrying the largest
    // share of his team's RB-room work. No numeric threshold is used
    // here -- this branch exists purely to catch a confirmed leader
    // that the three rules above, each with its own narrower numeric
    // window, didn't happen to catch.
    teamRole = "RB1"; roleDescription = "RB1 · Committee Lead";
  } else if (avgRBCarryShare < 0.45 && avgTargetShare >= 0.08) {
    teamRole = "RB2"; roleDescription = "RB2 · Receiving Back";
  } else if (avgRBCarryShare >= 0.20 && !isRbRoomLeader) {
    teamRole = "RB2"; roleDescription = "RB2 · Committee Back";
  } else if (avgRBCarryShare > 0 || avgSnapPct > 0.10) {
    teamRole = "RB2"; roleDescription = "RB2 · Change-of-Pace Back";
  }

  if (!roleDescription) {
    return { teamRole: null, roleDescription: "Role Uncertain", roleConfidence: "LOW", evidence };
  }

  const roleConfidence = gamesUsed >= MIN_GAMES_FOR_HIGH_CONFIDENCE ? "HIGH" : "MEDIUM";
  return { teamRole, roleDescription, roleConfidence, evidence };
}

// WR: sustained target share is primary; snap share is supporting
// context only (never overrides target share, per spec -- "do NOT
// simply classify highest snap share as WR1"). Co-Primary is used
// when the top two on a team are genuinely close, rather than forcing
// an artificial #1/#2 split the data doesn't support.
const WR1_TARGET_SHARE_FLOOR = 0.20;
const WR2_TARGET_SHARE_FLOOR = 0.14;
const WR3_TARGET_SHARE_FLOOR = 0.05;
const CO_PRIMARY_MARGIN = 0.03; // percentage points -- top-2 within this margin of each other

function classifyWRsForTeam(teamWRAggs) {
  const withShares = teamWRAggs.map(agg => ({
    agg,
    avgTargetShare: avg(agg.games.map(g => g.targetSharePct)),
    avgSnapPct: avg(agg.games.map(g => g.offSnapPct)),
    gamesUsed: agg.games.length
  })).sort((a, b) => b.avgTargetShare - a.avgTargetShare);

  const results = {};

  withShares.forEach((entry, i) => {
    const evidence = { avgSnapPct: entry.avgSnapPct, avgTargetShare: entry.avgTargetShare, avgRBCarryShare: 0, gamesUsed: entry.gamesUsed };
    if (entry.gamesUsed < MIN_GAMES_FOR_ANY_CONFIDENCE) {
      results[entry.agg.playerID] = { teamRole: null, roleDescription: "Role Uncertain", roleConfidence: "LOW", evidence };
      return;
    }

    const confidence = entry.gamesUsed >= MIN_GAMES_FOR_HIGH_CONFIDENCE ? "HIGH" : "MEDIUM";
    let teamRole = null, roleDescription = null;

    if (i === 0 && entry.avgTargetShare >= WR1_TARGET_SHARE_FLOOR) {
      const second = withShares[1];
      const isCoPrimary = second && second.avgTargetShare >= WR1_TARGET_SHARE_FLOOR &&
        Math.abs(entry.avgTargetShare - second.avgTargetShare) <= CO_PRIMARY_MARGIN;
      teamRole = "WR1";
      roleDescription = isCoPrimary ? "WR1 · Co-Primary Receiver" : "WR1 · Primary Receiver";
    } else if (i === 1 && entry.avgTargetShare >= WR1_TARGET_SHARE_FLOOR) {
      const first = withShares[0];
      const isCoPrimary = Math.abs(entry.avgTargetShare - first.avgTargetShare) <= CO_PRIMARY_MARGIN;
      teamRole = isCoPrimary ? "WR1" : "WR2";
      roleDescription = isCoPrimary ? "WR1 · Co-Primary Receiver" : "WR2 · Starting Receiver";
    } else if (entry.avgTargetShare >= WR2_TARGET_SHARE_FLOOR) {
      teamRole = "WR2"; roleDescription = "WR2 · Starting Receiver";
    } else if (entry.avgTargetShare >= WR3_TARGET_SHARE_FLOOR) {
      teamRole = "WR3"; roleDescription = "WR3 · Rotational Receiver";
    }

    if (!roleDescription) {
      results[entry.agg.playerID] = { teamRole: null, roleDescription: "Role Uncertain", roleConfidence: "LOW", evidence };
    } else {
      results[entry.agg.playerID] = { teamRole, roleDescription, roleConfidence: confidence, evidence };
    }
  });

  return results;
}

// TE: same shape as WR but lower absolute floors, since TE target
// share is leaguewide lower even for clear #1 options. No Co-Primary
// concept requested for TE -- not implemented, matching spec.
const TE1_PRIMARY_TARGET_SHARE_FLOOR = 0.15;
const TE1_STARTING_SNAP_FLOOR = 0.55; // high snaps but more modest target share still reads as "the starting TE"
const TE2_TARGET_SHARE_FLOOR = 0.05;

function classifyTE(agg) {
  const avgSnapPct = avg(agg.games.map(g => g.offSnapPct));
  const avgTargetShare = avg(agg.games.map(g => g.targetSharePct));
  const gamesUsed = agg.games.length;
  const evidence = { avgSnapPct, avgTargetShare, avgRBCarryShare: 0, gamesUsed };

  if (gamesUsed < MIN_GAMES_FOR_ANY_CONFIDENCE) {
    return { teamRole: null, roleDescription: "Role Uncertain", roleConfidence: "LOW", evidence };
  }

  let teamRole = null, roleDescription = null;
  if (avgTargetShare >= TE1_PRIMARY_TARGET_SHARE_FLOOR) {
    teamRole = "TE1"; roleDescription = "TE1 · Primary Receiving TE";
  } else if (avgSnapPct >= TE1_STARTING_SNAP_FLOOR) {
    teamRole = "TE1"; roleDescription = "TE1 · Starting TE";
  } else if (avgTargetShare >= TE2_TARGET_SHARE_FLOOR) {
    teamRole = "TE2"; roleDescription = "TE2 · Secondary TE";
  }

  if (!roleDescription) {
    return { teamRole: null, roleDescription: "Role Uncertain", roleConfidence: "LOW", evidence };
  }
  const roleConfidence = gamesUsed >= MIN_GAMES_FOR_HIGH_CONFIDENCE ? "HIGH" : "MEDIUM";
  return { teamRole, roleDescription, roleConfidence, evidence };
}

// QB: sustained team pass-attempt DOMINANCE, not merely "most
// attempts." A near-even split (e.g. an injury/competition situation)
// is reported as Role Uncertain for BOTH QBs rather than confidently
// crowning one -- no depth-chart call is added to resolve this, per
// spec ("do not add depth-chart API calls solely for this
// prototype").
const QB1_DOMINANCE_SHARE = 0.65;

function classifyQBsForTeam(teamQBAggs) {
  const totalAttempts = teamQBAggs.reduce((sum, agg) => sum + agg.games.reduce((s, g) => s + g.passAttempts, 0), 0);
  const results = {};

  teamQBAggs.forEach(agg => {
    const gamesUsed = agg.games.filter(g => g.passAttempts > 0).length;
    const ownAttempts = agg.games.reduce((s, g) => s + g.passAttempts, 0);
    const share = totalAttempts > 0 ? ownAttempts / totalAttempts : 0;
    const evidence = { avgSnapPct: avg(agg.games.map(g => g.offSnapPct)), avgTargetShare: 0, avgRBCarryShare: 0, gamesUsed };

    if (gamesUsed < MIN_GAMES_FOR_ANY_CONFIDENCE || ownAttempts === 0) {
      results[agg.playerID] = { teamRole: null, roleDescription: "Role Uncertain", roleConfidence: "LOW", evidence };
      return;
    }

    const confidence = gamesUsed >= MIN_GAMES_FOR_HIGH_CONFIDENCE ? "HIGH" : "MEDIUM";
    if (share >= QB1_DOMINANCE_SHARE) {
      results[agg.playerID] = { teamRole: "QB1", roleDescription: "QB1 · Starting Quarterback", roleConfidence: confidence, evidence };
    } else if (share > 0 && (1 - share) >= QB1_DOMINANCE_SHARE) {
      results[agg.playerID] = { teamRole: "QB2", roleDescription: "QB2 · Backup Quarterback", roleConfidence: confidence, evidence };
    } else {
      // No clearly dominant passer this window (competition/injury/split
      // start situation) -- do not manufacture a starter/backup call.
      results[agg.playerID] = { teamRole: null, roleDescription: "Role Uncertain", roleConfidence: "LOW", evidence };
    }
  });

  return results;
}

// OFFENSIVE STYLE — team-level, computed once per team from the SAME
// window, using ALL players' pass/rush attempts (QB scrambles
// included in rush attempts here, deliberately DIFFERENT from RB
// carry share above -- see file header for why that's correct).
const PASS_HEAVY_FLOOR = 0.60;
const BALANCED_FLOOR = 0.54;
const OFFENSE_STYLE_MIN_GAMES = 3; // never classify from one game

function classifyOffensiveStyleForTeam(teamPassRushTotals, teamID) {
  const gameKeys = Object.keys(teamPassRushTotals).filter(k => k.startsWith(teamID + "_"));
  if (gameKeys.length < OFFENSE_STYLE_MIN_GAMES) {
    return { offenseStyle: "Role Uncertain", gamesUsed: gameKeys.length };
  }
  let totalPass = 0, totalRush = 0;
  gameKeys.forEach(k => {
    totalPass += teamPassRushTotals[k].passAttempts;
    totalRush += teamPassRushTotals[k].rushAttempts;
  });
  const totalPlays = totalPass + totalRush;
  if (totalPlays === 0) return { offenseStyle: "Role Uncertain", gamesUsed: gameKeys.length };
  const passRate = totalPass / totalPlays;

  let offenseStyle;
  if (passRate >= PASS_HEAVY_FLOOR) offenseStyle = "Pass-Heavy Offense";
  else if (passRate >= BALANCED_FLOOR) offenseStyle = "Balanced Offense";
  else offenseStyle = "Run-Heavy Offense";

  return { offenseStyle, passRate, gamesUsed: gameKeys.length };
}

// CAREER PROFILE — exp gates the floor; sustained role evidence
// (never exp alone) confirms the label. "Late-Career Veteran" is
// deliberately NOT implemented (no age/career-stage data confirmed
// available) -- "Veteran — Reduced Role" is used instead wherever the
// spec's description of that concept would otherwise apply.
function classifyCareerProfile(exp, roleTeamRole, evidence) {
  // Canonical position-aware "meaningful established starting role" --
  // per explicit product refinement, this must include WR2 (a real
  // starting receiver, not a reduced role) alongside the four
  // position-leader tiers. QB2/RB2/WR3/TE2/Role Uncertain/blank are
  // deliberately NOT included -- those are reduced or unresolved
  // roles, not established ones. UNCHANGED from the prior fix -- this
  // turn only adjusts which LABEL each experience/role combination
  // maps to below, never this definition itself.
  //
  // The independent `avgSnapPct >= 0.50` fallback remains REMOVED --
  // Career Profile depends only on this already-computed,
  // target-share-aware role tier, never on raw snap percentage.
  const hasMeaningfulStarterRole = roleTeamRole === "QB1" || roleTeamRole === "RB1" ||
    roleTeamRole === "WR1" || roleTeamRole === "WR2" || roleTeamRole === "TE1";

  // FINAL CALIBRATION (locked framework): "Veteran" language was
  // reaching customers too early -- a Year 3-4 player in a secondary
  // role is not intuitively a "Veteran" to a fantasy football
  // customer, even though it's defensible NFL terminology. The
  // former single "years <= 6" bucket is now split into two: Years
  // 3-4 secondary/reduced/uncertain roles now read as "Developing
  // Young Player" (same label already used for Years 1-2 secondary
  // roles and non-starter rookies); "Veteran — Reduced Role" now only
  // begins at Year 5. Starter-tier labeling (Established Starter at
  // 3-6 years, Proven Veteran at 7+) is unchanged in shape, just now
  // spans the same "Established Starter" label across both the 3-4
  // and 5-6 bands rather than needing a separate branch, since the
  // label itself doesn't change at that boundary -- only the
  // non-starter label does.
  //
  // Non-starter rookies also now read as "Developing Young Player"
  // (previously "Rookie") -- consistent with every other non-starter
  // young-player bucket using that same label, per the explicit
  // locked framework.
  if (exp === "R") {
    return hasMeaningfulStarterRole ? "High-Upside Rookie" : "Developing Young Player";
  }

  const years = parseInt(exp, 10);
  if (Number.isNaN(years)) return "Role Uncertain";

  if (years <= 2) {
    return hasMeaningfulStarterRole ? "Emerging Starter" : "Developing Young Player";
  }
  if (years <= 4) {
    return hasMeaningfulStarterRole ? "Established Starter" : "Developing Young Player";
  }
  if (years <= 6) {
    return hasMeaningfulStarterRole ? "Established Starter" : "Veteran — Reduced Role";
  }
  // years >= 7
  return hasMeaningfulStarterRole ? "Proven Veteran" : "Veteran — Reduced Role";
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════
exports.handler = async (event) => {
  connectLambda(event);

  const params = event.queryStringParameters || {};
  const season = params.season || "2026";
  const currentWeek = params.week ? parseInt(params.week, 10) : getCurrentNFLWeek();

  // Roster cache: REUSED as-is, zero new Tank01 calls for this part.
  let rosterByPlayerID = {};
  try {
    const store = getStore({ name: "player-data" });
    const cached = await store.get("playerData", { type: "json" });
    if (cached?.players) rosterByPlayerID = cached.players;
  } catch (e) {
    console.log("player-data cache read failed (non-fatal, will proceed with fewer classifiable players):", e.message);
  }

  const { players, weeksUsed, gamesUsed, gamesPerWeek } = await fetchRecentGameWindow(season, currentWeek);
  if (players.length === 0) {
    const msg = `No player game data available for weeks ${weeksUsed.join(",")}, season ${season} -- aborting, nothing cached.`;
    console.log(msg, "gamesPerWeek:", JSON.stringify(gamesPerWeek));
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: msg, gamesPerWeek }) };
  }

  const teamAggregates = buildTeamAggregates(players, rosterByPlayerID);
  const perPlayerAggregates = buildPlayerAggregates(players, rosterByPlayerID, teamAggregates);

  // RB-room carry-share leader per team, needed by classifyRB() for
  // the Committee Lead rule ("leads the team's RB room in carry
  // share").
  const teamRbAvgCarryShares = {};
  Object.values(perPlayerAggregates).filter(a => a.pos === "RB").forEach(agg => {
    const avgShare = avg(agg.games.map(g => g.rbCarryShare));
    if (!teamRbAvgCarryShares[agg.team] || avgShare > teamRbAvgCarryShares[agg.team].avgShare) {
      teamRbAvgCarryShares[agg.team] = { avgShare, leaderPlayerID: agg.playerID };
    }
  });

  // WR and QB classifications are computed PER TEAM (relative ranking
  // against teammates), RB and TE are computed per player independently.
  const wrByTeam = {};
  const qbByTeam = {};
  Object.values(perPlayerAggregates).forEach(agg => {
    if (agg.pos === "WR") (wrByTeam[agg.team] = wrByTeam[agg.team] || []).push(agg);
    if (agg.pos === "QB") (qbByTeam[agg.team] = qbByTeam[agg.team] || []).push(agg);
  });
  const wrResultsByPlayerID = {};
  Object.keys(wrByTeam).forEach(team => Object.assign(wrResultsByPlayerID, classifyWRsForTeam(wrByTeam[team])));
  const qbResultsByPlayerID = {};
  Object.keys(qbByTeam).forEach(team => Object.assign(qbResultsByPlayerID, classifyQBsForTeam(qbByTeam[team])));

  const offenseStyleByTeam = {};
  const teamIDs = new Set(Object.keys(teamAggregates.teamPassRushTotals).map(k => k.split("_")[0]));
  teamIDs.forEach(teamID => {
    offenseStyleByTeam[teamID] = classifyOffensiveStyleForTeam(teamAggregates.teamPassRushTotals, teamID);
  });

  const snapshots = {};
  Object.values(perPlayerAggregates).forEach(agg => {
    let roleResult;
    if (agg.pos === "RB") roleResult = classifyRB(agg, teamRbAvgCarryShares);
    else if (agg.pos === "WR") roleResult = wrResultsByPlayerID[agg.playerID];
    else if (agg.pos === "TE") roleResult = classifyTE(agg);
    else if (agg.pos === "QB") roleResult = qbResultsByPlayerID[agg.playerID];
    else return; // K/DEF/other positions not in scope for V1 Player Snapshot

    if (!roleResult) return;

    const roster = rosterByPlayerID[agg.playerID] || {};
    // currentTeam: from the CURRENT (2026) roster cache -- unchanged
    // source from before this fix, just explicitly named now.
    const currentTeam = roster.team || agg.team;
    // usageTeam: from the box score data actually used to compute this
    // player's stats for THIS run (2025 games in the reported case) --
    // this is the historical-team-attribution fix. See
    // usageTeamAbv's own comment above for where it comes from.
    const usageTeam = agg.usageTeamAbv || agg.team;

    const careerProfile = classifyCareerProfile(roster.exp, roleResult.teamRole, roleResult.evidence);

    snapshots[agg.playerID] = {
      playerID: agg.playerID,
      longName: agg.longName,
      pos: agg.pos,
      currentTeam,
      usageTeam,
      teamRole: roleResult.teamRole,
      roleDescription: roleResult.roleDescription,
      roleConfidence: roleResult.roleConfidence,
      offenseStyle: null, // filled in below, once currentTeam/usageTeam mismatch is resolved
      careerProfile,
      availabilityProfile: "NOT_CURRENTLY_SUPPORTED",
      computedFromGames: roleResult.evidence.gamesUsed,
      updatedAt: new Date().toISOString(),
      _internal: {
        avgSnapPct: Number((roleResult.evidence.avgSnapPct || 0).toFixed(4)),
        avgTargetShare: Number((roleResult.evidence.avgTargetShare || 0).toFixed(4)),
        avgRBCarryShare: Number((roleResult.evidence.avgRBCarryShare || 0).toFixed(4))
      }
    };
  });

  // Second pass: attach offenseStyle by the player's actual Tank01
  // teamID (keyed the SAME way teamAggregates/offenseStyleByTeam were
  // built above -- Tank01's numeric teamID, not the display
  // abbreviation used elsewhere for readability/grouping-by-abbreviation
  // in wrByTeam/qbByTeam/teamRbAvgCarryShares, which is why this is a
  // deliberately separate pass rather than folded into the loop above).
  //
  // HISTORICAL TEAM ATTRIBUTION FIX: offenseStyle here was ALREADY
  // being computed from usageTeam (the historical, box-score-period
  // team) via tank01TeamID -- that part was correct before this fix.
  // The bug was that it was displayed alongside currentTeam with no
  // way to tell they might differ. If a player's current roster team
  // doesn't match the team his usage data actually came from (a
  // trade/free-agent move since that data was recorded), showing his
  // OLD team's offensive style under his NEW team's name is
  // misleading -- it is not evidence about the new team's offense at
  // all. Per spec: never silently carry a former team's style onto
  // the new team.
  Object.values(perPlayerAggregates).forEach(agg => {
    const snap = snapshots[agg.playerID];
    if (!snap) return;
    if (snap.currentTeam !== snap.usageTeam) {
      snap.offenseStyle = "New Team — Offensive Style TBD";
      return;
    }
    const style = offenseStyleByTeam[agg.tank01TeamID];
    snap.offenseStyle = style ? style.offenseStyle : "Role Uncertain";
  });

  const store = getStore({ name: "player-snapshot" });
  await store.setJSON("latest", {
    computedAt: new Date().toISOString(),
    season,
    currentWeek,
    weeksUsed,
    gamesFetched: gamesUsed,
    gamesPerWeek, // e.g. {"13":16,"14":14,...} -- verifies every requested week actually contributed games, not just the total
    playerCount: Object.keys(snapshots).length,
    players: snapshots
  });

  console.log(`Player Snapshot V1 computed: ${Object.keys(snapshots).length} players, weeks ${weeksUsed.join(",")} (per-week games: ${JSON.stringify(gamesPerWeek)}), season ${season}`);
  return { statusCode: 200, body: JSON.stringify({ playerCount: Object.keys(snapshots).length, weeksUsed, gamesPerWeek }) };
};

// Exported for local logic testing only (mirrors this project's
// existing pattern in other function files of not exporting internals
// for production consumers -- these are used solely by a standalone
// prototype-validation script, never imported by any customer-facing
// file).
exports._internal = {
  classifyRB, classifyWRsForTeam, classifyTE, classifyQBsForTeam,
  classifyOffensiveStyleForTeam, classifyCareerProfile, buildTeamAggregates,
  buildPlayerAggregates, avg
};

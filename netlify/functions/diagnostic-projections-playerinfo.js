// netlify/functions/diagnostic-projections-playerinfo.js
//
// ONE-TIME DIAGNOSTIC — not scheduled, run manually via Netlify UI ("Run now")
// or by hitting the deployed endpoint URL directly in a browser.
// Purpose: settle the open questions from the Aug 15 2026 Oracle Verdict
// opportunity-data investigation before scoping any real feature work —
// same "verify live before committing" discipline already used for
// diagnostic-box-score.js and diagnostic-games-for-week.js.
//
// WHAT WE DON'T KNOW YET (never called anywhere in this codebase before
// tonight — confirmed via full-repo grep, not assumed):
//   1. Does getFantasyPointProjections exist on this Tank01 product, and
//      if so, what params does it need (playerID? season? week? explicit
//      scoring weights to get fantasyPoints calculated)? Does it return
//      projected rushAttempts/rushYards/rushTD, targets, receptions,
//      recYards/recTD, fantasyPoints, and/or games/projected games?
//   2. Does getNFLPlayerInfo exist and accept a playerName param directly
//      (avoiding a separate ID-lookup call), or does it require a
//      playerID resolved some other way first?
//   3. What is the exact shape of the "Rushing" sub-object inside a real
//      getNFLBoxScore player stat line? refresh-risers-fallers.js only
//      ever reads the sibling "Receiving" object — Rushing has never
//      once been logged in this repo.
//
// STRATEGY — same "try multiple likely shapes in one run" discipline as
// diagnostic-games-for-week.js (which tried week/season AND
// gameWeek/season in a single deploy rather than guessing and wasting a
// second round trip): this file tries several reasonable parameter
// combinations for each unverified endpoint and logs every attempt's
// raw response separately, labeled clearly, so whichever shape is
// actually correct is settled by reading the logs once, not by a
// second diagnostic deploy.
//
// PLAYER ID RESOLUTION: we do not have real Tank01 playerIDs for Bijan
// Robinson, Jahmyr Gibbs, or Ja'Marr Chase anywhere in this repo (this
// app has always worked name-based, via getNFLADP/getNFLTeamRoster,
// never by hardcoded ID). Step 1 below tries getNFLPlayerInfo with a
// playerName query param directly for each of the 3 names FIRST (the
// cheapest path, if Tank01 supports it) — the response, if any, should
// also reveal each player's playerID for use in later steps. If that
// comes back empty for a given player, this also tries getNFLPlayerList
// (no params) as a fallback ID-resolution path and filters by name
// locally, mirroring refresh-player-data.js's "fetch the real list live
// rather than hardcode/assume" discipline for team abbreviations.
//
// SCOPE: diagnostic only. Builds NO cache, NO scheduled job, NO client
// fetch, NO Oracle/verdict logic. Draft Command Center is completely
// untouched by this file's existence — nothing calls it automatically.
//
// After running, check Netlify → Functions → diagnostic-projections-playerinfo
// → logs for the labeled blocks below, or read the JSON response body
// directly (same as the other two diagnostics in this repo).

const TANK01_HOST = 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';

// Same known-good test game diagnostic-box-score.js already confirmed
// works (2025 Week 1, Cowboys @ Eagles) — reused here specifically to
// re-inspect the Rushing sub-object, which that earlier diagnostic run
// never logged (it only needed to confirm the endpoint worked at all).
const TEST_GAME_ID = '20250904_DAL@PHI';

const TARGET_PLAYERS = ['Bijan Robinson', 'Jahmyr Gibbs', "Ja'Marr Chase"];

async function tank01Fetch(label, endpoint, params) {
  const queryString = new URLSearchParams(params || {}).toString();
  const url = `https://${TANK01_HOST}/${endpoint}${queryString ? '?' + queryString : ''}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': TANK01_HOST,
        'x-rapidapi-key': process.env.TANK01_API_KEY,
      },
    });

    const status = response.status;
    let data = null;
    let parseError = null;
    try {
      data = await response.json();
    } catch (e) {
      parseError = e.message;
    }

    console.log(
      `PROJECTIONS/PLAYERINFO DIAGNOSTIC — ${label}:`,
      JSON.stringify({ url, status, params, data, parseError }, null, 2)
    );

    return { label, endpoint, params, status, ok: response.ok, data, parseError };
  } catch (err) {
    console.error(`PROJECTIONS/PLAYERINFO DIAGNOSTIC — ${label} EXCEPTION:`, err.message);
    return { label, endpoint, params, error: err.message };
  }
}

exports.handler = async function (event, context) {
  const apiKey = process.env.TANK01_API_KEY;

  if (!apiKey) {
    const msg = 'DIAGNOSTIC FAILED: TANK01_API_KEY environment variable not found.';
    console.error(msg);
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }

  const results = {
    playerInfoByName: {},
    playerListFallback: null,
    fantasyProjections: {},
    boxScoreRushingCheck: null,
  };

  // ── STEP 1: try getNFLPlayerInfo with a direct playerName param for
  // each target player. If Tank01 supports this, the response should
  // also reveal each player's real playerID for use in Step 2. ──────
  for (const name of TARGET_PLAYERS) {
    results.playerInfoByName[name] = await tank01Fetch(
      `Step 1 — getNFLPlayerInfo(playerName="${name}")`,
      'getNFLPlayerInfo',
      { playerName: name }
    );
  }

  const namesStillUnresolved = TARGET_PLAYERS.filter((name) => {
    const r = results.playerInfoByName[name];
    return !r || !r.ok || !r.data || !r.data.body || (Array.isArray(r.data.body) && r.data.body.length === 0);
  });

  // ── STEP 1b (fallback): if playerName lookup didn't clearly work for
  // one or more players, try the full player list and filter locally —
  // same "fetch the real list live" discipline as refresh-player-data.js
  // used for team abbreviations, rather than assuming a param name. ──
  if (namesStillUnresolved.length > 0) {
    results.playerListFallback = await tank01Fetch(
      'Step 1b — getNFLPlayerList (fallback ID resolution)',
      'getNFLPlayerList',
      {}
    );
  }

  // Try to extract playerIDs from whichever of Step 1 / Step 1b actually
  // worked, so Step 2 can call getFantasyPointProjections with a real ID
  // instead of guessing one.
  const resolvedIDs = {};
  TARGET_PLAYERS.forEach((name) => {
    const infoResult = results.playerInfoByName[name];
    const infoBody = infoResult && infoResult.data && infoResult.data.body;
    let id = null;
    if (Array.isArray(infoBody) && infoBody[0] && infoBody[0].playerID) {
      id = infoBody[0].playerID;
    } else if (infoBody && !Array.isArray(infoBody) && infoBody.playerID) {
      id = infoBody.playerID;
    }
    if (!id && results.playerListFallback && results.playerListFallback.data) {
      const listBody = results.playerListFallback.data.body;
      if (Array.isArray(listBody)) {
        const match = listBody.find(
          (p) => (p.longName || '').toLowerCase() === name.toLowerCase()
        );
        if (match) id = match.playerID;
      }
    }
    resolvedIDs[name] = id;
  });

  // ── STEP 2: getFantasyPointProjections. Param shape is completely
  // unverified, so try several reasonable combinations per player and
  // log each distinctly — same multi-attempt discipline as Step 1. ──
  for (const name of TARGET_PLAYERS) {
    const playerID = resolvedIDs[name];
    results.fantasyProjections[name] = {
      resolvedPlayerID: playerID,
      attempts: [],
    };

    if (playerID) {
      results.fantasyProjections[name].attempts.push(
        await tank01Fetch(
          `Step 2a — getFantasyPointProjections(playerID="${playerID}", season=2026) for ${name}`,
          'getFantasyPointProjections',
          { playerID: playerID, season: '2026' }
        )
      );
      results.fantasyProjections[name].attempts.push(
        await tank01Fetch(
          `Step 2b — getFantasyPointProjections(playerID="${playerID}", season=2026, week=1) for ${name}`,
          'getFantasyPointProjections',
          { playerID: playerID, season: '2026', week: '1' }
        )
      );
    } else {
      console.log(`Step 2 skipped ID-specific attempts for ${name}: no playerID resolved in Step 1/1b.`);
    }
  }

  // Also try ONE no-playerID, no-week call (season totals across the
  // whole league, if this endpoint works that way like getNFLADP does)
  // — only needs to run once, not per player.
  results.fantasyProjections._leagueWideAttempt = await tank01Fetch(
    'Step 2c — getFantasyPointProjections(season=2026) — no playerID/week, checking for a full-league dump',
    'getFantasyPointProjections',
    { season: '2026' }
  );

  // ── STEP 3: re-confirm getNFLBoxScore's Rushing shape using the same
  // known-good test game already proven to work. Logs EVERY player in
  // that box score who has a Rushing object (our 3 target players were
  // very likely not in this specific 2025 game, so this settles the
  // Rushing field shape in general, not for these 3 specifically). ──
  const boxScoreResult = await tank01Fetch(
    `Step 3 — getNFLBoxScore(gameID="${TEST_GAME_ID}") — re-checking for Rushing shape`,
    'getNFLBoxScore',
    { gameID: TEST_GAME_ID }
  );

  let rushingSamples = [];
  const playerStats = boxScoreResult.data && boxScoreResult.data.body && boxScoreResult.data.body.playerStats;
  if (playerStats && typeof playerStats === 'object') {
    Object.values(playerStats).forEach((p) => {
      if (p && p.Rushing) {
        rushingSamples.push({
          longName: p.longName,
          playerID: p.playerID,
          Rushing: p.Rushing,
        });
      }
    });
  }
  console.log(
    'PROJECTIONS/PLAYERINFO DIAGNOSTIC — Step 3 Rushing samples found:',
    JSON.stringify(rushingSamples, null, 2)
  );
  results.boxScoreRushingCheck = {
    gameID: TEST_GAME_ID,
    playerCount: playerStats ? Object.keys(playerStats).length : 0,
    rushingSampleCount: rushingSamples.length,
    rushingSamples: rushingSamples,
  };

  console.log(
    'PROJECTIONS/PLAYERINFO DIAGNOSTIC — SUMMARY:',
    JSON.stringify(
      {
        resolvedIDs,
        playerInfoOk: TARGET_PLAYERS.map((n) => ({ name: n, ok: results.playerInfoByName[n] && results.playerInfoByName[n].ok })),
        rushingSampleCount: rushingSamples.length,
      },
      null,
      2
    )
  );

  return {
    statusCode: 200,
    body: JSON.stringify(results, null, 2),
  };
};

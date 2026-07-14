// netlify/functions/diagnostic-games-for-week.js
//
// ONE-TIME DIAGNOSTIC — not scheduled, run manually via Netlify UI ("Run now")
// or by hitting the deployed endpoint URL directly in a browser.
// Purpose: settle the schedule-lookup question for Feature Idea #131
// (Risers & Fallers) before building the real aggregation function —
// same "verify live before committing" discipline already used for
// diagnostic-box-score.js and refresh-player-data.js's live team list.
//
// WHAT WE DON'T KNOW YET (confirmed via Tank01's own docs that the
// endpoint exists, but not its exact parameter names or response shape):
//   1. Does getNFLGamesForWeek take separate `week` + `season` params,
//      or a combined param? Tank01's other endpoints are inconsistent
//      about this (getNFLADP takes `season` alone; getNFLTeamRoster
//      takes `teamAbv`/`teamID`) — no reason to assume this one
//      matches either pattern without checking.
//   2. Does each returned game object give us a `gameID` in EXACTLY
//      the same format getNFLBoxScore expects (e.g. "20250904_DAL@PHI"),
//      or some other shape that needs translating first?
//   3. Does it return completed 2025 games the same way it will
//      return upcoming 2026 games, so this is testable NOW against
//      real historical data (same idea as the box score diagnostic
//      testing against a real 2025 game) rather than waiting for the
//      season to start?
//
// TEST TARGET: 2025 Week 1 (should return a full slate of real,
// completed games we can cross-check by eye against known results).
//
// TRYING BOTH LIKELY PARAM SHAPES: rather than guess one and possibly
// waste a diagnostic run on a wrong guess, this fires both a
// `week`+`season` call AND a `gameWeek`+`season` call in the same
// run, logs both raw responses separately, and reports which one (if
// either) actually returned a real game list. Whichever shape works
// is what the real aggregation function should use — no guessing
// required once this run's logs are read.
//
// After running, check Netlify → Functions → diagnostic-games-for-week
// → logs for:
//   "GAMES-FOR-WEEK DIAGNOSTIC — attempt A (week/season)"
//   "GAMES-FOR-WEEK DIAGNOSTIC — attempt B (gameWeek/season)"
// The browser tab hitting the endpoint directly will also show the
// same JSON as the HTTP response body, with both attempts side by side.

const TANK01_HOST = 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';
const TEST_WEEK = '1';
const TEST_SEASON = '2025';

async function tryFetch(label, params) {
  const queryString = new URLSearchParams(params).toString();
  const url = `https://${TANK01_HOST}/getNFLGamesForWeek?${queryString}`;

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
      `GAMES-FOR-WEEK DIAGNOSTIC — ${label}:`,
      JSON.stringify({ url, status, params, data, parseError }, null, 2)
    );

    // Try to isolate whether this attempt returned a real, non-empty
    // list of games, and if so, grab one sample game object plus the
    // exact key name the game list lived under (varies by Tank01
    // endpoint — sometimes body IS the array, sometimes it's nested
    // under a named key like body.games or body.body).
    let sampleGame = null;
    let gameListKey = 'not found';
    let gameCount = 0;

    const body = data && data.body !== undefined ? data.body : data;

    if (Array.isArray(body)) {
      gameListKey = 'body (direct array)';
      gameCount = body.length;
      sampleGame = body[0] || null;
    } else if (body && typeof body === 'object') {
      const arrayKey = Object.keys(body).find((k) => Array.isArray(body[k]));
      if (arrayKey) {
        gameListKey = `body.${arrayKey}`;
        gameCount = body[arrayKey].length;
        sampleGame = body[arrayKey][0] || null;
      }
    }

    return { label, status, ok: response.ok, gameListKey, gameCount, sampleGame, rawBody: body };
  } catch (err) {
    console.error(`GAMES-FOR-WEEK DIAGNOSTIC — ${label} EXCEPTION:`, err.message);
    return { label, error: err.message };
  }
}

exports.handler = async function (event, context) {
  const apiKey = process.env.TANK01_API_KEY;

  if (!apiKey) {
    const msg = 'DIAGNOSTIC FAILED: TANK01_API_KEY environment variable not found.';
    console.error(msg);
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }

  // Attempt A: week + season (matches the plain-English param names
  // most fantasy APIs of this shape tend to use)
  const attemptA = await tryFetch('attempt A (week/season)', {
    week: TEST_WEEK,
    season: TEST_SEASON,
  });

  // Attempt B: gameWeek + season (Tank01 uses non-obvious param names
  // elsewhere — e.g. getNFLTeamRoster wants teamAbv, not team — so a
  // second likely name is worth testing in the same run rather than
  // burning a separate diagnostic deploy if attempt A comes back empty)
  const attemptB = await tryFetch('attempt B (gameWeek/season)', {
    gameWeek: TEST_WEEK,
    season: TEST_SEASON,
  });

  console.log(
    'GAMES-FOR-WEEK DIAGNOSTIC — SUMMARY:',
    JSON.stringify(
      {
        attemptA: { ok: attemptA.ok, gameCount: attemptA.gameCount, gameListKey: attemptA.gameListKey },
        attemptB: { ok: attemptB.ok, gameCount: attemptB.gameCount, gameListKey: attemptB.gameListKey },
      },
      null,
      2
    )
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ attemptA, attemptB }, null, 2),
  };
};

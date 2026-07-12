// netlify/functions/diagnostic-box-score.js
//
// ONE-TIME DIAGNOSTIC — not scheduled, run manually via Netlify UI ("Run now")
// or by hitting the deployed endpoint URL directly in a browser.
// Purpose: settle two open questions before scoping Feature Ideas #131/#132:
//   1. Does getNFLBoxScore work for historical/completed games, or only current season?
//   2. Does it return only basic counting stats, or NGS-style data (air yards,
//      target share %, snap %)?
//
// Test target: Week 1 2025, Cowboys @ Eagles, gameID '20250904_DAL@PHI'
//
// HOST FIX (v2): first version used the wrong RapidAPI host
// (tank01-fantasy-stats.p.rapidapi.com), which 404'd with "Endpoint
// '/getNFLBoxScore' does not exist" — the key and connection were fine,
// just the wrong product host. Corrected to match the host already
// proven working in refresh-player-data.js:
// tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com
//
// After running, check Netlify → Functions → diagnostic-box-score → logs for:
//   "BOX SCORE DIAGNOSTIC — getNFLBoxScore(...)"  (full raw response)
//   "BOX SCORE DIAGNOSTIC — single player sample"  (one isolated stat line)
// The browser tab hitting the endpoint directly will also show the same
// JSON as the HTTP response body.

const TANK01_HOST = 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';
const TEST_GAME_ID = '20250904_DAL@PHI';

exports.handler = async function (event, context) {
  const apiKey = process.env.TANK01_API_KEY;

  if (!apiKey) {
    const msg = 'DIAGNOSTIC FAILED: TANK01_API_KEY environment variable not found.';
    console.error(msg);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: msg }),
    };
  }

  const url = `https://${TANK01_HOST}/getNFLBoxScore?gameID=${encodeURIComponent(TEST_GAME_ID)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': TANK01_HOST,
        'x-rapidapi-key': apiKey,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(
        `BOX SCORE DIAGNOSTIC — HTTP ERROR: ${response.status} ${response.statusText}`,
        errText
      );
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: `Tank01 returned ${response.status}`,
          detail: errText,
        }),
      };
    }

    const data = await response.json();

    // Log #1: full raw response, exactly as Tank01 returns it
    console.log(
      `BOX SCORE DIAGNOSTIC — getNFLBoxScore(${TEST_GAME_ID}):`,
      JSON.stringify(data, null, 2)
    );

    // Try to isolate a single player's stat line for easy inspection.
    // Tank01's shape can vary by endpoint, so we probe a few likely
    // locations rather than assuming one structure.
    let samplePlayer = null;
    let sampleSource = 'not found';

    const body = data && data.body ? data.body : data;

    if (body) {
      // Common Tank01 pattern: body.playerStats is a keyed object { playerID: {...} }
      if (body.playerStats && typeof body.playerStats === 'object') {
        const firstKey = Object.keys(body.playerStats)[0];
        if (firstKey) {
          samplePlayer = body.playerStats[firstKey];
          sampleSource = `body.playerStats["${firstKey}"]`;
        }
      }
      // Fallback pattern: body is itself a keyed object of player stat lines
      else if (!samplePlayer && typeof body === 'object') {
        const candidateKey = Object.keys(body).find(
          (k) => body[k] && typeof body[k] === 'object' && !Array.isArray(body[k])
        );
        if (candidateKey) {
          samplePlayer = body[candidateKey];
          sampleSource = `body["${candidateKey}"]`;
        }
      }
    }

    // Log #2: the isolated single-player sample
    console.log(
      'BOX SCORE DIAGNOSTIC — single player sample:',
      `(source: ${sampleSource})`,
      JSON.stringify(samplePlayer, null, 2)
    );

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          gameID: TEST_GAME_ID,
          fullResponse: data,
          samplePlayer,
          sampleSource,
        },
        null,
        2
      ),
    };
  } catch (err) {
    console.error('BOX SCORE DIAGNOSTIC — EXCEPTION:', err.message, err.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

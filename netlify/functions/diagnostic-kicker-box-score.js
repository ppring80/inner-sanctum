// netlify/functions/diagnostic-kicker-box-score.js
//
// ONE-TIME DIAGNOSTIC — not scheduled, run manually via Netlify UI ("Run now")
// or by hitting the deployed endpoint URL directly in a browser.
//
// Purpose: settle the open question before scoping Weekly SAGE K --
// does getNFLBoxScore expose kicker-specific statistics (field goals
// made/attempted, extra points made/attempted, distance information,
// longest FG, kicking fantasy points), and if so, under what exact
// field names? Same "verify live before committing" discipline
// already used for diagnostic-box-score.js and
// diagnostic-games-for-week.js -- this does NOT assume a "Kicking"
// stat block or any specific FG/XP field name exists. It scans every
// player's stat object in the box score for keys that plausibly
// relate to kicking and reports exactly what it finds, with no
// pre-filled guesses.
//
// TEST TARGET: same default game already proven working in
// diagnostic-box-score.js -- Week 1 2025, Cowboys @ Eagles,
// gameID '20250904_DAL@PHI'. Override via ?gameID=... to inspect any
// other completed game (e.g. a game you know had notable kicking
// activity).
//
// USAGE:
//   /.netlify/functions/diagnostic-kicker-box-score
//   /.netlify/functions/diagnostic-kicker-box-score?gameID=20250907_KC@LAC
//
// SCOPE: this file makes exactly ONE Tank01 call (getNFLBoxScore) per
// invocation -- no follow-up endpoint is queried, per the "use the
// minimum number of Tank01 calls necessary" instruction. It also does
// not dump the entire raw box score by default (that response can be
// large) -- only the per-player key summary and any kicker-looking
// player's full stat line are returned, to keep this narrow. Set
// ?full=true to also include the complete raw response for deeper
// inspection if the summary isn't enough.
//
// After running, check Netlify → Functions → diagnostic-kicker-box-score
// → logs for:
//   "KICKER DIAGNOSTIC — getNFLBoxScore(...)"           (full raw response)
//   "KICKER DIAGNOSTIC — per-player stat-block summary"  (every player's
//                                                          top-level stat
//                                                          category names)
//   "KICKER DIAGNOSTIC — kicker-looking player(s) found" (full stat line
//                                                          for any player
//                                                          whose keys hint
//                                                          at kicking)
// The browser tab hitting the endpoint directly will also show the
// same JSON as the HTTP response body.
//
// This file does NOT modify, call, or depend on any Weekly SAGE
// function, does NOT write to any Blob store, and is not referenced
// anywhere in netlify.toml -- purely additive, manually invoked only.

const TANK01_HOST = 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';
const DEFAULT_GAME_ID = '20250904_DAL@PHI';

// Pure heuristic, applied only to KEY NAMES (never to guessed values) --
// this is deliberately broad so it can't miss an unexpected naming
// convention. It does not assume any of these actually exist; it only
// flags a key as "worth a human's attention" if it matches.
const KICKING_KEY_PATTERN = /kick|field.?goal|\bfg\b|\bxp\b|extra.?point|\blongest\b|\bfgm\b|\bfga\b|\bxpm\b|\bxpa\b/i;

function findKickingLikeKeys(statObject) {
  if (!statObject || typeof statObject !== 'object') {
    return [];
  }
  return Object.keys(statObject).filter((key) => KICKING_KEY_PATTERN.test(key));
}

// Locate the per-player stat collection within the box score response.
// Tank01's shape varies by endpoint (confirmed already in
// diagnostic-box-score.js), so this probes the same candidate
// locations rather than assuming one structure.
function extractPlayerStats(body) {
  if (!body || typeof body !== 'object') {
    return { players: {}, source: 'not found' };
  }

  if (body.playerStats && typeof body.playerStats === 'object') {
    return { players: body.playerStats, source: 'body.playerStats' };
  }

  // Fallback: body itself may be a keyed object of player stat lines.
  const candidateEntries = Object.entries(body).filter(
    ([, value]) => value && typeof value === 'object' && !Array.isArray(value)
  );

  if (candidateEntries.length > 0) {
    return { players: Object.fromEntries(candidateEntries), source: 'body (direct keyed object)' };
  }

  return { players: {}, source: 'not found' };
}

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

  const query = (event && event.queryStringParameters) || {};
  const gameID = query.gameID ? String(query.gameID) : DEFAULT_GAME_ID;
  const includeFullResponse = String(query.full || '').toLowerCase() === 'true';

  const url = `https://${TANK01_HOST}/getNFLBoxScore?gameID=${encodeURIComponent(gameID)}`;

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
        `KICKER DIAGNOSTIC — HTTP ERROR: ${response.status} ${response.statusText}`,
        errText
      );
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: `Tank01 returned ${response.status}`,
          detail: errText,
          gameID,
        }),
      };
    }

    const data = await response.json();

    // Log #1: full raw response, exactly as Tank01 returns it.
    console.log(
      `KICKER DIAGNOSTIC — getNFLBoxScore(${gameID}):`,
      JSON.stringify(data, null, 2)
    );

    const body = data && data.body ? data.body : data;
    const { players, source } = extractPlayerStats(body);
    const playerIDs = Object.keys(players);

    // Summary: for every player, just the top-level stat-block key
    // names (e.g. "Rushing", "Receiving", "Passing", "snapCounts") --
    // this alone reveals whether anything kicking-related exists
    // under ANY name, without dumping every player's full stat line.
    const perPlayerKeySummary = playerIDs.map((id) => ({
      playerID: id,
      longName: players[id] && players[id].longName ? players[id].longName : null,
      team: players[id] && (players[id].teamAbv || players[id].team) ? (players[id].teamAbv || players[id].team) : null,
      statBlockKeys: Object.keys(players[id] || {}),
    }));

    console.log(
      'KICKER DIAGNOSTIC — per-player stat-block summary:',
      `(source: ${source}, ${playerIDs.length} player(s) found)`,
      JSON.stringify(perPlayerKeySummary, null, 2)
    );

    // Scan every player for any key that plausibly relates to kicking,
    // at any nesting level one deep (covers both a flat field like
    // "fgMade" directly on the player, and a nested block like
    // player.Kicking.fgMade).
    const kickingCandidates = [];

    playerIDs.forEach((id) => {
      const player = players[id] || {};
      const topLevelHits = findKickingLikeKeys(player);

      let nestedHits = [];
      Object.entries(player).forEach(([key, value]) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const inner = findKickingLikeKeys(value);
          if (inner.length > 0) {
            nestedHits.push({ block: key, keys: inner });
          }
        }
      });

      if (topLevelHits.length > 0 || nestedHits.length > 0) {
        kickingCandidates.push({
          playerID: id,
          longName: player.longName || null,
          team: player.teamAbv || player.team || null,
          topLevelHits,
          nestedHits,
          fullStatLine: player,
        });
      }
    });

    console.log(
      'KICKER DIAGNOSTIC — kicker-looking player(s) found:',
      kickingCandidates.length,
      JSON.stringify(kickingCandidates, null, 2)
    );

    // Game-level context (final score, teams) is usually present at
    // the top of the box score body regardless of per-player detail --
    // surfaced here since it's a plausible team-scoring-environment
    // signal for K, without assuming any specific field name is the
    // "right" one. Reported as-is, whatever keys actually exist.
    const gameLevelKeys = body && typeof body === 'object' ? Object.keys(body) : [];

    const result = {
      gameID,
      tank01CallsMade: 1,
      playerStatsSource: source,
      totalPlayersInBoxScore: playerIDs.length,
      gameLevelKeys,
      perPlayerKeySummary,
      kickingLikeKeysFound: kickingCandidates.length > 0,
      kickingCandidates,
    };

    if (includeFullResponse) {
      result.fullResponse = data;
    }

    return {
      statusCode: 200,
      body: JSON.stringify(result, null, 2),
    };
  } catch (err) {
    console.error('KICKER DIAGNOSTIC — EXCEPTION:', err.message, err.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

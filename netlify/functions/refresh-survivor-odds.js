"use strict";
const { connectLambda, getStore } = require("@netlify/blobs");
const { isNetlifyScheduledInvocation, requireTank01RefreshAuthorization } = require("./_tank01-refresh-guard.js");
const { requireTank01Budget } = require("./_tank01-daily-budget.js");
const HOST = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";
const MAX_TANK01_CALLS_PER_RUN = 8;

function json(statusCode, body) { return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) }; }
function currentWeek(now = new Date()) {
  const week2 = new Date("2026-09-15T00:00:00Z");
  return now < week2 ? 1 : Math.max(1, Math.min(18, Math.floor((now - week2) / 604800000) + 2));
}
async function tank01Fetch(endpoint, params) {
  const response = await fetch(`https://${HOST}/${endpoint}?${new URLSearchParams(params)}`, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": process.env.TANK01_API_KEY } });
  if (!response.ok) throw new Error(`Tank01 ${endpoint} failed: ${response.status}`);
  return response.json();
}
function numberFrom(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== null && value !== undefined && value !== "") {
      const n = Number(String(value).replace(/[−–—]/g, "-").replace(/[^0-9.+-]/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
function implied(ml) { return !Number.isFinite(ml) ? null : ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100); }
function normalCdf(value) {
  const sign = value < 0 ? -1 : 1, x = Math.abs(value) / Math.sqrt(2), t = 1 / (1 + 0.3275911 * x);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}
function probabilities(book) {
  const away = implied(numberFrom(book, ["awayTeamMLOdds", "awayTeamMoneyLine", "awayMoneyline", "awayML"]));
  const home = implied(numberFrom(book, ["homeTeamMLOdds", "homeTeamMoneyLine", "homeMoneyline", "homeML"]));
  if (away !== null && home !== null && away + home > 0) return { away: away / (away + home), home: home / (away + home), method: "moneyline-devigged" };
  const hs = numberFrom(book, ["homeTeamSpread", "homeSpread"]), as = numberFrom(book, ["awayTeamSpread", "awaySpread"]);
  const spread = hs !== null ? hs : as !== null ? -as : null;
  if (spread === null) return { away: null, home: null, method: null };
  const homeProbability = normalCdf(-spread / 13.86);
  return { away: 1 - homeProbability, home: homeProbability, method: "spread-estimate" };
}
function selectBook(odds) {
  const meta = new Set(["awayTeam", "homeTeam", "gameDate", "gameID", "teamIDAway", "teamIDHome", "last_updated_e_time"]);
  const entries = Object.entries(odds || {}).filter(([key, value]) => !meta.has(key) && value && typeof value === "object");
  const byName = Object.fromEntries(entries);
  const name = ["draftkings", "fanduel", "betmgm", "caesars"].find((candidate) => byName[candidate]) || entries[0]?.[0];
  return name ? { name, book: byName[name] || entries[0][1] } : null;
}
function mergeGames(games, oddsByGameId) {
  return games.map((game) => {
    const gameID = game.gameID || `${game.away}@${game.home}_${game.gameDate}`;
    const selected = selectBook(oddsByGameId[gameID]);
    const p = selected ? probabilities(selected.book) : { away: null, home: null, method: null };
    return { gameID, gameDate: game.gameDate || null, gameTime: game.gameTime || null, away: game.away || null, home: game.home || null,
      awayWinPct: p.away === null ? null : Math.round(p.away * 1000) / 10, homeWinPct: p.home === null ? null : Math.round(p.home * 1000) / 10,
      probabilityMethod: p.method, spread: selected ? numberFrom(selected.book, ["homeTeamSpread", "awayTeamSpread", "homeSpread", "awaySpread"]) : null,
      sportsbook: selected?.name || null, oddsFound: Boolean(selected) };
  });
}

exports.handler = async function (event = {}) {
  connectLambda(event);
  if (!isNetlifyScheduledInvocation(event) && event.httpMethod && event.httpMethod !== "GET") return json(405, { error: "Method not allowed." });
  const authError = requireTank01RefreshAuthorization(event); if (authError) return authError;
  const budgetError = await requireTank01Budget(event, { job: "refresh-survivor-odds", calls: MAX_TANK01_CALLS_PER_RUN }); if (budgetError) return budgetError;
  if (!process.env.TANK01_API_KEY) return json(500, { error: "TANK01_API_KEY is not configured." });
  const query = event.queryStringParameters || {}, week = query.week ? Number(query.week) : currentWeek();
  const season = String(query.season || new Date().getUTCFullYear()), seasonType = String(query.seasonType || "reg").toLowerCase();
  if (!Number.isInteger(week) || week < 1 || week > 18 || !/^[0-9]{4}$/.test(season) || !["reg", "post"].includes(seasonType)) return json(400, { error: "Invalid season, week, or seasonType." });
  try {
    const schedule = await tank01Fetch("getNFLGamesForWeek", { week, season, seasonType });
    const games = Array.isArray(schedule?.body) ? schedule.body : [];
    if (!games.length) return json(422, { cached: false, error: "No games returned; existing snapshot retained." });
    const dates = [...new Set(games.map((g) => g.gameDate).filter(Boolean))];
    if (1 + dates.length > MAX_TANK01_CALLS_PER_RUN) return json(422, { cached: false, error: "Tank01 call ceiling exceeded; existing snapshot retained." });
    const oddsByGameId = {}; let calls = 1;
    for (const gameDate of dates) { const odds = await tank01Fetch("getNFLBettingOdds", { gameDate }); calls += 1; if (odds?.body && typeof odds.body === "object") Object.assign(oddsByGameId, odds.body); }
    const merged = mergeGames(games, oddsByGameId);
    if (!merged.some((g) => g.spread !== null || g.homeWinPct !== null)) return json(422, { cached: false, error: "No usable odds; existing snapshot retained." });
    const snapshot = { status: "Success", evidenceType: "survivor-odds-snapshot", generatedAt: new Date().toISOString(), week: String(week), season, seasonType, tank01Calls: calls, games: merged };
    const key = `week:${season}:${week}:${seasonType}`; await getStore({ name: "survivor-odds" }).setJSON(key, snapshot);
    return json(200, { cached: true, key, games: merged.length, tank01Calls: calls, maxTank01CallsPerRun: MAX_TANK01_CALLS_PER_RUN, generatedAt: snapshot.generatedAt });
  } catch (error) { return json(502, { cached: false, error: "Survivor refresh failed; existing snapshot retained.", detail: error.message }); }
};
exports.numberFrom = numberFrom; exports.probabilities = probabilities; exports.mergeGames = mergeGames; exports.MAX_TANK01_CALLS_PER_RUN = MAX_TANK01_CALLS_PER_RUN;
// Scheduling remains disabled until the measured multi-day production plan is approved.

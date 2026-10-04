"use strict";

// netlify/functions/super-sage-pregame-ledger-snapshot.js
//
// SCHEDULED (netlify.toml: "30 11,14,16,19,23 * * *" UTC). Preserves
// immutable PREGAME evidence snapshots in Blob store "super-sage-pregame-ledger"
// so future calibration has temporally valid history. Builds no decisions,
// calibrates nothing.
//
// Cadence is driven by the REAL schedule, not by day-of-week assumptions:
// each run reads only caches (ZERO Tank01 calls) and writes only when
//   (a) no entry exists yet for this season/week/scoring (weekly baseline), or
//   (b) the next not-yet-started kickoff is within WINDOW_HOURS.
// The five daily checks catch international (09:30 ET), Thursday, Saturday,
// Sunday early/late, Sunday night and Monday kickoffs under both EDT and EST.
//
// Safety:
//   * only players whose game has NOT kicked off (and whose kickoff is known)
//     are written; everyone else is listed in excludedPlayers;
//   * the entry's firstKickoff is the earliest included kickoff and the
//     builder refuses any entry generated at/after it;
//   * writes are onlyIfNew (never overwrite); entries are hash-verified;
//   * no outcome data; this function never throws, and nothing on the
//     customer path depends on it.

const { connectLambda, getStore } = require("@netlify/blobs");
const { resolveCurrentNFLWeek } = require("./_current-nfl-week.js");
const { readCachedWeeklySchedule } = require("./_weekly-sage-schedule-cache.js");
const { buildKickoffIndex, decisionCutoff, teamKickoffState } = require("./_super-sage-kickoff.js");
const { loadObservedOpportunity } = require("./_super-sage-opportunity-evidence.js");
const { buildPregameLedgerEntry, writePregameLedgerEntry, LEDGER_STORE_NAME } = require("./_super-sage-pregame-ledger.js");

const SCORINGS = ["half", "ppr", "standard"];
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const WINDOW_HOURS = 4;
const TEAMS = 12;

const rowTeam = (row, pos) => String((pos === "DEF" ? (row.team || row.name) : row.team) || "").toUpperCase();
const markerKey = (season, week, scoring) => `marker/${season}/w${String(week).padStart(2, "0")}/${scoring}`;

function rankingsUrl(baseUrl, season, week, scoring) {
  const params = new URLSearchParams({ season: String(season), week: String(week), seasonType: "reg", scoring, teams: String(TEAMS) });
  return `${baseUrl}/.netlify/functions/weekly-sage-rankings?${params.toString()}`;
}

// Keep only players whose game is known and not yet kicked off.
function pregameOnly(rankings, index, now) {
  const excluded = [];
  const kickoffs = [];
  const positions = {};
  POSITIONS.forEach((pos) => {
    positions[pos] = (rankings.positions[pos] || []).filter((row) => {
      const k = teamKickoffState(index, rowTeam(row, pos), now);
      if (k.state === "PREGAME") { kickoffs.push(k.kickoff); return true; }
      excluded.push({ name: row.name, position: pos, team: rowTeam(row, pos),
        reason: k.state === "KICKED_OFF" ? `Game kicked off ${k.kickoff}.` : k.state === "UNKNOWN" ? `Kickoff not established${k.reason ? ` (${k.reason})` : ""}.` : "No game this week." });
      return false;
    });
  });
  kickoffs.sort();
  return { rankings: { ...rankings, positions }, excluded, firstKickoff: kickoffs[0] || null };
}

async function runSnapshot({ now = new Date(), baseUrl, fetchImpl = fetch, readSchedule = readCachedWeeklySchedule, ledgerStore, opportunityStore } = {}) {
  const summary = { generatedAt: now.toISOString(), written: [], skipped: [], errors: [] };
  const season = now.getUTCFullYear();
  const week = resolveCurrentNFLWeek(now, season);
  if (!week) { summary.skipped.push("No current regular-season week."); return summary; }
  summary.season = season; summary.week = week;

  let schedule;
  try { schedule = await readSchedule({ season, week, seasonType: "reg" }); }
  catch (error) { summary.skipped.push(`Schedule unavailable (${error.message}); no write without real kickoff truth.`); return summary; }
  const index = buildKickoffIndex(schedule, { season, week });
  if (!index.ok) { summary.skipped.push(`Schedule unusable: ${index.reason}`); return summary; }
  const pending = index.games.filter((g) => g.kickoff && Date.parse(g.kickoff) > now.getTime()).map((g) => g.kickoff).sort();
  if (!pending.length) { summary.skipped.push("No pregame games remain this week."); return summary; }
  const hoursToNext = (Date.parse(pending[0]) - now.getTime()) / 3600000;
  summary.nextKickoff = pending[0];
  const weekCutoff = decisionCutoff(index);

  for (const scoring of SCORINGS) {
    try {
      let hasBaseline = false;
      try { hasBaseline = Boolean(await ledgerStore.get(markerKey(season, week, scoring), { type: "json" })); } catch (error) { hasBaseline = false; }
      if (hasBaseline && hoursToNext > WINDOW_HOURS) { summary.skipped.push(`${scoring}: baseline exists and next kickoff is ${hoursToNext.toFixed(1)}h away.`); continue; }

      const response = await fetchImpl(rankingsUrl(baseUrl, season, week, scoring), { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Weekly SAGE responded ${response.status}`);
      const rankings = await response.json();
      if (!rankings || !rankings.positions) throw new Error("Weekly SAGE response has no positions");
      // The response must be the season/week/scoring requested; otherwise the
      // entry would be filed under the wrong format (fail closed, no write).
      if (String(rankings.scoring) !== scoring || String(rankings.season) !== String(season) || Number(rankings.targetWeek) !== Number(week)) {
        throw new Error(`Weekly SAGE returned ${rankings.season}/${rankings.targetWeek}/${rankings.scoring} for requested ${season}/${week}/${scoring}`);
      }

      const filtered = pregameOnly(rankings, index, now);
      if (!filtered.firstKickoff) { summary.skipped.push(`${scoring}: no pregame players.`); continue; }
      const opportunity = opportunityStore
        ? await loadObservedOpportunity({ season, week, store: opportunityStore, decisionCutoff: weekCutoff.ok ? weekCutoff.cutoff : null })
        : { status: "UNAVAILABLE", reason: "No opportunity store.", provenance: null, records: {} };
      const entry = buildPregameLedgerEntry({
        rankings: filtered.rankings, generatedAt: now.toISOString(), firstKickoff: filtered.firstKickoff, opportunity,
        kickoffFor: (row, pos) => teamKickoffState(index, rowTeam(row, pos), now).kickoff,
        excludedPlayers: filtered.excluded, kickoffSource: index.source
      });
      const result = await writePregameLedgerEntry(ledgerStore, entry);
      if (result.written) {
        summary.written.push({ scoring, key: result.key, players: entry.players.length, excluded: filtered.excluded.length });
        try { await ledgerStore.setJSON(markerKey(season, week, scoring), { firstEntryKey: result.key, at: entry.generatedAt }, { onlyIfNew: true }); } catch (error) { /* marker is advisory */ }
      } else summary.skipped.push(`${scoring}: ${result.reason}`);
    } catch (error) {
      summary.errors.push(`${scoring}: ${error.message}`);
    }
  }
  return summary;
}

exports.handler = async (event) => {
  try {
    try { connectLambda(event); } catch (error) { /* scheduled invocation without Lambda Blobs context */ }
    const summary = await runSnapshot({
      now: new Date(),
      baseUrl: process.env.URL || "https://theinnersanctum.xyz",
      ledgerStore: getStore({ name: LEDGER_STORE_NAME }),
      opportunityStore: (() => { try { return getStore({ name: "opportunity-intel" }); } catch (e) { return null; } })()
    });
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (error) {
    // Never throws: a ledger failure must not affect anything else.
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: error.message }) };
  }
};

exports._test = { runSnapshot, pregameOnly, markerKey, WINDOW_HOURS, SCORINGS };

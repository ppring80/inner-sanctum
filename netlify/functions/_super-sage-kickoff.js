"use strict";

// ═══════════════════════════════════════════════════════════════════════
// SUPER SAGE — REAL KICKOFF CUTOFFS
// ═══════════════════════════════════════════════════════════════════════
//
// Source: the cached Weekly SAGE schedule (Blob "weekly-sage-schedule",
// written by refresh-weekly-sage-schedule from Tank01 getNFLGamesForWeek).
// Reading it makes ZERO provider calls.
//
// Kickoff per game: gameTime_epoch when present; otherwise gameDate +
// gameTime interpreted in America/New_York (the provider's convention, also
// used by Weekly SAGE's own started-game exclusion). No day-of-week is
// assumed anywhere: Thursday, Saturday, international and Monday games all
// come from the data.
//
// Fail closed: a game whose kickoff cannot be established (missing time,
// postponed/suspended/TBD status) is UNKNOWN. A cutoff that depends on an
// UNKNOWN game is not returned; callers must treat that as "temporal safety
// not established".
// ═══════════════════════════════════════════════════════════════════════

const UNKNOWN_STATUS = /postpon|suspend|cancel|delay|tbd|to be determined/i;

function easternOffsetMinutes(utcMillis) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(new Date(utcMillis));
  const tz = (parts.find((p) => p.type === "timeZoneName") || {}).value || "GMT-5";
  const m = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  return m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] || 0) : -300;
}

// "YYYYMMDD" + "1:00p" / "8:15pm" / "13:00" in America/New_York -> ISO UTC.
function easternToIso(gameDate, gameTime) {
  const d = String(gameDate || "").replace(/\D/g, "");
  const t = String(gameTime || "").trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*([ap])?m?$/);
  if (d.length < 8 || !t) return null;
  let hour = Number(t[1]); const minute = Number(t[2]);
  if (hour > 23 || minute > 59) return null;
  if (t[3]) { hour %= 12; if (t[3] === "p") hour += 12; }
  const naive = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)), hour, minute);
  // Two-pass offset resolution handles DST transitions.
  let utc = naive - easternOffsetMinutes(naive) * 60000;
  utc = naive - easternOffsetMinutes(utc) * 60000;
  return new Date(utc).toISOString();
}

function kickoffForGame(game) {
  const status = game && game.gameStatus ? String(game.gameStatus) : null;
  if (status && UNKNOWN_STATUS.test(status)) return { kickoff: null, basis: null, reason: `Game status "${status}": kickoff not established.` };
  const epoch = Number(game && game.gameTime_epoch);
  // Tank01 reports seconds; some cached shapes carry milliseconds.
  if (Number.isFinite(epoch) && epoch > 0) return { kickoff: new Date(epoch > 1e12 ? epoch : epoch * 1000).toISOString(), basis: "gameTime_epoch", reason: null };
  const iso = easternToIso(game && game.gameDate, game && game.gameTime);
  if (iso) return { kickoff: iso, basis: "gameDate+gameTime America/New_York", reason: null };
  return { kickoff: null, basis: null, reason: "No kickoff time in the schedule." };
}

const teamOf = (t) => String((t && (t.abbreviation || t.team || t.code || t.teamAbv)) || t || "").trim().toUpperCase() || null;

/** Build a kickoff index from a cached Weekly SAGE schedule document. */
function buildKickoffIndex(schedule, { season, week } = {}) {
  if (!schedule || !Array.isArray(schedule.games)) return { ok: false, reason: "Schedule unavailable.", byTeam: {}, games: [], firstKickoff: null, unknownGames: [] };
  if (season != null && String(schedule.season) !== String(season)) return { ok: false, reason: `Schedule season ${schedule.season} does not match ${season}.`, byTeam: {}, games: [], firstKickoff: null, unknownGames: [] };
  const sw = schedule.targetWeek != null ? schedule.targetWeek : schedule.week;
  if (week != null && Number(sw) !== Number(week)) return { ok: false, reason: `Schedule week ${sw} does not match ${week}.`, byTeam: {}, games: [], firstKickoff: null, unknownGames: [] };
  if (!schedule.games.length) return { ok: false, reason: "Schedule has no games.", byTeam: {}, games: [], firstKickoff: null, unknownGames: [] };
  const byTeam = {};
  const games = schedule.games.map((g) => {
    const k = kickoffForGame(g);
    const teams = [teamOf(g.away), teamOf(g.home)].filter(Boolean);
    const out = { gameID: g.gameID || null, teams, kickoff: k.kickoff, basis: k.basis, status: g.gameStatus || null, reason: k.reason };
    teams.forEach((t) => { byTeam[t] = out; });
    return out;
  });
  const unknownGames = games.filter((g) => !g.kickoff);
  const known = games.filter((g) => g.kickoff).map((g) => g.kickoff).sort();
  return {
    ok: true,
    source: { store: "weekly-sage-schedule", season: String(schedule.season), week: Number(sw), generatedAt: schedule.generatedAt || null },
    byTeam, games, unknownGames,
    // The week's first kickoff is only established when no game is UNKNOWN
    // (an unknown game could be earlier).
    firstKickoff: unknownGames.length ? null : (known[0] || null),
    byeTeams: Array.isArray(schedule.byeTeams) ? schedule.byeTeams : []
  };
}

/**
 * Earliest kickoff that bounds a decision. With teams: the earliest kickoff
 * among those teams' games (a team with no game this week contributes none).
 * Without teams: the week's first kickoff. Fails closed on UNKNOWN games.
 */
function decisionCutoff(index, { teams = null } = {}) {
  if (!index || !index.ok) return { ok: false, reason: (index && index.reason) || "Schedule unavailable." };
  if (!teams) {
    if (index.unknownGames.length) return { ok: false, reason: `Kickoff unknown for ${index.unknownGames.map((g) => g.gameID).join(", ")}; the week's first kickoff cannot be established.` };
    return index.firstKickoff ? { ok: true, cutoff: index.firstKickoff, scope: "week" } : { ok: false, reason: "No kickoff times in the schedule." };
  }
  const relevant = [...new Set(teams.map((t) => String(t || "").toUpperCase()).filter(Boolean))].map((t) => ({ team: t, game: index.byTeam[t] || null }));
  const unknown = relevant.filter((r) => r.game && !r.game.kickoff);
  if (unknown.length) return { ok: false, reason: `Kickoff unknown for ${unknown.map((u) => `${u.team} (${u.game.reason})`).join(", ")}.` };
  const kickoffs = relevant.filter((r) => r.game).map((r) => r.game.kickoff).sort();
  return kickoffs.length ? { ok: true, cutoff: kickoffs[0], scope: "teams" } : { ok: false, reason: "None of these teams has a game this week." };
}

/** Kickoff state for one team at a point in time. */
function teamKickoffState(index, team, now = new Date()) {
  const game = index && index.ok ? index.byTeam[String(team || "").toUpperCase()] : null;
  if (!game) return { state: index && index.ok ? "NO_GAME" : "UNKNOWN", kickoff: null };
  if (!game.kickoff) return { state: "UNKNOWN", kickoff: null, reason: game.reason, gameID: game.gameID };
  return { state: Date.parse(game.kickoff) <= now.getTime() ? "KICKED_OFF" : "PREGAME", kickoff: game.kickoff, gameID: game.gameID };
}

module.exports = { buildKickoffIndex, decisionCutoff, teamKickoffState, easternToIso, kickoffForGame };

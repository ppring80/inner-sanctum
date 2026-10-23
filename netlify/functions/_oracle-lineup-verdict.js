'use strict';

// ═══════════════════════════════════════════════════════════════════════
// ORACLE LINEUP VERDICT — presentation over the shared Super SAGE authority
// ═══════════════════════════════════════════════════════════════════════
//
// Week 7 customer failure: the Oracle's "Ask The Oracle for Lineup Advice"
// button sent bare player names to the language model with only a schedule/
// injury eligibility table. The model echoed "SCHEDULED" back as if it were a
// verdict, could not resolve DeVonta Smith's team (name-only lookup), had no
// team/position anchor to keep Rashee Rice distinct from other Rices, and was
// never given a starter-vs-bench comparison. Super SAGE's shared lineup
// authority (decideSharedLineup) already does all of that for the website and
// ChatGPT, but the Oracle path never consulted it.
//
// This module:
//   1. pre-resolves each rostered player against the Weekly SAGE rows using
//      provider ID (only when it agrees with the name), canonical name,
//      position and team, and hands SAGE the resolved sageCompatibleId so its
//      existing ID-first matcher is used. Ambiguous identities are never
//      guessed; they are excluded and reported.
//   2. calls the SAME shared authority with the SAME Weekly SAGE request the
//      website uses (decision logic is untouched; the record is not altered).
//   3. maps the customer's own starters onto SAGE's record as KEEP / SWAP /
//      HOLD PENDING NEWS. It never ranks, scores, or chooses starters: SWAP
//      means SAGE starts a benched player instead; KEEP means SAGE starts the
//      same player; HOLD means SAGE's own evidence marks availability, role or
//      identity as unresolved.
//   4. never invents evidence. Missing opponent, injury or projection data is
//      stated as missing. If SAGE cannot decide, the Oracle says so.
// ═══════════════════════════════════════════════════════════════════════

const { decideSharedLineup } = require('./_super-sage-lineup-service.js');
const { buildWeeklyRankingsUrl, baseUrlFor } = require('./super-sage-lineup.js');
const { readCachedWeeklySchedule } = require('./_weekly-sage-schedule-cache.js');
const { resolveCurrentNFLWeek, WEEK_TWO_START_UTC, MILLISECONDS_PER_WEEK } = require('./_current-nfl-week.js');
const { buildKickoffIndex, teamKickoffState, easternToIso } = require('./_super-sage-kickoff.js');
const { canonicalNameKey } = require('../../player-identity');

const ORACLE_LINEUP_FORMAT = 'oracle-lineup-verdict';
const SEASON = 2026;
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K'];
const SLOT_ELIGIBLE = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'], RECFLEX: ['WR', 'TE'], SFLEX: ['QB', 'RB', 'WR', 'TE']
};
const SAGE_SLOT_LABEL = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K', DEF: 'DEF', FLEX: 'FLEX', RECFLEX: 'WR/TE', SFLEX: 'SUPERFLEX' };
const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX', 'RECFLEX', 'SFLEX'];
const TEAM_ALIAS = { JAC: 'JAX', WSH: 'WAS', LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR', ARZ: 'ARI', GNB: 'GB', KAN: 'KC', NWE: 'NE', NOR: 'NO', SFO: 'SF', TAM: 'TB', HST: 'HOU', BLT: 'BAL', CLV: 'CLE' };
const DEFAULT_TEAMS = 12;

const clean = (v, max = 80) => String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, max);
const upper = (v) => String(v || '').trim().toUpperCase();
function teamCode(v) {
  const t = upper(v);
  if (!t || t === 'FA' || t === 'UNKNOWN' || t === '—') return null;
  return TEAM_ALIAS[t] || t;
}
function normalizeScoring(v) {
  const s = String(v || '').toLowerCase();
  if (!s) return null;
  if (/half|0\.5/.test(s)) return 'half';
  if (/standard|std|non[-_ ]?ppr/.test(s)) return 'standard';
  if (/ppr|full/.test(s)) return 'ppr';
  return null;
}
const SCORING_LABEL = { half: 'Half-PPR', ppr: 'PPR', standard: 'Standard' };

// ─── Request normalization ─────────────────────────────────────────────

function normalizeEntry(raw, slotPos) {
  const name = clean(raw && raw.name);
  if (!name) return null;
  const position = POSITIONS.includes(upper(raw.position)) ? upper(raw.position) : null;
  const slotEligible = slotPos ? SLOT_ELIGIBLE[slotPos] || [] : null;
  const eligiblePositions = position ? [position] : (slotEligible && slotEligible.length ? slotEligible.slice() : SKILL_POSITIONS.slice());
  return {
    name,
    position,
    eligiblePositions,
    team: teamCode(raw.team),
    rosterStatus: raw.rosterStatus ? clean(raw.rosterStatus, 24) : null,
    providerPlayerId: raw.providerPlayerId != null && raw.providerPlayerId !== '' ? clean(raw.providerPlayerId, 40) : null,
    slotPos: slotPos || null,
    slotLabel: raw.slotLabel ? clean(raw.slotLabel, 32) : null
  };
}

function normalizeLineupPayload(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'lineup payload missing' };
  const week = Number(raw.week);
  if (!Number.isInteger(week) || week < 1 || week > 18) return { ok: false, error: 'week must be 1-18' };
  const starters = (Array.isArray(raw.starters) ? raw.starters : []).slice(0, 20)
    .map((s) => normalizeEntry(s, SLOT_ELIGIBLE[upper(s && s.slotPos)] ? upper(s.slotPos) : null))
    .filter((s) => s && s.slotPos);
  const bench = (Array.isArray(raw.bench) ? raw.bench : []).slice(0, 30).map((b) => normalizeEntry(b, null)).filter(Boolean);
  if (!starters.length) return { ok: false, error: 'no starters' };
  const counts = raw.slotCounts && typeof raw.slotCounts === 'object' ? raw.slotCounts : {};
  const slots = SLOT_ORDER.map((pos) => {
    const fromCounts = Math.floor(Number(counts[pos]) || 0);
    const fromStarters = starters.filter((s) => s.slotPos === pos).length;
    const count = Math.min(10, Math.max(fromCounts, fromStarters));
    return count > 0 ? { slotLabel: SAGE_SLOT_LABEL[pos], eligiblePositions: SLOT_ELIGIBLE[pos].slice(), count, slotPos: pos } : null;
  }).filter(Boolean);
  const scoring = normalizeScoring(raw.scoring);
  const teams = Number(raw.teams) >= 4 && Number(raw.teams) <= 32 ? Number(raw.teams) : DEFAULT_TEAMS;
  return {
    ok: true,
    payload: {
      season: SEASON, week,
      scoring: scoring || 'half', scoringProvided: Boolean(scoring),
      teams, provider: raw.provider ? clean(raw.provider, 16).toLowerCase() : null,
      starters, bench, slots
    }
  };
}

// ─── Identity pre-resolution against Weekly SAGE rows ──────────────────

function rankingRows(rankings) {
  const rows = [];
  POSITIONS.forEach((pos) => {
    ((rankings && rankings.positions && rankings.positions[pos]) || []).forEach((r) => rows.push({ ...r, position: upper(r.position || pos), _inactive: false }));
    ((rankings && rankings.inactive && rankings.inactive[pos]) || []).forEach((r) => rows.push({ ...r, position: upper(r.position || pos), _inactive: true }));
  });
  return rows;
}

function resolveIdentity(entry, rows) {
  const key = canonicalNameKey(entry.name);
  const eligible = (r) => entry.eligiblePositions.includes(r.position);
  const rowTeam = (r) => teamCode(r.currentTeam || r.team);
  if (entry.eligiblePositions.length === 1 && entry.eligiblePositions[0] === 'DEF') {
    const byTeam = entry.team ? rows.filter((r) => r.position === 'DEF' && rowTeam(r) === entry.team) : [];
    return byTeam.length === 1 ? { status: 'RESOLVED', row: byTeam[0], via: 'team' } : { status: 'NOT_FOUND', candidates: [] };
  }
  if (entry.providerPlayerId) {
    const byId = rows.filter((r) => r.playerID != null && String(r.playerID) === entry.providerPlayerId && canonicalNameKey(r.name) === key && eligible(r));
    if (byId.length === 1) return { status: 'RESOLVED', row: byId[0], via: 'provider ID' };
  }
  let candidates = rows.filter((r) => canonicalNameKey(r.name) === key && eligible(r));
  const unique = new Map();
  candidates.forEach((r) => unique.set(String(r.playerID || r.name + '|' + r.position + '|' + rowTeam(r)), r));
  candidates = [...unique.values()];
  if (candidates.length > 1 && entry.team) {
    const sameTeam = candidates.filter((r) => rowTeam(r) === entry.team);
    if (sameTeam.length === 1) return { status: 'RESOLVED', row: sameTeam[0], via: 'name, position and team' };
  }
  if (candidates.length === 1) {
    const row = candidates[0];
    const conflict = entry.team && rowTeam(row) && rowTeam(row) !== entry.team
      ? { rosterTeam: entry.team, evidenceTeam: rowTeam(row) } : null;
    return { status: 'RESOLVED', row, via: entry.position ? 'name and position' : 'name only', teamConflict: conflict };
  }
  if (candidates.length > 1) return { status: 'AMBIGUOUS', candidates };
  return { status: 'NOT_FOUND', candidates: [] };
}

// Roster facts for players with NO Weekly SAGE row (e.g. outside SAGE's
// depth-chart population). Read from the cached Tank01 roster (the same
// player-data blob chat.js reads). Facts are reported, never scored: they let
// the Oracle name such a player explicitly instead of letting him disappear.
const ROSTER_POS = { PK: 'K', DST: 'DEF', 'D/ST': 'DEF' };
function rosterFactFor(entry, playerData) {
  const list = Object.values((playerData && playerData.players) || {});
  if (!list.length) return { status: 'NONE' };
  const key = canonicalNameKey(entry.name);
  const named = list.filter((p) => canonicalNameKey(p.longName || p.name) === key &&
    entry.eligiblePositions.includes(ROSTER_POS[upper(p.pos || p.position)] || upper(p.pos || p.position)));
  let hits = entry.team ? named.filter((p) => teamCode(p.team) === entry.team) : named;
  if (!hits.length && named.length === 1) hits = named;
  if (hits.length !== 1) return { status: hits.length ? 'AMBIGUOUS' : 'NONE' };
  const p = hits[0];
  const injury = p.injury || {};
  const desc = String(injury.description || '').replace(/\s+/g, ' ').trim();
  return {
    status: 'FOUND', team: teamCode(p.team), position: ROSTER_POS[upper(p.pos)] || upper(p.pos || p.position),
    designation: String(injury.designation || '').trim() || null,
    description: desc ? (desc.length > 120 ? desc.slice(0, 117) + '...' : desc) : null,
    asOf: playerData.updatedAt || null
  };
}

function toSageRosterEntry(entry, identity) {
  if (identity.status === 'RESOLVED') {
    const r = identity.row;
    return { name: r.name, eligiblePositions: [r.position], team: teamCode(r.currentTeam || r.team) || entry.team, sageCompatibleId: r.playerID != null ? String(r.playerID) : null, rosterStatus: entry.rosterStatus };
  }
  return { name: entry.name, eligiblePositions: entry.eligiblePositions, team: entry.team, rosterStatus: entry.rosterStatus };
}

// ─── Source-week evidence guard ────────────────────────────────────────
// A caller can relabel targetWeek or projection.week; it cannot relabel when
// the evidence was produced or which games it describes. Week N evidence must
// be generated, projected and injury-checked inside Week N's recommendation
// window (the shared Tuesday 06:00 UTC boundary) and describe Week N games.
// Any violation rejects the whole packet: the Oracle never mixes weeks.

function weekWindow(week) {
  const start = WEEK_TWO_START_UTC + (Number(week) - 2) * MILLISECONDS_PER_WEEK;
  return { start, end: start + MILLISECONDS_PER_WEEK };
}
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

function validateWeekEvidence(rankings, { season, week, now = new Date(), kickoffIndex = null, scoring = null }) {
  const problems = [];
  const { start, end } = weekWindow(week);
  const nowMs = now.getTime();
  const inWindow = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) && t >= start && t < end && t <= nowMs + 10 * 60000; };
  const label = (iso) => iso || 'missing';
  if (!rankings) return { ok: false, problems: ['no Weekly SAGE evidence'] };
  if (String(rankings.season) !== String(season)) problems.push(`season ${rankings.season} is not ${season}`);
  if (Number(rankings.targetWeek) !== Number(week)) problems.push(`Weekly SAGE returned Week ${rankings.targetWeek} evidence, not Week ${week}`);
  if (scoring && normalizeScoring(rankings.scoring) !== scoring) problems.push(`Weekly SAGE returned ${rankings.scoring || 'unlabeled'} scoring, not ${scoring}`);
  if (!inWindow(rankings.generatedAt)) problems.push(`rankings generated ${label(rankings.generatedAt)}, outside Week ${week}`);
  const meta = rankings.metadata || {};
  if (meta.projections && meta.projections.available !== false) {
    if (meta.projections.week != null && Number(meta.projections.week) !== Number(week)) problems.push(`projections are for Week ${meta.projections.week}`);
    if (meta.projections.updatedAt && !inWindow(meta.projections.updatedAt)) problems.push(`projections updated ${meta.projections.updatedAt}, outside Week ${week}`);
  }
  if (meta.availability && meta.availability.available !== false && !inWindow(meta.availability.updatedAt)) {
    problems.push(`injury report updated ${label(meta.availability.updatedAt)}, outside Week ${week}`);
  }
  const rows = rankingRows(rankings);
  const startDay = ymd(start), endDay = ymd(end - 1);
  let badGames = 0, badProj = 0, badMatchups = 0; const examples = [], matchupExamples = [];
  rows.forEach((r) => {
    const day = String(r.gameDate || String(r.gameID || '').slice(0, 8) || '');
    if (day && (day < startDay || day > endDay)) { badGames++; if (examples.length < 2) examples.push(`${r.name} game ${day}`); }
    const pr = r.projection;
    if (pr && ((pr.week != null && Number(pr.week) !== Number(week)) || (pr.updatedAt && !inWindow(pr.updatedAt)) ||
      (scoring && pr.scoring && normalizeScoring(pr.scoring) !== scoring))) badProj++;
    if (kickoffIndex && kickoffIndex.ok && r.gameID && r.position !== 'DEF') {
      const team = teamCode(r.currentTeam || r.team);
      const key = Object.keys(kickoffIndex.byTeam).find((k) => teamCode(k) === team);
      const game = key ? kickoffIndex.byTeam[key] : null;
      if (!game || (game.gameID && game.gameID !== r.gameID)) {
        badMatchups++;
        if (matchupExamples.length < 3) matchupExamples.push(`${r.name} (${team || 'unknown team'}): rankings ${r.gameID}, schedule ${game?.gameID || 'missing'}`);
      }
    }
  });
  if (badGames) problems.push(`${badGames} player games fall outside Week ${week} (${examples.join(', ')})`);
  if (badProj) problems.push(`${badProj} player projections are not Week ${week} ${scoring ? SCORING_LABEL[scoring] + ' ' : ''}projections`);
  if (badMatchups) problems.push(`${badMatchups} matchups disagree with the Week ${week} schedule (${matchupExamples.join('; ')})`);
  return { ok: problems.length === 0, problems };
}

// ─── Evidence presentation helpers (read-only) ─────────────────────────

const keyOf = (name, position) => canonicalNameKey(name) + '|' + upper(position);
const fmt = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(1) : null);

function gameLine(row) {
  if (!row || !row.opponent) return null;
  const where = String(row.location || '').toLowerCase() === 'away' ? '@' : 'vs';
  return `${where} ${row.opponent}`;
}

function evidenceBits(p, row) {
  if (!p) return [];
  const bits = [];
  if (p.baseline && p.baseline.positionRank != null) bits.push(`${p.position}${p.baseline.positionRank}`);
  const pts = admissiblePoints(p);
  if (pts != null) bits.push(`${fmt(pts)} proj`);
  else if (p.matched !== false) bits.push('no comparable projection');
  const game = gameLine(row);
  if (game) bits.push(game);
  if (p.matchup) bits.push(`${String(p.matchup).toLowerCase()} matchup`);
  if (p.observedOpportunity && p.observedOpportunity.avgLast3 != null) bits.push(`${fmt(p.observedOpportunity.avgLast3)} opportunities/game last 3`);
  return bits;
}

function describe(p, row) {
  const team = teamCode((row && (row.currentTeam || row.team)) || p.team);
  const bits = [team, ...evidenceBits(p, row)].filter(Boolean);
  return `${p.name}${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

function idLabel(p, row) {
  const team = teamCode((row && (row.currentTeam || row.team)) || p.team);
  return `${p.name} (${p.position}${team ? ', ' + team : ''})`;
}

// What actually separates two players, from evidence already in the record
// and the Weekly SAGE rows. Only factors that differ are reported; nothing is
// re-ranked or re-scored.
const MATCHUP_ORDER = { positive: 2, neutral: 1, negative: 0 };
// Projected points the Oracle may compare: SAGE-admissible AND, on the raw
// Weekly SAGE row, explicitly for the requested week, explicitly in the
// league's scoring, and fresh. (SAGE itself admits a projection whose week or
// scoring is merely missing; the Oracle never states a point gap on that.)
// COMPARE_CTX is set at the start of the synchronous deriveVerdict call.
let COMPARE_CTX = null;
function admissiblePoints(p) {
  if (!p || !p.projection || p.projection.admissible === false || !Number.isFinite(Number(p.projection.points))) return null;
  if (!COMPARE_CTX) return null;
  const row = COMPARE_CTX.rows.get(keyOf(p.name, p.position));
  const rp = row && row.projection;
  if (!rp || Number(rp.week) !== Number(COMPARE_CTX.week) || normalizeScoring(rp.scoring) !== COMPARE_CTX.scoring || rp.fresh !== true || p.projection.fresh !== true) return null;
  return Number(p.projection.points);
}
function separation(a, rowA, b, rowB) {
  const forA = [], againstA = [];
  const pa = admissiblePoints(a), pb = admissiblePoints(b);
  if (pa != null && pb != null && Math.abs(pa - pb) >= 0.5) (pa > pb ? forA : againstA).push(`${fmt(Math.abs(pa - pb))} more projected points${pa > pb ? '' : ` for ${b.name}`}`);
  [['role', 'role'], ['production', 'production']].forEach(([k, word]) => {
    const x = Number(rowA && rowA[k] && rowA[k].adjustedScore), y = Number(rowB && rowB[k] && rowB[k].adjustedScore);
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) >= 10) (x > y ? forA : againstA).push(`${x > y ? 'a stronger' : 'a weaker'} ${word} score (${Math.round(x)} vs ${Math.round(y)})`);
  });
  const ma = String((rowA && rowA.matchup && rowA.matchup.label) || a.matchup || '').toLowerCase();
  const mb = String((rowB && rowB.matchup && rowB.matchup.label) || b.matchup || '').toLowerCase();
  if (ma in MATCHUP_ORDER && mb in MATCHUP_ORDER && ma !== mb) (MATCHUP_ORDER[ma] > MATCHUP_ORDER[mb] ? forA : againstA).push(`${MATCHUP_ORDER[ma] > MATCHUP_ORDER[mb] ? 'the better' : 'a tougher'} matchup (${ma} vs ${mb})`);
  const oa = a.observedOpportunity && Number(a.observedOpportunity.avgLast3), ob = b.observedOpportunity && Number(b.observedOpportunity.avgLast3);
  if (Number.isFinite(oa) && Number.isFinite(ob) && Math.abs(oa - ob) >= 2) (oa > ob ? forA : againstA).push(`${fmt(Math.abs(oa - ob))} ${oa > ob ? 'more' : 'fewer'} opportunities per game over the last three`);
  return { forA, againstA };
}
const listJoin = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
function separationSentence(a, rowA, b, rowB) {
  const { forA, againstA } = separation(a, rowA, b, rowB);
  if (!forA.length && !againstA.length) return `No single factor separates them in the evidence; SAGE's ranking (${a.position}${a.baseline && a.baseline.positionRank} vs ${b.position}${b.baseline && b.baseline.positionRank}) decides it.`;
  const pros = forA.length ? `${a.name} brings ${listJoin(forA)}` : `${a.name} holds the higher SAGE ranking`;
  return `${pros}${againstA.length ? `, despite ${listJoin(againstA)}` : ''}.`;
}

// Short forms for the concise (voice-length) answer.
function injuryPart(desc) { const m = String(desc || '').match(/\(([^)]{2,30})\)/); return m ? ` (${m[1]})` : ''; }
function shortStatus(p) {
  const a = availabilityText(p);
  return a.status ? `${String(a.status).toLowerCase()}${injuryPart(a.desc)}` : 'unavailable';
}
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function gameShort(row) {
  const g = gameLine(row);
  if (!g) return null;
  const d = String(row.gameDate || '');
  const day = d.length === 8 ? WEEKDAY[new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8))).getUTCDay()] : null;
  return `${g}${day ? ` ${day}` : ''}${row.gameTime ? ` ${row.gameTime}` : ''}`;
}
function topFactor(a, rowA, b, rowB) {
  const { forA } = separation(a, rowA, b, rowB);
  return forA.length ? forA[0] : null;
}
function shortSlot(label) {
  const s = String(label || '');
  const n = (s.match(/(\d+)\s*$/) || [])[1] || '';
  if (/^quarterback/i.test(s)) return 'QB' + n;
  if (/^running back/i.test(s)) return 'RB' + n;
  if (/^wide receiver/i.test(s)) return 'WR' + n;
  if (/^tight end/i.test(s)) return 'TE' + n;
  if (/^kicker/i.test(s)) return 'K';
  if (/^defense/i.test(s)) return 'DEF';
  if (/^superflex/i.test(s)) return 'SFLEX' + n;
  if (/^flex \(wr\/te\)/i.test(s)) return 'W/T' + n;
  if (/^flex/i.test(s)) return 'FLEX' + n;
  return s;
}

function availabilityText(p) {
  const a = (p && p.availability) || {};
  const eff = a.effectiveStatus || {};
  const status = eff.reported || a.injuryStatus || a.rosterStatus || eff.status || null;
  let desc = a.injuryDescription ? String(a.injuryDescription).replace(/^Current injury report:\s*/i, '').replace(/\s+/g, ' ').trim() : '';
  if (status) desc = desc.replace(new RegExp('^' + String(status).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[\u2014-]\\s*', 'i'), '');
  return { status, desc: desc.length > 140 ? desc.slice(0, 137) + '...' : desc };
}

function holdReasons(p, evidenceStatus) {
  const reasons = [];
  if (!p) return reasons;
  const a = p.availability || {};
  const eff = a.effectiveStatus || {};
  if (a.questionable) {
    const t = availabilityText(p);
    reasons.push(`listed ${String(eff.reported || eff.status).toLowerCase()}${t.desc ? ` (${t.desc})` : ''}`);
  }
  if (a.conflict) reasons.push('injury sources disagree on his status');
  if (!a.questionable && (eff.status === 'UNVERIFIED' || a.availabilityVerified === false)) reasons.push('his availability for this week is not verified');
  const avail = evidenceStatus && evidenceStatus.availability;
  if (avail && avail.status !== 'AVAILABLE') reasons.push(`the injury report is ${avail.status === 'DEGRADED' ? 'stale' : 'unavailable'} (${avail.detail})`);
  const unresolvedRole = p.baselineValidity && p.baselineValidity.state === 'REASSESS' &&
    (p.stateChanges || []).some((c) => c.type === 'ROLE_CHANGE' && (!c.establishment || c.establishment.status !== 'ESTABLISHED'));
  if (unresolvedRole) reasons.push('a reported role change is not yet confirmed by game evidence');
  return [...new Set(reasons)];
}

// ─── Mapping customer starters onto the SAGE record ─────────────────────

function indexRecord(record) {
  const idx = new Map();
  const put = (p, where, slot) => { if (p && !idx.has(keyOf(p.name, p.position))) idx.set(keyOf(p.name, p.position), { packet: p, where, slot }); };
  record.slots.forEach((s) => put(s.starter, 'START', s));
  (record.unavailable || []).forEach((p) => put(p, 'UNAVAILABLE', null));
  (record.bench || []).forEach((p) => put(p, 'BENCH', null));
  (record.unmatched || []).forEach((p) => put(p, 'UNMATCHED', null));
  return idx;
}

function deriveVerdict({ payload, result, rankings, identities, now = new Date(), locked = new Map(), kickoffUnknown = [], slateStarted = false, rosterFacts = new Map() }) {
  const unknownKick = new Set(kickoffUnknown);
  const record = result.record;
  const evidenceStatus = result.evidenceStatus || {};
  const rows = rankingRows(rankings);
  COMPARE_CTX = { week: payload.week, scoring: payload.scoring, rows: new Map(rows.map((r) => [keyOf(r.name, r.position), r])) };
  const rowFor = (p) => (p ? rows.find((r) => keyOf(r.name, r.position) === keyOf(p.name, p.position)) || null : null);
  const idx = indexRecord(record);
  const locate = (entry) => {
    const id = identities.get(entry);
    if (!id || id.status === 'AMBIGUOUS') return null;
    const name = id.status === 'RESOLVED' ? id.row.name : entry.name;
    for (const pos of id.status === 'RESOLVED' ? [id.row.position] : entry.eligiblePositions) {
      const hit = idx.get(keyOf(name, pos));
      if (hit) return hit;
    }
    return null;
  };

  const starterKeys = new Set();
  const starters = payload.starters.map((entry) => {
    const loc = locate(entry);
    if (loc) starterKeys.add(keyOf(loc.packet.name, loc.packet.position));
    return { entry, loc, identity: identities.get(entry) };
  });
  const promotions = record.slots.filter((s) => s.starter && !starterKeys.has(keyOf(s.starter.name, s.starter.position)))
    .map((s) => ({ slot: s, packet: s.starter, used: false }));
  const benchEntries = payload.bench.map((entry) => ({ entry, loc: locate(entry), identity: identities.get(entry) }));

  const eligibleFor = (slotPos) => SLOT_ELIGIBLE[slotPos] || [];
  const takePromotion = (slotPos, position, strict) => {
    const pool = promotions.filter((x) => !x.used && (!strict || eligibleFor(slotPos).includes(x.packet.position)));
    const pick = pool.find((x) => x.packet.position === position) || pool[0] || null;
    if (pick) pick.used = true;
    return pick;
  };
  const bestBenchAlternative = (slotPos, sageSlot) => {
    const options = benchEntries.filter((b) => b.loc && (b.loc.where === 'BENCH' || b.loc.where === 'START') && eligibleFor(slotPos).includes(b.loc.packet.position));
    if (!options.length) return null;
    if (sageSlot && sageSlot.comparator) {
      const comp = options.find((b) => keyOf(b.loc.packet.name, b.loc.packet.position) === keyOf(sageSlot.comparator.name, sageSlot.comparator.position));
      if (comp) return comp.loc.packet;
    }
    const projected = options.filter((b) => b.loc.packet.projection && b.loc.packet.projection.admissible !== false && b.loc.packet.projection.points != null);
    if (projected.length) return projected.sort((a, b) => b.loc.packet.projection.points - a.loc.packet.projection.points)[0].loc.packet;
    return options[0].loc.packet;
  };

  const verdictRows = [];
  // Demotions are paired before keeps so every SWAP names its replacement.
  starters.forEach((s) => {
    const { entry, loc, identity } = s;
    const slot = entry.slotLabel || SAGE_SLOT_LABEL[entry.slotPos];
    if (locked.has(entry)) {
      const k = locked.get(entry);
      const r = identity.row;
      s.row = { decision: 'KEEP', slot, player: idLabel({ name: r.name, position: r.position, team: r.team }, r),
        reason: `Locked: ${r.name}'s ${gameLine(r) ? gameLine(r) + ' ' : ''}game kicked off at ${k.kickoff} (${k.source}), so this slot can no longer change.`,
        brief: 'locked — his game has started', locked: true, name: r.name };
      return;
    }
    if (identity && identity.status === 'AMBIGUOUS') {
      const teams = [...new Set(identity.candidates.map((r) => teamCode(r.currentTeam || r.team)).filter(Boolean))];
      s.row = { decision: 'NOT EVALUATED', slot, player: `${entry.name}`, unevaluated: true, reason: `More than one ${entry.eligiblePositions.join('/')} named ${entry.name} is in Week ${payload.week} evidence${teams.length ? ` (${teams.join(', ')})` : ''}, and your lineup did not say which. I won't guess — reconnect your league or confirm his team before kickoff.`,
        brief: `more than one ${entry.name} in the evidence${teams.length ? ` (${teams.join(', ')})` : ''} — confirm which before kickoff`, name: entry.name };
      return;
    }
    if ((!loc || loc.where === 'UNMATCHED') && identity && identity.status === 'RESOLVED') {
      // Identity is known; SAGE simply has no actionable standing for him
      // (e.g. he is on the inactive list and the status cannot be confirmed).
      const r = identity.row;
      const status = r.status && !/^active$/i.test(r.status) ? String(r.status).toUpperCase() : null;
      const stale = evidenceStatus.availability && evidenceStatus.availability.status !== 'AVAILABLE';
      s.row = { decision: 'HOLD PENDING NEWS', slot, player: idLabel({ name: r.name, position: r.position, team: r.team }, r),
        reason: `SAGE has no Week ${payload.week} standing for ${r.name}${status ? `: his latest listed status is ${status}` : ''}${stale ? `, and the injury report is ${evidenceStatus.availability.status === 'DEGRADED' ? 'stale' : 'unavailable'} (${evidenceStatus.availability.detail})` : ''}. Do not count on him until his status is confirmed before kickoff.`,
        brief: `no SAGE standing${status ? `; latest status ${status}` : ''} — confirm before kickoff`, name: r.name };
      return;
    }
    if (!loc || loc.where === 'UNMATCHED') {
      const fact = rosterFacts.get(entry);
      if (fact && fact.status === 'FOUND') {
        s.row = { decision: 'NOT EVALUATED', slot, player: `${entry.name} (${fact.position}, ${fact.team})`, name: entry.name, unevaluated: true,
          reason: `${entry.name} is on ${fact.team}'s roster${fact.designation ? ` and listed ${fact.designation}${fact.description ? ` (${fact.description})` : ''}` : ''}, but SAGE did not evaluate him for Week ${payload.week}, so it cannot compare him with your bench. This is not a SAGE start or sit call; confirm his status before kickoff.`,
          brief: `on ${fact.team}'s roster${fact.designation ? `, listed ${fact.designation.toLowerCase()}${injuryPart(fact.description)}` : ''}; SAGE has no Week ${payload.week} evaluation, so no call` };
        return;
      }
      s.row = { decision: 'NOT EVALUATED', slot, player: `${entry.name}${entry.team ? ` (${entry.team})` : ''}`, name: entry.name, unevaluated: true, reason: `I could not match ${entry.name} to verified Week ${payload.week} evidence${entry.team ? '' : ' — his team is unresolved'}. SAGE has no standing for him, so I won't call this start; confirm his team and status before kickoff.`,
        brief: `not found in Week ${payload.week} evidence${entry.team ? '' : ' (team unresolved)'}; no SAGE evaluation, so no call` };
      return;
    }
    if (loc.where === 'UNAVAILABLE' || (loc.where === 'BENCH' && !record.slots.some((sl) => sl.decisionState === 'NO_CALL' && (sl.candidates || []).some((c) => keyOf(c.name, c.position) === keyOf(loc.packet.name, loc.packet.position))))) {
      s.demoted = true;
      return;
    }
    if (loc.where === 'BENCH') {
      s.row = { decision: 'HOLD PENDING NEWS', slot, player: idLabel(loc.packet, rowFor(loc.packet)), reason: `SAGE has no Week ${payload.week} standing to decide this slot; it makes no call rather than guessing.`, brief: 'SAGE makes no call for this slot', name: loc.packet.name };
    }
  });
  starters.filter((s) => s.demoted).forEach((s) => { s.promotion = takePromotion(s.entry.slotPos, s.loc.packet.position, true); });
  starters.filter((s) => s.demoted && !s.promotion).forEach((s) => {
    s.promotion = takePromotion(s.entry.slotPos, s.loc.packet.position, false);
    if (!s.promotion) return;
    // The replacement cannot play this slot directly: SAGE's lineup slides a
    // kept starter into it and puts the replacement in the kept starter's slot.
    s.slide = starters.find((k) => k !== s && k.loc && k.loc.where === 'START' && !k.demoted &&
      eligibleFor(k.entry.slotPos).includes(s.promotion.packet.position) &&
      eligibleFor(s.entry.slotPos).includes(k.loc.packet.position) && !k.slidFor) || null;
    if (s.slide) s.slide.slidFor = s;
  });

  starters.forEach((s) => {
    if (s.row) { verdictRows.push(s.row); return; }
    const { entry, loc } = s;
    const p = loc.packet;
    const row = rowFor(p);
    const slot = entry.slotLabel || SAGE_SLOT_LABEL[entry.slotPos];
    const identityNote = s.identity && s.identity.teamConflict
      ? ` Your league lists him on ${s.identity.teamConflict.rosterTeam}; current NFL evidence lists ${s.identity.teamConflict.evidenceTeam}, which is what SAGE used.` : '';
    if (s.demoted) {
      const a = availabilityText(p);
      const out = loc.where === 'UNAVAILABLE';
      const conflict = Array.isArray(p.availability && p.availability.conflict) && p.availability.conflict.length
        ? ` Sources disagree (${p.availability.conflict.map((c) => `${c.source}: ${c.status}`).join(' vs ')}); SAGE applies the most severe current status.` : '';
      const why = out
        ? `${p.name} is ${a.status ? a.status.toUpperCase() : 'unavailable'}${a.desc ? ` — ${a.desc}` : ''}.${conflict}`
        : '';
      if (s.promotion) {
        const q = s.promotion.packet;
        const caution = holdReasons(q, evidenceStatus).filter((r) => !/injury report is/.test(r));
        const conf = ` ${s.promotion.slot.confidence.label} confidence.`;
        if (unknownKick.has(q.name) && slateStarted) {
          verdictRows.push({ decision: 'HOLD PENDING NEWS', slot, player: idLabel(p, row),
            reason: `SAGE would start ${describe(q, rowFor(q))} over ${p.name}${out ? ` (${why.trim()})` : ''}, but this week's games are underway and ${q.name}'s kickoff cannot be verified — he may already be locked. Confirm his game has not started before making this move.${identityNote}`.replace(/\s+/g, ' ').trim(),
            brief: `SAGE would start ${q.name}, but his kickoff can't be verified with games underway`, name: p.name });
          return;
        }
        const kickCaveat = unknownKick.has(q.name) ? ` Kickoff for ${q.name} is not verified; make this move before his game starts.` : '';
        const move = s.slide
          ? ` Slide ${s.slide.loc.packet.name} from ${s.slide.entry.slotLabel || SAGE_SLOT_LABEL[s.slide.entry.slotPos]} into ${slot} and start ${q.name} at ${s.slide.entry.slotLabel || SAGE_SLOT_LABEL[s.slide.entry.slotPos]}.`
          : '';
        verdictRows.push({ decision: 'SWAP', slot, player: idLabel(p, row), replacement: idLabel(q, rowFor(q)),
          reason: `Start ${describe(q, rowFor(q))} over ${out ? p.name : describe(p, row)}. ${why}${out ? '' : ' ' + separationSentence(q, rowFor(q), p, row)}${move}${conf}${kickCaveat}${caution.length ? ` Confirm ${q.name} first: ${caution.join('; ')}.` : ''}${identityNote}`.replace(/\s+/g, ' ').trim(),
          name: p.name,
          brief: `${s.slide
            ? `bench ${p.name}, move ${s.slide.loc.packet.name} to ${shortSlot(slot)} and start ${q.name} at ${shortSlot(s.slide.entry.slotLabel || SAGE_SLOT_LABEL[s.slide.entry.slotPos])}`
            : `start ${q.name} over ${p.name}`} — ${out ? `${p.name} is ${shortStatus(p)}` : (topFactor(q, rowFor(q), p, row) || `SAGE ranks ${q.name} ahead`)}${caution.length ? `; confirm ${q.name}: ${caution[0]}` : ''}` });
      } else {
        verdictRows.push({ decision: 'SWAP', slot, player: idLabel(p, row), replacement: null,
          reason: `${why || `SAGE does not start ${p.name}.`} No eligible bench player can replace him — he cannot help you this week, so find a ${eligibleFor(entry.slotPos).join('/')} on waivers.${identityNote}`,
          name: p.name, brief: `${p.name} is ${out ? shortStatus(p) : 'not started by SAGE'} and no bench player fits — check waivers` });
      }
      return;
    }
    // Kept by SAGE.
    const reasons = holdReasons(p, evidenceStatus);
    const alt = bestBenchAlternative(entry.slotPos, loc.slot);
    const game = gameLine(row);
    const kick = row && row.gameDate && row.gameTime ? ` (kickoff ${row.gameDate.slice(4, 6)}/${row.gameDate.slice(6, 8)} ${row.gameTime} ET)` : '';
    if (reasons.length) {
      verdictRows.push({ decision: 'HOLD PENDING NEWS', slot, player: idLabel(p, row),
        reason: `SAGE would start ${describe(p, row)}, but ${reasons.join('; ')}. Check the final inactive list before ${game ? 'his ' + game + ' game' : 'kickoff'}${kick}.${alt ? ` If he's out, ${describe(alt, rowFor(alt))} is your best eligible bench option.` : ' You have no eligible bench fallback.'}${identityNote}`,
        name: p.name,
        brief: `${(p.availability && p.availability.questionable) ? shortStatus(p) : reasons[0].replace(/ \(.*$/, '')}${gameShort(row) ? `, ${gameShort(row)}` : ''}; ${alt ? `if he's out, start ${alt.name}` : 'no eligible bench fallback'}` });
      return;
    }
    if (s.slidFor) {
      const to = s.slidFor.entry.slotLabel || SAGE_SLOT_LABEL[s.slidFor.entry.slotPos];
      verdictRows.push({ decision: 'KEEP', slot, player: idLabel(p, row),
        reason: `${describe(p, row)} stays in your lineup but moves to ${to} to make room for ${s.slidFor.promotion.packet.name} (see SWAP). ${loc.slot.confidence.label} confidence.${identityNote}`.replace(/\s+/g, ' ').trim(),
        name: p.name, brief: `moves to ${shortSlot(to)}`, meaningful: false });
      return;
    }
    const close = loc.slot.decisionState === 'CLOSE_CALL_WITHIN_NOISE' || loc.slot.decisionState === 'PROVISIONAL_UNRESOLVED';
    const versus = alt
      ? `${close ? ' Close call over' : ' Beats'} your best eligible bench option, ${describe(alt, rowFor(alt))}. ${separationSentence(p, row, alt, rowFor(alt))}`
      : ' No eligible bench player challenges him.';
    const pa = admissiblePoints(p), pb = alt ? admissiblePoints(alt) : null;
    const narrow = alt && pa != null && pb != null && pa - pb < 1.5;
    const conflictTeam = s.identity && s.identity.teamConflict;
    verdictRows.push({ decision: 'KEEP', slot, player: idLabel(p, row),
      reason: `${describe(p, row)}.${versus} ${loc.slot.confidence.label} confidence.${identityNote}`.replace(/\s+/g, ' ').trim(),
      name: p.name,
      meaningful: Boolean(close || narrow || conflictTeam),
      brief: close && alt ? `close call over ${alt.name} — within normal projection error`
        : narrow ? `edges ${alt.name} by ${fmt(pa - pb)} projected points`
        : conflictTeam ? `your league lists ${conflictTeam.rosterTeam}; current NFL evidence (used by SAGE) lists ${conflictTeam.evidenceTeam}`
        : 'starts over your bench' });
  });

  // SAGE starters with no customer starter to replace (an empty slot).
  promotions.filter((x) => !x.used).forEach((x) => verdictRows.push({ decision: 'SWAP', slot: x.slot.slotLabel, player: '(empty slot)', replacement: idLabel(x.packet, rowFor(x.packet)),
    reason: `Fill your open ${x.slot.slotLabel} slot with ${describe(x.packet, rowFor(x.packet))}.`, name: x.packet.name, brief: `fill your open ${x.slot.slotLabel} slot with ${x.packet.name}` }));

  const benchNotes = benchEntries.map((b) => {
    if (locked.has(b.entry)) return `${b.identity.row.name}: game already kicked off — cannot be moved into your lineup`;
    if (b.identity && b.identity.status === 'AMBIGUOUS') return `${b.entry.name}: more than one player by that name — not evaluated`;
    if (!b.loc || b.loc.where === 'UNMATCHED') {
      const fact = rosterFacts.get(b.entry);
      return fact && fact.status === 'FOUND'
        ? `${b.entry.name}: on ${fact.team}'s roster${fact.designation ? `, listed ${fact.designation}` : ''}, but not evaluated by SAGE this week`
        : `${b.entry.name}: no verified Week ${payload.week} evidence — not evaluated`;
    }
    if (b.loc.where === 'UNAVAILABLE') { const a = availabilityText(b.loc.packet); return `${b.loc.packet.name}: ${a.status ? a.status.toUpperCase() : 'unavailable'}`; }
    if (b.identity && b.identity.teamConflict) return `${b.loc.packet.name}: your league lists ${b.identity.teamConflict.rosterTeam}, current NFL evidence lists ${b.identity.teamConflict.evidenceTeam}`;
    return null;
  }).filter(Boolean);


  // Strongest bench alternative: a bench player SAGE moves in is covered by
  // its SWAP; otherwise the best-projected eligible bench player, measured
  // against the weakest eligible kept starter he could replace.
  let benchSummary = null;
  const movingIn = promotions.filter((x) => x.used && benchEntries.some((b) => b.loc && keyOf(b.loc.packet.name, b.loc.packet.position) === keyOf(x.packet.name, x.packet.position)));
  const sitting = benchEntries.filter((b) => b.loc && b.loc.where === 'BENCH' && !locked.has(b.entry));
  const bestOf = (list) => list.slice().sort((a, b) => (admissiblePoints(b.loc.packet) ?? -1) - (admissiblePoints(a.loc.packet) ?? -1))[0];
  const best = sitting.length ? bestOf(sitting) : null;
  if (best) {
    const bp = best.loc.packet;
    const kept = starters.filter((k) => k.loc && k.loc.where === 'START' && !k.demoted && !locked.has(k.entry) && eligibleFor(k.entry.slotPos).includes(bp.position));
    const weakest = kept.slice().sort((a, b) => (admissiblePoints(a.loc.packet) ?? 1e9) - (admissiblePoints(b.loc.packet) ?? 1e9))[0];
    const bpts = admissiblePoints(bp);
    const head = `${bp.name} (${bp.position}, ${teamCode(bp.team) || '—'}${bpts != null ? `, ${fmt(bpts)} proj` : ''})`;
    if (!weakest) benchSummary = `Best bench option: ${head} — no eligible starting slot for him.`;
    else {
      const w = weakest.loc.packet;
      const factor = topFactor(w, rowFor(w), bp, rowFor(bp));
      benchSummary = `Best bench option: ${head} — doesn't improve your lineup; ${w.name}, your weakest eligible starter, ${factor ? `brings ${factor}` : 'holds the higher SAGE standing'}.`;
    }
  } else if (movingIn.length) {
    benchSummary = `Best bench option: ${movingIn[0].packet.name} — moving into your lineup (see SWAP).`;
  }
  const unevaluatedBench = benchEntries.filter((b) => !locked.has(b.entry) && (!b.loc || b.loc.where === 'UNMATCHED')).map((b) => {
    const fact = rosterFacts.get(b.entry);
    return fact && fact.status === 'FOUND' ? `${b.entry.name} (${fact.team}${fact.designation ? `, ${fact.designation.toLowerCase()}` : ''})` : b.entry.name;
  });

  const currentWeek = resolveCurrentNFLWeek(now, SEASON);
  const order = { SWAP: 0, 'HOLD PENDING NEWS': 1, 'NOT EVALUATED': 2, KEEP: 3 };
  const LIMIT_KEYS = ['weeklySage', 'availability', 'projections', 'schedule'];
  return {
    week: payload.week,
    currentWeek,
    scoring: payload.scoring,
    scoringProvided: payload.scoringProvided,
    decisionId: record.decisionId,
    sageGeneratedAt: (rankings && rankings.generatedAt) || null,
    availabilityAsOf: (rankings && rankings.metadata && rankings.metadata.availability && rankings.metadata.availability.updatedAt) || null,
    rows: verdictRows.map((r, i) => ({ ...r, _i: i }))
      .sort((a, b) => order[a.decision] - order[b.decision] || a._i - b._i)
      .map(({ _i, ...r }) => r),
    benchNotes,
    benchSummary,
    unevaluatedBench,
    kickoffUnknown: [...unknownKick],
    evidenceLimits: LIMIT_KEYS.map((k) => [k, evidenceStatus[k]])
      .filter(([, t]) => t && t.status !== 'AVAILABLE')
      .map(([k, t]) => ({ name: k, status: t.status, detail: t.detail }))
  };
}

// ─── Customer text (1/3/10, Oracle voice, no invented evidence) ────────

const DEEPER_QUESTION = 'Would you like the deeper SAGE analysis on your lineup?';

// Which players lack a verified kickoff, and whether each call still holds:
// a KEEP needs no move (safe); a player moved in or out by a SWAP is safe only
// before his game starts; other bench players are unaffected.
function kickoffSafety(verdict) {
  const unknown = verdict.kickoffUnknown || [];
  if (!unknown.length) return null;
  const rows = verdict.rows;
  const inSwap = (n) => rows.some((r) => r.decision === 'SWAP' && (r.name === n || (r.replacement || '').startsWith(n + ' (')));
  const kept = (n) => rows.some((r) => r.decision === 'KEEP' && r.name === n);
  const moves = unknown.filter(inSwap);
  const keeps = unknown.filter((n) => !inSwap(n) && kept(n));
  const parts = [`Kickoff time unverified for ${listJoin(unknown)}.`];
  if (keeps.length) parts.push(`${listJoin(keeps)} ${keeps.length > 1 ? 'are KEEPs' : 'is a KEEP'}, so no move depends on it.`);
  if (moves.length) parts.push(`The SWAP involving ${listJoin(moves)} is safe only if made before ${moves.length > 1 ? 'their games start' : 'his game starts'}.`);
  if (!keeps.length && !moves.length) parts.push('No recommended move depends on it.');
  return parts.join(' ');
}

function verdictCounts(rows) {
  return [['SWAP', 'SWAP'], ['HOLD PENDING NEWS', 'HOLD'], ['NOT EVALUATED', 'NOT EVALUATED'], ['KEEP', 'KEEP']]
    .map(([d, label]) => [label, rows.filter((r) => r.decision === d).length])
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${n} ${label}`)
    .join(', ');
}

// 1/3/10, voice length: the verdict first, every change and unresolved risk,
// the strongest bench alternative, meaningful KEEPs, then routine KEEPs
// grouped. Full comparisons live in the deeper analysis.
function renderVerdictText(verdict) {
  const rows = verdict.rows;
  const lines = [`The Oracle has weighed your Week ${verdict.week} lineup against your bench: ${verdictCounts(rows)}.`];
  if (verdict.currentWeek && verdict.currentWeek !== verdict.week) lines.push(`(The current NFL week is Week ${verdict.currentWeek}.)`);
  rows.filter((r) => r.decision === 'SWAP').forEach((r) => lines.push(`SWAP ${shortSlot(r.slot)}: ${r.brief}.`));
  rows.filter((r) => r.decision === 'HOLD PENDING NEWS').forEach((r) => lines.push(`HOLD ${shortSlot(r.slot)} ${r.name}: ${r.brief}.`));
  rows.filter((r) => r.decision === 'NOT EVALUATED').forEach((r) => lines.push(`NOT EVALUATED ${shortSlot(r.slot)} ${r.name}: ${r.brief}.`));
  rows.filter((r) => r.decision === 'KEEP' && r.meaningful).forEach((r) => lines.push(`KEEP ${shortSlot(r.slot)} ${r.name}: ${r.brief}.`));
  const routine = rows.filter((r) => r.decision === 'KEEP' && !r.meaningful && !r.locked);
  if (routine.length) lines.push(`KEEP ${routine.map((r) => r.name).join(', ')}.`);
  const lockedRows = rows.filter((r) => r.locked);
  if (lockedRows.length) lines.push(`Locked (games started): ${lockedRows.map((r) => r.name).join(', ')}.`);
  if (verdict.benchSummary) lines.push(verdict.benchSummary);
  if (verdict.unevaluatedBench && verdict.unevaluatedBench.length) lines.push(`Not evaluated by SAGE this week: ${verdict.unevaluatedBench.join(', ')}.`);
  const cautions = [];
  if (!verdict.scoringProvided) cautions.push('league scoring not provided, so Half-PPR was assumed');
  const avail = verdict.evidenceLimits.find((l) => l.name === 'availability');
  if (avail) cautions.push(`injury report ${avail.status === 'DEGRADED' ? 'is stale' : 'is unavailable'}`);
  if (verdict.evidenceLimits.some((l) => l.name === 'projections')) cautions.push('no current projections');
  if (cautions.length) lines.push(`Caution: ${cautions.join('; ')}.`);
  const kick = kickoffSafety(verdict);
  if (kick) lines.push(kick);
  lines.push(DEEPER_QUESTION);
  return lines.join('\n');
}

// Deeper analysis (the 10-second layer): every comparison and evidence limit.
function renderDeeperText(verdict) {
  const counts = ['SWAP', 'HOLD PENDING NEWS', 'NOT EVALUATED', 'KEEP']
    .map((d) => [d, verdict.rows.filter((r) => r.decision === d).length])
    .filter(([, n]) => n > 0)
    .map(([d, n]) => `${n} ${d}`);
  const lines = [`Deeper SAGE analysis — Week ${verdict.week}: ${counts.join(', ')}.`];
  if (verdict.currentWeek && verdict.currentWeek !== verdict.week) {
    lines.push(`Note: you asked about Week ${verdict.week}; the current NFL week is Week ${verdict.currentWeek}.`);
  }
  lines.push('');
  verdict.rows.forEach((r) => lines.push(`${r.decision} — ${r.slot}: ${r.reason}`));
  if (verdict.benchNotes.length) { lines.push(''); lines.push(`Bench notes: ${verdict.benchNotes.join('; ')}.`); }
  lines.push('');
  const basis = [
    `${SCORING_LABEL[verdict.scoring] || verdict.scoring} scoring${verdict.scoringProvided ? '' : ' (your league scoring was not provided, so Half-PPR was assumed)'}`,
    verdict.sageGeneratedAt ? `Weekly SAGE ${verdict.sageGeneratedAt}` : null,
    verdict.availabilityAsOf ? `injury report as of ${verdict.availabilityAsOf}` : null
  ].filter(Boolean);
  lines.push(`Basis: ${basis.join('; ')}.`);
  verdict.evidenceLimits.forEach((l) => lines.push(`Evidence ${l.status.toLowerCase()} — ${l.name}: ${l.detail}`));
  lines.push('Bench is a start/sit call for this week only — it does not mean drop.');
  return lines.join('\n');
}

function renderUnavailableText({ week, reason }) {
  // Rejected or mismatched evidence is not authoritative for player-level
  // availability. Do not convert bench warnings into starter SWAP calls.
  return [
    `SAGE cannot verify the Week ${week} lineup evidence (${reason}).`,
    'No starters, substitutions, injuries or bye assignments are confirmed by this response.',
    'The lineup decision is unavailable until the evidence is corrected.'
  ].join('\\n');
}

// ─── Orchestration ─────────────────────────────────────────────────────

async function buildOracleLineupVerdict({ lineup, event = {}, messages = [], deps = {} }) {
  const normalized = normalizeLineupPayload(lineup);
  if (!normalized.ok) return null;
  const payload = normalized.payload;
  const now = deps.now ? deps.now() : new Date();

  let rankings = null, rankingsError = null;
  try {
    const url = buildWeeklyRankingsUrl({ baseUrl: baseUrlFor(event), season: payload.season, week: payload.week, scoring: payload.scoring, teams: payload.teams });
    const response = await (deps.fetch || fetch)(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) rankingsError = `Weekly SAGE responded ${response.status}`;
    else rankings = await response.json();
  } catch (error) { rankingsError = `Weekly SAGE request failed: ${error.message}`; }

  const unavailable = async (reason) => ({
    status: 'UNAVAILABLE', reason,
    text: renderUnavailableText({ week: payload.week, reason })
  });
  if (!rankings) return unavailable(rankingsError || 'Weekly SAGE unavailable');

  let schedule = null, scheduleError = null;
  try { schedule = await (deps.readSchedule || readCachedWeeklySchedule)({ season: payload.season, week: payload.week, seasonType: 'reg' }); } catch (error) { scheduleError = error.message; }
  const kickoffIndex = buildKickoffIndex(schedule, { season: payload.season, week: payload.week });

  const evidenceCheck = validateWeekEvidence(rankings, { season: payload.season, week: payload.week, now, kickoffIndex, scoring: payload.scoring });
  if (!evidenceCheck.ok) return unavailable(`the evidence is not verifiably Week ${payload.week}: ${evidenceCheck.problems.join('; ')}`);
  let opportunityStore = null;
  try { opportunityStore = deps.getStore ? deps.getStore({ name: 'opportunity-intel' }) : require('@netlify/blobs').getStore({ name: 'opportunity-intel' }); } catch (_) { opportunityStore = null; }

  const rows = rankingRows(rankings);
  const identities = new Map();
  const locked = new Map();
  const kickoffUnknown = [];
  const roster = [];
  const slotCounts = new Map(payload.slots.map((sl) => [sl.slotPos, sl.count]));
  // Kickoff locks: the cached schedule first, Weekly SAGE's own game time when
  // the schedule is unavailable. A started game's player cannot move in or out.
  const kickoffFor = (row) => {
    const team = teamCode(row.currentTeam || row.team);
    if (kickoffIndex.ok) {
      const key = Object.keys(kickoffIndex.byTeam).find((k) => teamCode(k) === team) || team;
      const k = teamKickoffState(kickoffIndex, key, now);
      return { ...k, source: 'Week schedule' };
    }
    const iso = easternToIso(row.gameDate, row.gameTime);
    if (!iso) return { state: 'UNKNOWN', kickoff: null, source: null };
    return { state: Date.parse(iso) <= now.getTime() ? 'KICKED_OFF' : 'PREGAME', kickoff: iso, source: 'Weekly SAGE game time' };
  };
  [...payload.starters, ...payload.bench].forEach((entry) => {
    const identity = resolveIdentity(entry, rows);
    identities.set(entry, identity);
    if (identity.status === 'RESOLVED') {
      const k = kickoffFor(identity.row);
      if (k.state === 'KICKED_OFF') {
        locked.set(entry, k);
        if (entry.slotPos) slotCounts.set(entry.slotPos, (slotCounts.get(entry.slotPos) || 0) - 1);
        return; // locked players are withheld from SAGE; their slots are not re-decided
      }
      if (k.state === 'UNKNOWN' && identity.row.position !== 'DEF') kickoffUnknown.push(identity.row.name);
    }
    if (identity.status !== 'AMBIGUOUS') roster.push(toSageRosterEntry(entry, identity));
  });
  const slots = payload.slots.map(({ slotLabel, eligiblePositions, slotPos }) => ({ slotLabel, eligiblePositions, count: slotCounts.get(slotPos) || 0 }))
    .filter((sl) => sl.count > 0);

  if (!slots.length) {
    const verdict = deriveVerdict({ payload, result: { record: { slots: [], bench: [], unavailable: [], unmatched: [], decisionId: null }, evidenceStatus: {} }, rankings, identities, now, locked });
    return { status: 'VERDICT', verdict, text: renderVerdictText(verdict), deeper: renderDeeperText(verdict) };
  }
  const result = await (deps.decideSharedLineup || decideSharedLineup)({
    rankings, rankingsError, roster, provider: payload.provider, slots,
    season: payload.season, week: payload.week, scoring: payload.scoring,
    schedule, scheduleError, opportunityStore, now
  });
  if (result.status !== 'DECIDED' || !result.record) return unavailable(result.reason || 'SAGE could not decide');

  // Roster facts only for players SAGE has no row for.
  const rosterFacts = new Map();
  const missing = [...identities.entries()].filter(([, id]) => id && id.status === 'NOT_FOUND');
  if (missing.length) {
    let playerData = null;
    try {
      playerData = deps.readPlayerData ? await deps.readPlayerData()
        : await require('@netlify/blobs').getStore({ name: 'player-data' }).get('playerData', { type: 'json' });
    } catch (_) { playerData = null; }
    missing.forEach(([entry]) => rosterFacts.set(entry, rosterFactFor(entry, playerData)));
  }
  const slateStarted = kickoffIndex.ok
    ? Boolean(kickoffIndex.games.some((g) => g.kickoff && Date.parse(g.kickoff) <= now.getTime()))
    : rows.some((r) => { const iso = easternToIso(r.gameDate, r.gameTime); return iso && Date.parse(iso) <= now.getTime(); });
  const verdict = deriveVerdict({ payload, result, rankings, identities, now, locked, kickoffUnknown, slateStarted, rosterFacts });
  if (kickoffUnknown.length) verdict.evidenceLimits.push({ name: 'kickoff', status: 'UNAVAILABLE', detail: `Kickoff could not be established for ${kickoffUnknown.join(', ')}; confirm their games have not started before moving them.` });
  return { status: 'VERDICT', verdict, text: renderVerdictText(verdict), deeper: renderDeeperText(verdict) };
}

module.exports = {
  ORACLE_LINEUP_FORMAT,
  normalizeLineupPayload,
  normalizeScoring,
  resolveIdentity,
  rankingRows,
  deriveVerdict,
  holdReasons,
  renderVerdictText,
  renderDeeperText,
  renderUnavailableText,
  shortSlot,
  buildOracleLineupVerdict,
  validateWeekEvidence,
  weekWindow,
  separation,
  rosterFactFor
};

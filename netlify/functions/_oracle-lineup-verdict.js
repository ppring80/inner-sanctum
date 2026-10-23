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
const { resolveCurrentNFLWeek } = require('./_current-nfl-week.js');
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

function toSageRosterEntry(entry, identity) {
  if (identity.status === 'RESOLVED') {
    const r = identity.row;
    return { name: r.name, eligiblePositions: [r.position], team: teamCode(r.currentTeam || r.team) || entry.team, sageCompatibleId: r.playerID != null ? String(r.playerID) : null, rosterStatus: entry.rosterStatus };
  }
  return { name: entry.name, eligiblePositions: entry.eligiblePositions, team: entry.team, rosterStatus: entry.rosterStatus };
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
  if (p.projection && p.projection.admissible !== false && p.projection.points != null) bits.push(`${fmt(p.projection.points)} proj`);
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

function deriveVerdict({ payload, result, rankings, identities, now = new Date() }) {
  const record = result.record;
  const evidenceStatus = result.evidenceStatus || {};
  const rows = rankingRows(rankings);
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
    if (identity && identity.status === 'AMBIGUOUS') {
      const teams = [...new Set(identity.candidates.map((r) => teamCode(r.currentTeam || r.team)).filter(Boolean))];
      s.row = { decision: 'HOLD PENDING NEWS', slot, player: `${entry.name}`, reason: `More than one ${entry.eligiblePositions.join('/')} named ${entry.name} is in Week ${payload.week} evidence${teams.length ? ` (${teams.join(', ')})` : ''}, and your lineup did not say which. I won't guess — reconnect your league or confirm his team before kickoff.` };
      return;
    }
    if ((!loc || loc.where === 'UNMATCHED') && identity && identity.status === 'RESOLVED') {
      // Identity is known; SAGE simply has no actionable standing for him
      // (e.g. he is on the inactive list and the status cannot be confirmed).
      const r = identity.row;
      const status = r.status && !/^active$/i.test(r.status) ? String(r.status).toUpperCase() : null;
      const stale = evidenceStatus.availability && evidenceStatus.availability.status !== 'AVAILABLE';
      s.row = { decision: 'HOLD PENDING NEWS', slot, player: idLabel({ name: r.name, position: r.position, team: r.team }, r),
        reason: `SAGE has no Week ${payload.week} standing for ${r.name}${status ? `: his latest listed status is ${status}` : ''}${stale ? `, and the injury report is ${evidenceStatus.availability.status === 'DEGRADED' ? 'stale' : 'unavailable'} (${evidenceStatus.availability.detail})` : ''}. Do not count on him until his status is confirmed before kickoff.` };
      return;
    }
    if (!loc || loc.where === 'UNMATCHED') {
      s.row = { decision: 'HOLD PENDING NEWS', slot, player: `${entry.name}${entry.team ? ` (${entry.team})` : ''}`, reason: `I could not match ${entry.name} to verified Week ${payload.week} evidence${entry.team ? '' : ' — his team is unresolved'}. SAGE has no standing for him, so I won't call this start; confirm his team and status before kickoff.` };
      return;
    }
    if (loc.where === 'UNAVAILABLE' || (loc.where === 'BENCH' && !record.slots.some((sl) => sl.decisionState === 'NO_CALL' && (sl.candidates || []).some((c) => keyOf(c.name, c.position) === keyOf(loc.packet.name, loc.packet.position))))) {
      s.demoted = true;
      return;
    }
    if (loc.where === 'BENCH') {
      s.row = { decision: 'HOLD PENDING NEWS', slot, player: idLabel(loc.packet, rowFor(loc.packet)), reason: `SAGE has no Week ${payload.week} standing to decide this slot; it makes no call rather than guessing.` };
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
      const why = out
        ? `${p.name} is ${a.status ? a.status.toUpperCase() : 'unavailable'}${a.desc ? ` — ${a.desc}` : ''}.`
        : `SAGE starts the bench option instead.`;
      if (s.promotion) {
        const q = s.promotion.packet;
        const caution = holdReasons(q, evidenceStatus).filter((r) => !/injury report is/.test(r));
        const conf = ` ${s.promotion.slot.confidence.label} confidence.`;
        const move = s.slide
          ? ` Slide ${s.slide.loc.packet.name} from ${s.slide.entry.slotLabel || SAGE_SLOT_LABEL[s.slide.entry.slotPos]} into ${slot} and start ${q.name} at ${s.slide.entry.slotLabel || SAGE_SLOT_LABEL[s.slide.entry.slotPos]}.`
          : '';
        verdictRows.push({ decision: 'SWAP', slot, player: idLabel(p, row), replacement: idLabel(q, rowFor(q)),
          reason: `Start ${describe(q, rowFor(q))} over ${out ? p.name : describe(p, row)}. ${why}${move}${conf}${caution.length ? ` Confirm ${q.name} first: ${caution.join('; ')}.` : ''}${identityNote}`.replace(/\s+/g, ' ').trim() });
      } else {
        verdictRows.push({ decision: 'SWAP', slot, player: idLabel(p, row), replacement: null,
          reason: `${why} No eligible bench player can replace him — he cannot help you this week, so find a ${eligibleFor(entry.slotPos).join('/')} on waivers.${identityNote}` });
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
        reason: `SAGE would start ${describe(p, row)}, but ${reasons.join('; ')}. Check the final inactive list before ${game ? 'his ' + game + ' game' : 'kickoff'}${kick}.${alt ? ` If he's out, ${describe(alt, rowFor(alt))} is your best eligible bench option.` : ' You have no eligible bench fallback.'}${identityNote}` });
      return;
    }
    if (s.slidFor) {
      const to = s.slidFor.entry.slotLabel || SAGE_SLOT_LABEL[s.slidFor.entry.slotPos];
      verdictRows.push({ decision: 'KEEP', slot, player: idLabel(p, row),
        reason: `${describe(p, row)} stays in your lineup but moves to ${to} to make room for ${s.slidFor.promotion.packet.name} (see SWAP). ${loc.slot.confidence.label} confidence.${identityNote}`.replace(/\s+/g, ' ').trim() });
      return;
    }
    const close = loc.slot.decisionState === 'CLOSE_CALL_WITHIN_NOISE' || loc.slot.decisionState === 'PROVISIONAL_UNRESOLVED';
    const versus = alt
      ? `${close ? ' Close call over' : ' Beats'} your best eligible bench option, ${describe(alt, rowFor(alt))}.`
      : ' No eligible bench player challenges him.';
    verdictRows.push({ decision: 'KEEP', slot, player: idLabel(p, row),
      reason: `${describe(p, row)}.${versus} ${loc.slot.confidence.label} confidence.${identityNote}`.replace(/\s+/g, ' ').trim() });
  });

  // SAGE starters with no customer starter to replace (an empty slot).
  promotions.filter((x) => !x.used).forEach((x) => verdictRows.push({ decision: 'SWAP', slot: x.slot.slotLabel, player: '(empty slot)', replacement: idLabel(x.packet, rowFor(x.packet)),
    reason: `Fill your open ${x.slot.slotLabel} slot with ${describe(x.packet, rowFor(x.packet))}.` }));

  const benchNotes = benchEntries.map((b) => {
    if (b.identity && b.identity.status === 'AMBIGUOUS') return `${b.entry.name}: more than one player by that name — not evaluated`;
    if (!b.loc || b.loc.where === 'UNMATCHED') return `${b.entry.name}: no verified Week ${payload.week} evidence — not evaluated`;
    if (b.loc.where === 'UNAVAILABLE') { const a = availabilityText(b.loc.packet); return `${b.loc.packet.name}: ${a.status ? a.status.toUpperCase() : 'unavailable'}`; }
    if (b.identity && b.identity.teamConflict) return `${b.loc.packet.name}: your league lists ${b.identity.teamConflict.rosterTeam}, current NFL evidence lists ${b.identity.teamConflict.evidenceTeam}`;
    return null;
  }).filter(Boolean);


  const currentWeek = resolveCurrentNFLWeek(now, SEASON);
  const order = { SWAP: 0, 'HOLD PENDING NEWS': 1, KEEP: 2 };
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
    evidenceLimits: LIMIT_KEYS.map((k) => [k, evidenceStatus[k]])
      .filter(([, t]) => t && t.status !== 'AVAILABLE')
      .map(([k, t]) => ({ name: k, status: t.status, detail: t.detail }))
  };
}

// ─── Customer text (1/3/10, Oracle voice, no invented evidence) ────────

function oracleOpener(rows) {
  const swaps = rows.filter((r) => r.decision === 'SWAP').length;
  const holds = rows.filter((r) => r.decision === 'HOLD PENDING NEWS').length;
  if (swaps) return 'The Oracle has weighed every starter against your bench — change is required.';
  if (holds) return 'The Oracle has weighed every starter against your bench — the scrolls are not yet final.';
  return 'The Oracle has weighed every starter against your bench — your lineup stands.';
}

function renderVerdictText(verdict) {
  const counts = ['SWAP', 'HOLD PENDING NEWS', 'KEEP']
    .map((d) => [d, verdict.rows.filter((r) => r.decision === d).length])
    .filter(([, n]) => n > 0)
    .map(([d, n]) => `${n} ${d}`);
  const lines = [oracleOpener(verdict.rows), `Week ${verdict.week} verdict: ${counts.join(', ')}.`];
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
  lines.push('');
  lines.push('Would you like the deeper SAGE analysis on your lineup?');
  return lines.join('\n');
}

function renderUnavailableText({ week, reason, eligibility }) {
  const lines = [
    `The Oracle will not guess. SAGE's Week ${week} evaluation is unavailable right now (${reason}), so I cannot weigh your starters against your bench.`,
    'Nothing in your lineup is confirmed by this answer.'
  ];
  const rows = (eligibility && Array.isArray(eligibility.rows)) ? eligibility.rows : [];
  const blocked = rows.filter((r) => r.status === 'BYE' || r.status === 'INJURY BLOCKED');
  if (blocked.length) {
    lines.push('');
    lines.push('What the cached evidence does show:');
    blocked.forEach((r) => lines.push(`SWAP — ${r.name} (${r.team}): ${r.status === 'BYE' ? `on bye in Week ${week}` : `listed ${r.injury}`}. Do not start him.`));
  }
  lines.push('');
  lines.push('Ask again shortly, and confirm every starter against the final inactive report before kickoff.');
  return lines.join('\n');
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
  if (rankings && Number(rankings.targetWeek) !== payload.week) {
    rankingsError = `Weekly SAGE returned Week ${rankings.targetWeek} evidence, not Week ${payload.week}`;
    rankings = null;
  }

  const unavailable = async (reason) => {
    let eligibility = null;
    try { eligibility = await (deps.buildLineupEligibility || require('./_sanctum-lineup-eligibility').buildLineupEligibility)(messages); } catch (_) { eligibility = null; }
    return { status: 'UNAVAILABLE', reason, text: renderUnavailableText({ week: payload.week, reason, eligibility }) };
  };
  if (!rankings) return unavailable(rankingsError || 'Weekly SAGE unavailable');

  let schedule = null, scheduleError = null;
  try { schedule = await (deps.readSchedule || readCachedWeeklySchedule)({ season: payload.season, week: payload.week, seasonType: 'reg' }); } catch (error) { scheduleError = error.message; }
  let opportunityStore = null;
  try { opportunityStore = deps.getStore ? deps.getStore({ name: 'opportunity-intel' }) : require('@netlify/blobs').getStore({ name: 'opportunity-intel' }); } catch (_) { opportunityStore = null; }

  const rows = rankingRows(rankings);
  const identities = new Map();
  const roster = [];
  [...payload.starters, ...payload.bench].forEach((entry) => {
    const identity = resolveIdentity(entry, rows);
    identities.set(entry, identity);
    if (identity.status !== 'AMBIGUOUS') roster.push(toSageRosterEntry(entry, identity));
  });
  const slots = payload.slots.map(({ slotLabel, eligiblePositions, count }) => ({ slotLabel, eligiblePositions, count }));

  const result = await (deps.decideSharedLineup || decideSharedLineup)({
    rankings, rankingsError, roster, provider: payload.provider, slots,
    season: payload.season, week: payload.week, scoring: payload.scoring,
    schedule, scheduleError, opportunityStore, now
  });
  if (result.status !== 'DECIDED' || !result.record) return unavailable(result.reason || 'SAGE could not decide');

  const verdict = deriveVerdict({ payload, result, rankings, identities, now });
  return { status: 'VERDICT', verdict, text: renderVerdictText(verdict) };
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
  renderUnavailableText,
  buildOracleLineupVerdict
};

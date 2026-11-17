'use strict';
const { getStore } = require('@netlify/blobs');
const Identity = require('../../player-identity.js');
const STORE = 'weekly-projections';
const FORMATS = ['standard', 'ppr', 'half'];
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const REFRESH_MS = 6 * 60 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const keyFor = (season, week) => `week:${season}:${week}:reg`;
function finite(value) { return value === null || value === undefined || value === '' || typeof value === 'boolean' ? null : Number.isFinite(Number(value)) ? Number(value) : null; }
function scoringKey(value) {
  const key = String(value || '').toLowerCase().replace(/[\s_-]/g, '');
  return ['half','halfppr','0.5ppr'].includes(key) ? 'half' : ['standard','nonppr'].includes(key) ? 'standard' : ['ppr','fullppr'].includes(key) ? 'ppr' : null;
}
function teamKey(value) {
  const team = String(value || '').trim().toUpperCase();
  return ({WSH:'WAS',WFT:'WAS',JAC:'JAX',LA:'LAR',OAK:'LV',SD:'LAC'})[team] || team;
}
function positionKey(value) { const position = Identity.normalizedPosition(value); return position === 'PK' ? 'K' : position === 'DEFENSE' ? 'DEF' : position; }

function offensivePoints(value) {
  const fields = [value.Passing?.passYds,value.Passing?.passTD,value.Passing?.int,value.Rushing?.rushYds,value.Rushing?.rushTD,value.Receiving?.recYds,value.Receiving?.recTD,value.Receiving?.receptions,value.fumblesLost,value.twoPointConversion].map(finite);
  if (fields.some(number => number === null)) return null;
  const [passYds,passTD,interceptions,rushYds,rushTD,recYds,recTD,receptions,fumbles,twoPoints] = fields;
  const standard = passYds/25+passTD*4-interceptions*2+(rushYds+recYds)/10+(rushTD+recTD)*6-fumbles*2+twoPoints*2;
  return {standard:Number(standard.toFixed(2)),half:Number((standard+receptions*.5).toFixed(2)),ppr:Number((standard+receptions).toFixed(2))};
}

function normalizeProjectionResponse(payload, season, week, now = new Date()) {
  const body = payload && payload.body;
  if (!body || !body.playerProjections || !body.teamDefenseProjections) throw new Error('Projection provider did not return playerProjections and teamDefenseProjections.');
  if ((body.season != null && String(body.season) !== String(season)) || (body.week != null && Number(body.week) !== Number(week))) throw new Error('Projection provider returned a different season/week.');
  const rows = [];
  const add = (value, defense = false) => {
    if (!value || typeof value !== 'object') return;
    const position = defense ? 'DEF' : positionKey(value.pos);
    const team = teamKey(defense ? value.teamAbv : value.team);
    const name = defense ? team : value.longName;
    if (!name || !POSITIONS.includes(position) || !team) return;
    const points = defense
      ? Object.fromEntries(FORMATS.map(format => [format, finite(value.fantasyPointsDefault)]))
      : position === 'K'
        ? { standard: finite(value.fantasyPointsDefault?.standard), ppr: finite(value.fantasyPointsDefault?.PPR), half: finite(value.fantasyPointsDefault?.halfPPR) }
        : offensivePoints(value);
    if (!points || FORMATS.some(format => points[format] === null)) return;
    const carries = finite(value.Rushing?.rushAttempts ?? value.Rushing?.rushAtt);
    const targets = finite(value.Receiving?.targets);
    const projectedWorkload = position === 'RB' && carries !== null && carries >= 0 && targets !== null && targets >= 0
      ? {carries, targets, rushYards:finite(value.Rushing?.rushYds), catches:finite(value.Receiving?.receptions), receivingYards:finite(value.Receiving?.recYds)}
      : undefined;
    rows.push({ ...(projectedWorkload ? {projectedWorkload} : {}), playerID: defense ? null : value.playerID || null, name, position, team, points });
  };
  Object.values(body.playerProjections).forEach(value => add(value));
  Object.values(body.teamDefenseProjections).forEach(value => add(value, true));
  const counts = Object.fromEntries(POSITIONS.map(position => [position, rows.filter(row => row.position === position).length]));
  if (rows.length < 100 || POSITIONS.some(position => !counts[position])) throw new Error(`Projection coverage incomplete: ${JSON.stringify(counts)}; previous cache preserved.`);
  const seen = new Set();
  for (const row of rows) {
    const identity = `${row.position}|${row.team}|${Identity.canonicalNameKey(row.name)}`;
    if (seen.has(identity)) throw new Error('Projection provider returned duplicate identities; previous cache preserved.');
    seen.add(identity);
  }
  return { evidenceType: 'weekly-projection-cache', season: String(season), targetWeek: Number(week), seasonType: 'reg', generatedAt: now.toISOString(), source: 'Tank01', scoringBasis: 'Tank01 projected stats; passing TD 4, rushing/receiving TD 6, passing yards 1/25, rushing/receiving yards 1/10, interceptions/fumbles lost -2, two-point conversions 2; receptions 0/0.5/1. K/DEF use Tank01 defaults.', counts, rows };
}

function validCache(cache, season, week, maxAge = MAX_AGE_MS, now = Date.now()) {
  const age = cache && now - Date.parse(cache.generatedAt);
  return Boolean(cache && cache.evidenceType === 'weekly-projection-cache' && String(cache.season) === String(season) && Number(cache.targetWeek) === Number(week) && cache.seasonType === 'reg' && Array.isArray(cache.rows) && cache.rows.length >= 100 && Number.isFinite(age) && age >= 0 && age < maxAge);
}
// Preview callers must supply independently verified facts and a workload baseline
// tied to this exact provider snapshot. No live caller supplies a pilot.
function previewLateRbRows(cache, pilot) {
  if (!pilot) return cache.rows;
  const {event, baseline, asOf, efficiency} = pilot;
  if (!event || !baseline || baseline.asOf !== cache.generatedAt ||
      String(event.season) !== String(cache.season) || event.week !== cache.targetWeek ||
      !efficiency || !['yardsPerCarry','catchRate','yardsPerCatch'].every(
        key => Number.isFinite(efficiency[key]) && efficiency[key] >= 0) ||
      efficiency.catchRate > 1) return cache.rows;
  const find = id => cache.rows.filter(row => row.playerID === id && row.team === event.team && row.position === 'RB');
  const starter = find(event.starterId);
  const successor = find(event.successorId);
  if (starter.length !== 1 || successor.length !== 1) return cache.rows;
  const { replayLeadBack } = require('../../scripts/lib/late-rb-workload-replay');
  const result = replayLeadBack({event, baseline, asOf});
  if (!result.applied) return cache.rows;
  // Conservative pilot: move 75% of vacated opportunities to the lead
  // backup. Leave the remainder unassigned and don't project extra TDs.
  const carries = (result.workload.carries - result.before.carries) * .75;
  const targets = (result.workload.targets - result.before.targets) * .75;
  const catches = targets * efficiency.catchRate;
  const yardagePoints = (carries * efficiency.yardsPerCarry + catches * efficiency.yardsPerCatch) / 10;
  if (!Number.isFinite(yardagePoints + catches)) return cache.rows;
  const delta = {standard:yardagePoints, half:yardagePoints + catches * .5, ppr:yardagePoints + catches};
  return cache.rows.map(row => {
    if (row === starter[0]) return {...row, points:{standard:0, half:0, ppr:0}};
    if (row !== successor[0]) return row;
    return {...row, points:Object.fromEntries(FORMATS.map(format =>
      [format, Number((row.points[format] + delta[format]).toFixed(2))]))};
  });
}
async function readProjectionSnapshot(season, week) {
  const cache = await getStore({ name: STORE }).get(keyFor(season,week), {type:'json'});
  return validCache(cache,season,week) ? cache : null;
}
async function readWeeklyProjections(season, week, scoring, pilot) {
  const format = scoringKey(scoring);
  if (!format) return null;
  try {
    const cache = await readProjectionSnapshot(season,week);
    if (!cache) return null;
    return { ...cache, scoring:format, fresh: Date.now()-Date.parse(cache.generatedAt) < REFRESH_MS, rows:previewLateRbRows(cache, pilot).map(({projectedWorkload, ...row}) => ({...row,projectedPoints:row.points[format]})) };
  } catch (_) { return null; }
}
function matchProjection(player, cache) {
  if (!cache) return null;
  const position = positionKey(player.position || player.pos || player.defaultPosition);
  const team = teamKey(player.team || player.nflTeam || player.teamAbv || player.teamAbbreviation);
  const name = player.name || player.longName || player.fullName || player.playerName;
  if (!position || !name) return null;
  const rows = cache.rows.filter(row => row.position === position && (!team || row.team === team));
  if (position === 'DEF') {
    const defenseTeam = team || teamKey(name);
    const matching = rows.filter(row => row.team === defenseTeam);
    return matching.length === 1 ? matching[0] : null;
  }
  return Identity.resolveRosterPlayer({name,position},rows);
}
function fillProjection(player, cache, preferCache = false) {
  if (preferCache) player = {...player,projectedPoints:null,projection:null};
  if (!preferCache && finite(player.projectedPoints) !== null) return player;
  const matched = matchProjection(player,cache);
  if (!matched) return player;
  return {...player,projectedPoints:matched.projectedPoints,projection:{points:matched.projectedPoints,source:cache.source,season:cache.season,week:cache.targetWeek,scoring:cache.scoring,updatedAt:cache.generatedAt,fresh:cache.fresh,scoringBasis:cache.scoringBasis}};
}
function attachProjectionPositions(positions, cache) {
  const counts = {available:Boolean(cache),source:cache?.source||null,updatedAt:cache?.generatedAt||null,fresh:cache?.fresh||false,matched:0,missing:0};
  for (const position of POSITIONS) {
    positions[position] = (positions[position] || []).map(row => {
      const filled = fillProjection(row,cache);
      if (finite(filled.projectedPoints) === null) { counts.missing++; return filled; }
      counts.matched++;
      if (!filled.projection) return filled;
      const label = cache.scoring === 'half' ? 'half-PPR' : cache.scoring.toUpperCase();
      return {...filled,sageTake:[row.sageTake,`${cache.source} ${label} projection: ${filled.projectedPoints.toFixed(1)} points.`].filter(Boolean).join(' ')};
    });
  }
  return counts;
}
module.exports = { offensivePoints, attachProjectionPositions, STORE, REFRESH_MS, MAX_AGE_MS, keyFor, finite, scoringKey, normalizeProjectionResponse, validCache, readProjectionSnapshot, readWeeklyProjections, matchProjection, fillProjection };

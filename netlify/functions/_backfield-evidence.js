"use strict";
const { playerKey, matchingTransaction } = require("./_injury-transactions");
const { resolveCurrentNFLWeek } = require("./_current-nfl-week");
// Read existing caches only. Depth order is a reported rank, never a workload forecast.
function backfieldEvidence(row, cache, availability, season, week, now = new Date()) {
  const time = new Date(now).getTime(), generated = Date.parse(cache?.generatedAt);
  if (row.position !== "RB" || cache?.source !== "Tank01" || !Number.isFinite(generated) ||
      generated > time || time - generated > 36 * 3600000 ||
      Number(season) !== new Date(time).getUTCFullYear() ||
      Number(week) !== resolveCurrentNFLWeek(new Date(time), Number(season)) ||
      resolveCurrentNFLWeek(new Date(generated), Number(season)) !== Number(week)) return null;
  const unit = cache.teams?.[row.team]?.RB;
  if (!Array.isArray(unit) || !unit.length || unit.length > 8 ||
      unit.some(p => !p?.longName || !Number.isInteger(p.depth) || p.depth < 1) ||
      new Set(unit.map(p => p.depth)).size !== unit.length ||
      new Set(unit.map(p => playerKey(p.longName))).size !== unit.length) return null;
  const candidates = unit.filter(p => row.playerID && p.playerID
    ? String(row.playerID) === String(p.playerID) : playerKey(row.name) === playerKey(p.longName));
  if (candidates.length !== 1) return null;
  const rosterTime = Date.parse(availability?.updatedAt);
  const rosterFresh = availability?.fresh === true && Number.isFinite(rosterTime) &&
    rosterTime <= time && time - rosterTime <= 8 * 3600000;
  const players = [...unit].sort((a,b) => a.depth-b.depth).map(p => {
    const matches = Object.entries(availability?.players || {}).filter(([id,r]) =>
      r.team === row.team && r.pos === "RB" && (p.playerID ? String(id) === String(p.playerID) : playerKey(r.longName) === playerKey(p.longName)));
    const roster = rosterFresh && matches.length === 1 ? matches[0][1] : null;
    const transaction = matchingTransaction({name:p.longName,team:row.team,position:"RB"},season,week,availability?.transactions);
    const rosterStatus = String(roster?.injury?.designation || roster?.rosterStatus || "UNKNOWN").toUpperCase();
    // An activation clears a reserve designation, not a subsequent injury report.
    const useTransaction = transaction && !(transaction.status === "ACTIVE" && ["QUESTIONABLE","DOUBTFUL","OUT"].includes(rosterStatus));
    const status = useTransaction ? transaction.status : rosterStatus;
    return { name:p.longName, playerID:p.playerID || null, depth:p.depth,
      availability:{status:String(status).toUpperCase(), source:(useTransaction ? transaction.source : null) || (roster ? "cached Tank01 roster" : null),
        sourceUrl:(useTransaction ? transaction.sourceUrl : null) || null, reportedAt:(useTransaction ? transaction.reportedAt : null) || (roster ? availability.updatedAt : null)} };
  });
  return {team:row.team, source:cache.source, generatedAt:cache.generatedAt, candidateDepth:candidates[0].depth,
    players, redistributionVerified:false,
    note:"Reported depth order identifies backfield alternatives; it does not establish snap shares, health clearance, or who receives an absent teammate's work."};
}
module.exports = {backfieldEvidence};

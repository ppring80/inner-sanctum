'use strict';
// Read-only eligibility context for Sanctum persona lineup requests.
const { getStore } = require('@netlify/blobs');
const { readCachedWeeklySchedule } = require('./_weekly-sage-schedule-cache');
function lineupRequest(messages) {
  const text = [...(Array.isArray(messages) ? messages : [])].reverse()
    .find(m => m.role === 'user' && typeof m.content === 'string' && /It is NFL Week \d+\. Here is my current lineup:/i.test(m.content))?.content;
  if (!text) {
    const last = [...(Array.isArray(messages) ? messages : [])].reverse()
      .find(m => m.role === 'user' && typeof m.content === 'string')?.content || '';
    const weekMatch = last.match(/\\b(?:NFL\\s+)?Week\\s+(\\d{1,2})\\b/i);
    if (!weekMatch || !/\\b(start|sit|bench|lineup|bye|play|swap|replace)\\b/i.test(last)) return null;
    const week = Number(weekMatch[1]);
    if (week < 1 || week > 18) return null;
    return { week, names: [], freeform: last };
  }
  const week = Number(text.match(/It is NFL Week (\d+)/i)?.[1]);
  if (!Number.isInteger(week) || week < 1 || week > 18) return null;
  const starters = text.match(/STARTERS:\s*([\s\S]*?)(?:\n\nBENCH:|\n\nIMPORTANT GROUNDING:|\n\nPlease analyze|$)/i)?.[1] || '';
  const bench = text.match(/\n\nBENCH:\s*([^\n]*)/i)?.[1] || '';
  const names = [...starters.split('\n').map(line => line.replace(/^[^:]+:\s*/, '').trim()),...bench.split(',').map(s => s.trim())].filter(Boolean);
  return { week, names: [...new Set(names)] };
}
const normalize = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g,'');
function evidenceForPlayer(name, players) {
  const found = Object.values(players || {}).filter(p => normalize(p.longName || p.name) === normalize(name));
  return found.length === 1 ? found[0] : null;
}
async function buildLineupEligibility(messages, season = 2026) {
  const request = lineupRequest(messages);
  if (!request) return null;
  let schedule = null, cache = null;
  try { schedule = await readCachedWeeklySchedule({ season, week:request.week, seasonType:'reg' }); } catch (_) {}
  try { cache = await getStore({name:'player-data'}).get('playerData',{type:'json'}); } catch (_) {}
  const scheduleValid = schedule?.byeClassificationAvailable === true &&
    Array.isArray(schedule.activeTeams) && Array.isArray(schedule.byeTeams) &&
    schedule.activeTeams.length + schedule.byeTeams.length === 32;
  const age = Date.now() - Date.parse(cache?.updatedAt || '');
  const injuryFresh = Number.isFinite(age) && age >= 0 && age <= 26*3600000;
  if (request.freeform) {
    const phrase = normalize(request.freeform);
    const candidates = Object.values(cache?.players || {});
    request.names = [...new Set(candidates
      .map(p => p.longName || p.name)
      .filter(name => name && normalize(name).length >= 8 &&
        phrase.includes(normalize(name))))];
  }
  const rows = request.names.map(name => {
    const player = evidenceForPlayer(name,cache?.players);
    const team = String(player?.team || '').toUpperCase();
    const bye = scheduleValid && schedule.byeTeams.includes(team);
    const scheduled = scheduleValid && schedule.activeTeams.includes(team);
    const designation = player?.injury?.designation || '';
    const blockedInjury = /^(OUT|IR|PUP|NFI|DOUBTFUL|INJURED RESERVE)$/i.test(designation);
    const eligible = Boolean(player && scheduled && injuryFresh && !blockedInjury);
    return { name,team:team||'UNKNOWN',status:bye?'BYE':blockedInjury?'INJURY BLOCKED':eligible?'SCHEDULED; injury snapshot checked':'UNVERIFIED',injury:designation||'none in snapshot',eligible };
  });
  const blockedNames = rows.filter(r=>!r.eligible).map(r=>r.name);
  return { week:request.week,rows,blockedNames,
    text:'WEEK '+request.week+' LINEUP ELIGIBILITY — CACHED EVIDENCE ONLY (schedule '+(schedule?.generatedAt||'unavailable')+', injury '+(cache?.updatedAt||'unavailable')+'). Do not recommend starting, swapping in, or promoting any player unless status is SCHEDULED; injury snapshot checked. BYE and INJURY BLOCKED are prohibited. UNVERIFIED is not eligible for an affirmative substitution. QUESTIONABLE players require a conditional warning and final inactive check. These restrictions apply to Oracle, Trash Lord and Analyst.\n'+rows.map(r=>r.name+' | '+r.team+' | '+r.status+' | injury: '+r.injury).join('\n') };
}
function unsafeRecommendation(reply, blockedNames) {
  const s = String(reply || '');
  return blockedNames.some(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const n = new RegExp(escaped,'i');
    return s.split(/[.!?\n]/).some(sentence => n.test(sentence) &&
      /\b(start|play|insert|promote|swap in|replace .* with|summon|put in|activate)\b/i.test(sentence) &&
      !/\b(do not|don't|never|avoid|cannot|can't|shouldn't|not start|not play)\b/i.test(sentence));
  });
}
module.exports = { lineupRequest, evidenceForPlayer, buildLineupEligibility, unsafeRecommendation };

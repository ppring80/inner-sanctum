'use strict';
const { kickoffForGame } = require('./_super-sage-kickoff.js');
const MINUTE = 60000;
const dailyRuns = now => new Date(now).getUTCDay() === 0 ? 10 : 4;
function criticalCheckpoint(schedule, now = Date.now()) {
  const checkpoints = [];
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  // After the afternoon practice reports, once per reporting day.
  if (['Wed','Thu','Fri','Sat'].includes(parts.weekday) && Number(parts.hour) === 18) checkpoints.push({at:Math.floor(now/3600000)*3600000,reason:'after-practice'});
  for (const game of schedule?.games || []) {
    const kickoff = Date.parse(kickoffForGame(game).kickoff);
    if (!Number.isFinite(kickoff) || now >= kickoff) continue;
    for (const minutes of [75,20]) {
      const at = kickoff-minutes*MINUTE;
      if (now >= at && now-at <= 35*MINUTE) checkpoints.push({at,reason:`pregame-${minutes}`});
    }
  }
  return checkpoints.sort((a,b)=>b.at-a.at)[0] || null;
}
module.exports = { dailyRuns, criticalCheckpoint };

'use strict';
const {playerKey} = require('./_injury-transactions');
const {resolveCurrentNFLWeek} = require('./_current-nfl-week');
// Structured editorial expectations only; prose is never parsed into a role.
const TEAM_HOSTS = Object.freeze({PHI:'www.philadelphiaeagles.com'});
function reportedRoleEvidence(row, stories, season, week, now = new Date()) {
  const time = new Date(now).getTime();
  if (!Number.isFinite(time) || row?.position !== 'RB' || Number(season) !== new Date(time).getUTCFullYear() || Number(week) !== resolveCurrentNFLWeek(new Date(time), Number(season))) return null;
  const reports = (Array.isArray(stories) ? stories : []).filter(story => {
    const r = story?.roleReport, published = Date.parse(story?.publishedAt), verified = Date.parse(story?.verifiedAt);
    let url; try {url = new URL(story.sourceUrl);} catch {return false;}
    return story.editorial === true && story.team === row.team && story.position === row.position && playerKey(story.player) === playerKey(row.name) &&
      r?.type === 'TEAM_REPORTED_EXPECTATION' && r.role === 'LEAD_BACK' && Number(r.season) === Number(season) && Number(r.week) === Number(week) &&
      typeof r.statement === 'string' && r.statement.length > 0 && r.statement.length <= 400 &&
      url.protocol === 'https:' && !url.username && !url.password && url.hostname === TEAM_HOSTS[row.team] && url.pathname.startsWith('/news/') &&
      Number.isFinite(published) && published <= time && time - published < 7*86400000 && resolveCurrentNFLWeek(new Date(published), Number(season)) === Number(week) &&
      Number.isFinite(verified) && verified >= published && verified <= time;
  }).sort((a,b) => Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
  if (!reports.length) return null;
  const story = reports[0];
  return {type:'TEAM_REPORTED_EXPECTATION',role:story.roleReport.role,statement:story.roleReport.statement,
    team:story.team,player:story.player,season:Number(season),week:Number(week),source:story.sourceLabel,
    sourceUrl:story.sourceUrl,publishedAt:story.publishedAt,verifiedAt:story.verifiedAt,
    workloadAmountVerified:false,healthClearanceEstablished:false,projectionAdjustmentEstablished:false};
}
module.exports = {reportedRoleEvidence};

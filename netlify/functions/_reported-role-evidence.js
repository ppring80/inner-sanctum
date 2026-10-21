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
// Structured direct role reports. No network calls or prose-to-role inference.
function reportedRoleEvents(row,stories,season,week,now=new Date()){
 if(!['QB','RB','WR','TE'].includes(row.position)||Number(season)!==new Date(now).getUTCFullYear()||Number(week)!==resolveCurrentNFLWeek(new Date(now),Number(season)))return [];
 return (Array.isArray(stories)?stories:[]).filter(s=>s?.editorial===true&&s.roleReport?.type==='TEAM_REPORTED_ROLE_CHANGE'&&(!s.expiresAt||Date.parse(s.expiresAt)>new Date(now).getTime()))
  .map(s=>({...s.roleReport,player:s.player,position:s.position,team:s.team,sourceUrl:s.sourceUrl,publishedAt:s.publishedAt,verifiedAt:s.verifiedAt,verified:true,fresh:s.roleReport.fresh!==false}))
  .filter(e=>typeof e.statement==='string'&&e.statement.length>0&&e.statement.length<=400&&require('./_super-sage-role-establishment').qualifyEvent(e,{...row,season,week,cutoff:new Date(now).toISOString(),historical:true}).valid)
  .sort((a,b)=>Date.parse(b.effectiveAt)-Date.parse(a.effectiveAt)||[a.kind,a.sourceUrl,a.id||''].join('|').localeCompare([b.kind,b.sourceUrl,b.id||''].join('|')));
}
function applyReportedRoleEvents(positions,stories,season,week,now=new Date()){
 for(const pos of ['QB','RB','WR','TE'])for(const row of positions[pos]||[]){
  const events=reportedRoleEvents(row,stories,season,week,now);
  if(!events.length)continue;
  const prior=row.roleContext;
  row.roleContext={...prior,status:'REASSESS',event:events[0],events,
   priorContexts:prior&&!prior.event?[prior]:[],effectiveAt:events[0].effectiveAt,
   publishedAt:events[0].publishedAt,observedAt:events[0].verifiedAt,
   note:[events[0].statement,prior?.note].filter(Boolean).join(' ')};
 }
 return positions;
}
module.exports = {reportedRoleEvidence,reportedRoleEvents,applyReportedRoleEvents};

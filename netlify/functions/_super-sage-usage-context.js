'use strict';
// Dated official reports about games in the observed sample. These describe
// conditions, not causal effects, current health, or forecast adjustments.
const REPORTS = Object.freeze([
  {id:'nyg-qb-transition-20260924',season:2026,team:'NYG',positions:['WR','TE','RB'],games:['20260921_NYG@LAR'],publishedDate:'2026-09-24',availableFromWeek:3,
    statement:'Jaxson Dart was injured on the opening drive against the Rams. Jameis Winston replaced him. John Harbaugh said that game plan was built for Dart and the next game plan would be built around Winston’s skill set.',
    source:'New York Giants · Official team reporting',sourceUrl:'https://www.giants.com/news/week-3-tennessee-titans-jameis-winston-jaxson-dart-john-harbaugh-brian-burns-malik-nabers-cam-ward'},
  {id:'nabers-shoulder-interruption-20260923',season:2026,team:'NYG',player:'Malik Nabers',positions:['WR'],games:['20260921_NYG@LAR'],publishedDate:'2026-09-23',availableFromWeek:3,
    statement:'Malik Nabers injured his shoulder against the Rams and returned in the first half. The report does not quantify missed snaps or establish how much the injury affected his workload.',
    source:'New York Giants · Official team reporting',sourceUrl:'https://www.giants.com/news/jaxson-dart-knee-injury-update-status-jameis-winston'},
  {id:'nyg-weather-run-plan-20260927',season:2026,team:'NYG',positions:['WR','TE','RB'],games:['20260927_TEN@NYG'],publishedDate:'2026-09-27',availableFromWeek:4,
    statement:'Against Tennessee, in wet and windy conditions, the Giants ran 33 times and attempted 22 passes in Winston’s first start after Dart’s injury.',
    source:'New York Giants · Official team reporting',sourceUrl:'https://www.giants.com/news/instant-analysis-giants-defeat-titans-12-7'}
]);
function usageContext({name,team,position,season,week,games,cutoff = null}) {
  const time = Date.parse(cutoff);
  if (!Number.isFinite(time)) return [];
  const ids = new Set((games || []).map(g=>g.gameID));
  return REPORTS.filter(r=>r.season===Number(season)&&r.team===team&&r.positions.includes(position)&&(!r.player||r.player===name)&&Number(week)>=r.availableFromWeek&&Date.parse(r.publishedDate+'T23:59:59Z')<=time&&r.games.some(id=>ids.has(id)))
    .map(r=>({id:r.id,statement:r.statement,affectedGameIds:r.games.filter(id=>ids.has(id)),publishedDate:r.publishedDate,source:r.source,sourceUrl:r.sourceUrl,causalEffectEstablished:false}));
}
module.exports = {usageContext, REPORTS};

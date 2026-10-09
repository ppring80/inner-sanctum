'use strict';
const {text} = require('./_newswire-sources');
const {canonicalNameKey} = require('../../player-identity');
const STORE = 'nfl-injury-transactions';
// Verified repair seed is a safety net until the first scheduled collection.
// Newer official activation records override it; missing roster fields do not.
const VERIFIED = [{name:'Travis Etienne Jr.',position:'RB',team:'NO',season:2026,status:'IR',reportedAt:'2026-10-01',source:'New Orleans Saints official transaction',sourceUrl:'https://www.neworleanssaints.com/news/ulysses-bentley-iv-david-ojabo-saints-roster-moves-transaction-alert-october-1-2026',reason:'New Orleans placed Etienne on Injured Reserve on October 1.'}];
const TEAMS = {'arizona-cardinals':'ARI','atlanta-falcons':'ATL','baltimore-ravens':'BAL','buffalo-bills':'BUF','carolina-panthers':'CAR','chicago-bears':'CHI','cincinnati-bengals':'CIN','cleveland-browns':'CLE','dallas-cowboys':'DAL','denver-broncos':'DEN','detroit-lions':'DET','green-bay-packers':'GB','houston-texans':'HOU','indianapolis-colts':'IND','jacksonville-jaguars':'JAX','kansas-city-chiefs':'KC','las-vegas-raiders':'LV','los-angeles-chargers':'LAC','los-angeles-rams':'LAR','miami-dolphins':'MIA','minnesota-vikings':'MIN','new-england-patriots':'NE','new-orleans-saints':'NO','new-york-giants':'NYG','new-york-jets':'NYJ','philadelphia-eagles':'PHI','pittsburgh-steelers':'PIT','san-francisco-49ers':'SF','seattle-seahawks':'SEA','tampa-bay-buccaneers':'TB','tennessee-titans':'TEN','washington-commanders':'WSH'};
const playerKey = name => canonicalNameKey(name);
const recordKey = r => `${r.season}:${r.team}:${playerKey(r.name)}`;
function parseTransactions(html, year, month, category, sourceUrl) {
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].find(m => /<th[^>]*>Transaction<\/th>/i.test(m[1]));
  if(!table && /class="[^"]*nfl-o-no-results[^"]*"/.test(html) && /No Transactions Available/.test(html) && html.includes(`/transactions/league/${category}/${year}/${String(month).padStart(2,'0')}`))return [];
  if (!table || !['From','To','Date','Name','Position','Transaction'].every(h => new RegExp(`<th\\b[^>]*>${h}</th>`,'i').test(table[1]))) throw Error('Official transaction table contract changed; previous cache preserved.');
  const records=[];
  for (const [,row] of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);
    if (!cells.length) continue;
    if(cells.length!==6) throw Error('Official transaction row contract changed.');
    const date=text(cells[2]),name=text(cells[3]),transaction=text(cells[5]);
    const status=/^Reserve\/(Injured|PUP|Non-Football Injury|NFI)$/i.test(transaction)?(/^Reserve\/Injured$/i.test(transaction)?'IR':/^Reserve\/PUP$/i.test(transaction)?'PUP':'NFI'):/^Activated (from|off) (Reserve\/)?(Injured|PUP|NFI)/i.test(transaction)?'ACTIVE':null;
    if(!status) continue;
    const slug=/href=["']\/teams\/([^/]+)\//i.exec(cells[1])?.[1];
    const team=TEAMS[slug],match=/^(\d{2})\/(\d{2})$/.exec(date);
    if(!team||!name||!match||Number(match[1])!==month) throw Error('Official transaction identity/date incomplete.');
    const reportedAt=`${year}-${match[1]}-${match[2]}`;
    if(new Date(reportedAt+'T00:00:00Z').toISOString().slice(0,10)!==reportedAt) throw Error('Invalid transaction date.');
    records.push({name,team,position:text(cells[4])||null,status,season:year,reportedAt,source:'NFL official transactions',sourceUrl,reason:`${transaction} transaction reported ${reportedAt}.`});
  }
  return records;
}
function mergeTransactions(previous, incoming, now=new Date().toISOString()) {
  const records=new Map([...VERIFIED,...(previous?.records||[])].map(r=>[recordKey(r),r]));
  const changes=[];
  // Same-day reserve/activation order cannot be inferred from date-only rows.
  // Fail closed until an explicit later-day activation or curated confirmation.
  for(const r of incoming.sort((a,b)=>a.reportedAt.localeCompare(b.reportedAt)||(a.status==='ACTIVE'?-1:1))) {
    const key=recordKey(r),old=records.get(key);
    if(old && (old.reportedAt>r.reportedAt || old.reportedAt===r.reportedAt&&old.status!=='ACTIVE'&&r.status==='ACTIVE')) continue;
    if(!old||old.status!==r.status) changes.push({...r,previousStatus:old?.status||null,detectedAt:now});
    records.set(key,{...r,position:r.position||old?.position||null});
  }
  return {records:[...records.values()],changes};
}
function matchingTransaction(player, season, week, records) {
  const candidates=(records||[]).filter(r=>Number(r.season)===Number(season)&&r.team===player.team&&playerKey(r.name)===playerKey(player.name||player.longName)&&(!r.position||!player.position||r.position===player.position)&&(r.fromWeek||require('./_current-nfl-week').resolveCurrentNFLWeek(new Date(r.reportedAt+'T12:00:00Z'),Number(season)))<=Number(week));
  return candidates.length===1?candidates[0]:null;
}
function roleContext(row, players, transactions, season, week, updatedAt) {
  if(row.position!=='RB')return null;
  const unavailable=new Map();
  for(const r of transactions||[])if(r.team===row.team&&r.status!=='ACTIVE'&&Number(r.fromWeek||require('./_current-nfl-week').resolveCurrentNFLWeek(new Date(r.reportedAt+'T12:00:00Z'),Number(season)))===Number(week)&&matchingTransaction({name:r.name,team:r.team,position:'RB'},season,week,[r])) {
    const roster=Object.values(players||{}).find(p=>p.team===r.team&&playerKey(p.longName)===playerKey(r.name));
    if(r.position==='RB'||roster?.pos==='RB')unavailable.set(playerKey(r.name),r);
  }
  for(const p of Object.values(players||{}))if(p.team===row.team&&p.pos==='RB'&&['IR','OUT','DOUBTFUL','PUP','NFI','RESERVE/INJURED'].includes(String(p.injury?.designation||p.rosterStatus||'').toUpperCase())) {
    const transaction=matchingTransaction({name:p.longName,position:'RB',team:p.team},season,week,transactions);
    if(transaction?.status==='ACTIVE')continue;
    unavailable.set(playerKey(p.longName),{name:p.longName,status:p.injury?.designation||p.rosterStatus,source:'cached Tank01 roster',sourceUrl:null,reportedAt:updatedAt});
  }
  unavailable.delete(playerKey(row.name));
  if(!unavailable.size)return null;
  const absences=[...unavailable.values()];
  return {status:'REASSESS',absences,projectionRecalculated:false,rankRecalculated:false,note:`Backfield role change: ${absences.map(r=>`${r.name} (${r.status})`).join(', ')} unavailable. ${row.name}'s prior workload and weekly rank need reassessment. The absence alone does not establish increased work; the share is not verified. Do not use the old rank alone to recommend dropping this player.`};
}
module.exports={STORE,VERIFIED,playerKey,parseTransactions,mergeTransactions,matchingTransaction,roleContext};

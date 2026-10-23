'use strict';
// Recognize source assertions, not fantasy opinions. Names and team identities
// are supplied by the verified cache; no player-specific rules or model calls.
const {canonicalNameKey}=require('../../player-identity');
const clubs=require('./_official-club-sources.json');
const escape=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function teamMention(text,club){
 const city=club.club.split(' ').slice(0,-1).join(' ');
 const names=[club.club,club.club.split(' ').at(-1),...(clubs.filter(c=>c.club.split(' ').slice(0,-1).join(' ')===city).length===1?[city]:[])];
 return names.some(n=>new RegExp('\\b'+escape(n)+'\\b','i').test(text));
}
const POSITIONS={QB:'quarterback',RB:'running back',WR:'wide receiver',TE:'tight end'};
const uncertainty=/\b(?:if|unless|might|could|may|would|should|expect(?:ed|s)?|predict(?:ed|s|ion)?|project(?:ed|s|ion)?|rumou?rs?|hypothetical|denied|denies|false|not true|not named|never named|have not|has not|no decision|unconfirmed|not confirmed|next week)\b/i;
function sentences(body){
 // Protect initials before finding boundaries. "J.J. McCarthy" is one subject.
 return String(body).replace(/\b(?:[A-Z]\.){1,4}/g,s=>s.replace(/\./g,'\uE000')).replace(/\b(?:Jr|Sr)\./g,s=>s.replace('.','\uE000'))
  .split(/(?<=[.!?])\s+(?=[A-Z"“])/).map(s=>s.replace(/\uE000/g,'.').trim()).filter(Boolean);
}
function namePattern(name){return escape(name).replace(/\\\./g,'\\.?').replace(/\s+/g,'\\s+');}
function claimsForArticle(article,players,{season}){
 const claims=[],unresolved=[],parts=sentences(article.body),title=article.headline||'',nameCounts=new Map();
 for(const p of players){const key=canonicalNameKey(p.longName);nameCounts.set(key,(nameCounts.get(key)||0)+1);}
 for(const p of players){
  if(!POSITIONS[p.pos]||nameCounts.get(canonicalNameKey(p.longName))!==1)continue;
  const club=clubs.find(c=>c.team===p.team);if(!club||article.sourceTeam&&article.sourceTeam!==p.team)continue;
  const teamNames=[club.club,club.club.split(' ').at(-1),club.club.split(' ').slice(0,-1).join(' ')];
  if(!article.sourceTeam&&!teamNames.some(t=>new RegExp('\\b'+escape(t)+'\\b','i').test(title+' '+article.body)))continue;
  const name=new RegExp('\\b'+namePattern(p.longName)+'(?=\\W|$)','i');
  for(let i=0;i<parts.length;i++){
   const statement=parts[i],m=name.exec(statement);if(!m||statement.length>1200)continue;
   const before=statement.slice(0,m.index),after=statement.slice(m.index+m[0].length);
   const historical=/\b(?:last season|last year|past offseason|college|collegiate|preseason)\b/i.test(statement)||[...statement.matchAll(/\b20\d{2}\b/g)].some(x=>Number(x[0])!==Number(season));
   if(historical)continue;
   const explicitPositions=Object.entries(POSITIONS).filter(([,word])=>new RegExp('\\b'+word+'s?\\b','i').test(statement));
   if(explicitPositions.length&&!explicitPositions.some(([pos])=>pos===p.pos))continue;
   // Opponents may be named in the same report; require this player's team
   // in the statement or a team-owned source, rather than banning opponents.
   if(!article.sourceTeam&&!teamNames.some(t=>new RegExp('\\b'+escape(t)+'\\b','i').test(statement)))continue;
   // Bind the team making the announcement to this cached identity. An
   // opponent elsewhere in the sentence is not the announcing club.
   const actor=before.split(/[,;!?]/).at(-1);
   const announcing=/\b(?:(?:have|has)\s+(?:named|announced|selected|moved|demoted|benched)|will\s+start)\b[^.!?]*$/i.test(actor);
   const attributed=after.match(/^\s+(?:will\s+be|is|remains|continues\s+as)\s+(.{0,70}?)\b(?:starter|starting)\b/i)?.[1]||after.match(/^\s+will\s+start\s+for\s+(.{0,60}?)(?=\s+(?:in|at|on|against)|[,.!?]|$)/i)?.[1];
   if(announcing&&clubs.some(c=>c.team!==p.team&&teamMention(actor,c))||attributed&&clubs.some(c=>c.team!==p.team&&teamMention(attributed,c))){
    unresolved.push({player:p.longName,position:p.pos,team:p.team,sourceQuote:statement.slice(0,400),reason:'TEAM_RELATION_CONFLICT'});continue;
   }
   const firstStart=/^\s+(?:made|makes)\s+(?:his|their|the)\s+first\s+(?:(?:career|NFL|regular-season)\s+)*start\b/i.test(after);
   const starts=/^\s+(?:(?:will|shall)\s+start\b|(?:will\s+be|is|remains|continues\s+as)\s+.{0,70}?\b(?:starter|starting\s+(?:quarterback|running back|wide receiver|tight end))\b|(?:has been|was|is)\s+(?:named|appointed|confirmed|selected)\s+.{0,70}?\b(?:starter|starting)\b)/i.test(after)
    ||/\b(?:have|has)\s+(?:named|announced|selected)\s+(?:\w+\s+){0,4}$/i.test(before)&&/^\s+(?:(?:as|their|its|the)\s+){0,3}(?:new\s+)?(?:starter|starting\s+(?:quarterback|running back|wide receiver|tight end))\b/i.test(after)
    ||/\bwill\s+start\s+(?:\w+\s+){0,4}$/i.test(before);
   const loss=/^\s+(?:(?:has been|was|is|will be)\s+benched\b|is\s+no longer\s+.{0,60}?\b(?:starter|starting)\b|will\s+(?:return|move)\s+to\s+.{0,30}?\bbackup\b)/i.test(after)
    ||/\b(?:have|has)\s+(?:moved|demoted|benched)\s+$/i.test(before)&&/\b(?:bench|backup)\b/i.test(after);
   const committee=/\b(?:split|share|sharing|committee|rotate|rotation)\b/i.test(title+' '+statement)&&/\b(?:reps|snaps|carries|backfield|touches)\b/i.test(title+' '+statement);
   if(!firstStart&&!starts&&!loss&&!committee){
    if(/\b(?:starter|starting\s+(?:quarterback|running back|wide receiver|tight end|job|role|assignment|position)|benched|workload|committee|backfield|reps)\b/i.test(statement))unresolved.push({player:p.longName,position:p.pos,team:p.team,sourceQuote:statement.slice(Math.max(0,m.index-80),Math.max(0,m.index-80)+400),reason:'UNSUPPORTED_ROLE_ASSERTION'});
    continue;
   }
   const context=(parts[i-1]||'')+' '+statement;
   const quote=statement.slice(Math.max(0,m.index-80),Math.max(0,m.index-80)+400);
   if(statement.length>400){unresolved.push({player:p.longName,position:p.pos,team:p.team,sourceQuote:quote,reason:'LONG_ASSERTION_REQUIRES_REVIEW'});continue;}
   const ambiguous=(!loss&&/\b(?:not|never|neither)\b[^,.!?]{0,80}\b(?:start|starter|starting|named)\b/i.test(statement))||/\bstart\s+(?:practicing|practice|training|rehab|his recovery|a business)\b/i.test(statement)||uncertainty.test(title)||uncertainty.test(statement)||/^['"“]/.test(statement)||/hypothetical|false|denied|denies/i.test(context)||/^\s*and\b/i.test(after)||/\bco[- ]starter/i.test(statement);
   if(ambiguous){unresolved.push({player:p.longName,position:p.pos,team:p.team,sourceQuote:quote,reason:'CONDITIONAL_OR_AMBIGUOUS_ROLE_ASSERTION'});continue;}
   const kind=loss?'ROLE_LOSS':committee&&!firstStart&&!starts?'ROLE_REASSESSMENT':/\bremains|continues\s+as\b/i.test(after)?'CONFIRMATION':'ROLE_GAIN';
   claims.push({player:p.longName,position:p.pos,team:p.team,kind,explicitRole:kind==='ROLE_LOSS'?'BACKUP':kind==='ROLE_REASSESSMENT'?'UNRESOLVED':'STARTER',sourceQuote:quote});
  }
 }
 // Contradictory assertions are a reason to retain reassessment, never to pick
 // whichever sentence appeared first. All supporting source text is retained.
 const output=[];
 for(const p of new Set(claims.map(c=>[c.player,c.position,c.team].join('|')))){
  const matches=claims.filter(c=>[c.player,c.position,c.team].join('|')===p),kinds=new Set(matches.map(c=>c.kind));
  if(kinds.has('ROLE_GAIN')&&kinds.has('ROLE_LOSS'))output.push({...matches[0],kind:'ROLE_REASSESSMENT',explicitRole:'UNRESOLVED',sourceQuote:matches[0].sourceQuote,conflictingSourceQuotes:matches.map(c=>c.sourceQuote)});
  else output.push(...matches.filter((c,i)=>matches.findIndex(x=>x.kind===c.kind)===i));
 }
 return {claims:output,unresolved};
}
module.exports={sentences,claimsForArticle};

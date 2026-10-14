'use strict';
// Read-only saved-source inventory. This never qualifies an adapter or collection.
const fs=require('node:fs'),{createHash}=require('node:crypto');
const {rosterSnapshot}=require('../netlify/functions/_club-availability-reconciliation');
const {officialUrl}=require('../netlify/functions/_official-club-transactions');
function analyzePage({team,kind,url,status,responseUrl,html,observedAt}){
 officialUrl(url,team);const result={team,kind,url,status,responseUrl,sha256:createHash('sha256').update(html).digest('hex'),coveragePassed:false};
 if(responseUrl){try{officialUrl(responseUrl,team);}catch{result.error='UNAPPROVED_RESPONSE_ORIGIN';return result;}}
 if(String(status)!=='200'){result.error='SOURCE_HTTP_'+status;return result;}
 if(kind==='roster'){
  try{const snapshot=rosterSnapshot(html,{team,sourceUrl:url,observedAt});result.players=snapshot.rows.length;result.sections=[...new Set(snapshot.rows.map(p=>p.section))];result.reservePlayers=snapshot.rows.filter(p=>/^Reserve\//.test(p.section)).map(p=>({name:p.name,status:p.status,section:p.section}));}catch(e){result.error=e.message;}
 }else if(kind==='transactions'){
  const tables=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];result.tables=tables.length;result.datedRows=tables.reduce((n,m)=>n+[...m[1].matchAll(/<td\b[^>]*>\s*(?:<[^>]+>\s*)*\d{2}\/\d{2}/gi)].length,0);if(!result.datedRows)result.error='DATED_TRANSACTION_TABLE_UNRECOGNIZED';
 }else if(kind==='news'){
  result.storyModules=[];
  for(const [,body]of html.matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)){
   try{const d=JSON.parse(body);if(d.Name==='EditorialList'&&d.Module?.Type==='stories')result.storyModules.push({sectionTitle:d.Module.SectionTitle??null,selection:d.Module.Selection??null,category:d.Module.Category??null,count:d.Module.Count,skip:d.Module.Skip,view:d.Module.View});}catch{}
  }
  const links=[];
  for(const [,tag]of html.matchAll(/(<a\b[^>]*>)/gi)){
   const href=/\bhref=["']([^"']+)["']/.exec(tag)?.[1],label=/(?:title|data-link_name|aria-label)=["']([^"']+)["']/.exec(tag)?.[1]||'';
   if(!href||!/all.news|latest|headlines|\/news\/(?:all|index|archive|articles)(?:[-/]|$)/i.test(label+' '+href))continue;
   try{const target=officialUrl(new URL(href,url).href,team);if(new URL(target).pathname.startsWith('/news'))links.push({url:target,label});}catch{}
  }
  result.candidateIndexes=[...new Map(links.map(l=>[l.url,l])).values()];if(!result.storyModules.length&&!result.candidateIndexes.length)result.error='NEWS_DISCOVERY_FORMAT_UNRECOGNIZED';
 }
 return result;
}
if(require.main===module){
 const [manifestPath,outputPath]=process.argv.slice(2);if(!manifestPath||!outputPath)throw Error('Usage: node scripts/audit-official-club-page-formats.js <fetch-manifest.json> <output.json>');
 const observedAt=new Date().toISOString(),sources=JSON.parse(fs.readFileSync(manifestPath,'utf8')).map(r=>analyzePage({...r,observedAt,html:fs.readFileSync(r.path,'utf8')}));
 const report={scope:'Read-only page-format inventory; not discovery completeness or freshness qualification',observedAt,teams:[...new Set(sources.map(s=>s.team))],sources,coveragePassed:false,productionEnabled:false};fs.writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({teams:report.teams.length,sourcePages:sources.length,errors:sources.filter(s=>s.error).map(s=>({team:s.team,kind:s.kind,error:s.error}))}));
}
module.exports={analyzePage};

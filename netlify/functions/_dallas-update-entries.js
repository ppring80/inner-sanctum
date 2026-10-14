'use strict';
// Dated update entries only. No player status promotion or freshness authority.
const {officialUrl}=require('./_official-club-transactions');
const clean=s=>String(s).replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const months={January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12,Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Sept:9,Oct:10,Nov:11,Dec:12};
function updateEntries(html,{sourceUrl,season,observedAt}){
 officialUrl(sourceUrl,'DAL');if(!/^\/news\/updates-[a-z]+-\d{4}$/.test(new URL(sourceUrl).pathname)||!Number.isInteger(season)||!Number.isFinite(Date.parse(observedAt)))throw Error('Dallas update inputs invalid.');
 const entries=[],unresolved=[];let reportedAt=null;
 for(const [,body] of html.matchAll(/<div\b[^>]*class="[^"]*\bnfl-c-body-part--text\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)){
  const heading=/<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(body);
  if(heading){const m=/^([A-Z][a-z]+)\.?\s+(\d{1,2})$/.exec(clean(heading[1]));if(!m||!months[m[1]]){reportedAt=null;unresolved.push({reason:'UPDATE_DATE_HEADING_UNRECOGNIZED'});continue;}
   reportedAt=`${season}-${String(months[m[1]]).padStart(2,'0')}-${m[2].padStart(2,'0')}`;
   if(new Date(reportedAt).toISOString().slice(0,10)!==reportedAt||reportedAt>observedAt.slice(0,10)){reportedAt=null;unresolved.push({reason:'UPDATE_DATE_INVALID_OR_FUTURE'});}continue;
  }
  const text=clean(body);if(!text)continue;
  if(!reportedAt){unresolved.push({reason:'UPDATE_WITHOUT_DATE',text});continue;}
  entries.push({reportedAt,sourceUrl,observedAt,sourceText:text,customerEligible:false});
 }
 return {team:'DAL',entries,unresolved,complete:entries.length>0&&unresolved.length===0,customerEligible:false};
}
module.exports={updateEntries};

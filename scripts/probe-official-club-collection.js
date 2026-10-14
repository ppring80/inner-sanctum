'use strict';
// Read-only, bounded live qualification. The supplied cache is never changed.
const fs=require('node:fs');
const {clubs}=require('../netlify/functions/_official-club-transactions');
const {collectClub}=require('../netlify/functions/_official-club-collection');
async function main(){
 const [cachePath,since,...teamCodes]=process.argv.slice(2);
 if(!cachePath||!since||!teamCodes.length)throw Error('Usage: node scripts/probe-official-club-collection.js CACHE_JSON YYYY-MM-DD TEAM [TEAM...]');
 const teams=[...new Set(teamCodes)];if(teams.length>4)throw Error('This controlled probe permits at most four clubs.');
 const selected=teams.map(team=>{const c=clubs.find(c=>c.team===team);if(!c)throw Error('Unknown team '+team);return c;});
 const cache=JSON.parse(fs.readFileSync(cachePath,'utf8'));if(!Array.isArray(cache.records))throw Error('Cache records missing.');
 const reports=[];
 for(const c of selected){const r=await collectClub(c,{since,identities:cache.records,maxArticles:2,maxRequests:4,newsUrl:c.team==='NO'?c.origin+'/news/latest-headlines':c.team==='LAC'?c.origin+'/news/transactions':c.team==='DAL'?c.origin+'/news/all-news/':undefined});reports.push(r);console.error(JSON.stringify({team:r.team,requests:r.requests,errors:r.errors.length,complete:r.coverage.complete}));}
 console.log(JSON.stringify({readOnly:true,reportedAt:new Date().toISOString(),reports},null,2));
 process.exitCode=reports.every(r=>r.coverage.complete)?0:2;
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});

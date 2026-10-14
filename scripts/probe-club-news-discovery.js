'use strict';
// Read-only qualification: public official pages only, no cache or model calls.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const exec=promisify(execFile);
const profiles=require('../netlify/functions/_club-news-profiles.json');
const {officialUrl}=require('../netlify/functions/_official-club-transactions');
const {discoverNews}=require('../netlify/functions/_club-news-discovery');
async function main(){
 const [directory,since,...teams]=process.argv.slice(2);
 if(!directory||!since||!teams.length||teams.length>4||new Set(teams).size!==teams.length)throw Error('Usage: node scripts/probe-club-news-discovery.js OUTPUT_DIRECTORY YYYY-MM-DD TEAM [up to four unique teams]');
 const selected=teams.map(team=>{const profile=profiles.find(p=>p.team===team);if(!profile)throw Error('No verified card profile for '+team);return profile;});
 fs.mkdirSync(directory,{recursive:true});
 const started=Date.now(),deadline=started+12*60000,asOf=new Date(started).toISOString(),sources=[];
 let requests=0,nextStart=started;
 async function read(url,team){
  officialUrl(url,team);
  if(requests>=360||Date.now()>=deadline)throw Error('Read-only discovery budget exhausted.');
  const reservation=Math.max(Date.now(),nextStart);nextStart=reservation+1000;
  if(reservation>=deadline)throw Error('Read-only discovery deadline exceeded.');
  requests++;
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,reservation-Date.now())));
  const filename=createHash('sha256').update(url).digest('hex')+'.html',file=path.join(directory,filename);
  const record={team,url,path:file};sources.push(record);
  try{
   const {stdout}=await exec('curl',['-sS','--max-time',String(Math.max(0.001,Math.min(12,(deadline-Date.now())/1000))),'-o',file,'-w','%{http_code}\n%{url_effective}',url],{maxBuffer:4096});
   const [status,responseUrl]=stdout.trim().split('\n');Object.assign(record,{status:Number(status),responseUrl,observedAt:new Date().toISOString()});
   officialUrl(responseUrl,team);
   if(status!=='200')throw Error('Official club HTTP '+status);
   if(Date.now()>=deadline)throw Error('Read-only discovery deadline exceeded.');
   const html=fs.readFileSync(file,'utf8');record.sha256=createHash('sha256').update(html).digest('hex');return html;
  }catch(error){record.error=error.message;throw error;}
 }
 const reports=[];
 // Four article requests at most; finish one club before starting the next.
 for(const profile of selected){
  try{
   const report=await discoverNews({profile,read:url=>read(url,profile.team),since,asOf,parallel:4});
   reports.push(report);console.error(JSON.stringify({team:profile.team,requests,discoveryPassed:report.discoveryPassed,articles:report.articles.length,errors:report.errors.length,chronological:report.chronological,boundaryReached:report.boundaryReached}));
  }catch(error){reports.push({team:profile.team,discoveryPassed:false,coveragePassed:false,error:error.message});}
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({readOnly:true,asOf,requests,reports,sources,productionEnabled:false},null,2)+'\n');
 }
 process.exitCode=reports.every(report=>report.discoveryPassed)?0:2;
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});

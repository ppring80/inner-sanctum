'use strict';
const {randomUUID,timingSafeEqual}=require('node:crypto');
const {connectLambda,getDeployStore}=require('@netlify/blobs');
const {readWeeklyProjections,readProjectionSnapshot}=require('./_weekly-projections');
const {reviewWorkloadFlag}=require('../../scripts/lib/manual-workload-flag');
const response=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
function authorized(headers){
  const expected=Buffer.from(process.env.SAGE_MANUAL_WORKLOAD_TOKEN||'');
  const value=Object.entries(headers||{}).find(([key])=>key.toLowerCase()==='authorization')?.[1];
  const actual=Buffer.from(/^Bearer (.+)$/.exec(value||'')?.[1]||'');
  return expected.length>=32 && actual.length===expected.length && timingSafeEqual(actual,expected);
}
function source(value){
  try { const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.href.length<=512; }
  catch { return false; }
}
async function preview(pilot,now){
  const e=pilot.event;
  const read=(format,p)=>readWeeklyProjections(e.season,e.week,format,p);
  const results=await Promise.all(['standard','half','ppr'].map(async scoring=>{
    const [before,after]=await Promise.all([read(scoring),read(scoring,{...pilot,asOf:now})]);
    if(!before||!after||before.generatedAt!==pilot.baseline.asOf||after.generatedAt!==before.generatedAt)return null;
    const find=(cache,id)=>cache.rows.find(r=>r.playerID===id&&r.position==='RB'&&r.team===e.team)?.projectedPoints;
    const old=find(before,e.successorId), next=find(after,e.successorId);
    return Number.isFinite(old)&&Number.isFinite(next)&&next>old&&find(after,e.starterId)===0 ? [scoring,{before:old,after:next}]:null;
  }));
  return results.every(Boolean)?Object.fromEntries(results):null;
}
exports.handler=async event=>{
  if(process.env.SAGE_MANUAL_WORKLOAD_PREVIEW!=='true'||process.env.CONTEXT!=='deploy-preview')return response(404,{error:'Unavailable'});
  if(event.httpMethod!=='POST')return response(405,{error:'POST required'});
  if(!authorized(event.headers))return response(401,{error:'Authorization required'});
  if(typeof event.body!=='string'||event.body.length>8192||event.isBase64Encoded)return response(400,{error:'Invalid request'});
  let input;try{input=JSON.parse(event.body);}catch{return response(400,{error:'Invalid JSON'});}
  if(!input||!['players','preview','approve','withdraw'].includes(input.action))return response(400,{error:'Invalid action'});
  const now=new Date().toISOString();
  const actor={id:'manual-workload-preview-admin',isAdmin:true};
  try{
    connectLambda(event);
    const store=getDeployStore({name:'sage-manual-workload-preview',consistency:'strong'});
    if(input.action==='players'){
      if(!Number.isInteger(input.season)||!Number.isInteger(input.week)||input.week<1||input.week>18||!/^[A-Z]{2,3}$/.test(input.team||''))return response(400,{error:'Enter a season, week and NFL team.'});
      const snapshot=await readProjectionSnapshot(input.season,input.week);
      const players=(snapshot?.rows||[]).filter(r=>r.position==='RB'&&r.team===input.team&&r.playerID&&r.projectedWorkload).map(r=>({id:r.playerID,name:r.name}));
      return players.length>=2?response(200,{players}):response(409,{error:'Tank01 workload is unavailable for this team and week.'});
    }
    if(input.action==='preview'){
      const {event:e}=input;
      if(!e||!Number.isInteger(e.season)||!Number.isInteger(e.week)||e.week<1||e.week>18||
         !source(e.statusSource)||!source(e.roleSource)||input.evidenceReviewed!==true)
        return response(400,{error:'Game, workload and reviewed sources required'});
      // Admin attests to both sources; URLs are recorded and never fetched here.
      const snapshot=await readProjectionSnapshot(e.season,e.week);
      const lookup=id=>(snapshot?.rows||[]).filter(r=>r.position==='RB'&&r.team===e.team&&r.playerID===id);
      const [a,b]=[lookup(e.starterId),lookup(e.successorId)];
      const starter=a.length===1&&a[0].projectedWorkload, backup=b.length===1&&b[0].projectedWorkload;
      if(!starter||!backup||![backup.rushYards,backup.catches,backup.receivingYards].every(x=>Number.isFinite(x)&&x>=0)||
         !backup.carries||!backup.targets||!backup.catches||backup.catches>backup.targets)
        return response(409,{error:'Tank01 workload or backup efficiency is unavailable for these players.'});
      const workload=(w,id)=>({id,carries:w.carries,targets:w.targets,goalLineCarries:0});
      const baseline={season:e.season,week:e.week,team:e.team,asOf:snapshot.generatedAt,starter:workload(starter,e.starterId),successor:workload(backup,e.successorId)};
      const efficiency={yardsPerCarry:backup.rushYards/backup.carries,catchRate:backup.catches/backup.targets,yardsPerCatch:backup.receivingYards/backup.catches};
      const pilot={event:{...e,statusVerified:true,roleVerified:true},baseline,efficiency};
      const points=await preview(pilot,now);
      if(!points)return response(409,{error:'No adjustment for the current baseline'});
      const id=randomUUID();
      await store.setJSON('draft:'+id,{id,revision:id,state:'draft',event:pilot.event,pilot});
      return response(201,{id,points});
    }
    if(typeof input.id!=='string'||!/^[a-f0-9-]{36}$/.test(input.id))return response(400,{error:'Invalid flag ID'});
    const key=input.id;
    const draft=await store.get('draft:'+key,{type:'json'});
    if(!draft)return response(404,{error:'Flag missing'});
    if(await store.get('withdrawn:'+key,{type:'json'}))return response(409,{error:'Flag withdrawn'});
    const approved=await store.get('approved:'+key,{type:'json'});
    if(input.action==='withdraw'){
      if(!approved)return response(409,{error:'Flag not approved'});
      const result=reviewWorkloadFlag({draft:approved,action:'withdraw',actor,now});
      await store.setJSON('withdrawn:'+key,result);
      return response(200,{id:key,state:result.state});
    }
    if(approved)return response(409,{error:'Flag already approved'});
    const points=await preview(draft.pilot,now);
    if(!points)return response(409,{error:'Preview no longer valid'});
    const record=reviewWorkloadFlag({draft,action:'approve',actor,now,preview:{applied:true,flagId:key,revision:key,baselineAt:draft.pilot.baseline.asOf}});
    await store.setJSON('approved:'+key,record);
    return response(200,{id:key,state:record.state,points});
  }catch{return response(503,{error:'Workload flag service unavailable'});}
};

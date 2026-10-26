"use strict";
const {getStore}=require('@netlify/blobs');
const {origin}=require('./synthetic-fixture');
const {create,STORE}=require('./synthetic-session');
function session(){return create({store:()=>getStore({name:STORE}),expected:require('./synthetic-expected.json'),canonical:require('../netlify/functions/league-snapshot').acceptanceCanonical,assertions:cases=>require('./espn-preservation-assertions').run(cases)});}
const json=(statusCode,value,headers={})=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers},body:JSON.stringify(value)});
async function handler(event){
 try{
  if(event.httpMethod!=='POST'||event.headers?.origin!==origin)return json(403,{ok:false,errorCategory:'ORIGIN_REJECTED'});
  if(Object.keys(event.headers||{}).some(k=>k.toLowerCase()==='authorization')||Buffer.byteLength(event.body||'')>20000)return json(403,{ok:false,errorCategory:'REQUEST_REJECTED'});
  const body=JSON.parse(event.body||'{}');
  if(body.action==='begin'&&Object.keys(body).length===1){const r=await session().begin();return r.ok?json(200,{ok:true},{'Set-Cookie':`__Host-sage-synthetic=${r.token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600`}):json(409,r);}
  if(body.action!=='upload'||Object.keys(body).sort().join(',')!=='action,caseId,snapshot')return json(400,{ok:false,errorCategory:'REQUEST_REJECTED'});
  const token=(event.headers.cookie||'').split('; ').find(s=>s.startsWith('__Host-sage-synthetic='))?.split('=')[1];
  const r=await session().upload(token,body.caseId,body.snapshot);return json(r.ok?200:r.errorCategory==='UNAUTHORIZED'?401:409,r);
 }catch{return json(400,{ok:false,errorCategory:'REQUEST_REJECTED'});}
}
function register(server,z){for(const [name,method]of[['get_espn_stored_assertions','inspect'],['cleanup_espn_synthetic','cleanup'],['verify_espn_cleanup','verifyAbsent']])server.registerTool(name,{description:'Synthetic acceptance only. Sanitized results; no private roster input.',inputSchema:z.object({}).strict(),annotations:{readOnlyHint:method==='inspect',destructiveHint:false}},async()=>{const result=await session()[method]();return{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};});}
module.exports={handler,register};

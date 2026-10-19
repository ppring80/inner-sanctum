'use strict';
const { connectLambda, getStore } = require('@netlify/blobs');
const {editorialStories,VERIFIED_AT}=require('./_newswire-editorial');
const {mergeStories}=require('./refresh-sage-newswire');
const {currentNewswire}=require('./_newswire-availability');
function fallback(headers,error){const stories=editorialStories();return {statusCode:stories.length?200:503,headers,body:JSON.stringify({version:3,mode:'editorial',updatedAt:VERIFIED_AT,stories,automaticRefreshPending:true,error:error||null})};}
exports.handler = async event => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  connectLambda(event);
  let playerCache=null;
  try { playerCache=await getStore({name:'player-data'}).get('playerData',{type:'json'}); } catch (_) {}
  const finish=response=>{const body=JSON.parse(response.body);const current=currentNewswire(body.stories||[],playerCache);return {...response,statusCode:current.stories.length?200:response.statusCode,body:JSON.stringify({...body,...current,updatedAt:current.availability.fresh?current.availability.updatedAt:body.updatedAt})};};
  try {
    const cached = await getStore({ name: 'sage-newswire' }).get('latest', { type: 'json' });
    const age = cached && Date.now() - Date.parse(cached.updatedAt);
    if (!cached || cached.mode !== 'editorial-with-sources' || !Array.isArray(cached.stories) || !Number.isFinite(age) || age > 24 * 60 * 60 * 1000 || age < 0) {
      return finish(fallback(headers,'Automatic source refresh is pending; verified editorial reports remain available.'));
    }
    const stories=mergeStories(editorialStories(),cached.stories);
    return finish({ statusCode: 200, headers, body: JSON.stringify({ ...cached, stories, automaticUpdatedAt:cached.updatedAt, updatedAt:Date.parse(VERIFIED_AT)>Date.parse(cached.updatedAt)?VERIFIED_AT:cached.updatedAt, editorialVerifiedAt:VERIFIED_AT, collection:{...cached.collection,editorialStories:stories.filter(s=>s.editorial).length}, stale: false }) });
  } catch (_) {
    return finish(fallback(headers,'Automatic source cache could not be read; verified editorial reports remain available.'));
  }
};

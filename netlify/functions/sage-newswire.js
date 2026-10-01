'use strict';
const { connectLambda, getStore } = require('@netlify/blobs');
const {editorialStories,VERIFIED_AT}=require('./_newswire-editorial');
function fallback(headers,error){const stories=editorialStories();return {statusCode:stories.length?200:503,headers,body:JSON.stringify({version:3,mode:'editorial',updatedAt:VERIFIED_AT,stories,automaticRefreshPending:true,error:error||null})};}
exports.handler = async event => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  connectLambda(event);
  try {
    const cached = await getStore({ name: 'sage-newswire' }).get('latest', { type: 'json' });
    const age = cached && Date.now() - Date.parse(cached.updatedAt);
    if (!cached || cached.mode !== 'editorial-with-sources' || !Array.isArray(cached.stories) || !Number.isFinite(age) || age > 24 * 60 * 60 * 1000 || age < 0) {
      return fallback(headers,'Automatic source refresh is pending; verified editorial reports remain available.');
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ...cached, stale: false }) };
  } catch (_) {
    return fallback(headers,'Automatic source cache could not be read; verified editorial reports remain available.');
  }
};

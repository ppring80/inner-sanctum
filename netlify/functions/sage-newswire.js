'use strict';
const { connectLambda, getStore } = require('@netlify/blobs');
exports.handler = async event => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  connectLambda(event);
  try {
    const cached = await getStore({ name: 'sage-newswire' }).get('latest', { type: 'json' });
    const age = cached && Date.now() - Date.parse(cached.updatedAt);
    if (!cached || !Array.isArray(cached.stories) || !Number.isFinite(age) || age > 24 * 60 * 60 * 1000 || age < 0) {
      return { statusCode: 503, headers, body: JSON.stringify({ stories: [], stale: true, error: 'Current Newswire evidence is unavailable; scheduled refresh will retry.' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ...cached, stale: false }) };
  } catch (_) {
    return { statusCode: 503, headers, body: JSON.stringify({ stories: [], error: 'Newswire cache could not be read.' }) };
  }
};

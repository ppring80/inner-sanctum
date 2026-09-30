'use strict';
const { connectLambda, getStore } = require('@netlify/blobs');
const { requireTank01RefreshAuthorization } = require('./_tank01-refresh-guard.js');
const { requireTank01Budget } = require('./_tank01-daily-budget.js');

function normalizeStories(items, players = {}) {
  const stories = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item.title !== 'string' || !item.title.trim()) continue;
    let link;
    try { link = new URL(item.link); } catch (_) { continue; }
    if (link.protocol !== 'https:' || seen.has(link.href)) continue;
    seen.add(link.href);
    const match = /^([^:]+):/.exec(item.title);
    const player = match ? match[1].trim() : 'NFL News';
    const identity = Object.values(players).find(row => String(row.longName || '').toLowerCase() === player.toLowerCase());
    const time = item.publishedAt || item.pubDate || item.date || item.timestamp;
    const parsed = time ? new Date(time) : null;
    stories.push({
      id: link.href, player, team: identity && identity.team || '', position: identity && identity.pos || '',
      status: 'Source report', statusTone: 'monitor', headline: item.title.trim(),
      summary: 'Open the linked report for the full context.',
      sageImpact: 'Check the report against your player’s current injury designation and role before changing your lineup. This headline alone does not establish availability.',
      sourceLabel: link.hostname, sourceUrl: link.href,
      publishedAt: parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null,
      featured: stories.length < 3
    });
    if (stories.length >= 20) break;
  }
  return stories;
}

exports.handler = async event => {
  const denied = requireTank01RefreshAuthorization(event);
  if (denied) return denied;
  connectLambda(event);
  const budget = await requireTank01Budget(event, { job: 'refresh-sage-newswire', calls: 1 });
  if (budget) return budget;
  const host = 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';
  try {
    const response = await fetch(`https://${host}/getNFLNews?fantasyNews=true&maxItems=20`, {
      headers: { 'x-rapidapi-host': host, 'x-rapidapi-key': process.env.TANK01_API_KEY }
    });
    if (!response.ok) throw new Error(`News provider returned HTTP ${response.status}`);
    const payload = await response.json();
    let players = {};
    try { players = (await getStore({ name: 'player-data' }).get('playerData', { type: 'json' }))?.players || {}; } catch (_) {}
    const stories = normalizeStories(Array.isArray(payload.body) ? payload.body : [], players);
    if (!stories.length) throw new Error('News provider returned no usable headlines.');
    await getStore({ name: 'sage-newswire' }).setJSON('latest', { version: 2, updatedAt: new Date().toISOString(), mode: 'source-headlines', stories });
    return { statusCode: 200, body: JSON.stringify({ cached: true, stories: stories.length }) };
  } catch (error) {
    console.error('SAGE_NEWSWIRE_REFRESH_FAILED', error.message);
    return { statusCode: 502, body: JSON.stringify({ cached: false, error: 'Newswire refresh failed; previous cache preserved.' }) };
  }
};
exports.normalizeStories = normalizeStories;

'use strict';
const { connectLambda, getStore } = require('@netlify/blobs');
const { requireTank01RefreshAuthorization } = require('./_tank01-refresh-guard.js');
const { requireTank01Budget } = require('./_tank01-daily-budget.js');
const { resolveCurrentNFLWeek } = require('./_current-nfl-week.js');
const { STORE, keyFor, normalizeProjectionResponse } = require('./_weekly-projections.js');

exports.handler = async event => {
  const denied = requireTank01RefreshAuthorization(event);
  if (denied) return denied;
  connectLambda(event);
  const season = new Date().getUTCFullYear();
  const week = Number(event.queryStringParameters?.week || resolveCurrentNFLWeek(new Date(),season));
  if (!Number.isInteger(week) || week < 1 || week > 18 || (event.queryStringParameters?.season && Number(event.queryStringParameters.season) !== season)) return {statusCode:400,body:JSON.stringify({error:'Projection refresh supports the current NFL season and Weeks 1–18.'})};
  const budget = await requireTank01Budget(event,{job:'refresh-weekly-projections',calls:1});
  if (budget) return budget;
  const host = 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';
  try {
    const response = await fetch(`https://${host}/getNFLProjections?week=${week}&itemFormat=map`,{headers:{'x-rapidapi-host':host,'x-rapidapi-key':process.env.TANK01_API_KEY}});
    if (!response.ok) throw new Error(`Projection provider returned HTTP ${response.status}`);
    const cache = normalizeProjectionResponse(await response.json(),season,week);
    await getStore({name:STORE}).setJSON(keyFor(season,week),cache);
    return {statusCode:200,body:JSON.stringify({cached:true,week,counts:cache.counts})};
  } catch (error) {
    console.error('WEEKLY_PROJECTIONS_FAILED',error.message);
    return {statusCode:502,body:JSON.stringify({cached:false,error:error.message})};
  }
};

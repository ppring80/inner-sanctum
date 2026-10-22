'use strict';
const { connectLambda, getStore } = require('@netlify/blobs');
const { inspectJobs, resolveCurrentNFLWeek } = require('./_weekly-refresh-recovery.js');
exports.handler = async event => {
  if (event.httpMethod !== 'GET') return { statusCode: 405 };
  const diagnostic=event.queryStringParameters?.diagnostics==='refresh';
  if(diagnostic){
    const header=Object.entries(event.headers||{}).find(([k])=>k.toLowerCase()==='authorization')?.[1]||'';
    const token=String(header).match(/^Bearer\s+(.+)$/i)?.[1];
    if(!await require('./_injury-workflow-auth').verifyWorkflowToken(token))return {statusCode:401,headers:{'Cache-Control':'no-store'},body:JSON.stringify({error:'Operator workflow identity required.'})};
  }
  connectLambda(event);
  try {
    const season = new Date().getUTCFullYear();
    const week = resolveCurrentNFLWeek(new Date(), season);
    const rows = await inspectJobs(getStore, season, week);
    if(diagnostic)return {statusCode:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(await require('./_weekly-refresh-diagnostics').refreshDiagnostics(getStore,rows))};
    const jobs = rows.map(row => ({ job: row.job, week: row.week, ready: row.ready, state: row.status && row.status.status || 'pending', lastAttempt: row.status && row.status.startedAt || null, error: row.status && row.status.error || null }));
    const ready = rows.length > 0 && rows.every(row => row.ready);
    const playerCache=await getStore({name:'player-data'}).get('playerData',{type:'json'});
    const providerMode=playerCache?.availabilityMode===require('./_tank01-player-cache').MODE;
    const playerAge=Date.now()-Date.parse(playerCache?.updatedAt||'');
    const playerAvailability={source:playerCache?.source||null,availabilityMode:playerCache?.availabilityMode||null,updatedAt:playerCache?.updatedAt||null,fresh:providerMode&&Number.isFinite(playerAge)&&playerAge>=0&&playerAge<8*3600000,teamsSucceeded:playerCache?.teamsSucceeded||0,teamsFailed:playerCache?.teamsFailed||0,playerCount:playerCache?.playerCount||0};
    const injuryStore=getStore({name:require('./_injury-transactions').STORE});
    const [injuries,health]=providerMode?[null,null]:await Promise.all([injuryStore.get('latest',{type:'json'}),injuryStore.get('health',{type:'json'})]);
    const age=Date.now()-Date.parse(injuries?.checkedAt||'');
    const injuryTransactions={retired:providerMode,checkedAt:injuries?.checkedAt||null,fresh:Number.isFinite(age)&&age>=0&&age<2*3600000,records:injuries?.records?.length||0,lastChanges:injuries?.lastChanges||[],health};
    const clubModule=require('./_club-availability-run');
    let clubAvailability;
    try {
      if(providerMode){clubAvailability={retired:true,enabled:false,customerReadsEnabled:false};}
      else {
      const clubStore=getStore({name:clubModule.STORE});
      const [latest,clubHealth,observations]=await Promise.all([clubStore.get('latest',{type:'json'}),clubStore.get('health',{type:'json'}),clubStore.get('observations',{type:'json'})]);
      clubAvailability=clubModule.summarize(latest,clubHealth,{enabled:process.env.OFFICIAL_CLUB_COLLECTION_ENABLED==='true',customerReadsEnabled:process.env.OFFICIAL_CLUB_CUSTOMER_READS_ENABLED==='true'});
      clubAvailability.observations=require('./_club-observation-status').observationStatus(observations);
      }
    } catch (_) {
      clubAvailability={enabled:process.env.OFFICIAL_CLUB_COLLECTION_ENABLED==='true',customerReadsEnabled:false,fresh:false,coveragePassed:false,error:'Official club coverage status unavailable.'};
    }
    return { statusCode: ready ? 200 : 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ season, week, ready, jobs, playerAvailability,injuryTransactions,clubAvailability }) };
  } catch (_) {
    return { statusCode: 503, body: JSON.stringify({ ready: false, error: 'Weekly cache status could not be checked.' }) };
  }
};

'use strict';
// Evidence qualification only. Never changes ranks, forecasts growth, fetches,
// writes history or promotes a signal. Undated observations cannot date events.
const {canonicalNameKey}=require('../../player-identity');
const CLUBS=require('./_official-club-sources.json');
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
function qualifyEvent(event,{name,position,team,season,week,cutoff,historical=false}){
 const fail=reason=>({valid:false,reason});
 if(!event)return fail('dated_role_event_missing');
 if(event.verified!==true||(!historical&&event.fresh!==true))return fail('role_event_unverified_or_stale');
 if(canonicalNameKey(event.player)!==canonicalNameKey(name)||event.position!==position||event.team!==team||Number(event.season)!==Number(season)||(event.appliesFromWeek!=null ? !Number.isInteger(event.appliesFromWeek)||event.appliesFromWeek!==Number(event.week)||event.appliesFromWeek>Number(week) : Number(event.week)!==Number(week)))return fail('role_event_identity_or_week_mismatch');
 if(!['ROLE_GAIN','ROLE_LOSS','TEAMMATE_ABSENCE','TEAMMATE_RETURN'].includes(event.kind))return fail('role_event_kind_unsupported');
 let url;try{url=new URL(event.sourceUrl);}catch{return fail('role_event_source_unverified');}
 const club=CLUBS.find(c=>c.team===team),host=club&&new URL(club.origin).hostname;
 const reporter=event.authority==='VERIFIED_REPORTER'&&require('./_role-report-sources.json').some(s=>s.team===team&&s.host===url.hostname&&url.pathname.startsWith(s.pathPrefix)&&s.reporters.includes(event.reporter));
 if(url.protocol!=='https:'||url.username||url.password||!(reporter||(url.hostname===host&&(url.pathname.startsWith('/news/')||url.pathname.startsWith('/team/depth-chart')))||(url.hostname==='www.nfl.com'&&url.pathname.startsWith('/news/'))))return fail('role_event_source_unverified');
 const effective=stamp(event.effectiveAt),published=stamp(event.publishedAt),verified=stamp(event.verifiedAt),end=stamp(cutoff);
 if(effective===null||published===null||verified===null||end===null||effective>end||published>end||verified>end||verified<published)return fail('role_event_date_unverified');
 if(![Number(season),Number(season)+1].includes(new Date(effective).getUTCFullYear())||(!historical&&end-verified>=7*86400000))return fail('role_event_unverified_or_stale');
 // An observation timestamp is not a source's published/effective change date.
 if(!['PUBLISHED','EFFECTIVE'].includes(event.dateBasis))return fail('role_event_date_unverified');
 if(event.authority==='TEAM_CHART'&&(event.publishedAt===null||event.coListed===true))return fail('role_event_chart_ambiguous');
 if(!['TEAM_ANNOUNCEMENT','OFFICIAL_TRANSACTION','OFFICIAL_INJURY_REPORT','TEAM_CHART','VERIFIED_REPORTER'].includes(event.authority))return fail('role_event_authority_unverified');
 if(event.kind==='ROLE_GAIN'&&!['TEAM_ANNOUNCEMENT','TEAM_CHART','VERIFIED_REPORTER'].includes(event.authority))return fail('starter_role_not_established_by_transaction_or_injury_alone');
 return {valid:true,effectiveAt:event.effectiveAt,kind:event.kind,event};
}
function establishRole({event,opportunity,projection={},statusEvidence=[],name,position,team,season,week,scoring,conflictingEvents=[],factCutoff=null}){
 const cutoff=opportunity?.provenance?.decisionCutoff||opportunity?.provenance?.computedAt;
 // Observed outcomes retain their pre-week cutoff. Current facts have an
 // independently bounded, player-pregame source cutoff from the live service.
 const factsCutoff=factCutoff===null?cutoff:factCutoff;
 const q=qualifyEvent(event,{name,position,team,season,week,cutoff:factsCutoff});
 const fail=(reason,extra={})=>({status:'UNRESOLVED',reason,effectiveAt:event?.effectiveAt||null,...extra});
 if(!q.valid)return fail(q.reason);
 if(conflictingEvents.some(e=>e!==event&&stamp(e.effectiveAt)>=stamp(event.effectiveAt)&&(e.kind!==event.kind||e.explicitRole!==event.explicitRole)))return fail('role_event_conflict');
 if(event.kind!=='ROLE_GAIN'||event.explicitRole!=='STARTER')return fail('beneficiary_role_not_confirmed');
 if(opportunity?.status!=='AVAILABLE')return fail('post_change_work_unavailable');
 const record=opportunity.records?.[require('./_super-sage-opportunity-evidence').normalizeName(name)+'|'+position];
 if(!Array.isArray(record?._rawGames))return fail('post_change_work_unavailable');
 // Reuse the reader's temporal guard: no current-week or future outcomes.
 const checked=require('./_super-sage-opportunity-evidence').validateSnapshot({season,computedAt:opportunity.provenance.computedAt,records:{player:record}},{season,week,decisionCutoff:cutoff});
 if(!checked.ok)return fail('post_change_work_temporal_failure');
 const effectiveDay=new Date(q.effectiveAt).toISOString().slice(0,10).replace(/-/g,'');
 const first=event.firstAffectedGameID;
 if(first&&(!event.firstAffectedGameVerified||!/^\d{8}_[A-Z]{2,3}@[A-Z]{2,3}$/.test(first)||first.slice(0,8)!==effectiveDay||!first.slice(9).split('@').includes(team)||!record._rawGames.some(g=>g.gameID===first)))return fail('first_affected_game_unverified');
 const games=record._rawGames.filter(g=>String(g.gameID).slice(0,8)>effectiveDay||(first&&g.gameID===first));
 if(!games.length)return fail('no_post_change_games');
 if(new Set(games.map(g=>g.gameID)).size!==games.length)return fail('duplicate_post_change_games');
 if(games.some(g=>!Number.isFinite(g.carries)||!Number.isFinite(g.targets)||!Number.isFinite(g.opportunities)||g.opportunities!==g.carries+g.targets))return fail('post_change_work_invalid');
 const producer=require('./refresh-opportunity-intel');
 const window=producer.buildOpportunityIntelligence(games,position);
 const signal=k=>window.signals.find(s=>s.type===k)?.value;
 const proof={...(factCutoff===null?{}:{factsCutoff}),effectiveAt:q.effectiveAt,eventId:event.id||null,firstAffectedGameID:first||null,gameIDs:games.map(g=>g.gameID),gamesSampled:games.length,sampleSize:signal('sampleSize'),trend:signal('trendClassification')||null,volumeTier:signal('volumeTier')||null,opportunities:window.opportunities,
  projectionIncorporationEstablished:false};
 // Two games support only a provisional current role, never a growth signal.
 // Reuse position-specific producer volume tiers for EACH game: an average
 // cannot hide a spike or a low-involvement game. The global sample rule stays 3.
 const gameVolumeTiers=games.map(g=>producer.buildOpportunityIntelligence([g],position).signals.find(s=>s.type==='volumeTier')?.value);
 const provisional=games.length===2&&gameVolumeTiers.every(t=>['high-volume','moderate-volume'].includes(t))&&gameVolumeTiers[0]===gameVolumeTiers[1];
 if((proof.sampleSize!=='adequate'&&!provisional)||!['high-volume','moderate-volume','role-player'].includes(proof.volumeTier))return fail('post_change_role_not_established',proof);
 if(provisional)Object.assign(proof,{provisional:true,confidenceCap:'Moderate',gameVolumeTiers,caveat:'Only two games in the new role; confidence is moderate at most.'});
 const generated=stamp(projection.updatedAt);
 if(!projection.admissible||!Number.isFinite(projection.points)||projection.fresh!==true||!projection.source||!scoring||projection.scoring!==scoring||Number(projection.week)!==Number(week)||generated===null||generated<=stamp(event.effectiveAt)||generated>stamp(factsCutoff))return fail('post_change_projection_unverified',proof);
 const status=require('./_super-sage-baseline-validity').resolveStatus(statusEvidence);
 if(status.effective?.statusClass!=='ACTIVE'||status.conflict||status.staleMoreSevere.length)return fail('current_availability_unverified',proof);
 return {...proof,status:'ESTABLISHED',reason:'dated_current_role_supported_by_post_change_work',projectionUpdatedAt:projection.updatedAt,
  sourceUrl:event.sourceUrl,source:event.authority,workloadGrowthValidated:false};
}
module.exports={qualifyEvent,establishRole};

'use strict';
const {hash}=require('./_super-sage-shadow-llm');
const {fromSnapshot,observedEvidenceFor,normalizeName}=require('./_super-sage-opportunity-evidence');
// Supplement a COPY with the exact dated cached opportunity window. No live
// statistics refresh, outcomes, rankings or availability updates are read.
async function supplementUsageReplay(focused,{parentEvidenceHash,capturedAt,loadSnapshot}) {
  const packet=JSON.parse(JSON.stringify(focused.packet));
  // First researched editorial case only. Other pairs keep their frozen view.
  const player=packet.players.find(p=>p.name==='Malik Nabers'&&p.position==='WR');
  const fact=player?.facts.find(f=>f.field==='observedOpportunity');
  if(!fact||fact.value?.recentGames?.length) return focused;
  const prior=fact.value, provenance=prior?.provenance;
  if(provenance?.store!=='opportunity-intel'||!provenance.key||!provenance.computedAt||!provenance.decisionCutoff) throw Error('usage_replay_provenance_missing');
  if(!Number.isFinite(Date.parse(capturedAt))||Date.parse(provenance.decisionCutoff)>Date.parse(capturedAt)) throw Error('usage_replay_capture_invalid');
  const snapshot=await loadSnapshot(provenance.key);
  if(!snapshot||snapshot.computedAt!==provenance.computedAt||Date.parse(snapshot.computedAt)>Date.parse(capturedAt)) throw Error('usage_replay_snapshot_changed');
  const loaded=fromSnapshot(snapshot,{season:packet.request.season,week:packet.request.week,key:provenance.key,store:provenance.store,decisionCutoff:provenance.decisionCutoff});
  if(loaded.status!=='AVAILABLE'||JSON.stringify(loaded.provenance.weeksIncluded)!==JSON.stringify(provenance.weeksIncluded)) throw Error('usage_replay_temporal_mismatch');
  const record=loaded.records[`${normalizeName(player.name)}|WR`];
  if(!record||!record._rawGames.every(g=>g.opportunities===g.carries+g.targets)) throw Error('usage_replay_invalid_observations');
  const supplemented=observedEvidenceFor(loaded,{name:player.name,position:'WR',team:'NYG',season:packet.request.season,week:packet.request.week}).observedOpportunity;
  for(const field of ['avgLast3','lastGame','gamesSampled']) if(supplemented?.[field]!==prior[field]) throw Error('usage_replay_measurement_mismatch');
  if(!supplemented.sampleContext.length) throw Error('usage_replay_context_unavailable');
  // Preserve all existing evidence values. Add only source-labelled sample detail.
  fact.value={...prior,recentGames:supplemented.recentGames,sampleContext:supplemented.sampleContext,sampleRepresentativeness:supplemented.sampleRepresentativeness,interpretation:supplemented.interpretation};
  packet.scope='SUPPLEMENTED_PREGAME_REPLAY';
  packet.replay={version:1,parentEvidenceHash,parentCapturedAt:capturedAt,sourceSnapshotHash:hash(JSON.stringify(snapshot)),sourceComputedAt:snapshot.computedAt,sourceCutoff:provenance.decisionCutoff,customerEligible:false,outcomeDataAllowed:false};
  return {packet,evidenceHash:hash(JSON.stringify(packet))};
}
module.exports={supplementUsageReplay};

'use strict';
const assert=require('node:assert/strict');
const {plainPresentation}=require('../netlify/functions/_rookie-plain-presentation');
const {validate,render,factors,schema,decode}=require('../netlify/functions/_rookie-structured-pair');
const clone=x=>JSON.parse(JSON.stringify(x));
// Replay the factual shape of msg_011Cg5CiwZSkJNqmwHG9LSHh without private input.
const raw={players:[['A','Tyler Higbee','TE',5.44,'Strong Positive','high-volume'],['B','Keenan Allen','WR',8.57,'Neutral','moderate-volume']].map(([id,name,position,points,matchup,level])=>({id,name,position,facts:[['projection',{admissible:true,points}],['observedOpportunity',{avgLast3:7.67}],['matchup',matchup],['establishedRole',{status:'ESTABLISHED',level}],['availability',{effectiveStatus:{status:'ACTIVE'},unavailable:false,questionable:false}]].map(([field,value])=>({field,value,factId:`${id}:${field}`}))})),requiredDisclosures:[]};
const before=JSON.stringify(raw),packet=plainPresentation({packet:raw}).packet;
assert.equal(JSON.stringify(raw),before);
for(const p of packet.players){const role=p.facts.find(f=>f.field==='establishedRole').value;assert.equal(role.status,undefined);assert.equal(role.crossPositionComparable,false);assert.equal(p.facts.find(f=>f.field==='matchup').value.favorabilityRank,undefined);}
const good={selected:'B',confidence:'MEDIUM',decidingFactor:'projection',tradeoffFactor:'matchup',blocker:'NONE',reconsider:'pick_ruled_out'};
assert.deepEqual(validate(good,packet),[]);
assert.deepEqual(validate({...good,selected:'A',decidingFactor:'matchup',tradeoffFactor:'projection'},packet),[]);
for(const bad of [{...good,decidingFactor:'recentUsage'},{...good,decidingFactor:'matchup'},{...good,tradeoffFactor:'projection'},{...good,tradeoffFactor:'NONE'},{...good,reconsider:'alternative_cleared'},{...good,reconsider:'teammate_ruled_out'},{...good,reconsider:{subject:'pick',event:'more_work_confirmed'}},{...good,explanation:'Both players share the same established role.'},{...good,reconsider:'Allen inactive or Higbee top-5 matchup'}])assert.ok(validate(bad,packet).length,JSON.stringify(bad));
assert.equal(factors(packet).recentUsage.favoredId,null);
const text=render(good,packet);assert.deepEqual(text,render(good,packet));assert.match(text.explanation,/8.57 versus 5.44/);assert.match(text.explanation,/tradeoff: Tyler Higbee has the more favorable matchup/);assert.match(text.reconsider,/^Would switch if Keenan Allen is ruled out\./);assert.doesNotMatch(text.explanation,/same established role|top-5|9-target/);assert.ok(text.factIds.every(id=>packet.players.some(p=>p.facts.some(f=>f.factId===id))));
const uncertain=clone(packet);uncertain.players[0].facts.find(f=>f.field==='availability').value.questionable=true;assert.deepEqual(validate({...good,reconsider:'alternative_cleared'},uncertain),[]);
const unavailable=clone(packet);unavailable.players[1].facts.find(f=>f.field==='availability').value.unavailable=true;assert.ok(validate(good,unavailable).includes('unavailable_player_selected'));
const nc={selected:null,confidence:'LOW',decidingFactor:'NONE',tradeoffFactor:'NONE',blocker:'conflicting_evidence',reconsider:'evidence_resolves_blocker'};
assert.deepEqual(validate(nc,packet),[]);assert.ok(validate({...nc,blocker:'NONE'},packet).length);assert.match(render(nc,packet).explanation,/has no call/);
assert.ok(validate({selected:'B',confidence:'MEDIUM',explanationSentences:[],reconsider:'If Allen is inactive.'},packet).length,'legacy cache cannot compose');
assert.equal(schema.properties.selected.type,'string');assert.deepEqual(schema.properties.selected.enum,['A','B','NO_CALL']);
assert.deepEqual(validate(decode({...nc,selected:'NO_CALL'}),packet),[]);assert.equal(render(decode({...nc,selected:'NO_CALL'}),packet).selected,null);assert.equal(decode(good),good);
for(const [key,rule] of Object.entries(schema.properties))assert.ok(rule.enum.every(v=>typeof v===rule.type),key+' enum values match declared wire type');
assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.explanation,undefined);assert.equal(schema.properties.factIds,undefined);
const tied=clone(packet);tied.players[0].facts.find(f=>f.field==='projection').value.points=8.57;tied.players[0].facts.find(f=>f.field==='matchup').value={plain:'neutral',favorabilityOrder:3};
assert.ok(validate({...good,tradeoffFactor:'NONE'},tied).length);assert.deepEqual(validate({...nc,blocker:'no_supported_factor'},tied),[]);
console.log('PASS: failed live answer replay cannot express role equality, inverted risk, invented rank or diagnoses; both picks, tie direction, missing opposition, NO_CALL, conditional reversal, cache shape, deterministic facts and unchanged source.');

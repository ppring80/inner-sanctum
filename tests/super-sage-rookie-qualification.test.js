'use strict';
// Independent qualification regression probes. Expected results are stated before invoking
// the deployed adapter. This is a diagnostic, not a production promotion gate.
const {shadowSlot}=require('../netlify/functions/_super-sage-live-shadow-adapter');
const player=(name,rank,points)=>({name,position:'RB',standing:{tier:'START',positionRank:rank},availability:{availabilityVerified:true,unavailable:false},baselineValidity:{state:'VALID'},projection:{admissible:true,fresh:true,points},stateChanges:[],uncertainty:[]});
const cases=[];
function exam(name,a,b,expected,why){cases.push({name,a:structuredClone(a),b:structuredClone(b),expected,why});}
exam('Clear incumbent',player('A',1,20),player('B',10,10),'A','Rank and fresh projection support A.');
exam('Clear challenger',player('A',10,10),player('B',1,20),'B','Rank and fresh projection support B.');
exam('Close known evidence',player('A',1,10),player('B',2,11),'A','Competing evidence may preserve the established prior, with LOW confidence.');
exam('Unknown availability',{...player('A',1,20),availability:{}},player('B',2,10),null,'Unknown availability must not receive a definitive call.');
exam('Unresolved injury',{...player('A',1,20),availability:{availabilityVerified:true,questionable:true}},player('B',2,10),null,'Questionable status is unresolved.');
exam('Unverified role expansion',player('A',1,20),{...player('B',2,10),roleExpansion:{claimed:true,validated:false}},null,'An unverified role claim must not manufacture certainty.');
exam('Known unavailable challenger',player('A',1,20),{...player('B',2,10),availability:{availabilityVerified:true,unavailable:true}},'A','A has sufficient independent support; B is known ineligible, not an unknown state.');
exam('Known unavailable incumbent',{...player('A',1,20),availability:{availabilityVerified:true,unavailable:true}},player('B',2,10),'B','Only B is available and verified; A cannot start.');
exam('Exact tie order A/B',player('A',1,10),player('B',1,10),null,'No directional evidence: no independent preference.');
exam('Exact tie order B/A',player('B',1,10),player('A',1,10),null,'Reordering an exact tie must not create evidence.');
exam('Same player compared twice',player('A',1,20),player('A',10,10),null,'Conflicting records for the same player are not a legal independent matchup.');
exam('Material incumbent role increase', {...player('A',1,10),stateChanges:[{type:'ROLE_CHANGE',verified:true,magnitudeValidated:true,note:'A has a validated role increase.'}],roleExpansion:{claimed:true,validated:true}},player('B',2,11),'A','An incumbent role increase supports A; a single projection edge does not reverse that benefit.');
exam('Reassessment flag lacks resolved basis',{...player('A',1,20),baselineValidity:{state:'REASSESS'}},player('B',2,10),null,'Unresolved baseline cannot be hidden by rank/projection.');
exam('Stale projection only', {...player('A',1,10),standing:{},projection:{admissible:true,fresh:false,points:10}}, {...player('B',2,20),standing:{},projection:{admissible:true,fresh:false,points:20}},null,'Explicitly stale projections alone cannot justify a present call.');
exam('Both unavailable',{...player('A',1,20),availability:{availabilityVerified:true,unavailable:true}},{...player('B',2,10),availability:{availabilityVerified:true,unavailable:true}},null,'No eligible player remains.');
exam('Unverified exclusion',player('A',1,20),{...player('B',2,10),availability:{availabilityVerified:false,unavailable:true}},null,'An unverified exclusion cannot manufacture a sole eligible option.');
exam('Eligible alternative still questionable',{...player('A',1,20),availability:{availabilityVerified:true,unavailable:true}},{...player('B',2,10),availability:{availabilityVerified:true,questionable:true}},null,'A verified exclusion does not resolve B availability.');
exam('Material challenger role increase',player('A',2,10),{...player('B',1,11),stateChanges:[{type:'ROLE_CHANGE',verified:true,magnitudeValidated:true,note:'B has a validated role increase.'}],roleExpansion:{claimed:true,validated:true}},'B','Verified challenger growth plus stronger standing/projection supports B.');
exam('Same name with casing/spacing',player(' A ',1,20),player('a',10,10),null,'Formatting differences do not create another player.');
// Second ring: systematic input perturbations, with expectations independent of
// ranking/projection threshold implementation.
for (const swap of [false,true]) for (const highRank of [1,20]) for (const highPoints of [5,30]) {
 const a=player('A',highRank,highPoints), b=player('B',10,15);
 for (const excludedName of ['A','B']) {
  const excluded=excludedName==='A'?a:b;
  excluded.availability={availabilityVerified:true,unavailable:true};
  exam(`Eligibility matrix ${swap}/${highRank}/${highPoints}/${excludedName}`,swap?b:a,swap?a:b,excludedName==='A'?'B':'A','Known eligibility governs regardless of prior order, ranking, or projection.');
  excluded.availability={availabilityVerified:true,unavailable:false};
 }
}
for (const points of [null,NaN,Infinity,-Infinity]) {
 const a=player('A',1,points),b=player('B',2,10);a.standing={};b.standing={};
 exam(`Invalid projection ${String(points)}`,a,b,null,'A nonfinite or absent projection supplies no comparative evidence.');
}
for (const freshA of [false,true]) for (const freshB of [false,true]) {
 if(freshA&&freshB) continue;
 const a=player('A',1,10),b=player('B',2,20);a.standing={};b.standing={};a.projection.fresh=freshA;b.projection.fresh=freshB;
 exam(`Freshness matrix ${freshA}/${freshB}`,a,b,null,'Both projections must avoid an explicit stale flag.');
}
const rows=cases.map(c=>{const before=JSON.stringify([c.a,c.b]);const out=shadowSlot({slotLabel:'RB',starter:c.a,comparator:c.b,confidence:{label:'Moderate'}});return {case:c.name,expected:c.expected,actual:out.shadow.selected,pass:out.shadow.selected===c.expected&&JSON.stringify([c.a,c.b])===before&&out.hasValidatedEdge===false&&(c.expected!==null||out.confidence.label==="LOW"),status:out.shadow.callStatus,confidence:out.confidence.label,why:c.why,evidence:out.shadow.evidenceUsed};});
const result={purpose:'Independent diagnostic; synthetic pregame inputs, no outcomes or provider calls',passed:rows.filter(r=>r.pass).length,total:rows.length,rows};
console.log(JSON.stringify(result,null,2));
if(result.passed !== result.total) throw new Error(`Rookie qualification failed: ${result.passed}/${result.total}`);
process.exitCode=rows.every(r=>r.pass)?0:1;

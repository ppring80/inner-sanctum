"use strict";
const VERSION=1;
const n=v=>Number.isFinite(Number(v))?Number(v):null;
function summarizePacket(packet){
 const a=packet?.assessment?.attribution||{}, p=a.predictionQuality||{};
 return {decisionId:packet?.decisionId||null,player:packet?.assessment?.player?.name||"Unknown player",decisionQuality:a.decisionQuality||"INSUFFICIENT_EVIDENCE",evidenceQuality:a.evidenceQuality||"UNREVIEWED",explanationQuality:a.explanationQuality||"UNREVIEWED",varianceClass:a.outcomeVariance?.class||"UNREVIEWED",projection:n(p.projection),actual:n(p.actual),predictionQuality:p.quality||"UNREVIEWED",disposition:packet?.assessment?.learning?.disposition||"CALIBRATION_ONLY",hypothesis:packet?.assessment?.learning?.learningCase?.learning?.hypothesis||null};
}
function buildWeekPostmortem(packets,{teamName="Your team",season=null,week=null}={}){
 const rows=(packets||[]).map(summarizePacket);
 if(!rows.length)return{version:VERSION,type:"SUPER_SAGE_WEEK_POSTMORTEM",teamName,season,week,summary:"No completed Super SAGE learning cases are available for this week.",counts:{reviewed:0},players:[],learning:[],productionChangeAllowed:false};
 const counts={reviewed:rows.length,goodDecisions:rows.filter(x=>x.decisionQuality==="GOOD_DECISION").length,questionableDecisions:rows.filter(x=>x.decisionQuality==="QUESTIONABLE_DECISION").length,badDecisions:rows.filter(x=>x.decisionQuality==="BAD_DECISION").length,insufficientEvidence:rows.filter(x=>x.decisionQuality==="INSUFFICIENT_EVIDENCE").length,injuryVariance:rows.filter(x=>x.varianceClass==="INJURY").length,investigations:rows.filter(x=>x.disposition==="INVESTIGATE").length};
 const comparable=rows.filter(x=>x.projection!=null&&x.actual!=null), projected=comparable.reduce((s,x)=>s+x.projection,0), actual=comparable.reduce((s,x)=>s+x.actual,0);
 const summary=counts.badDecisions===0&&counts.questionableDecisions===0?"The results were worse than the decision process.":counts.badDecisions>counts.goodDecisions?"The decision process needs work; this was not just bad variance.":"Mixed week: some sound decisions, plus decisions worth investigating.";
 return{version:VERSION,type:"SUPER_SAGE_WEEK_POSTMORTEM",teamName,season,week,summary,expectation:comparable.length?{playersCompared:comparable.length,projected:Number(projected.toFixed(1)),actual:Number(actual.toFixed(1)),delta:Number((actual-projected).toFixed(1))}:null,counts,players:rows,learning:rows.filter(x=>x.disposition==="INVESTIGATE").map(x=>({player:x.player,decisionQuality:x.decisionQuality,hypothesis:x.hypothesis,productionChangeAllowed:false})),productionChangeAllowed:false};
}
function postmortemText(r){
 if(!r?.counts?.reviewed)return r?.summary||"No completed learning cases are available.";
 const e=r.expectation, f=v=>n(v)==null?"—":Number(v).toFixed(1);
 const lines=[r.teamName+" — Week "+(r.week??"?")+" Super SAGE postmortem",r.summary,e?"Expectation: "+f(e.projected)+" projected vs "+f(e.actual)+" actual ("+(e.delta>=0?"+":"")+f(e.delta)+").":"Expectation comparison: insufficient projection evidence.","Decision audit: "+r.counts.goodDecisions+" good, "+r.counts.questionableDecisions+" questionable, "+r.counts.badDecisions+" bad, "+r.counts.insufficientEvidence+" insufficient evidence.","Variance: "+r.counts.injuryVariance+" injury case(s). Learning investigations: "+r.counts.investigations+"."];
 r.players.forEach(x=>lines.push(x.player+": "+x.decisionQuality+"; "+x.predictionQuality+"; "+x.varianceClass+". "+f(x.projection)+" projected -> "+f(x.actual)+" actual."));
 lines.push("No postgame result or learning case can automatically change production SAGE.");
 return lines.join("\n");
}
module.exports={VERSION,summarizePacket,buildWeekPostmortem,postmortemText};

'use strict';
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const aliases=p=>[p.name,String(p.name||'').replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/i,'').split(/\s+/).pop()].filter(Boolean);
const mentions=(text,p)=>aliases(p).some(n=>new RegExp(`\\b${escape(n)}\\b`,'i').test(text));
function validateReconsider(answer,packet){
 if(packet.presentation!=='plain-v1')return [];
 const fail=()=>['reconsider_not_reversal'];
 const text=typeof answer?.reconsider==='string'?answer.reconsider.trim():'';
 if(!text||packet.players?.length!==2)return fail();
 const pick=packet.players.find(p=>p.id===answer.selected),alternative=packet.players.find(p=>p!==pick);
 if(answer.selected!==null&&!pick)return fail();
 // A hypothetical named diagnosis is still invented if no source supplied it.
 const health=/\b(hamstring|concussion|ankle|knee|shoulder|groin|acl|mcl|fracture|sprain|tear|broken|surgery|illness|flu)\b/gi;
 if(/\b(?:opponent|defen[cs]e|coverage)\b[^.;!?]*(?:allows?|points?|yards?|touchdowns?|rank|percent|%|receptions?)|\b(?:points?|yards?|touchdowns?)\b[^.;!?]*\b(?:opponent|defen[cs]e)\b/i.test(text))return fail();
 const clauses=text.split(/\s+(?:or|and|but)\s+|[;.!?]/i).map(s=>s.trim()).filter(Boolean);
 let priorSubject=null,matched=false;
 for(const originalClause of clauses){
  const clause=originalClause.replace(/\b(?:isn't|is not|not) active\b/gi,'inactive').replace(/\b(?:doesn't|does not) practice\b/gi,'misses practice');
  if(/\b(?:not|never|unless|without)\b|\b(?:isn't|doesn't|cannot|can't)\b/i.test(clause))return fail();
  const named=packet.players.filter(p=>mentions(clause,p));
  if(named.length>1)return fail(); // require an explicit subject per directional clause
  const subject=named[0]||(/^(?:if\s+)?(?:he\s+|his\s+|is\s+|misses\s+|loses\s+)/i.test(clause)?priorSubject:null);
  if(!subject)return fail();priorSubject=subject;
  const source=JSON.stringify(subject.facts.filter(f=>['availability','stateChanges','uncertainty'].includes(f.field))).toLowerCase();
  for(const match of clause.matchAll(health))if(!source.includes(match[1].toLowerCase()))return fail();
  const negative=/\b(?:ruled out|inactive|doubtful|sidelined|benched|miss(?:es)?\s+(?:practice|warmups|the game)|limited\s+(?:practice|participation)|los(?:es|t)\s+(?:work|targets|carries|snaps|role)|fewer\s+(?:targets|carries|snaps)|reduced\s+(?:work|role|snaps)|(?:workload|role|target share|snap share)\s+(?:is\s+)?(?:reduced|falls|drops|shrinks|decreases)|setback|downgraded)\b/i.test(clause);
  const more=/\b(?:more|larger|bigger|increased)\s+(?:verified\s+|confirmed\s+)?(?:work|workload|targets|carries|snaps|routes|role|usage|opportunities)\b|\b(?:workload|role|target share|snap share)\s+(?:grows|expands|increases)\b/i.test(clause);
  const cleared=/\b(?:cleared|confirmed active|full practice|removed from (?:the )?injury report)\b/i.test(clause);
  const availability=subject.facts.find(f=>f.field==='availability')?.value;
  const uncertain=availability?.questionable===true||availability?.unavailable===true||Boolean(availability?.conflict)||['QUESTIONABLE','DOUBTFUL','UNKNOWN','OUT','IR'].includes(String(availability?.effectiveStatus?.status||availability?.status||'UNKNOWN').toUpperCase());
  if(pick){
   if(subject===pick){if(!negative||more||cleared)return fail();}
   else if(subject===alternative){if(negative||!(more||(cleared&&uncertain)))return fail();}
   else return fail();
  }else if(negative||!(more||(cleared&&uncertain)))return fail();
  matched=true;
 }
 return matched?[]:fail();
}
module.exports={validateReconsider};

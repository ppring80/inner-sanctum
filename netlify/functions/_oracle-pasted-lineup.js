'use strict';
// Parse the lineup form's visible, pasteable text into the same structured
// payload consumed by the Oracle button. Never infer NFL teams from names.
const SLOT_MAP = [
  [/^quarterback$/i,'QB','QB'],[/^running back(?:\\s*\\d+)?$/i,'RB','RB'],
  [/^wide receiver(?:\\s*\\d+)?$/i,'WR','WR'],[/^tight end$/i,'TE','TE'],
  [/^flex(?:\\s*\\(.*?\\))?(?:\\s*\\d+)?$/i,'FLEX',null],
  [/^kicker$/i,'K','K'],[/^defense(?:\\s*\\/\\s*st)?$/i,'DEF','DEF'],
  [/^superflex(?:\\s*\\d+)?$/i,'SFLEX',null]
];
function parsePastedOracleLineup(messages) {
  const last = [...(Array.isArray(messages)?messages:[])].reverse().find(m=>m && m.role==='user' && typeof m.content==='string');
  const text = last && last.content;
  if (!text || !/\\bSTARTERS\\s*:/i.test(text) || !/\\bBENCH\\s*:/i.test(text)) return null;
  const week = Number(text.match(/\\b(?:NFL\\s+)?Week\\s+(\\d{1,2})\\b/i)?.[1]);
  if (!Number.isInteger(week) || week<1 || week>18) return {error:'Please include the NFL week with your lineup.'};
  const startSection = text.match(/\\bSTARTERS\\s*:\\s*([\\s\\S]*?)(?=\\bBENCH\\s*:)/i)?.[1] || '';
  const benchSection = text.match(/\\bBENCH\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Please |IMPORTANT GROUNDING:|SCORING:|LEAGUE:)|$)/i)?.[1] || '';
  const starters=[],slotCounts={};
  for (const line of startSection.split(/\\r?\\n/).map(s=>s.trim()).filter(Boolean)) {
    const match=line.match(/^([^:]+):\\s*(.+)$/);
    if(!match) return {error:'Please use one starter per line with a position label.'};
    const slot=SLOT_MAP.find(([re])=>re.test(match[1].trim()));
    if(!slot) return {error:'Unrecognized lineup slot: '+match[1].trim()};
    const name=match[2].trim();
    if(!name || name.length>80) return {error:'Please verify the starter names.'};
    starters.push({name,position:slot[2],slotPos:slot[1],slotLabel:match[1].trim()});
    slotCounts[slot[1]]=(slotCounts[slot[1]]||0)+1;
  }
  const bench=benchSection.split(/[,\\n]/).map(s=>s.trim()).filter(Boolean).map(name=>({name}));
  if(starters.length<1 || starters.length>20 || bench.length>30) return {error:'Please provide a valid starting lineup and bench.'};
  const scoring=text.match(/\\b(?:scoring|format)\\s*:\\s*(half[- ]?ppr|ppr|standard|non[- ]?ppr)\\b/i)?.[1]||null;
  return {lineup:{week,starters,bench,slotCounts,scoring,provider:null,teams:null}};
}
module.exports={parsePastedOracleLineup};

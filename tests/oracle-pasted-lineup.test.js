'use strict';
const assert=require('node:assert/strict');
const {parsePastedOracleLineup}=require('../netlify/functions/_oracle-pasted-lineup');
const fs=require('node:fs');
const path=require('node:path');
const customer=`It is NFL Week 7. Here is my current lineup:

STARTERS:
Quarterback: Bryce Young
Running Back 1: Woody Marks
Running Back 2: Jaylen Warren
Wide Receiver 1: Amon-Ra St. Brown
Wide Receiver 2: Garrett Wilson
Tight End: George Kittle
Flex (RB/WR/TE) 1: Carnell Tate
Flex (RB/WR/TE) 2: DeVonta Smith
Kicker: Matt Gay
Defense / ST: Pittsburgh Steelers

BENCH:
Jakobi Meyers, Bhayshul Tuten, Chris Rodriguez Jr., Tyler Allgeier, Rashee Rice, J.J. McCarthy

Please analyze my lineup, confirm my starts look good, flag any concerns, and if I have bench players listed, let me know if any should replace a starter. Give me your full lineup verdict.`;
const req=(s)=>[{role:'user',content:s}];
const out=parsePastedOracleLineup(req(customer));
assert.ok(out && out.lineup);
assert.equal(out.lineup.week,7);
assert.equal(out.lineup.starters.length,10);
assert.equal(out.lineup.bench.length,6);
assert.equal(out.lineup.slotCounts.FLEX,2);
assert.equal(out.lineup.starters.find(p=>p.name==='DeVonta Smith').slotPos,'FLEX');
assert.equal(out.lineup.bench.find(p=>p.name==='Chris Rodriguez Jr.').team,undefined,'never assign Jacksonville from neighboring bench player');
assert.equal(out.lineup.bench.find(p=>p.name==='Rashee Rice').team,undefined,'do not invent team from text');
assert.equal(parsePastedOracleLineup(req('Who should I start this week?')),null);
assert.match(parsePastedOracleLineup(req(customer.replace('Week 7','Week 19'))).error,/week/i);
assert.match(parsePastedOracleLineup(req(customer.replace('Quarterback: Bryce Young','Unknown Slot: Bryce Young'))).error,/slot/i);
const chat=fs.readFileSync(path.join(__dirname,'../netlify/functions/chat.js'),'utf8');
assert.match(chat,/parsePastedOracleLineup\(messages\)/);
assert.match(chat,/buildOracleLineupVerdict\(\{ lineup: effectiveLineup/);
assert.ok(chat.indexOf('if (effectiveLineup)')<chat.indexOf('buildLineupEligibility(messages)'));
console.log('oracle pasted lineup: PASS');

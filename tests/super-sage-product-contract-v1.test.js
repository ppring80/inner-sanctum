"use strict";

const assert = require("assert");
const { run } = require("../scripts/run-super-sage-week4-acceptance.js");
const { toCustomerAnswer, customerAnswerText } = require("../netlify/functions/_super-sage-lineup-presenters.js");

const record = run().record;
const answer = toCustomerAnswer(record);
const text = customerAnswerText(answer);

assert.match(text, /^Start: /, "1-second layer must lead with the lineup");
assert.match(text, /provisional \(no validated edge\)/i, "1-second layer must expose provisional state");

const provisional = record.slots.find((s) => s.decisionState === "PROVISIONAL_UNRESOLVED" && s.comparator);
assert.ok(provisional, "canonical fixture must exercise a controversial provisional comparison");

const three = answer.threeSeconds.join("\n");
const ten = answer.tenSeconds.join("\n");
const combined = three + "\n" + ten;

assert.ok(combined.includes(provisional.starter.name), "must name the recommended player");
assert.ok(combined.includes(provisional.comparator.name), "must name the strongest alternative");
assert.match(combined, /no validated edge/i, "must state that the edge is not validated");
assert.match(combined, /projection/i, "must surface projection evidence when present");
assert.match(combined, /opportunities\/game/i, "must surface observed workload when present");
assert.match(combined, /established role/i, "must describe established role when present");
assert.match(combined, /matchup/i, "must surface matchup when present");
assert.match(combined, /Could change:/, "must say what could change the call");
assert.match(text, /observed workload|Recent workload/i, "must preserve observation-vs-forecast distinction");
assert.match(text, /does not mean drop/i, "must preserve start/sit vs roster-value separation");

const p = provisional.starter;
if (p.projection && p.projection.points != null) assert.ok(combined.includes(Number(p.projection.points).toFixed(1)), "starter projection must match record");
if (p.observedOpportunity && p.observedOpportunity.avgLast3 != null) assert.ok(combined.includes(Number(p.observedOpportunity.avgLast3).toFixed(1)), "starter workload must match record");

console.log("Super SAGE Product Contract V1 customer-answer acceptance: PASS");

"use strict";
const assert=require("assert");
const {buildDecisionTrace}=require("../netlify/functions/_super-sage-decision-grammar");
const {presentDecision}=require("../netlify/functions/_super-sage-operator-presenter");

function trace(x){return buildDecisionTrace(x);}

// Lab 4 — established role + matchup; rich but consumable.
const monty=trace({
 question:"Monty or Allen?",prior:{player:"David Montgomery",basis:["Established role"]},challenger:{player:"Braelon Allen"},
 evidence:[
  {id:"monty-role",statement:"Montgomery has an established role.",effect:"REINFORCES_PRIOR",verified:true,causalGroup:"monty-role"},
  {id:"monty-matchup",statement:"Montgomery has the more favorable rushing matchup.",effect:"REINFORCES_PRIOR",verified:true,scope:"OPPONENT_DEFENSE",causalGroup:"monty-matchup"},
  {id:"allen-matchup",statement:"Allen faces the tougher rushing environment.",effect:"REINFORCES_PRIOR",verified:true,scope:"OPPONENT_DEFENSE",causalGroup:"allen-matchup"}
 ],threshold:{state:"NOT_CROSSED"},decision:{selected:"David Montgomery",confidence:"MODERATE",rationale:["His established workload and better rushing environment give him the edge."],losingCase:["Allen has enough opportunity to deserve consideration, but his matchup does not overcome Montgomery's role advantage."]}
});
let p=presentDecision(monty);
assert.ok(p.text.startsWith("I'd start David Montgomery."));
assert.ok(p.text.includes("Braelon Allen is a legitimate consideration."));
assert.strictEqual(p.canChangeProductionDecision,false);

// Lab 5 — opponent defender OUT is material and can reopen an earlier sit.
const moore=trace({
 question:"DJ Moore or Michael Wilson?",prior:{player:"Michael Wilson"},challenger:{player:"DJ Moore"},
 evidence:[{id:"cb-out",statement:"The opponent's top corner is out.",effect:"REASSESS_PRIOR",scope:"OPPONENT_DEFENSE",materialChange:true,verified:true,causalGroup:"secondary-state"}],
 threshold:{state:"CROSSED",rationale:["Opponent personnel change materially improves Moore's matchup."]},
 decision:{selected:"DJ Moore",confidence:"MODERATE",rationale:["The verified opponent-secondary change materially improves Moore's receiving environment."],losingCase:["Wilson remains playable, but the matchup state changed enough to move Moore ahead."]},
 flipConditions:["the defensive availability report changes before kickoff"]
});
p=presentDecision(moore);assert.strictEqual(p.depth,"DEEP");assert.ok(p.text.includes("I'd reopen the decision"));

// Lab 6 — kickoff optionality / conditional availability.
const lad=trace({
 question:"Lad or early alternative?",prior:{player:"Lad McConkey"},challenger:{player:"Early Alternative"},
 evidence:[{id:"late-status",statement:"McConkey's availability is unresolved and the alternative locks earlier.",effect:"REASSESS_PRIOR",scope:"GAME_ENVIRONMENT",materialChange:true,verified:true,causalGroup:"availability-timing"}],
 threshold:{state:"UNRESOLVED",rationale:["The decision depends on whether a viable later replacement remains available."]},
 decision:{selected:"Lad McConkey",confidence:"LOW",rationale:["If a viable later replacement remains available, preserving the higher-value option is reasonable."],losingCase:["The early alternative protects against a late inactive, but sacrifices the option to use McConkey if active."]},
 flipConditions:["no viable later replacement remains when the early player locks"]
});
p=presentDecision(lad);assert.strictEqual(p.depth,"DEEP");

// Lab 7 — customer concern must survive parsing and be explicitly answered.
const barkley=trace({
 question:"Should I bench Barkley because of a limited workload?",prior:{player:"Saquon Barkley"},challenger:{player:"Mike Davis"},
 evidence:[{id:"customer-workload",statement:"Barkley's workload may be limited.",effect:"REASSESS_PRIOR",scope:"PLAYER",verified:false,source:"customer-stated-concern",customerConcern:true,causalGroup:"barkley-workload"}],
 threshold:{state:"NOT_CROSSED",rationale:["The concern is not yet verified strongly enough to overturn the prior."]},
 decision:{selected:"Saquon Barkley",confidence:"MODERATE",rationale:["The workload concern matters, but it needs verification before it can overturn Barkley's established role."],losingCase:["Davis is the safer fallback if a real restriction is confirmed."]},
 flipConditions:["a credible pregame report confirms a meaningful workload restriction"]
});
p=presentDecision(barkley);
assert.ok(p.text.includes("Your concern is legitimate"));
assert.ok(p.text.includes("Barkley's workload may be limited"));
assert.ok(p.text.includes("I'd reopen the decision"));
assert.strictEqual(p.guardrails.providerCallsAllowed,false);

console.log("Super SAGE Operator Presenter V1 + Decision Labs 4-7: PASS");

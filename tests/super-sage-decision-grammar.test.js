"use strict";
const assert = require("assert");
const { buildDecisionTrace } = require("../netlify/functions/_super-sage-decision-grammar");

// Canonical Lab #1: established incumbent vs high-upside challenger.
// The grammar must preserve both cases, belief movement, losing argument,
// correlated-evidence discipline, and remain shadow-only.
const mahomesMaye = buildDecisionTrace({
  question: "Mahomes or Maye?",
  prior: {
    player: "Patrick Mahomes",
    basis: ["Established elite baseline", "Stronger current-season performance"],
    confidence: "HIGH"
  },
  challenger: {
    player: "Drake Maye",
    basis: ["Strong prior-season performance", "Rushing production path"]
  },
  evidence: [
    { id:"mahomes-baseline", statement:"Mahomes has the stronger established baseline.", effect:"REINFORCES_PRIOR", verified:true, source:"historical/current performance", causalGroup:"mahomes-baseline" },
    { id:"maye-matchup", statement:"Buffalo presents a favorable current pass matchup.", effect:"CHALLENGES_PRIOR", scope:"OPPONENT_DEFENSE", verified:true, causalGroup:"buffalo-pass-state" },
    { id:"buffalo-pass-yards", statement:"Buffalo has allowed elevated passing production.", effect:"CHALLENGES_PRIOR", scope:"OPPONENT_DEFENSE", verified:true, causalGroup:"buffalo-pass-state" },
    { id:"maye-rush", statement:"Maye has an independent rushing production path.", effect:"CHALLENGES_PRIOR", verified:true, causalGroup:"maye-rushing" },
    { id:"patriots-urgency", statement:"New England faces high competitive urgency.", effect:"CONTEXT_ONLY", scope:"GAME_ENVIRONMENT", verified:true, causalGroup:"competitive-state" }
  ],
  threshold: { state:"NOT_CROSSED", rationale:["Challenger evidence narrows the gap but does not invalidate the established prior."] },
  decision: {
    selected:"Patrick Mahomes", confidence:"MODERATE",
    rationale:["Established baseline remains valid despite a legitimate Maye case."],
    losingCase:["Maye has the better matchup and rushing upside, but the evidence is not sufficient to overturn Mahomes."]
  },
  flipConditions:["Verified deterioration in Mahomes' environment", "Additional structural evidence increasing Maye's expected opportunity"]
});
assert.strictEqual(mahomesMaye.mode,"SHADOW");
assert.strictEqual(mahomesMaye.canChangeProductionDecision,false);
assert.strictEqual(mahomesMaye.beliefMovement,"COMPETING_EVIDENCE");
assert.strictEqual(mahomesMaye.losingCase.player,"Drake Maye");
assert.ok(mahomesMaye.evidenceDiscipline.causalGroupsCountedOnce.includes("buffalo-pass-state"));
assert.strictEqual(mahomesMaye.evidenceDiscipline.causalGroupsCountedOnce.filter(x=>x==="buffalo-pass-state").length,1);

// Canonical Lab #2: teammate absence is a structural state change, not merely
// another recent-game data point.
const miller = buildDecisionTrace({
  question:"Tucker or Miller at FLEX?",
  prior:{player:"Tre Tucker",basis:["Established pre-change standing"]},
  challenger:{player:"Kendre Miller",basis:["Potential vacated workload"]},
  evidence:[
    {id:"teammate-out",statement:"A backfield teammate is unavailable.",effect:"REASSESS_PRIOR",scope:"OFFENSE",materialChange:true,verified:true,causalGroup:"backfield-redistribution"},
    {id:"role-redistribution",statement:"Miller's expected role requires redistribution review.",effect:"CHALLENGES_PRIOR",scope:"OFFENSE",materialChange:true,verified:true,causalGroup:"backfield-redistribution"}
  ],
  threshold:{state:"UNRESOLVED",rationale:["Redistribution magnitude must be established before changing the call."]},
  decision:{selected:"Tre Tucker",confidence:"LOW",losingCase:["Miller can flip the decision if the vacated workload is verified to flow to him."]},
  flipConditions:["Verified material workload redistribution to Miller"]
});
assert.strictEqual(miller.beliefMovement,"PRIOR_REQUIRES_REASSESSMENT");
assert.strictEqual(miller.materialChanges.length,2);
assert.strictEqual(miller.evidenceDiscipline.causalGroupsCountedOnce.length,1);

// Canonical Lab #3: postgame outcome has no place in the pregame Operator.
const barkley = buildDecisionTrace({
  question:"Start Saquon?",
  prior:{player:"Saquon Barkley",basis:["Healthy established starter at decision time"]},
  challenger:{player:"Bench alternative"},
  evidence:[{id:"healthy-pregame",statement:"No pregame evidence invalidates the start.",effect:"REINFORCES_PRIOR",verified:true}],
  threshold:{state:"NOT_CROSSED"},
  decision:{selected:"Saquon Barkley",confidence:"HIGH"}
});
assert.strictEqual(barkley.guardrails.outcomeDataAllowed,false);
assert.strictEqual(barkley.guardrails.providerCallsAllowed,false);
assert.strictEqual(barkley.guardrails.automaticPromotionAllowed,false);

console.log("Super SAGE Operator V1 shadow decision grammar: PASS");

'use strict';
const assert=require('assert');
const {validateClaims,revalidateCached}=require('../netlify/functions/_super-sage-rookie-claim-checks');
const {validate}=require('../netlify/functions/_super-sage-shadow-fast-review');
const packet={players:[{id:'A',name:'Chris Godwin Jr.',position:'WR',facts:[{field:'projection',factId:'A:projection',value:{points:8.2}},{field:'establishedRole',factId:'A:establishedRole',value:{description:'Established role: about 5 opportunities per game recently.'}}]},{id:'B',name:'Jakobi Meyers',position:'WR',facts:[{field:'projection',factId:'B:projection',value:{points:7.67}}]}]};
const cases=[
 ['The projection spread plus matchup make Godwin the better floor play here.','unsupported_floor_comparison'],
 ["If he plays, he'll see more opportunities.",'guaranteed_future_workload'],
 ['Blake Corum is putting up 6.82 points in half-PPR.','projection_presented_as_scored_points'],
 ['If Barkley practices fully Friday, projection edge narrows in his favor.','unsupported_projection_change'],
 ['He has about 7 targets per game.','observed_opportunity_unit_changed'],
 ['Godwin will throw with a different quarterback.','non_qb_described_as_passer'],
 ['His higher volume floor leads here.','unsupported_floor_comparison'],
 ['The uncertainty could shrink his floor.','unsupported_floor_change'],
 ['Sutton offers less upside without a role bump.','unsupported_ceiling_comparison'],
 ['Meyers is steadier but lower-ceiling given the projection gap.','unsupported_ceiling_comparison'],
 ['Meyers has a lower ceiling given his projected points.','unsupported_ceiling_comparison'],
 ['Meyers is lower\u2011ceiling.','unsupported_ceiling_comparison'],
 ['His projection assumes uncertain QB impact.','unsupported_projection_adjustment'],
 ['His projection of 5.29 reflects uncertainty about availability.','unsupported_projection_adjustment'],
 ['Sutton is healthy and consistent.','availability_overstated_as_health'],
 ['His clear health makes him the choice.','availability_overstated_as_health'],
 ['He is active and healthy for week 5.','availability_overstated_as_health'],
 ['Work share post-Bigsby trade remains unknown.','unsupported_trade_event']
];
for(const [explanation,error] of cases) assert.ok(validateClaims({explanation},packet).includes(error),error);
const safe={selected:'A',confidence:'MEDIUM',explanation:'Start Godwin. His matchup and established recent involvement support the lean, although the quarterback change adds uncertainty. He is projected for 8.2 points; that does not establish a better floor. He has recently averaged about five opportunities per game, which may change.',caveat:'Quarterback impact is unknown.',reconsider:'Reconsider if a new projection or verified role change favors Meyers.',factIds:['A:projection','B:projection']};
assert.deepStrictEqual(validate(safe,packet),[]);
for(const [explanation,error] of cases) assert.ok(validate({...safe,explanation},packet).includes(error));
assert.deepStrictEqual(validateClaims({explanation:'Godwin would catch passes from a new quarterback.'},packet),[]);
assert.deepStrictEqual(validateClaims({explanation:'Godwin is projected to score 8.2 points.'},packet),[]);
assert.deepStrictEqual(validateClaims({explanation:'He is listed active. Projection adjustment for the quarterback change is unknown.'},packet),[]);
assert.deepStrictEqual(validateClaims({explanation:'Meyers has lower projected points; no scoring bounds are supplied.'},packet),[]);
assert.deepStrictEqual(validateClaims({explanation:'If an updated projection improves, reconsider the comparison.'},packet),[]);
const qb={players:[{name:'Drake Maye',position:'QB',facts:[]}]};assert.deepStrictEqual(validateClaims({explanation:'Maye will throw to his receivers.'},qb),[]);
const tiers={players:[{facts:[{field:'standing',value:{tier:'FLEX'}}]},{facts:[{field:'standing',value:{tier:'SIT'}}]}]};
assert.ok(validateClaims({explanation:'Both players sit in the flex tier.'},tiers).includes('standing_tier_misrepresented'));
assert.deepStrictEqual(validateClaims({explanation:'One player has a higher positional rank.'},tiers),[]);
console.log('Rookie claim regressions reject observed failure patterns and accept honest forecasts. These checks are not exhaustive semantic verification.');
const old={status:'REVIEW_READY',answer:{explanation:'He is active and healthy for week 5.'},rawText:'original exact text'};
const reassessed=revalidateCached(old,validateClaims(old.answer,packet));
assert.strictEqual(reassessed.status,'INVALID');assert.strictEqual(reassessed.storedStatus,'REVIEW_READY');assert.strictEqual(reassessed.rawText,old.rawText);assert.strictEqual(old.status,'REVIEW_READY');
assert.strictEqual(revalidateCached(old,[]),old);

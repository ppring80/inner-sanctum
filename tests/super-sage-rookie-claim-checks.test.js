'use strict';
const assert=require('assert');
const {validateClaims}=require('../netlify/functions/_super-sage-rookie-claim-checks');
const {validate}=require('../netlify/functions/_super-sage-shadow-fast-review');
const packet={players:[{id:'A',name:'Chris Godwin Jr.',position:'WR',facts:[{field:'projection',factId:'A:projection',value:{points:8.2}},{field:'establishedRole',factId:'A:establishedRole',value:{description:'Established role: about 5 opportunities per game recently.'}}]},{id:'B',name:'Jakobi Meyers',position:'WR',facts:[{field:'projection',factId:'B:projection',value:{points:7.67}}]}]};
const cases=[
 ['The projection spread plus matchup make Godwin the better floor play here.','unsupported_floor_comparison'],
 ["If he plays, he'll see more opportunities.",'guaranteed_future_workload'],
 ['Blake Corum is putting up 6.82 points in half-PPR.','projection_presented_as_scored_points'],
 ['If Barkley practices fully Friday, projection edge narrows in his favor.','unsupported_projection_change'],
 ['He has about 7 targets per game.','observed_opportunity_unit_changed'],
 ['Godwin will throw with a different quarterback.','non_qb_described_as_passer']
];
for(const [explanation,error] of cases) assert.ok(validateClaims({explanation},packet).includes(error),error);
const safe={selected:'A',confidence:'MEDIUM',explanation:'Start Godwin. His matchup and established recent involvement support the lean, although the quarterback change adds uncertainty. He is projected for 8.2 points; that does not establish a better floor. He has recently averaged about five opportunities per game, which may change.',caveat:'Quarterback impact is unknown.',reconsider:'Reconsider if a new projection or verified role change favors Meyers.',factIds:['A:projection','B:projection']};
assert.deepStrictEqual(validate(safe,packet),[]);
for(const [explanation,error] of cases) assert.ok(validate({...safe,explanation},packet).includes(error));
assert.deepStrictEqual(validateClaims({explanation:'Godwin would catch passes from a new quarterback.'},packet),[]);
assert.deepStrictEqual(validateClaims({explanation:'Godwin is projected to score 8.2 points.'},packet),[]);
assert.deepStrictEqual(validateClaims({explanation:'If an updated projection improves, reconsider the comparison.'},packet),[]);
const qb={players:[{name:'Drake Maye',position:'QB',facts:[]}]};assert.deepStrictEqual(validateClaims({explanation:'Maye will throw to his receivers.'},qb),[]);
console.log('Rookie claim regressions: reject six observed failure patterns, preserve raw reasoning, accept honest forecasts and position-correct language. These checks are not exhaustive semantic verification.');

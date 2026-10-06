"use strict";
// SUPER SAGE OPERATOR — UNSCRIPTED TUMBLER V1
// Raw pregame evidence only. No threshold, decision, confidence, or answer key.
// These cases test classification and threshold inference. Synthetic scenarios,
// not current NFL facts.

const RAW_CASES=[
{id:"U01",label:"RB matchup plus, OL losses and receiving-back expansion",prior:{player:"Established RB",strength:"STRONG"},challenger:{player:"Receiving Backup"},facts:[
{text:"Established RB retains the larger historical rushing role.",verified:true,source:"role snapshot",causalHint:"incumbent-role"},
{text:"Opponent run matchup is favorable.",verified:true,source:"current matchup",causalHint:"run-matchup"},
{text:"Two starting offensive linemen are ruled out.",verified:true,source:"official status",causalHint:"ol-state"},
{text:"Receiving Backup's route and target role expanded for two consecutive games.",verified:true,source:"observed workload",causalHint:"backup-receiving"}]},
{id:"U02",label:"WR CB1 out, weather worsens, QB replaced",prior:{player:"Established WR",strength:"STRONG"},challenger:{player:"Alternative WR"},facts:[
{text:"Opponent CB1 is ruled out and normally covers Established WR's alignment.",verified:true,source:"official status",causalHint:"secondary-state"},
{text:"Forecast now calls for heavy wind during the game.",verified:true,source:"current weather",causalHint:"weather-state"},
{text:"Established WR's starting quarterback is ruled out.",verified:true,source:"official status",causalHint:"qb-state"},
{text:"Backup quarterback has not established comparable downfield usage.",verified:true,source:"observed role",causalHint:"qb-state"}]},
{id:"U03",label:"Higher projection but challenger lost LT and WR1",prior:{player:"Projection QB",strength:"MODERATE"},challenger:{player:"Rushing QB"},facts:[
{text:"Projection QB has a small current projection edge.",verified:true,source:"current projection",causalHint:"projection"},
{text:"Rushing QB has the better opponent matchup.",verified:true,source:"current matchup",causalHint:"matchup"},
{text:"Rushing QB has an independent rushing production path.",verified:true,source:"observed role",causalHint:"rushing"},
{text:"Rushing QB's starting left tackle is ruled out.",verified:true,source:"official status",causalHint:"offense-losses"},
{text:"Rushing QB's WR1 is ruled out.",verified:true,source:"official status",causalHint:"offense-losses"}]},
{id:"U04",label:"Defense sucks claim with opponent-quality trap",prior:{player:"Role Leader",strength:"MODERATE"},challenger:{player:"Matchup Challenger"},customerConcern:"Their defense sucks.",facts:[
{text:"Customer says the opponent defense is terrible.",verified:false,source:"customer",causalHint:"customer-claim"},
{text:"Raw fantasy points allowed rank is poor.",verified:true,source:"season aggregate",causalHint:"raw-defense-results"},
{text:"Two elite offenses account for most of the damaging sample.",verified:true,source:"opponent-quality context",causalHint:"sample-quality"},
{text:"Challenger has the weaker opportunity role.",verified:true,source:"role snapshot",causalHint:"challenger-role"}]},
{id:"U05",label:"Three reports from one coach quote",prior:{player:"Established Flex",strength:"MODERATE"},challenger:{player:"Backup RB"},facts:[
{text:"National outlet reports the coach said Backup RB should get more work.",verified:true,source:"Outlet A quoting coach",causalHint:"coach-quote-1"},
{text:"Fantasy outlet repeats that Backup RB should get more work.",verified:true,source:"Outlet B citing Outlet A",causalHint:"coach-quote-1"},
{text:"Local aggregation account repeats the same quote.",verified:true,source:"Outlet C citing same quote",causalHint:"coach-quote-1"},
{text:"No observed workload change exists yet.",verified:true,source:"pregame role snapshot",causalHint:"observed-role"}]},
{id:"U06",label:"Ranking stale after teammate absence",prior:{player:"Ranking Favorite",strength:"MODERATE"},challenger:{player:"Role Beneficiary"},facts:[
{text:"Weekly ranking favors Ranking Favorite.",verified:true,source:"ranking snapshot",causalHint:"ranking"},
{text:"After rankings were built, Role Beneficiary's teammate is ruled out.",verified:true,source:"official status",causalHint:"teammate-out"},
{text:"Role Beneficiary has previously handled the vacated role when that teammate was absent.",verified:true,source:"historical role evidence",causalHint:"role-inheritance"},
{text:"No new ranking has incorporated the absence.",verified:true,source:"ranking timestamp",causalHint:"ranking-staleness"}]},
{id:"U07",label:"Must-win plus documented coaching behavior",prior:{player:"Baseline Option",strength:"MODERATE"},challenger:{player:"Urgency Player"},facts:[
{text:"Urgency Player's team is in a must-win situation.",verified:true,source:"standings context",causalHint:"competitive-state"},
{text:"In comparable high-leverage games this staff has repeatedly increased Urgency Player's designed usage.",verified:true,source:"historical coaching usage",causalHint:"coaching-behavior"},
{text:"Current coach comments explicitly emphasize getting Urgency Player more touches.",verified:true,source:"coach comments",causalHint:"current-plan"}]},
{id:"U08",label:"Questionable late star, late replacement exists",prior:{player:"Questionable Star",strength:"STRONG"},challenger:{player:"Early Fallback"},facts:[
{text:"Questionable Star plays in the late window.",verified:true,source:"schedule",causalHint:"timing"},
{text:"Early Fallback locks in the early window.",verified:true,source:"schedule",causalHint:"timing"},
{text:"A viable Late Replacement is rostered and also plays late.",verified:true,source:"roster/schedule",causalHint:"late-option"},
{text:"Questionable Star is expected to be a true game-time decision.",verified:true,source:"current injury report",causalHint:"availability"}]},
{id:"U09",label:"Star history versus verified role erosion",prior:{player:"Established Star",strength:"STRONG"},challenger:{player:"Emerging Player"},facts:[
{text:"Established Star has a multi-season elite history.",verified:true,source:"historical baseline",causalHint:"history"},
{text:"Star's snap share, routes and designed opportunities have all declined.",verified:true,source:"current workload",causalHint:"role-erosion"},
{text:"The three declining metrics arise from the same verified role reduction.",verified:true,source:"role analysis",causalHint:"role-erosion"},
{text:"Emerging Player now owns the stronger current opportunity role.",verified:true,source:"current workload",causalHint:"emerging-role"}]},
{id:"U10",label:"Insufficient evidence coin flip",prior:{player:"Player A",strength:"WEAK"},challenger:{player:"Player B"},facts:[
{text:"Player A has a tiny role edge.",verified:true,source:"current role",causalHint:"a-role"},
{text:"Player B has a tiny matchup edge.",verified:true,source:"current matchup",causalHint:"b-matchup"},
{text:"Projection difference is within normal model noise.",verified:true,source:"projection uncertainty",causalHint:"projection-noise"},
{text:"No material injury, role, opponent-personnel or scheme change is known.",verified:true,source:"current state",causalHint:"stable-state"}]},
{id:"U11",label:"Complete conflict QB — no more news coming",informationState:"COMPLETE",prior:{player:"Veteran QB",strength:"MODERATE"},challenger:{player:"Dual-Threat QB"},facts:[
{text:"Veteran QB has a small projection edge.",verified:true,source:"current projection",causalHint:"projection"},
{text:"Dual-Threat QB has the better verified pass-defense matchup.",verified:true,source:"current matchup",causalHint:"matchup"},
{text:"Dual-Threat QB has an independent rushing production path.",verified:true,source:"observed role",causalHint:"rushing"},
{text:"Dual-Threat QB's starting left tackle is out.",verified:true,source:"official final status",causalHint:"offense-losses"},
{text:"Dual-Threat QB's WR1 is out.",verified:true,source:"official final status",causalHint:"offense-losses"},
{text:"All relevant final statuses are known and no additional pre-lock information is expected.",verified:true,source:"decision clock",causalHint:"information-complete"}]},
{id:"U12",label:"Complete conflict WR — defensive help versus offensive damage",informationState:"COMPLETE",prior:{player:"Established WR",strength:"STRONG"},challenger:{player:"Alternative WR"},facts:[
{text:"Opponent CB1 is out and directly matched the Established WR's alignment.",verified:true,source:"official final status",causalHint:"secondary-state"},
{text:"Established WR's starting quarterback is out.",verified:true,source:"official final status",causalHint:"qb-state"},
{text:"Heavy wind is confirmed for the game window.",verified:true,source:"current weather",causalHint:"weather-state"},
{text:"Alternative WR retains a stable full-time role in a neutral environment.",verified:true,source:"current role",causalHint:"alternative-role"},
{text:"All relevant final statuses are known and no additional pre-lock information is expected.",verified:true,source:"decision clock",causalHint:"information-complete"}]},
{id:"U13",label:"Complete conflict RB — matchup versus damaged blocking",informationState:"COMPLETE",prior:{player:"Established RB",strength:"STRONG"},challenger:{player:"Alternative RB"},facts:[
{text:"Established RB retains the stronger verified touch role.",verified:true,source:"current role",causalHint:"incumbent-role"},
{text:"Established RB has the better run-defense matchup.",verified:true,source:"current matchup",causalHint:"run-matchup"},
{text:"Two starting offensive linemen are out.",verified:true,source:"official final status",causalHint:"ol-state"},
{text:"Alternative RB has a stable three-down role in a neutral matchup.",verified:true,source:"current role",causalHint:"alternative-role"},
{text:"All relevant final statuses are known and no additional pre-lock information is expected.",verified:true,source:"decision clock",causalHint:"information-complete"}]},
{id:"U14",label:"Complete conflict ranking versus fresh role",informationState:"COMPLETE",prior:{player:"Ranking Favorite",strength:"MODERATE"},challenger:{player:"Fresh Role Player"},facts:[
{text:"The current published ranking favors Ranking Favorite.",verified:true,source:"ranking snapshot",causalHint:"ranking"},
{text:"Fresh Role Player received a verified material role increase after that ranking snapshot.",verified:true,source:"official/team role update",causalHint:"fresh-role"},
{text:"Fresh Role Player also has the slightly better matchup.",verified:true,source:"current matchup",causalHint:"matchup"},
{text:"All relevant final statuses are known and no additional pre-lock information is expected.",verified:true,source:"decision clock",causalHint:"information-complete"}]}

];
module.exports={RAW_CASES};

"use strict";
const origin='https://sprightly-chebakia-13d478.netlify.app';
const cases=[['synthetic-a',7,8],['synthetic-b',9,10]];
function league(team){const c=cases.find(c=>c[0]===team);if(!c)throw Error('fixture_case');return{id:'synthetic-league',scoringPeriodId:c[1],settings:{name:'Synthetic League',size:12,scoringSettings:{scoringItems:[{statId:53,points:1}]}},status:{currentScoringPeriod:c[1]},teams:[{id:team,name:'Synthetic Team',roster:{entries:[{lineupSlotId:4,playerPoolEntry:{player:{id:team+'-player',fullName:'Synthetic WR',defaultPositionId:3,proTeamId:1,stats:[]}}}]},record:{overall:{wins:0,losses:0,ties:0}}}],schedule:[]};}
module.exports={origin,cases,league};

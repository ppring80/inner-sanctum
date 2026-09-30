'use strict';
// Reserve transactions persist across recommendation weeks. Clearing one
// requires an explicit activation week, not an empty/missing injury field.
const TRANSACTIONS=Object.freeze([
 {playerID:'4702555',name:'Jonah Coleman',position:'RB',team:'DEN',season:2026,fromWeek:3,activationWeek:null,status:'IR',source:'Denver Broncos official roster',sourceUrl:'https://www.denverbroncos.com/team/players-roster/',confirmedAt:'2026-09-30',reason:'On Reserve/Injured after the September 26 injured-reserve transaction.'}
]);
const key=name=>String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function reserveTransaction(player,season,week){return TRANSACTIONS.find(t=>Number(season)===t.season&&Number(week)>=t.fromWeek&&(!t.activationWeek||Number(week)<t.activationWeek)&&((player.playerID&&String(player.playerID)===t.playerID)||key(player.name||player.longName)===key(t.name))&&(!player.position||player.position===t.position))||null;}
module.exports={TRANSACTIONS,reserveTransaction};

'use strict';
// Official sources use both specific positions and broader roster labels.
// Only a declared broad/specific relationship is compatible; sibling roles
// and unrelated labels do not become interchangeable.
const broad={OL:['C','G','T','OG','OT','LG','RG','LT','RT'],DL:['DE','DT','NT'],DB:['CB','S','FS','SS'],LB:['ILB','OLB','MLB'],EDGE:['DE','OLB']};
function compatiblePosition(left,right){
 const a=String(left||'').trim().toUpperCase(),b=String(right||'').trim().toUpperCase();
 return !!a&&!!b&&(a===b||broad[a]?.includes(b)===true||broad[b]?.includes(a)===true);
}
module.exports={compatiblePosition};

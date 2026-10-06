"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const s=fs.readFileSync(path.join(__dirname,"../docs/SUPER_SAGE_OPERATOR_GAUNTLET_V1.md"),"utf8");
for(let i=1;i<=50;i++){const id="G"+String(i).padStart(2,"0");assert.ok(s.includes(id+" —"),"missing gauntlet case "+id);}
[
"PASS_DIFFERENT_CALL","Invents an injury","Counts correlated manifestations",
"customer assertion as verified evidence","Must-win NFL team narrative",
"Opponent CB1 OUT","Pick two from four","Evidence genuinely insufficient",
"No single gauntlet failure changes production policy"
].forEach(x=>assert.ok(s.includes(x),"missing gauntlet guardrail: "+x));
console.log("Super SAGE Operator Gauntlet V1: 50 adversarial cases present, guardrails PASS");

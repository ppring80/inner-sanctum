"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const p=path.join(__dirname,"../docs/SUPER_SAGE_DECISION_DEMAND_CORPUS_V1.md");
const s=fs.readFileSync(p,"utf8");
[
"ESTABLISHED BASELINE VS CHALLENGER",
"MATCHUP VS PLAYER QUALITY",
"TEAMMATE STATE CHANGE / ROLE REDISTRIBUTION",
"OPPONENT DEFENSIVE STATE CHANGE",
"CONDITIONAL AVAILABILITY",
"KICKOFF OPTIONALITY",
"SMALL SAMPLE / REPRESENTATIVENESS",
"COMPETITIVE STATE / COACHING INCENTIVE",
"SYSTEM / ANALYST CONTRADICTION",
"WHY NOT THE OTHER PLAYER",
"These archetypes teach the Operator what conflict to recognize"
].forEach(x=>assert.ok(s.includes(x),`missing Operator teaching contract: ${x}`));
assert.ok(s.includes("do NOT encode the supplied human questions as correct answers"));
console.log("Super SAGE Operator Decision Demand Corpus V1 contract: PASS");

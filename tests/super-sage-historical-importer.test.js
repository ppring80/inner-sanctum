"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "../scripts/build-super-sage-historical-lab.py"), "utf8");
assert.ok(src.includes("2019-2025 full regular seasons + 2026 Weeks 1-3"));
assert.ok(src.includes("fantasy_half_ppr"));
assert.ok(src.includes("fantasy_ppr"));
assert.ok(src.includes("fantasy_std"));
assert.ok(src.includes("season_type"));
assert.ok(src.includes("game_type"));
assert.ok(src.includes("lookAheadRule"));
assert.ok(src.includes('players.to_csv(outdir / "player-weeks.csv"'));
assert.ok(src.includes('schedule.to_csv(outdir / "games.csv"'));
console.log("Super SAGE historical importer contract assertions passed.");

// Exercise the portable output contract without downloading provider data.
const {spawnSync}=require('child_process');
const probe=spawnSync('python3',['-c',String.raw`
import importlib.util,sys,tempfile,json,types,csv
from pathlib import Path
sys.modules['pandas']=types.ModuleType('pandas')
class Frame:
 def __init__(self,rows):self.rows=rows
 def to_csv(self,path,index=False):
  with open(path,'w',newline='') as f:
   writer=csv.DictWriter(f,fieldnames=list(self.rows[0]));writer.writeheader();writer.writerows(self.rows)
spec=importlib.util.spec_from_file_location('lab','scripts/build-super-sage-historical-lab.py')
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)
players=Frame([{'season':2024,'week':1,'player_id':'fixture','fantasy_half_ppr':22}])
games=Frame([{'season':2024,'week':1,'game_type':'REG'}])
lab.build=lambda *args:(players,games,{'lookAheadRule':'Outcomes are not pre-decision features'})
with tempfile.TemporaryDirectory() as directory:
 sys.argv=['lab','--out',directory];lab.main()
 out=Path(directory)
 assert list(csv.DictReader((out/'player-weeks.csv').open()))[0]['player_id']=='fixture'
 assert len(list(csv.DictReader((out/'games.csv').open())))==1
 assert json.loads((out/'manifest.json').read_text())['lookAheadRule']
`],{cwd:path.join(__dirname,'..'),encoding:'utf8'});
assert.strictEqual(probe.status,0,probe.stderr||probe.stdout);
console.log('Portable historical CSV output verified with an offline fixture.');

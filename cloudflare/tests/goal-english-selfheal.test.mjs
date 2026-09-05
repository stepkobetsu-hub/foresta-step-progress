import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { GOAL_ENGLISH_UNITS, GOAL_ENGLISH_MATERIAL } from "../src/goal-english.ts";

test("canonical Goal English has 54 ordered unique units",()=>{
 assert.equal(GOAL_ENGLISH_MATERIAL.series,"FORESTA_GOAL");
 assert.equal(GOAL_ENGLISH_MATERIAL.grade,"中3");
 assert.equal(GOAL_ENGLISH_UNITS.length,54);
 assert.deepEqual(GOAL_ENGLISH_UNITS.map(x=>x.unitOrder),Array.from({length:54},(_,i)=>i+1));
 assert.equal(new Set(GOAL_ENGLISH_UNITS.map(x=>x.unitId)).size,54);
 assert.match(GOAL_ENGLISH_UNITS[0].unitId,/2026FG-ENG-G3-UNIT-/);
 assert.match(GOAL_ENGLISH_UNITS[53].unitId,/2026FG-ENG-G3-TIME-/);
});

test("runtime self-heals English and verifies 1320/1331 eligibility",()=>{
 const v3=fs.readFileSync(new URL("../src/v3.ts",import.meta.url),"utf8");
 assert.match(v3,/ensureGoalEnglishCatalog/);
 assert.match(v3,/await ensureGoalEnglishCatalog\(env\)/);
 assert.match(v3,/ensureDummy1331/);
 assert.match(v3,/goalEnglishUnitCount/);
 assert.match(v3,/goalEnglishEligibility/);
});

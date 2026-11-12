// Self-check for estimateDaysLeft. Run: npx tsx src/app/module/summary/summary.calculator.check.ts
import assert from "node:assert/strict";
import { estimateDaysLeft } from "./summary.calculator";

// 30 meals in 10 days at 50/meal = 150/day; 1000 lasts 6 full days.
assert.equal(estimateDaysLeft(1000, 30, 10, 50), 6);
assert.equal(estimateDaysLeft(0, 30, 10, 50), 0);
assert.equal(estimateDaysLeft(-200, 30, 10, 50), 0);
assert.equal(estimateDaysLeft(500, 0, 10, 50), null);
assert.equal(estimateDaysLeft(500, 30, 0, 50), null);
assert.equal(estimateDaysLeft(500, 30, 10, 0), null);

console.log("estimateDaysLeft: all checks passed");

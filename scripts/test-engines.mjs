// 判定ロジックの簡単な確認: node scripts/test-engines.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vital = require("../js/va-vital-engine.js");
const ecg = require("../js/va-ecg-engine.js");

// 胸背部痛＋血圧左右差 → 緊急度 高、候補の先頭は大動脈解離
let r = vital.assess({ complaints: ["胸痛", "背部痛"], sex: "m", age: 62, history: ["高血圧"], hr: 112, rSys: 168, rDia: 92, lSys: 132, lDia: 80, spo2: 95, o2: "air", rr: 22, temp: 36.6 });
assert.equal(r.urgency.level, "high");
assert.equal(r.conditions[0].name, "急性大動脈解離");

// 発熱＋qSOFA 3点 → 敗血症が先頭
r = vital.assess({ complaints: ["発熱"], age: 80, hr: 112, rSys: 88, rDia: 50, rr: 26, temp: 38.9, spo2: 92, o2: "air", gcsE: 3, gcsV: 4, gcsM: 6 });
assert.equal(r.qsofa.score, 3);
assert.equal(r.conditions[0].name, "敗血症・敗血症性ショック");

// 体温 365 は確認を出し、評価に使わない
r = vital.assess({ temp: 365 });
assert.equal(r.checks[0].fix, 36.5);
assert.equal(r.vitals.find((v) => v.key === "temp").level, null);

// 入力なし → 未評価
assert.equal(vital.assess({}).urgency.level, "none");

// 心電図
assert.equal(ecg.evaluate({ hr: 72, regularity: "reg", p: "normal", pr: 160, qrs: 90 }).rhythms[0].name, "正常洞調律");
assert.equal(ecg.evaluate({ hr: 130, regularity: "irregirreg", p: "fib" }).rhythms[0].name, "心房細動");
assert.equal(ecg.evaluate({ qrsShape: "chaotic", pulse: "no" }).urgency, "arrest");
assert.equal(ecg.evaluate({ hr: 36, av: "dissoc", p: "more", qrs: 140 }).rhythms[0].name, "完全房室ブロック（3度）");
assert.match(ecg.evaluate({ hr: 80, p: "normal", regularity: "reg", stUp: ["II", "III", "aVF"] }).findings[0].name, /下壁/);

console.log("all engine checks passed");

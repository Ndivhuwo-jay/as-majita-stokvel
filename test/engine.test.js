const assert = require("node:assert/strict");
const { computeYear } = require("../js/engine.js");
global.window = {};
require("../js/seed-data.js");
const s = window.STOKVEL_SEED;

const r = computeYear({ members: s.members, payments: s.payments, year: 2026, interest: 0, today: "2026-10-21" });
const by = Object.fromEntries(r.ledger.map((l) => [l.id, l]));

assert.equal(r.totals.collected, 76350);
assert.equal(by["m-jondow"].totalPaid, 27000);
assert.equal(by["m-jabu"].totalPaid, 27850);
assert.equal(by["m-jabu"].penaltiesPaid, 50);
assert.equal(by["m-jabu"].savings, 27800);
assert.equal(by["m-makhera"].totalPaid, 9000);
assert.equal(by["m-makhera"].penaltiesCharged, 100);
assert.equal(by["m-chinanga"].savings, 11000);
assert.equal(by["m-trevor"].status, "expelled");
assert.equal(by["m-trevor"].expelledMonth, 7);
assert.equal(by["m-funi"].status, "expelled");
assert.equal(by["m-jondow"].status, "late");
assert.equal(Math.round(r.totals.decPayoutNow + r.totals.fundNow), Math.round(r.totals.balance));
console.log("All rule checks passed.");

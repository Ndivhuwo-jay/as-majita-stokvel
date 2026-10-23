const assert = require("node:assert/strict");
const { computeYear, deadline, isLate } = require("../js/engine.js");
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
// October is due by 7 November, so on 21 October it is not late yet
assert.equal(by["m-jondow"].status, "good");
assert.equal(by["m-jondow"].cells[9].state, "pending");
assert.equal(Math.round(r.totals.decPayoutNow + r.totals.fundNow), Math.round(r.totals.balance));

assert.equal(deadline(2026, 10), "2026-11-07");
assert.equal(deadline(2026, 12), "2027-01-07");
assert.equal(isLate({ date: "2026-11-07", month: "2026-10" }), false);
assert.equal(isLate({ date: "2026-11-08", month: "2026-10" }), true);
assert.equal(isLate({ date: "2026-10-20" }), false);

const one = (payments, today) => computeYear({ members: [{ id: "a", name: "A", joined: "2026-01-01" }], payments, year: 2026, interest: 0, today }).ledger[0];
const sept = (n) => Array.from({ length: n }, (_, i) => ({ memberId: "a", date: `2026-${String(i + 1).padStart(2, "0")}-15`, amount: 300 }));
// September unpaid: still pending on 7 October, missed with a penalty on 8 October
assert.equal(one(sept(8), "2026-10-07").cells[8].state, "pending");
assert.equal(one(sept(8), "2026-10-07").status, "good");
assert.equal(one(sept(8), "2026-10-08").cells[8].state, "missed");
assert.equal(one(sept(8), "2026-10-08").penaltiesCharged, 50);
// Paid on 3 October for September: on time, and counted for September
const paidEarlyOct = one([...sept(8), { memberId: "a", date: "2026-10-03", month: "2026-09", amount: 300 }], "2026-10-21");
assert.equal(paidEarlyOct.cells[8].state, "ontime");
assert.equal(paidEarlyOct.cells[9].state, "pending");
// Paid on 9 October for September: late, no penalty
const paidLate = one([...sept(8), { memberId: "a", date: "2026-10-09", month: "2026-09", amount: 300 }], "2026-10-21");
assert.equal(paidLate.cells[8].state, "late");
assert.equal(paidLate.status, "late");
assert.equal(paidLate.penaltiesCharged, 0);
// No December contribution: November is the last month, due by 7 December
const full = one(sept(10), "2026-12-07");
assert.equal(full.cells.length, 11);
assert.equal(full.cells[10].state, "pending");
assert.equal(full.status, "good");
assert.equal(one(sept(10), "2026-12-08").cells[10].state, "missed");
assert.equal(one(sept(11), "2026-12-20").status, "good");
console.log("All rule checks passed.");

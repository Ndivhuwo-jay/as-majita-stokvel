const RULES = { MIN: 300, PENALTY: 50, CUTOFF_DAY: 7, EXPEL_AFTER: 3, INTEREST_MIN_MONTHS: 8, PAYOUT_DAY: 20 };
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

function computeYear({ members, payments, year, interest, today }) {
  const t = parseDate(today);
  const cm = t.y > year ? 13 : t.y < year ? 0 : t.m;
  const todayDay = t.y === year ? t.d : 31;

  const monthTotals = MONTHS.map((name, i) => ({
    month: i + 1, name, collected: 0, onTime: 0, late: 0, penalties: 0,
    paidCount: 0, lateCount: 0, missedCount: 0, withdrawals: 0,
  }));

  const byMember = {};
  for (const p of payments) {
    const d = parseDate(p.date);
    if (!d || d.y !== year) continue;
    (byMember[p.memberId] ||= []).push({ ...p, d, amount: Number(p.amount) || 0 });
  }

  const ledger = [];
  for (const mem of members) {
    const join = parseDate(mem.joined) || { y: year, m: 1, d: 1 };
    if (join.y > year) continue;
    const start = join.y < year ? 1 : join.m;
    const wd = mem.withdrawn ? parseDate(mem.withdrawn) : null;
    const withdrawnThisYear = wd && wd.y === year;
    if (wd && wd.y < year) continue;
    const lastDue = withdrawnThisYear ? wd.m - 1 : 12;
    const pays = (byMember[mem.id] || []).sort((a, b) => (a.date < b.date ? -1 : 1));

    let due = 0, totalPaid = 0, penaltiesCharged = 0, penaltiesPaid = 0, contributions = 0;
    let monthsContributed = 0, consecutive = 0, expelledMonth = null, lateCount = 0;
    const cells = [];
    const lastMonth = withdrawnThisYear ? wd.m : 12;

    for (let m = 1; m <= 12; m++) {
      const inMonth = pays.filter((p) => p.d.m === m);
      const paid = inMonth.reduce((s, p) => s + p.amount, 0);
      if (m < start) { cells.push({ m, state: "na", paid: 0 }); continue; }
      if (expelledMonth) { cells.push({ m, state: "expelled", paid }); continue; }
      if (m > lastMonth) { cells.push({ m, state: "withdrawn", paid: 0 }); continue; }
      if (m > cm) { cells.push({ m, state: "future", paid: 0 }); continue; }

      const owed = m <= lastDue;
      const open = m === cm;
      totalPaid += paid;
      const toPenalty = Math.min(paid, penaltiesCharged - penaltiesPaid);
      penaltiesPaid += toPenalty;
      contributions += paid - toPenalty;
      const late = inMonth.length > 0 && inMonth[0].d.d > RULES.CUTOFF_DAY;

      const mt = monthTotals[m - 1];
      mt.collected += paid;
      for (const p of inMonth) p.d.d > RULES.CUTOFF_DAY ? (mt.late += p.amount) : (mt.onTime += p.amount);

      let state;
      if (paid > 0) {
        monthsContributed++; consecutive = 0;
        state = late ? "late" : "ontime";
        mt.paidCount++;
        if (late) { mt.lateCount++; lateCount++; }
        if (owed) due += RULES.MIN;
      } else if (!owed) {
        state = "withdrawn";
      } else if (open) {
        state = todayDay > RULES.CUTOFF_DAY ? "overdue" : "pending";
        if (todayDay > RULES.CUTOFF_DAY) due += RULES.MIN;
      } else {
        state = "missed";
        due += RULES.MIN;
        penaltiesCharged += RULES.PENALTY;
        mt.missedCount++; mt.penalties += RULES.PENALTY;
        consecutive++;
        if (consecutive >= RULES.EXPEL_AFTER) expelledMonth = m;
      }
      cells.push({ m, state, paid });
    }

    const penaltyOwed = penaltiesCharged - penaltiesPaid;
    const arrears = Math.max(0, due - contributions);
    const credit = Math.max(0, contributions - due);
    const savings = Math.max(0, contributions - penaltyOwed);
    const current = cells.find((c) => c.m === cm);

    let status;
    if (expelledMonth) status = "expelled";
    else if (withdrawnThisYear) status = "withdrawn";
    else if (arrears > 0 || penaltyOwed > 0) status = (current && current.state === "overdue" && arrears <= RULES.MIN && penaltyOwed === 0) ? "late" : "arrears";
    else if (current && (current.state === "late" || current.state === "overdue")) status = "late";
    else status = "good";

    let remaining = 0;
    if (status !== "expelled" && status !== "withdrawn") {
      for (const c of cells) if (c.state === "future" || c.state === "pending" || c.state === "overdue") remaining++;
    }
    const projContrib = contributions + remaining * RULES.MIN;
    const projMonths = monthsContributed + remaining;
    const projSavings = Math.max(0, projContrib - penaltyOwed);

    if (withdrawnThisYear) monthTotals[wd.m - 1].withdrawals += savings;

    ledger.push({
      id: mem.id, name: mem.name, joined: mem.joined, withdrawn: mem.withdrawn || null,
      cells, status, due, totalPaid, contributions, penaltiesCharged, penaltiesPaid, penaltyOwed,
      arrears, credit, savings, monthsContributed, lateCount, expelledMonth,
      forfeited: expelledMonth ? contributions : 0,
      remaining, projContrib, projMonths, projSavings,
    });
  }

  const share = (key, monthsKey) => {
    const q = ledger.filter((r) => r.status !== "expelled" && r[monthsKey] >= RULES.INTEREST_MIN_MONTHS);
    const base = q.reduce((s, r) => s + r[key], 0);
    for (const r of ledger) {
      const ok = q.includes(r) && base > 0;
      r[key + "Interest"] = ok ? (interest * r[key]) / base : 0;
      r[key + "Qualifies"] = q.includes(r);
    }
    return base > 0 ? 0 : interest;
  };
  const unsharedNow = share("savings", "monthsContributed");
  const unsharedProj = share("projSavings", "projMonths");

  for (const r of ledger) {
    r.payoutNow = r.status === "expelled" ? 0 : r.savings + r.savingsInterest;
    r.payoutProj = r.status === "expelled" ? 0 : r.projSavings + r.projSavingsInterest;
  }

  const sum = (k, rows = ledger) => rows.reduce((s, r) => s + r[k], 0);
  const collected = sum("totalPaid");
  const withdrawnOut = sum("savings", ledger.filter((r) => r.status === "withdrawn"));
  let running = 0;
  for (const mt of monthTotals) { running += mt.collected - mt.withdrawals; mt.balance = running; mt.closedOrOpen = mt.month <= cm; }

  const active = ledger.filter((r) => r.status !== "expelled" && r.status !== "withdrawn");
  const dec = ledger.filter((r) => r.status !== "expelled");
  const totals = {
    collected, withdrawnOut, interest,
    balance: collected - withdrawnOut + interest,
    penaltiesPaid: sum("penaltiesPaid"),
    penaltyOwed: sum("penaltyOwed"),
    forfeited: sum("forfeited"),
    arrears: sum("arrears"),
    decPayoutNow: dec.reduce((s, r) => s + (r.status === "withdrawn" ? r.savingsInterest : r.payoutNow), 0),
    decPayoutProj: dec.reduce((s, r) => s + (r.status === "withdrawn" ? r.projSavingsInterest : r.payoutProj), 0),
    futureContrib: active.reduce((s, r) => s + r.remaining * RULES.MIN, 0),
    unsharedNow, unsharedProj,
    counts: ledger.reduce((c, r) => ((c[r.status] = (c[r.status] || 0) + 1), c), {}),
  };
  totals.fundNow = totals.balance - totals.decPayoutNow;
  totals.balanceProj = totals.balance + totals.futureContrib;
  totals.fundProj = totals.balanceProj - totals.decPayoutProj;
  return { ledger, monthTotals, totals, cm };
}

if (typeof module !== "undefined" && module.exports) module.exports = { computeYear, RULES, MONTHS, parseDate };

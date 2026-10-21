(() => {
  const $ = (s) => document.querySelector(s);
  const state = { members: [], payments: [], settings: {}, year: null, canWrite: false, openMember: null, filter: "", csvRows: null };
  let db = null, charts = {};

  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const todayISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  state.year = now.getFullYear();
  const R = (n, dp = 2) => "R " + Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const R0 = (n) => R(n, 0);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const STATUS = { good: "Good standing", late: "Late", arrears: "In arrears", expelled: "Expelled", withdrawn: "Withdrawn" };
  const pill = (s) => `<span class="pill st-${s}">${STATUS[s]}</span>`;
  const fmtDate = (iso) => { const d = parseDate(iso); return d ? `${d.d} ${MONTHS[d.m - 1]} ${d.y}` : ""; };
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600); }

  function confirmBtn(btn, label, action) {
    if (btn.dataset.armed) { delete btn.dataset.armed; action(); return; }
    const old = btn.textContent; btn.dataset.armed = "1"; btn.textContent = label;
    setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = old; } }, 4000);
  }

  const TABS = ["overview", "members", "payments", "payout", "rules"];
  function showTab(name) {
    if (!TABS.includes(name)) name = "overview";
    document.querySelectorAll("nav.tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    document.querySelectorAll("section[data-panel]").forEach((s) => (s.hidden = s.dataset.panel !== name));
    try { localStorage.setItem("tab", name); } catch {}
  }
  document.querySelectorAll("nav.tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  let startTab = location.hash.slice(1);
  if (!TABS.includes(startTab)) { try { startTab = localStorage.getItem("tab") || "overview"; } catch { startTab = "overview"; } }
  showTab(startTab);

  function interestFor(y) { return Number(state.settings["y" + y]?.interest || 0); }
  function years() {
    const ys = new Set([now.getFullYear()]);
    for (const p of state.payments) { const d = parseDate(p.date); if (d) ys.add(d.y); }
    return [...ys].sort((a, b) => b - a);
  }

  function render() {
    const y = state.year;
    const res = computeYear({ members: state.members, payments: state.payments, year: y, interest: interestFor(y), today: todayISO });
    state.res = res;
    document.querySelectorAll(".yr").forEach((e) => (e.textContent = y));

    const ysel = $("#yearSel"); const ys = years();
    ysel.innerHTML = ys.map((v) => `<option ${v === y ? "selected" : ""}>${v}</option>`).join("");

    const payday = new Date(y, 11, RULES.PAYOUT_DAY);
    const days = Math.ceil((payday - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    $("#countdown").innerHTML = days > 0 ? `<b>${days}</b> days to the 20 Dec payout` : days === 0 ? `<b>Payout day</b>` : `Paid out 20 Dec ${y}`;
    $("#asOf").textContent = `Ledger for ${y} · rules applied as of ${fmtDate(todayISO)}`;

    renderKpis(res); renderCharts(res); renderMonthTable(res); renderLedger(res); renderPayForm(res); renderPayTable(res); renderPayout(res);
    document.querySelectorAll(".writer").forEach((el) => (el.hidden = !state.canWrite));
  }

  function renderKpis({ totals: T, ledger }) {
    const c = T.counts;
    const chips = ["good", "late", "arrears", "withdrawn", "expelled"].filter((k) => c[k]).map((k) => `<span class="pill st-${k}">${c[k]} ${STATUS[k].toLowerCase()}</span>`).join("");
    $("#kpis").innerHTML = `
      <div class="kpi"><span class="label">Collected in ${state.year}</span><span class="v num">${R0(T.collected)}</span><span class="d">${ledger.length} members on the register</span></div>
      <div class="kpi"><span class="label">In the account now</span><span class="v num">${R0(T.balance)}</span><span class="d">Includes ${R0(T.interest)} interest, less ${R0(T.withdrawnOut)} paid to early withdrawals</span></div>
      <div class="kpi"><span class="label">Projected 20 Dec payout</span><span class="v hero num">${R0(T.decPayoutProj)}</span><span class="d">If active members pay R300 for the remaining months</span></div>
      <div class="kpi"><span class="label">Owed to the Stokvel</span><span class="v num ${T.arrears + T.penaltyOwed ? "neg" : ""}">${R0(T.arrears + T.penaltyOwed)}</span><span class="d">${R0(T.arrears)} contributions, ${R0(T.penaltyOwed)} penalties</span></div>
      <div class="kpi"><span class="label">Members</span><div class="chips">${chips || '<span class="d">No members yet</span>'}</div></div>`;
  }

  function renderCharts({ monthTotals, cm }) {
    if (!window.Chart) return;
    const ink2 = css("--ink-2"), grid = css("--line-2"), s1 = css("--s1"), s2 = css("--s2"), surface = css("--surface");
    Chart.defaults.font.family = css("--font-body"); Chart.defaults.color = ink2;
    const labels = MONTHS;
    const tooltip = { callbacks: { label: (c) => `${c.dataset.label}: ${R(c.parsed.y)}` } };
    const scales = (stacked) => ({
      x: { stacked, grid: { display: false }, border: { color: grid } },
      y: { stacked, beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { callback: (v) => "R" + Number(v).toLocaleString("en-ZA"), maxTicksLimit: 6 } },
    });
    const barData = [
      { label: "By the 7th", data: monthTotals.map((m) => m.onTime), backgroundColor: s1, borderRadius: 4, borderSkipped: "start", borderColor: surface, borderWidth: { top: 2 } },
      { label: "After the 7th", data: monthTotals.map((m) => m.late), backgroundColor: s2, borderRadius: 4, borderSkipped: "start", borderColor: surface, borderWidth: { top: 2 } },
    ];
    const lineData = [{ label: "Balance", data: monthTotals.map((m) => (m.closedOrOpen ? m.balance : null)), borderColor: s1, backgroundColor: s1 + "22", fill: true, tension: 0.25, borderWidth: 2, pointRadius: 4, pointBackgroundColor: s1, pointBorderColor: surface, pointBorderWidth: 2, spanGaps: false }];
    const common = { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { display: false }, tooltip } };
    if (charts.bar) { charts.bar.data.datasets = barData; charts.bar.update(); }
    else charts.bar = new Chart($("#barChart"), { type: "bar", data: { labels, datasets: barData }, options: { ...common, scales: scales(true), datasets: { bar: { maxBarThickness: 34 } } } });
    if (charts.line) { charts.line.data.datasets = lineData; charts.line.update(); }
    else charts.line = new Chart($("#lineChart"), { type: "line", data: { labels, datasets: lineData }, options: { ...common, scales: scales(false) } });
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { charts.bar?.destroy(); charts.line?.destroy(); charts = {}; render(); });
  new MutationObserver(() => { charts.bar?.destroy(); charts.line?.destroy(); charts = {}; render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  function renderMonthTable({ monthTotals, totals }) {
    const rows = monthTotals.filter((m) => m.closedOrOpen).map((m) => `<tr>
      <td>${m.name}</td><td class="r num">${R(m.collected)}</td><td class="r num">${R(m.onTime)}</td><td class="r num">${m.late ? R(m.late) : '<span class="dim">–</span>'}</td>
      <td class="r num">${m.paidCount}</td><td class="r num">${m.lateCount || '<span class="dim">0</span>'}</td><td class="r num ${m.missedCount ? "neg" : ""}">${m.missedCount || '<span class="dim">0</span>'}</td>
      <td class="r num">${m.penalties ? R(m.penalties) : '<span class="dim">–</span>'}</td><td class="r num">${m.withdrawals ? R(m.withdrawals) : '<span class="dim">–</span>'}</td><td class="r num"><b>${R(m.balance)}</b></td></tr>`).join("");
    const sum = (k) => monthTotals.reduce((s, m) => s + m[k], 0);
    $("#monthTable").innerHTML = `<thead><tr><th>Month</th><th class="r">Collected</th><th class="r">By 7th</th><th class="r">Late</th><th class="r">Paid</th><th class="r">Late</th><th class="r">Missed</th><th class="r">Penalties charged</th><th class="r">Withdrawn</th><th class="r">Balance</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="10" class="empty">No payments recorded for ${state.year} yet.</td></tr>`}</tbody>
      <tfoot><tr><td>Year</td><td class="r num">${R(totals.collected)}</td><td class="r num">${R(sum("onTime"))}</td><td class="r num">${R(sum("late"))}</td><td></td><td></td><td class="r num">${sum("missedCount")}</td><td class="r num">${R(sum("penalties"))}</td><td class="r num">${R(totals.withdrawnOut)}</td><td class="r num">${R(totals.collected - totals.withdrawnOut)}</td></tr></tfoot>`;
  }

  const CELL_TITLE = { ontime: "paid by the 7th", late: "paid after the 7th", missed: "missed, R50 penalty", overdue: "not paid yet, past the 7th", pending: "due by the 7th", future: "not yet due", na: "before joining", withdrawn: "after withdrawal", expelled: "after expulsion" };
  function cellsHtml(cells) {
    return `<div class="months">${cells.map((c) => `<span class="mc ${c.state}" title="${MONTHS[c.m - 1]}: ${CELL_TITLE[c.state]}${c.paid ? " · " + R(c.paid) : ""}">${c.state === "missed" ? "×" : ""}</span>`).join("")}</div>`;
  }

  function renderLedger({ ledger }) {
    const head = `<thead><tr><th>Member</th><th>Status</th><th><div class="monthhead">${MONTHS.map((m) => `<span>${m[0]}</span>`).join("")}</div></th><th class="r">Paid</th><th class="r">Savings</th><th class="r">To settle</th><th class="r">Months</th></tr></thead>`;
    if (!ledger.length) { $("#ledgerTable").innerHTML = head + `<tbody><tr><td colspan="7" class="empty">${db ? "No members yet. Add the first member below." : "Records load once you are signed in."}</td></tr></tbody>`; return; }
    const order = { arrears: 0, late: 1, good: 2, withdrawn: 3, expelled: 4 };
    const rows = [...ledger].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name)).map((r) => {
      const owe = r.status === "expelled" || r.status === "withdrawn" ? 0 : r.arrears + r.penaltyOwed;
      const role = state.members.find((m) => m.id === r.id)?.role;
      return `<tr class="click ${state.openMember === r.id ? "open" : ""}" data-mid="${esc(r.id)}" tabindex="0">
        <td><b>${esc(r.name)}</b>${role ? `<div class="hint">${esc(role)}</div>` : ""}</td><td>${pill(r.status)}</td><td>${cellsHtml(r.cells)}</td>
        <td class="r num">${R(r.totalPaid)}</td><td class="r num">${r.status === "expelled" ? `<span class="neg">Forfeited</span>` : R(r.savings)}</td>
        <td class="r num ${owe ? "neg" : "dim"}">${owe ? R(owe) : "–"}</td><td class="r num">${r.monthsContributed}</td></tr>`;
    }).join("");
    $("#ledgerTable").innerHTML = head + `<tbody>${rows}</tbody>`;
    const open = ledger.find((r) => r.id === state.openMember);
    const box = $("#memberDetail"); box.hidden = !open;
    box.innerHTML = open ? `<div class="panel-head" style="margin:16px 0 4px"><h3>${esc(open.name)} ${pill(open.status)}</h3><button class="btn sm" data-close="1">Close</button></div>${detailHtml(open)}` : "";
  }

  function detailHtml(r) {
    const mem = state.members.find((m) => m.id === r.id) || {};
    const pays = state.payments.filter((p) => p.memberId === r.id && parseDate(p.date)?.y === state.year).sort((a, b) => (a.date < b.date ? -1 : 1));
    const missed = r.cells.filter((c) => c.state === "missed").map((c) => MONTHS[c.m - 1]);
    let note = "";
    if (r.status === "expelled") note = `Expelled automatically after three missed months in a row (ending ${MONTHS[r.expelledMonth - 1]}). ${R(r.forfeited)} in savings is forfeited to the Stokvel (9.2).`;
    else if (r.status === "withdrawn") note = `Withdrew on ${fmtDate(r.withdrawn)}. Received ${R(r.savings)}${r.penaltyOwed ? ` after ${R(r.penaltyOwed)} penalties were deducted` : ""}. ${r.monthsContributed >= RULES.INTEREST_MIN_MONTHS ? "Qualifies for interest." : "Does not qualify for interest (7.3)."}`;
    else if (r.arrears + r.penaltyOwed > 0) note = `To get back in good standing, pay ${R(r.arrears + r.penaltyOwed)}${r.penaltyOwed ? ` (${R(r.arrears)} contributions + ${R(r.penaltyOwed)} penalties)` : ""}, plus R300 for each new month.`;
    else note = r.credit ? `Ahead by ${R(r.credit)} above the R300 minimum. Extra contributions count as savings.` : "Up to date.";
    const payRows = pays.map((p) => `<tr><td class="num">${fmtDate(p.date)}</td><td class="r num">${R(p.amount)}</td><td>${parseDate(p.date).d > RULES.CUTOFF_DAY ? '<span class="pill st-late">Late</span>' : ""}</td><td class="muted">${esc(p.note || "")}</td><td class="r writer"><button class="btn sm danger" data-delpay="${esc(p.id)}">Delete</button></td></tr>`).join("");
    return `<div class="detail">
      <p>${note}</p>
      <div class="facts">
        <div><span class="label">Contributions due</span><b>${R(r.due)}</b></div>
        <div><span class="label">Paid in ${state.year}</span><b>${R(r.totalPaid)}</b></div>
        <div><span class="label">Penalties</span><b>${R(r.penaltiesCharged)} charged · ${R(r.penaltiesPaid)} paid</b></div>
        <div><span class="label">Missed months</span><b>${missed.join(", ") || "None"}</b></div>
        <div><span class="label">Late months</span><b>${r.lateCount}</b></div>
        <div><span class="label">Savings</span><b>${r.status === "expelled" ? "Forfeited" : R(r.savings)}</b></div>
      </div>
      <div class="tablewrap"><table><thead><tr><th>Date</th><th class="r">Amount</th><th></th><th>Note</th><th class="writer"></th></tr></thead><tbody>${payRows || `<tr><td colspan="5" class="dim">No payments in ${state.year}.</td></tr>`}</tbody></table></div>
      <div class="row writer">
        ${r.status === "withdrawn" ? `<button class="btn sm" data-unwithdraw="${esc(r.id)}">Undo withdrawal</button>` : r.status !== "expelled" ? `<label class="hint" for="wd-${esc(r.id)}">Withdrawal date</label><input type="date" id="wd-${esc(r.id)}" value="${todayISO}" style="width:auto"><button class="btn sm" data-withdraw="${esc(r.id)}">Record withdrawal</button>` : ""}
        <button class="btn sm danger" data-delmember="${esc(r.id)}">Remove member and payments</button>
      </div></div>`;
  }

  $("#ledgerTable").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-mid]"); if (!tr) return;
    state.openMember = state.openMember === tr.dataset.mid ? null : tr.dataset.mid; render();
    if (state.openMember) $("#memberDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  $("#memberDetail").addEventListener("click", (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.close) { state.openMember = null; render(); return; }
    memberAction(t);
  });
  $("#ledgerTable").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("tr[data-mid]")) e.target.click(); });

  async function memberAction(btn) {
    if (!db) return;
    try {
      if (btn.dataset.delpay) return confirmBtn(btn, "Confirm delete", async () => { await db.doc("payments/" + btn.dataset.delpay).delete(); toast("Payment deleted"); });
      if (btn.dataset.withdraw) { const id = btn.dataset.withdraw; const d = $("#wd-" + CSS.escape(id)).value; if (!d) return; return confirmBtn(btn, "Confirm withdrawal", async () => { await db.doc("members/" + id).update({ withdrawn: d }); toast("Withdrawal recorded"); }); }
      if (btn.dataset.unwithdraw) { await db.doc("members/" + btn.dataset.unwithdraw).update({ withdrawn: null }); toast("Withdrawal undone"); return; }
      if (btn.dataset.delmember) return confirmBtn(btn, "Confirm remove", async () => {
        const id = btn.dataset.delmember;
        for (const p of state.payments.filter((p) => p.memberId === id)) await db.doc("payments/" + p.id).delete();
        await db.doc("members/" + id).delete(); state.openMember = null; toast("Member removed");
      });
    } catch (err) { toast("Could not save: " + (err.message || err.code)); }
  }

  function memberOptions(sel, withAll) {
    const list = [...state.members].sort((a, b) => a.name.localeCompare(b.name));
    return (withAll ? `<option value="">All members</option>` : "") + list.map((m) => `<option value="${esc(m.id)}" ${sel === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("");
  }

  function renderPayForm() {
    const sel = $("#pMember"); const cur = sel.value;
    sel.innerHTML = state.members.length ? memberOptions(cur) : `<option value="">Add a member first</option>`;
    if (!$("#pDate").value) $("#pDate").value = todayISO;
    $("#payFilter").innerHTML = memberOptions(state.filter, true);
    updateSuggest();
  }
  function updateSuggest() {
    const r = state.res?.ledger.find((l) => l.id === $("#pMember").value);
    if (!r) { $("#suggest").textContent = ""; return; }
    const owe = r.arrears + r.penaltyOwed;
    const cur = r.cells.find((c) => c.m === state.res.cm);
    const curDue = cur && (cur.state === "pending" || cur.state === "overdue");
    $("#suggest").innerHTML = r.status === "expelled" ? `${esc(r.name)} was expelled. Payments are no longer due.` :
      r.status === "withdrawn" ? `${esc(r.name)} has withdrawn.` :
      owe > 0 ? `${esc(r.name)} owes <b>${R(owe)}</b>${r.penaltyOwed ? ` including ${R(r.penaltyOwed)} in penalties` : ""}.${curDue ? " This month's R300 is part of that." : ""}` :
      curDue ? `${esc(r.name)} owes R300 for ${MONTHS[state.res.cm - 1]}${cur.state === "overdue" ? ", now late" : ""}.` : `${esc(r.name)} is up to date.`;
  }
  $("#pMember").addEventListener("change", updateSuggest);

  function renderPayTable() {
    let pays = state.payments.filter((p) => parseDate(p.date)?.y === state.year);
    if (state.filter) pays = pays.filter((p) => p.memberId === state.filter);
    pays.sort((a, b) => (a.date < b.date ? 1 : -1));
    const name = (id) => state.members.find((m) => m.id === id)?.name || "Unknown member";
    $("#payTable").innerHTML = `<thead><tr><th>Date</th><th>Member</th><th class="r">Amount</th><th></th><th>Note</th><th class="writer"></th></tr></thead><tbody>` +
      (pays.map((p) => `<tr><td class="num">${fmtDate(p.date)}</td><td>${esc(name(p.memberId))}</td><td class="r num">${R(p.amount)}</td><td>${parseDate(p.date).d > RULES.CUTOFF_DAY ? '<span class="pill st-late">Late</span>' : ""}</td><td class="muted">${esc(p.note || "")}</td><td class="r writer"><button class="btn sm danger" data-delpay="${esc(p.id)}">Delete</button></td></tr>`).join("") ||
      `<tr><td colspan="6" class="empty">No payments for ${state.year} yet. Record one above or import a CSV.</td></tr>`) + `</tbody>`;
  }
  $("#payTable").addEventListener("click", (e) => { const b = e.target.closest("button[data-delpay]"); if (b) memberAction(b); });
  $("#payFilter").addEventListener("change", (e) => { state.filter = e.target.value; renderPayTable(); });

  function renderPayout({ ledger, totals: T }) {
    const rows = ledger.filter((r) => r.status !== "expelled").sort((a, b) => b.payoutProj - a.payoutProj).map((r) => `<tr>
      <td><b>${esc(r.name)}</b></td><td>${pill(r.status)}</td><td class="r num">${r.monthsContributed}${r.remaining ? ` → ${r.projMonths}` : ""}</td>
      <td>${r.projSavingsQualifies ? '<span class="pill st-good">Yes</span>' : '<span class="pill st-withdrawn">No</span>'}</td>
      <td class="r num">${R(r.contributions)}</td><td class="r num ${r.penaltyOwed ? "neg" : "dim"}">${r.penaltyOwed ? "−" + R(r.penaltyOwed) : "–"}</td>
      <td class="r num">${R(r.savingsInterest)}</td><td class="r num">${R(r.payoutNow)}</td><td class="r num"><b>${R(r.payoutProj)}</b>${r.status === "withdrawn" ? `<div class="hint">${R(r.savings)} paid ${fmtDate(r.withdrawn)}</div>` : ""}</td></tr>`).join("");
    const exp = ledger.filter((r) => r.status === "expelled").map((r) => `<tr class="dim"><td>${esc(r.name)}</td><td>${pill("expelled")}</td><td class="r num">${r.monthsContributed}</td><td>–</td><td class="r num">${R(r.contributions)}</td><td></td><td></td><td class="r num">${R(0)}</td><td class="r num">Forfeited</td></tr>`).join("");
    $("#payoutTable").innerHTML = `<thead><tr><th>Member</th><th>Status</th><th class="r">Months paid</th><th>Interest</th><th class="r">Savings now</th><th class="r">Penalty deduction</th><th class="r">Interest now</th><th class="r">Payout if today</th><th class="r">Projected 20 Dec</th></tr></thead>
      <tbody>${rows + exp || `<tr><td colspan="9" class="empty">No members yet.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="7">Paid out on 20 December</td><td class="r num">${R(T.decPayoutNow)}</td><td class="r num">${R(T.decPayoutProj)}</td></tr></tfoot>`;
    const ii = $("#interestIn"); if (document.activeElement !== ii) ii.value = T.interest || "";
    $("#fundCalc").innerHTML = `
      <div><span>Collected so far</span><span class="num">${R(T.collected)}</span></div>
      <div><span>Still to come (R300 × remaining months)</span><span class="num">${R(T.futureContrib)}</span></div>
      <div><span>Interest</span><span class="num">${R(T.interest)}</span></div>
      <div><span>Paid to early withdrawals</span><span class="num">−${R(T.withdrawnOut)}</span></div>
      <div class="total"><span>Expected in the account on 20 Dec</span><span class="num">${R(T.balanceProj)}</span></div>
      <div><span>Paid out to members</span><span class="num">−${R(T.decPayoutProj)}</span></div>
      <div class="total"><span>Left with the Stokvel</span><span class="num">${R(T.fundProj)}</span></div>`;
    $("#fundKept").innerHTML = `
      <div><span>Penalties paid</span><span class="num">${R(T.penaltiesPaid)}</span></div>
      <div><span>Unpaid penalties deducted from savings</span><span class="num">${R(T.penaltyOwed - ledger.filter((r) => r.status === "expelled").reduce((s, r) => s + r.penaltyOwed, 0))}</span></div>
      <div><span>Forfeited by expelled members</span><span class="num">${R(T.forfeited)}</span></div>
      ${T.unsharedProj ? `<div><span>Interest with no qualifying members</span><span class="num">${R(T.unsharedProj)}</span></div>` : ""}
      <div class="total"><span>Total</span><span class="num">${R(T.fundProj)}</span></div>`;
  }

  $("#yearSel").addEventListener("change", (e) => { state.year = +e.target.value; state.openMember = null; render(); });

  $("#memberForm").addEventListener("submit", async (e) => {
    e.preventDefault(); if (!db) return;
    const name = $("#mName").value.trim(); const mon = $("#mJoined").value; if (!name || !mon) return;
    if (state.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) { toast("A member with that name is already on the register"); return; }
    try { await db.collection("members").add({ name, joined: mon + "-01", role: $("#mRole").value || null, withdrawn: null, createdAt: new Date().toISOString() }); e.target.reset(); toast(`${name} added`); }
    catch (err) { toast("Could not save: " + (err.message || err.code)); }
  });
  $("#mJoined").value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

  $("#payForm").addEventListener("submit", async (e) => {
    e.preventDefault(); if (!db) { toast("Not connected to the database"); return; }
    const memberId = $("#pMember").value, date = $("#pDate").value, amount = Number($("#pAmount").value);
    if (!memberId || !date || !(amount > 0)) { toast("Choose a member, a date and an amount"); return; }
    try {
      // Firestore resolves add() only once the server has the record; don't wait forever if it can't be reached
      const noReply = new Promise((_, reject) => setTimeout(() => reject(new Error("no reply from the database, check your internet connection")), 15000));
      await Promise.race([db.collection("payments").add({ memberId, date, amount, note: $("#pNote").value.trim(), createdAt: new Date().toISOString() }), noReply]);
      $("#pNote").value = ""; toast(`${R(amount)} saved${window.STOKVEL_BACKEND ? " to " + window.STOKVEL_BACKEND : " in this browser only"}${parseDate(date).d > RULES.CUTOFF_DAY ? " (late, after the 7th)" : ""}`); }
    catch (err) { toast("Could not save: " + (err.message || err.code)); }
  });

  $("#saveInterest").addEventListener("click", async () => {
    if (!db) return; const v = Number($("#interestIn").value) || 0;
    try { await db.doc("settings/y" + state.year).set({ interest: v, year: state.year }); toast("Interest saved"); } catch (err) { toast("Could not save: " + (err.message || err.code)); }
  });

  const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
  function parseCsv(text) {
    const out = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true; else if (ch === "," || ch === ";") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); out.push(row); }
    return out.filter((r) => r.some((c) => c.trim()));
  }
  function normDate(s) {
    s = s.trim(); let m;
    if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    return null;
  }
  async function offerFile(filename, text, title) {
    const dl = await claude.use("downloads").catch(() => null);
    if (dl) { try { await dl.save({ filename, data: text }); toast("Saved " + filename); return; } catch (err) { if (err?.code === "declined") return; } }
    $("#exportBox").hidden = false; $("#exportTitle").textContent = title; $("#exportText").value = text; $("#exportText").select();
  }
  $("#exportPayments").addEventListener("click", () => {
    const name = (id) => state.members.find((m) => m.id === id)?.name || "";
    const rows = state.payments.filter((p) => parseDate(p.date)?.y === state.year).sort((a, b) => (a.date < b.date ? -1 : 1)).map((p) => [name(p.memberId), p.date, p.amount, p.note || ""]);
    offerFile(`as-majita-payments-${state.year}.csv`, toCsv([["member", "date", "amount", "note"], ...rows]), "Payments CSV");
  });
  $("#exportLedger").addEventListener("click", () => {
    const L = state.res.ledger;
    const rows = L.map((r) => [r.name, STATUS[r.status], ...r.cells.map((c) => c.paid || (c.state === "missed" ? "missed" : "")), r.totalPaid, r.penaltiesCharged, r.penaltiesPaid, r.arrears, r.savings, r.monthsContributed, r.projSavingsQualifies ? "yes" : "no", r.payoutNow.toFixed(2), r.payoutProj.toFixed(2)]);
    offerFile(`as-majita-ledger-${state.year}.csv`, toCsv([["member", "status", ...MONTHS, "total paid", "penalties charged", "penalties paid", "arrears", "savings", "months contributed", "qualifies for interest", "payout if today", "projected 20 Dec"], ...rows]), "Ledger CSV");
  });
  $("#copyCsv").addEventListener("click", () => { const t = $("#exportText"); navigator.clipboard?.writeText(t.value).then(() => toast("Copied"), () => { t.select(); toast("Press Ctrl+C to copy"); }); });

  $("#csvFile").addEventListener("change", (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { $("#csvText").value = rd.result; previewCsv(); }; rd.readAsText(f); });
  $("#csvPreview").addEventListener("click", previewCsv);
  function previewCsv() {
    const rows = parseCsv($("#csvText").value); state.csvRows = null; $("#csvImport").disabled = true;
    if (!rows.length) { $("#csvMsg").textContent = "Paste or choose a CSV first."; return; }
    const h = rows[0].map((c) => c.trim().toLowerCase());
    const hasHead = h.some((c) => ["member", "name", "date", "amount"].includes(c));
    const ix = hasHead ? { n: h.findIndex((c) => c === "member" || c === "name"), d: h.indexOf("date"), a: h.indexOf("amount"), t: h.indexOf("note") } : { n: 0, d: 1, a: 2, t: 3 };
    if (ix.n < 0 || ix.d < 0 || ix.a < 0) { $("#csvMsg").textContent = "The header needs member, date and amount columns."; return; }
    const good = [], bad = [];
    (hasHead ? rows.slice(1) : rows).forEach((r, i) => {
      const name = (r[ix.n] || "").trim(), date = normDate(r[ix.d] || ""), amount = Number(String(r[ix.a] || "").replace(/[R\s]/gi, "").replace(",", "."));
      if (name && date && amount > 0) good.push({ name, date, amount, note: ix.t >= 0 ? (r[ix.t] || "").trim() : "" }); else bad.push(i + (hasHead ? 2 : 1));
    });
    const known = new Set(state.members.map((m) => m.name.toLowerCase()));
    const newNames = [...new Set(good.map((g) => g.name).filter((n) => !known.has(n.toLowerCase())))];
    state.csvRows = good;
    $("#csvMsg").textContent = `${good.length} payments ready${newNames.length ? `, ${newNames.length} new members (${newNames.slice(0, 4).join(", ")}${newNames.length > 4 ? "…" : ""})` : ""}${bad.length ? `. Skipped lines ${bad.slice(0, 8).join(", ")}: they need a name, a date and an amount.` : "."}`;
    $("#csvImport").disabled = !good.length || !db;
  }
  $("#csvImport").addEventListener("click", async () => {
    const rows = state.csvRows; if (!rows?.length || !db) return;
    $("#csvImport").disabled = true; $("#csvMsg").textContent = "Importing…";
    try {
      const byName = new Map(state.members.map((m) => [m.name.toLowerCase(), m.id]));
      const first = {}; for (const r of rows) { const k = r.name.toLowerCase(); if (!first[k] || r.date < first[k].date) first[k] = r; }
      for (const k in first) if (!byName.has(k)) {
        const ref = await db.collection("members").add({ name: first[k].name, joined: first[k].date.slice(0, 7) + "-01", role: null, withdrawn: null, createdAt: new Date().toISOString() });
        byName.set(k, ref.id);
      }
      let n = 0;
      for (const r of rows) { await db.collection("payments").add({ memberId: byName.get(r.name.toLowerCase()), date: r.date, amount: r.amount, note: r.note, createdAt: new Date().toISOString() }); n++; if (n % 10 === 0) $("#csvMsg").textContent = `Importing… ${n}/${rows.length}`; }
      $("#csvMsg").textContent = `Imported ${n} payments.`; $("#csvText").value = ""; state.csvRows = null; toast(`Imported ${n} payments`);
    } catch (err) { $("#csvMsg").textContent = "Import stopped: " + (err.message || err.code); }
  });

  function setWriter(on) { state.canWrite = on; render(); }
  render();

  $("#signIn").addEventListener("click", () => window.stokvelAuth?.signIn().catch((err) => toast("Sign-in failed: " + (err.message || err.code))));
  $("#signOut").addEventListener("click", () => window.stokvelAuth?.signOut());

  (async () => {
    db = await claude.use("db");
    if (!db) { $("#noDb").hidden = false; render(); return; }
    const user = await claude.use("user");
    if (window.stokvelAuth) { $("#signOut").hidden = false; $("#signOut").title = user?.email || ""; }
    const can = user ? await user.can("data.write") : null;
    setWriter(can !== false);
    const sub = (path, key) => db.collection(path).onSnapshot((snap) => {
      if (key === "settings") { state.settings = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()])); }
      else state[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }, (err) => toast("Could not load " + path + ": " + err.message));
    sub("members", "members"); sub("payments", "payments"); sub("settings", "settings");
  })();
})();

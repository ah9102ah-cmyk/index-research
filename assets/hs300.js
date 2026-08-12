(() => {
  "use strict";

  const STORAGE_KEY = "indexResearch.hs300.ledger.v1";
  const FUND_CODE = "460300";
  const FUND_NAME = "华泰柏瑞沪深300ETF联接A";
  const DATA_URL = "../data/fund-460300.json";
  const money = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 });
  const sharesFmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 });

  const setupPanel = document.querySelector("#setup-panel");
  const setupForm = document.querySelector("#setup-form");
  const dashboard = document.querySelector("#dashboard");
  const summary = document.querySelector("#account-summary");
  const signalCard = document.querySelector("#signal-card");
  const transactionList = document.querySelector("#transaction-list");
  const buyForm = document.querySelector("#buy-form");
  let quote = null;
  let ledger = loadLedger();

  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const numberFrom = (id) => {
    const raw = document.querySelector(id).value.trim();
    return raw === "" ? null : Number(raw);
  };
  const today = () => new Date().toISOString().slice(0, 10);
  const showError = (id, message) => { const el = document.querySelector(id); el.textContent = message; el.hidden = false; };
  const clearError = (id) => { const el = document.querySelector(id); el.textContent = ""; el.hidden = true; };
  const finitePositive = (n) => Number.isFinite(n) && n > 0;

  function loadLedger() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function saveLedger() {
    ledger.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  }

  async function loadQuote() {
    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.code !== FUND_CODE || !finitePositive(Number(data.nav))) throw new Error("基金净值数据无效");
      quote = { ...data, nav: Number(data.nav), dailyChangePct: Number(data.dailyChangePct) };
      renderQuote();
      if (ledger) renderDashboard();
    } catch (error) {
      document.querySelector("#latest-nav").textContent = "暂不可用";
      document.querySelector("#latest-nav-meta").textContent = "净值读取失败，请稍后刷新";
      if (ledger) renderDashboard();
    }
  }

  function renderQuote() {
    const nav = document.querySelector("#latest-nav");
    const meta = document.querySelector("#latest-nav-meta");
    nav.textContent = quote.nav.toFixed(4);
    const sign = quote.dailyChangePct > 0 ? "+" : "";
    nav.className = quote.dailyChangePct > 0 ? "nav-up" : (quote.dailyChangePct < 0 ? "nav-down" : "");
    meta.textContent = `${quote.navDate} · 日涨跌 ${sign}${quote.dailyChangePct.toFixed(2)}% · 确认净值`;
  }

  function monthStage(startDate, startingStage) {
    if (startingStage === "steady") return "steady";
    const start = new Date(`${startDate}T00:00:00`);
    const now = new Date();
    const elapsed = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth());
    const stage = Number(startingStage) + elapsed;
    return stage > 6 ? "steady" : String(stage);
  }

  function compute() {
    if (!ledger || !quote) return null;
    const transactions = ledger.transactions || [];
    const shares = transactions.reduce((sum, tx) => sum + Number(tx.shares || 0), 0);
    const fundCost = transactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const marketValue = shares * quote.nav;
    const profit = marketValue - fundCost;
    const profitRate = fundCost > 0 ? profit / fundCost : 0;
    const reserveCash = Number(ledger.reserveCash);
    const buildCash = Math.max(0, Number(ledger.totalPrincipal) - reserveCash - fundCost);
    const totalValue = marketValue + reserveCash + buildCash;
    const currentWeight = totalValue > 0 ? marketValue / totalValue : 0;
    const phase = monthStage(ledger.strategyStartDate, ledger.startingStage);
    let action = "hold", targetWeight = currentWeight, title, reason;

    if (phase === "steady") {
      if (currentWeight < 0.55) {
        action = "add"; targetWeight = 0.60; title = "低于55%稳定区间";
        reason = "模型组合的沪深300占比低于55%，规则目标恢复到60%。";
      } else if (currentWeight > 0.65) {
        action = "reduce"; targetWeight = 0.60; title = "高于65%稳定区间";
        reason = "模型组合的沪深300占比高于65%，规则目标恢复到60%。";
      } else {
        title = "位于55%–65%稳定区间"; reason = "模型组合位于稳定区间，本期保持。";
      }
    } else {
      const scheduledWeight = Number(phase) * 0.10;
      if (currentWeight > 0.65) {
        action = "reduce"; targetWeight = 0.60; title = "建仓期超过65%风险上限";
        reason = "规则先把模型组合校准到60%。";
      } else if (Number(phase) === 6) {
        targetWeight = 0.60;
        const gap = targetWeight * totalValue - marketValue;
        action = Math.abs(gap) < 0.01 ? "hold" : (gap > 0 ? "add" : "reduce");
        title = "第6个月完成建仓校准"; reason = "第6个月校准到60%，随后进入稳定期。";
      } else if (currentWeight < scheduledWeight) {
        action = "add"; targetWeight = scheduledWeight; title = `建仓第${phase}个月低于计划目标`;
        reason = `本月计划目标为${Math.round(scheduledWeight * 100)}%，只补足本月差额。`;
      } else {
        title = `建仓第${phase}个月已达到计划目标`;
        reason = `本月目标为${Math.round(scheduledWeight * 100)}%，已有仓位领先计划且未超过65%，本期保持。`;
      }
    }

    let difference = action === "hold" ? 0 : targetWeight * totalValue - marketValue;
    if (difference > 0) difference = Math.min(difference, buildCash);
    if (Math.abs(difference) < 0.01) difference = 0;
    if (action === "add" && difference <= 0) {
      action = "hold";
      title = "没有可用建仓资金";
      reason = "模型存在正向差额，但账本中的尚未投入建仓资金已用完；长期4万元储备不自动挪用。";
    }
    return { shares, fundCost, marketValue, profit, profitRate, reserveCash, buildCash, totalValue, currentWeight, phase, action, targetWeight, difference, title, reason };
  }

  function renderDashboard() {
    if (!ledger) { setupPanel.hidden = false; dashboard.hidden = true; return; }
    setupPanel.hidden = true; dashboard.hidden = false;
    if (!quote) {
      summary.innerHTML = `<div><span>账本状态</span><strong>已保存</strong><small>等待净值后自动计算</small></div>`;
      signalCard.innerHTML = `<div class="empty-state"><h3>正在等待最新确认净值</h3><p>账本已保存在当前浏览器。</p></div>`;
      renderHistory();
      return;
    }
    const m = compute();
    const profitClass = m.profit >= 0 ? "positive" : "negative";
    summary.innerHTML = `
      <div><span>当前基金市值</span><strong>${money.format(m.marketValue)}</strong><small>${sharesFmt.format(m.shares)} 份</small></div>
      <div><span>累计持仓盈亏</span><strong class="${profitClass}">${m.profit >= 0 ? "+" : ""}${money.format(m.profit)}</strong><small>${(m.profitRate * 100).toFixed(2)}%</small></div>
      <div><span>尚未投入建仓资金</span><strong>${money.format(m.buildCash)}</strong><small>可用于后续建仓</small></div>
      <div><span>长期储备现金</span><strong>${money.format(m.reserveCash)}</strong><small>不自动挪用</small></div>
      <div><span>模型组合当前占比</span><strong>${(m.currentWeight * 100).toFixed(1)}%</strong><small>基金市值 ÷ 当前组合市值</small></div>`;

    const actionText = m.action === "add" ? "可加仓差额" : (m.action === "reduce" ? "可降低差额" : "本期保持");
    const diffText = m.difference === 0 ? "¥0.00" : `${m.difference > 0 ? "+" : "−"}${money.format(Math.abs(m.difference))}`;
    signalCard.innerHTML = `
      <div class="result-head"><div><p class="eyebrow">CURRENT MODEL STATE</p><h3>${escapeHtml(m.title)}</h3></div><span class="action-badge ${m.action}">${actionText}</span></div>
      <div class="big-number"><span>按最新确认净值计算的本期模型差额</span><strong>${escapeHtml(diffText)}</strong><small>${m.phase === "steady" ? "60/40稳定期" : `固定建仓第${m.phase}个月`} · 数据日期 ${quote.navDate}</small></div>
      <div class="result-metrics">
        <div><span>最新单位净值</span><strong>${quote.nav.toFixed(4)}</strong></div>
        <div><span>当前组合市值</span><strong>${money.format(m.totalValue)}</strong></div>
        <div><span>当前沪深300占比</span><strong>${(m.currentWeight * 100).toFixed(1)}%</strong></div>
        <div><span>本期目标占比</span><strong>${(m.targetWeight * 100).toFixed(1)}%</strong></div>
      </div>
      <p class="result-reason">${escapeHtml(m.reason)}</p>
      <p class="result-warning">差额是模型测算上限，不是自动订单。开放式基金按未知价申购，实际份额以基金公司确认结果为准。</p>`;
    document.querySelector("#recommend-note").textContent = m.difference > 0
      ? `当前模型正向差额上限 ${money.format(m.difference)}；这里只记录你已经完成的加仓。`
      : "当前模型没有正向差额；这里只记录已经在基金平台完成的加仓。";
    renderHistory();
  }

  function renderHistory() {
    const rows = [...(ledger.transactions || [])].reverse();
    transactionList.innerHTML = rows.map(tx => `
      <tr><td>${escapeHtml(tx.date)}</td><td>${tx.type === "initial" ? "初始持仓" : "加仓"}</td>
      <td>${money.format(Number(tx.amount))}</td><td>${sharesFmt.format(Number(tx.shares))}</td>
      <td>${tx.sharesEstimated ? "按净值估算" : "基金确认"}</td></tr>`).join("");
  }

  setupForm.addEventListener("submit", (event) => {
    event.preventDefault(); clearError("#setup-error");
    if (!quote) return showError("#setup-error", "最新净值尚未读取成功，请稍后刷新再建立账本。");
    const totalPrincipal = numberFrom("#total-principal");
    const fundCost = numberFrom("#fund-cost");
    const initialProfit = numberFrom("#initial-profit");
    const reserveCash = numberFrom("#reserve-cash");
    if (![totalPrincipal, fundCost, initialProfit, reserveCash].every(Number.isFinite)) return showError("#setup-error", "请完整填写本金、持仓本金、盈亏和现金。");
    if (totalPrincipal <= 0 || fundCost < 0 || reserveCash < 0 || fundCost + reserveCash > totalPrincipal) return showError("#setup-error", "持仓本金与长期现金不能超过策略总本金。");
    const marketValue = fundCost + initialProfit;
    if (marketValue < 0) return showError("#setup-error", "当前市值不能小于0，请检查盈亏正负号。");
    ledger = {
      version: 1, fundCode: FUND_CODE, fundName: FUND_NAME, totalPrincipal, reserveCash,
      strategyStartDate: today(), startingStage: document.querySelector("#starting-stage").value,
      transactions: [{ id: crypto.randomUUID(), type: "initial", date: today(), amount: fundCost,
        shares: marketValue / quote.nav, sharesEstimated: true, navUsed: quote.nav, navDate: quote.navDate }]
    };
    saveLedger(); renderDashboard();
  });

  buyForm.addEventListener("submit", (event) => {
    event.preventDefault(); clearError("#buy-error");
    if (!quote || !ledger) return showError("#buy-error", "净值或账本尚未就绪。");
    const amount = numberFrom("#buy-amount");
    const enteredShares = numberFrom("#buy-shares");
    const date = document.querySelector("#buy-date").value;
    const m = compute();
    if (!date || !finitePositive(amount)) return showError("#buy-error", "请填写日期和大于0的加仓本金。");
    if (amount > m.buildCash + 0.01) return showError("#buy-error", `加仓本金超过尚未投入的建仓资金 ${money.format(m.buildCash)}。`);
    if (enteredShares !== null && !finitePositive(enteredShares)) return showError("#buy-error", "确认份额必须大于0。");
    ledger.transactions.push({ id: crypto.randomUUID(), type: "buy", date, amount,
      shares: enteredShares ?? amount / quote.nav, sharesEstimated: enteredShares === null,
      navUsed: enteredShares === null ? quote.nav : null, navDate: enteredShares === null ? quote.navDate : null });
    saveLedger(); buyForm.reset(); document.querySelector("#buy-date").value = today(); renderDashboard();
  });

  document.querySelector("#edit-ledger").addEventListener("click", () => {
    if (!ledger) return;
    if ((ledger.transactions || []).length > 1 && !confirm("重新初始化会覆盖现有加仓记录。建议先导出备份。是否继续？")) return;
    const initial = ledger.transactions.find(tx => tx.type === "initial");
    document.querySelector("#total-principal").value = ledger.totalPrincipal;
    document.querySelector("#reserve-cash").value = ledger.reserveCash;
    document.querySelector("#fund-cost").value = initial?.amount ?? "";
    document.querySelector("#initial-profit").value = initial && quote ? (initial.shares * quote.nav - initial.amount).toFixed(2) : "";
    document.querySelector("#starting-stage").value = ledger.startingStage;
    dashboard.hidden = true; setupPanel.hidden = false;
  });

  document.querySelector("#clear-ledger").addEventListener("click", () => {
    if (!confirm("确定清空当前浏览器中的沪深300账本吗？此操作无法恢复。")) return;
    localStorage.removeItem(STORAGE_KEY); ledger = null; location.reload();
  });

  document.querySelector("#export-ledger").addEventListener("click", () => {
    if (!ledger) return;
    const blob = new Blob([JSON.stringify(ledger, null, 2)], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `hs300-ledger-${today()}.json`; link.click(); URL.revokeObjectURL(link.href);
  });

  document.querySelector("#import-ledger").addEventListener("click", () => document.querySelector("#import-file").click());
  document.querySelector("#import-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const candidate = JSON.parse(await file.text());
      const valid = candidate?.version === 1 && candidate?.fundCode === FUND_CODE
        && finitePositive(Number(candidate.totalPrincipal)) && Number(candidate.reserveCash) >= 0
        && Array.isArray(candidate.transactions) && candidate.transactions.length > 0
        && candidate.transactions.every(tx => finitePositive(Number(tx.amount)) && finitePositive(Number(tx.shares)) && tx.date);
      if (!valid) throw new Error("备份格式或基金代码不正确");
      ledger = candidate; saveLedger(); renderDashboard();
    } catch (error) {
      alert(`导入失败：${error.message}`);
    } finally {
      event.target.value = "";
    }
  });

  document.querySelector("#buy-date").value = today();
  renderDashboard();
  loadQuote();
})();

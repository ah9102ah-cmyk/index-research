(() => {
  "use strict";

  const CACHE_KEY = "indexResearch.hs300.remoteLedger.cache.v1";
  const FUND_CODE = "460300";
  const DATA_URL = "../data/fund-460300.json";
  const LEDGER_URL = "../data/ledger-460300.json";
  const ISSUE_URL = "https://github.com/ah9102ah-cmyk/index-research/issues/new";
  const money = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 });
  const sharesFmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 });

  const loading = document.querySelector("#ledger-loading");
  const dashboard = document.querySelector("#dashboard");
  const summary = document.querySelector("#account-summary");
  const signalCard = document.querySelector("#signal-card");
  const transactionList = document.querySelector("#transaction-list");
  const buyForm = document.querySelector("#buy-form");
  let quote = null;
  let ledger = null;
  let ledgerSource = "remote";

  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const numberFrom = (id) => {
    const raw = document.querySelector(id).value.trim();
    return raw === "" ? null : Number(raw);
  };
  const today = () => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const finitePositive = (n) => Number.isFinite(n) && n > 0;
  const navDataFresh = (navDate) => {
    if (!navDate || !/^\d{4}-\d{2}-\d{2}$/.test(navDate)) return false;
    if (navDate > today()) return false;
    const d = new Date(`${navDate}T00:00:00+08:00`).getTime();
    const n = new Date(`${today()}T00:00:00+08:00`).getTime();
    return (n - d) / 86400000 <= 15;
  };
  const showMessage = (message, success = false) => {
    const el = document.querySelector("#buy-error");
    el.textContent = message;
    el.classList.toggle("success", success);
    el.hidden = false;
  };
  const clearMessage = () => {
    const el = document.querySelector("#buy-error");
    el.textContent = "";
    el.classList.remove("success");
    el.hidden = true;
  };

  function validateLedger(candidate) {
    return candidate?.version === 1 && candidate?.fundCode === FUND_CODE
      && finitePositive(Number(candidate.totalPrincipal)) && Number(candidate.reserveCash) >= 0
      && /^\d{4}-\d{2}-\d{2}$/.test(candidate.strategyStartDate)
      && (["1", "2", "3", "4", "5", "6", "steady"].includes(String(candidate.startingStage)))
      && Array.isArray(candidate.transactions) && candidate.transactions.length > 0
      && candidate.transactions.every(tx => ["initial", "buy"].includes(tx.type)
        && finitePositive(Number(tx.amount)) && finitePositive(Number(tx.shares))
        && /^\d{4}-\d{2}-\d{2}$/.test(tx.date));
  }

  function loadCache() {
    try {
      const candidate = JSON.parse(localStorage.getItem(CACHE_KEY));
      return validateLedger(candidate) ? candidate : null;
    } catch (_) { return null; }
  }

  async function loadRemoteLedger() {
    try {
      const response = await fetch(`${LEDGER_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const candidate = await response.json();
      if (!validateLedger(candidate)) throw new Error("远程账本格式无效");
      ledger = candidate;
      ledgerSource = "remote";
      localStorage.setItem(CACHE_KEY, JSON.stringify(candidate));
    } catch (error) {
      ledger = loadCache();
      ledgerSource = ledger ? "cache" : "error";
    }
    renderDashboard();
  }

  async function loadQuote() {
    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.code !== FUND_CODE || !finitePositive(Number(data.nav))) throw new Error("基金净值数据无效");
      quote = { ...data, nav: Number(data.nav), dailyChangePct: Number(data.dailyChangePct), fresh: navDataFresh(data.navDate) };
      renderQuote();
      renderDashboard();
    } catch (_) {
      document.querySelector("#latest-nav").textContent = "暂不可用";
      document.querySelector("#latest-nav-meta").textContent = "净值读取失败，请稍后刷新";
      const footerNav = document.querySelector("#footer-nav-date");
      if (footerNav) footerNav.textContent = "暂不可用";
      renderDashboard();
    }
  }

  function renderQuote() {
    const nav = document.querySelector("#latest-nav");
    const meta = document.querySelector("#latest-nav-meta");
    nav.textContent = quote.nav.toFixed(4);
    const pct = Number.isFinite(quote.dailyChangePct) ? quote.dailyChangePct : 0;
    const sign = pct > 0 ? "+" : "";
    nav.className = pct > 0 ? "nav-up" : (pct < 0 ? "nav-down" : "");
    meta.textContent = `${quote.navDate} · 日涨跌 ${sign}${pct.toFixed(2)}% · 确认净值${quote.fresh ? "" : "（可能过期）"}`;
    const footerNav = document.querySelector("#footer-nav-date");
    if (footerNav) footerNav.textContent = quote.navDate;
  }

  function shanghaiParts(date) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "numeric" }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    return { year: values.year, month: values.month };
  }

  function monthStage(startDate, startingStage, referenceDate) {
    if (startingStage === "steady") return "steady";
    const start = new Date(`${startDate}T00:00:00+08:00`);
    const ref = referenceDate ? new Date(`${referenceDate}T00:00:00+08:00`) : new Date();
    const s = shanghaiParts(start);
    const r = shanghaiParts(ref);
    const elapsed = (r.year - s.year) * 12 + (r.month - s.month);
    const stage = Number(startingStage) + Math.max(0, elapsed);
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
    const phase = monthStage(ledger.strategyStartDate, String(ledger.startingStage), quote ? quote.navDate : null);
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
    // 建仓期买入只能用"尚未投入建仓资金"；稳定期再平衡可动用储备现金（60/40 的现金腿）
    const availableCash = phase === "steady" ? buildCash + reserveCash : buildCash;
    if (difference > 0) difference = Math.min(difference, availableCash);
    if (Math.abs(difference) < 0.01) difference = 0;
    if (action === "add" && difference <= 0) {
      action = "hold";
      title = phase === "steady" ? "没有可用现金补回" : "没有可用建仓资金";
      reason = phase === "steady"
        ? "模型组合低于55%，但组合已无可用现金用于补回（储备也已用尽）。"
        : "模型存在正向差额，但尚未投入建仓资金已用完；长期储备在建仓期不自动挪用。";
    }
    return { shares, fundCost, marketValue, profit, profitRate, reserveCash, buildCash, totalValue, currentWeight, phase, action, targetWeight, difference, title, reason };
  }

  function renderDashboard() {
    if (!ledger) {
      loading.hidden = false;
      dashboard.hidden = true;
      if (ledgerSource === "error") document.querySelector("#ledger-loading-note").textContent = "远程账本暂时无法读取，且本机没有可用缓存。请稍后刷新。";
      return;
    }
    loading.hidden = true;
    dashboard.hidden = false;
    const source = document.querySelector("#ledger-source-status");
    source.textContent = ledgerSource === "remote"
      ? `远程账本已同步 · 最后写入 ${ledger.updatedAt || "未知"}`
      : "远程读取失败 · 正在显示本机上次同步缓存";
    if (!quote) {
      summary.innerHTML = `<div><span>账本状态</span><strong>已读取</strong><small>等待净值后自动计算</small></div>`;
      signalCard.innerHTML = `<div class="empty-state"><h3>正在等待最新确认净值</h3><p>远程持仓已经读取，净值恢复后会自动计算。</p></div>`;
      renderHistory();
      return;
    }

    const m = compute();
    const profitClass = m.profit >= 0 ? "positive" : "negative";
    summary.innerHTML = `
      <div><span>当前基金市值</span><strong>${money.format(m.marketValue)}</strong><small>${sharesFmt.format(m.shares)} 份</small></div>
      <div><span>累计持仓盈亏</span><strong class="${profitClass}">${m.profit >= 0 ? "+" : ""}${money.format(m.profit)}</strong><small>${(m.profitRate * 100).toFixed(2)}%</small></div>
      <div><span>尚未投入建仓资金</span><strong>${money.format(m.buildCash)}</strong><small>可用于后续建仓</small></div>
      <div><span>长期储备现金</span><strong>${money.format(m.reserveCash)}</strong><small>稳定期再平衡时可动用</small></div>
      <div><span>模型组合当前占比</span><strong>${(m.currentWeight * 100).toFixed(1)}%</strong><small>基金市值 ÷ 当前组合市值</small></div>`;

    if (!quote.fresh) {
      signalCard.innerHTML = `
        <div class="empty-state"><h3>数据不足，暂停测算</h3><p>最新确认净值日期 ${escapeHtml(quote.navDate)} 已过期或异常，本期不输出调仓差额。</p></div>`;
      document.querySelector("#recommend-note").textContent = "净值数据异常时暂停测算；这里只登记已经在基金平台完成的加仓。";
    } else {
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
        ? `当前模型正向差额上限 ${money.format(m.difference)}；这里只登记你已经完成的加仓。`
        : "当前模型没有正向差额；这里只登记已经在基金平台完成的加仓。";
    }
    renderHistory();
  }

  function renderHistory() {
    const rows = [...(ledger.transactions || [])].reverse();
    transactionList.innerHTML = rows.map(tx => `
      <tr><td>${escapeHtml(tx.date)}</td><td>${tx.type === "initial" ? "初始持仓" : "加仓"}</td>
      <td>${money.format(Number(tx.amount))}</td><td>${sharesFmt.format(Number(tx.shares))}</td>
      <td>${tx.sharesEstimated ? "按净值估算" : "基金确认"}</td></tr>`).join("");
  }

  function encodePayload(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
  }

  buyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clearMessage();
    if (!quote || !ledger) return showMessage("净值或远程账本尚未就绪。");
    const amount = numberFrom("#buy-amount");
    const enteredShares = numberFrom("#buy-shares");
    const tradeDate = document.querySelector("#buy-date").value;
    const note = document.querySelector("#buy-note").value.trim();
    const m = compute();
    if (!tradeDate || !finitePositive(amount)) return showMessage("请填写日期和大于0的加仓本金。");
    if (tradeDate > today()) return showMessage("交易日期不能晚于北京时间今天。");
    if (tradeDate < ledger.strategyStartDate) return showMessage("加仓日期不能早于策略账本起始日。");
    if (amount > m.buildCash + 0.01) return showMessage(`加仓本金超过尚未投入的建仓资金 ${money.format(m.buildCash)}。`);
    if (enteredShares !== null && !finitePositive(enteredShares)) return showMessage("确认份额必须大于0。");

    const payload = { version: 1, fundCode: FUND_CODE, amount, date: tradeDate, shares: enteredShares, note };
    const humanBody = [
      "这是由‘指数的研究’页面生成的远程账本登记单。请核对后点击下方 Submit new issue；提交不会自动申购基金，只会更新公开账本。",
      "",
      `- 加仓金额：${amount.toFixed(2)} 元`,
      `- 交易/申请日期：${tradeDate}`,
      `- 确认份额：${enteredShares === null ? "留空，暂按最新确认净值估算" : enteredShares}`,
      `- 备注：${note || "无"}`,
      "",
      `<!-- index-research-ledger-v1:${encodePayload(payload)} -->`,
    ].join("\n");
    const url = `${ISSUE_URL}?title=${encodeURIComponent(`登记460300加仓 ${tradeDate} ${amount.toFixed(2)}元`)}&body=${encodeURIComponent(humanBody)}`;
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
    showMessage("登记单已尝试在新页面打开。核对后提交，约1–2分钟后刷新本页即可看到远程记录；若没有打开，请允许本站弹出新窗口后重试。", true);
  });

  document.querySelector("#export-ledger").addEventListener("click", () => {
    if (!ledger) return;
    const blob = new Blob([JSON.stringify(ledger, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `hs300-ledger-${today()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  document.querySelector("#buy-date").value = today();
  loadRemoteLedger();
  loadQuote();
})();

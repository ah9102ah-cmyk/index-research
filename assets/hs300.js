(() => {
  "use strict";

  const form = document.querySelector("#position-form");
  const result = document.querySelector("#result-card");
  const errorBox = document.querySelector("#form-error");

  const money = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0
  });

  const numberFrom = (id) => {
    const value = document.querySelector(id).value.trim();
    return value === "" ? null : Number(value);
  };

  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
  };

  const clearError = () => {
    errorBox.textContent = "";
    errorBox.hidden = true;
  };

  function calculate(input) {
    const impliedTotalCapital = input.capital / 0.60;
    const strategicReserveTarget = impliedTotalCapital * 0.40;
    const costBasis = input.marketValue - input.profitLoss;
    const inferredReserve = impliedTotalCapital - costBasis;
    const reserve = input.reserve ?? inferredReserve;
    const totalValue = input.marketValue + reserve;

    if (![costBasis, inferredReserve, reserve, totalValue].every(Number.isFinite)) {
      throw new Error("输入中包含无法计算的数值，请检查后重试。");
    }
    if (costBasis < 0) {
      throw new Error("按当前市值和盈亏推算的持仓成本小于0，请检查盈亏的正负号。");
    }
    if (reserve < 0) {
      throw new Error("推算的储备资产小于0。请填写实际储备资产市值，或检查总资金与持仓盈亏。");
    }
    if (totalValue <= 0) {
      throw new Error("当前策略总市值必须大于0。");
    }

    const currentWeight = input.marketValue / totalValue;
    let targetWeight;
    let action;
    let title;
    let reason;

    if (input.phase === "steady") {
      targetWeight = 0.60;
      if (currentWeight < 0.55) {
        action = "add";
        title = "模型组合低于稳定区间";
        reason = `当前沪深300占比 ${(currentWeight * 100).toFixed(1)}%，低于55%下边界；规则模型恢复到60%。`;
      } else if (currentWeight > 0.65) {
        action = "reduce";
        title = "模型组合高于稳定区间";
        reason = `当前沪深300占比 ${(currentWeight * 100).toFixed(1)}%，高于65%上边界；规则模型恢复到60%。`;
      } else {
        action = "hold";
        title = "模型组合位于稳定区间";
        targetWeight = currentWeight;
        reason = `当前沪深300占比 ${(currentWeight * 100).toFixed(1)}%，位于55%–65%之间；规则模型保持不变。`;
      }
    } else {
      const month = Number(input.phase);
      const scheduledWeight = month * 0.10;
      if (currentWeight > 0.65) {
        targetWeight = 0.60;
        action = "reduce";
        title = "建仓期触及风险上限";
        reason = `当前沪深300占比 ${(currentWeight * 100).toFixed(1)}%，超过65%上限；建仓规则先校准到60%。`;
      } else if (month === 6) {
        targetWeight = 0.60;
        const gap = targetWeight * totalValue - input.marketValue;
        action = Math.abs(gap) < 0.005 ? "hold" : (gap > 0 ? "add" : "reduce");
        title = "第6个月完成建仓校准";
        reason = "固定建仓计划在第6个月校准至沪深300 60%、储备资产40%，随后进入稳定期。";
      } else if (currentWeight < scheduledWeight) {
        targetWeight = scheduledWeight;
        action = "add";
        title = `建仓第${month}个月尚未达到计划比例`;
        reason = `本月计划目标为${Math.round(scheduledWeight * 100)}%；模型只补足到当月目标，不提前完成后续月份。`;
      } else {
        targetWeight = currentWeight;
        action = "hold";
        title = `已有仓位领先第${month}个月计划`;
        reason = `本月计划目标为${Math.round(scheduledWeight * 100)}%，当前比例已经达到或超过目标且未超过65%；不重复增加，也不因超过当月小目标而卖出。`;
      }
    }

    let difference = targetWeight * totalValue - input.marketValue;
    if (action === "hold" || Math.abs(difference) < 0.005) difference = 0;
    const estimatedCost = Math.abs(difference) * 0.001;

    return {
      ...input,
      impliedTotalCapital,
      strategicReserveTarget,
      costBasis,
      inferredReserve,
      reserve,
      reserveWasInferred: input.reserve === null,
      totalValue,
      currentWeight,
      targetWeight,
      difference,
      estimatedCost,
      action,
      title,
      reason,
      profitRate: costBasis > 0 ? input.profitLoss / costBasis : null
    };
  }

  function render(model) {
    const isAdd = model.action === "add";
    const isReduce = model.action === "reduce";
    const actionText = isAdd ? "模型差额：增加" : (isReduce ? "模型差额：降低" : "模型状态：保持");
    const differenceText = model.difference === 0
      ? "¥0"
      : `${model.difference > 0 ? "+" : "−"}${money.format(Math.abs(model.difference)).replace("CN¥", "¥")}`;
    const profitRateText = model.profitRate === null ? "—" : `${(model.profitRate * 100).toFixed(1)}%`;
    const reserveNote = model.reserveWasInferred
      ? `储备资产按“完整模型初始资金 − 持仓成本”推算为 ${money.format(model.reserve)}。`
      : `采用你填写的实际储备资产 ${money.format(model.reserve)}。`;

    result.className = "result-card";
    result.innerHTML = `
      <div class="result-head">
        <div>
          <p class="eyebrow">MODEL RESULT</p>
          <h3>${escapeHtml(model.title)}</h3>
        </div>
        <span class="action-badge ${escapeHtml(model.action)}">${escapeHtml(actionText)}</span>
      </div>
      <div class="big-number">
        <span>按当前输入计算的模型调整差额</span>
        <strong>${escapeHtml(differenceText)}</strong>
        <small>研究假设10bp成本约 ${escapeHtml(money.format(model.estimatedCost))}</small>
      </div>
      <div class="result-metrics">
        <div><span>当前策略总市值</span><strong>${escapeHtml(money.format(model.totalValue))}</strong></div>
        <div><span>当前沪深300占比</span><strong>${(model.currentWeight * 100).toFixed(1)}%</strong></div>
        <div><span>模型本期目标占比</span><strong>${(model.targetWeight * 100).toFixed(1)}%</strong></div>
        <div><span>沪深300最终目标仓位</span><strong>${escapeHtml(money.format(model.capital))}</strong></div>
        <div><span>完整模型初始资金</span><strong>${escapeHtml(money.format(model.impliedTotalCapital))}</strong></div>
        <div><span>长期储备目标</span><strong>${escapeHtml(money.format(model.strategicReserveTarget))}</strong></div>
        <div><span>沪深300持仓成本</span><strong>${escapeHtml(money.format(model.costBasis))}</strong></div>
        <div><span>累计持仓盈亏</span><strong>${escapeHtml(money.format(model.profitLoss))}</strong></div>
        <div><span>持仓收益率</span><strong>${escapeHtml(profitRateText)}</strong></div>
      </div>
      <p class="result-reason">${escapeHtml(model.reason)}</p>
      <p class="result-warning">${escapeHtml(reserveNote)} 盈亏只用于展示，不参与模型动作。以上是模型组合的规则测算，不是针对个人账户的交易指令。</p>
    `;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearError();

    const input = {
      capital: numberFrom("#capital"),
      marketValue: numberFrom("#market-value"),
      profitLoss: numberFrom("#profit-loss"),
      reserve: numberFrom("#reserve"),
      phase: document.querySelector("#phase").value
    };

    if (input.capital === null || input.capital <= 0) {
      showError("请输入大于0的沪深300目标仓位。");
      return;
    }
    if (input.marketValue === null || input.marketValue < 0) {
      showError("请输入不小于0的沪深300持仓市值。");
      return;
    }
    if (input.profitLoss === null) {
      showError("请输入累计盈亏；亏损请填写负数。");
      return;
    }
    if (input.reserve !== null && input.reserve < 0) {
      showError("储备资产市值不能为负数。");
      return;
    }

    try {
      render(calculate(input));
    } catch (error) {
      showError(error.message);
    }
  });
})();

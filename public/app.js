const form = document.getElementById("controls");
const signalEl = document.getElementById("signal");
const signalMetaEl = document.getElementById("signalMeta");
const setupEl = document.getElementById("setup");
const riskEl = document.getElementById("risk");
const qualityEl = document.getElementById("quality");
const reasonsEl = document.getElementById("reasons");
const warningsEl = document.getElementById("warnings");
const holdingInput = document.getElementById("holding");
const btcAlertsInput = document.getElementById("btcAlerts");
const btcAlertMetaEl = document.getElementById("btcAlertMeta");
const entryWrap = document.getElementById("entryWrap");
const providerInput = document.getElementById("provider");
const quoteInput = document.getElementById("quote");
const scanBodyEl = document.getElementById("scanBody");
const scanMetaEl = document.getElementById("scanMeta");
const runBtn = document.getElementById("runBtn");

let refreshTimer = null;
let lastSignal = null;
let activeRunId = 0;
let analysisController = null;
let scanController = null;

const fieldsToPersist = [
  "symbol",
  "provider",
  "quote",
  "equity",
  "riskPercent",
  "refreshSec",
  "holding",
  "entryPrice",
  "btcAlerts"
];

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (_error) {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (_error) {
    return false;
  }
}

function loadSettings() {
  const raw = safeStorageGet("crypto_signal_settings");
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    for (const name of fieldsToPersist) {
      const element = document.getElementById(name);
      if (!element || !(name in data)) continue;
      if (element.type === "checkbox") {
        element.checked = !!data[name];
      } else {
        element.value = data[name];
      }
    }
  } catch (_err) {
    // Ignore malformed localStorage.
  }
}

function saveSettings() {
  const data = {};
  for (const name of fieldsToPersist) {
    const element = document.getElementById(name);
    if (!element) continue;
    data[name] = element.type === "checkbox" ? element.checked : element.value;
  }
  safeStorageSet("crypto_signal_settings", JSON.stringify(data));
}

function updateVisibility() {
  entryWrap.classList.toggle("hidden", !holdingInput.checked);
  enforceUsdQuote();
}

function enforceUsdQuote() {
  quoteInput.value = "usd";
  quoteInput.disabled = true;
}

function fmt(value) {
  if (value == null || Number.isNaN(value)) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return String(value);
}

function fmtPct(value) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function setSignal(action) {
  signalEl.textContent = action;
  signalEl.classList.remove("buy", "abstain", "sell", "hold");
  signalEl.classList.add(action.toLowerCase());
}

function renderGrid(node, entries) {
  node.innerHTML = "";
  for (const [key, value] of entries) {
    const row = document.createElement("div");
    row.className = "kv";
    row.innerHTML = `<span class="k">${key}</span><span class="v">${fmt(value)}</span>`;
    node.appendChild(row);
  }
}

function pushNotification(action, symbol) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(`Signal changed: ${action}`, {
      body: `${symbol} is now ${action}`
    });
    return;
  }
  if (Notification.permission !== "denied") {
    Notification.requestPermission().catch(() => {});
  }
}

function pushBtcNotification(action, price, quote, timestamp) {
  if (!("Notification" in window)) return;
  const title = `BTC ${action} signal`;
  const body = `${price ?? "-"} ${quote ?? ""} | ${timestamp ? new Date(timestamp).toLocaleString() : ""}`.trim();

  if (Notification.permission === "granted") {
    new Notification(title, { body });
    return;
  }
  if (Notification.permission !== "denied") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") {
        new Notification(title, { body });
      }
    }).catch(() => {});
  }
}

function toUserFacingFetchError(error) {
  if (error?.name === "AbortError") return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return new Error("Cannot reach the API. Check your network or restart the app server.");
  }
  return error instanceof Error ? error : new Error(message);
}

async function fetchWithRetry(url, options = {}, retries = 1) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

function maybeAlertBtcFromScanRow(row) {
  if (!btcAlertsInput?.checked || !row || !row.ok) return;
  const transitionAction = String(row.transitionAction || "").toUpperCase();
  const baseAction = String(row.baseAction || row.action || "").toUpperCase();
  const action =
    transitionAction === "SELL" ? "SELL" : transitionAction === "BUY" && baseAction === "BUY" ? "BUY" : "";
  if (action !== "BUY" && action !== "SELL") return;

  const dedupeKey = `${action}:${row.signalTimestamp || "unknown"}`;
  const lastDedupeKey = safeStorageGet("btc_last_alert_key");
  if (lastDedupeKey === dedupeKey) return;

  safeStorageSet("btc_last_alert_key", dedupeKey);
  pushBtcNotification(action, row.close, row.quoteUsed, row.signalTimestamp);
  if (navigator.vibrate) {
    navigator.vibrate([200, 100, 200]);
  }
  if (btcAlertMetaEl) {
    btcAlertMetaEl.textContent = `BTC alert fired: ${action} at ${new Date(row.signalTimestamp).toLocaleString()}`;
  }
}

function actionPill(action) {
  const normalized = String(action || "HOLD").toUpperCase();
  const className =
    normalized === "BUY"
      ? "pill pill-buy"
      : normalized === "ABSTAIN"
        ? "pill pill-abstain"
        : normalized === "SELL"
          ? "pill pill-sell"
          : "pill pill-hold";
  return `<span class="${className}">${normalized}</span>`;
}

function gradeClass(grade) {
  const g = String(grade || "D").toLowerCase();
  return `grade grade-${g}`;
}

function clearPanels() {
  setupEl.innerHTML = "";
  riskEl.innerHTML = "";
  qualityEl.innerHTML = "";
  reasonsEl.innerHTML = "";
  warningsEl.innerHTML = "";
  scanBodyEl.innerHTML = "";
  scanMetaEl.textContent = "Radar unavailable.";
}

async function runScan(scanParams, runId) {
  const params = new URLSearchParams(scanParams);
  scanMetaEl.textContent = "Loading radar...";
  if (scanController) {
    scanController.abort();
  }
  const controller = new AbortController();
  scanController = controller;

  try {
    const response = await fetchWithRetry(`/api/scan?${params.toString()}`, { signal: controller.signal }, 1);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Radar request failed.");
    }
    if (runId !== activeRunId || controller.signal.aborted) return;

    scanBodyEl.innerHTML = "";
    const items = [...(data.results || [])];
    const priority = { BUY: 0, ABSTAIN: 1, HOLD: 2, SELL: 3 };
    items.sort((a, b) => {
      if (!a.ok && !b.ok) return 0;
      if (!a.ok) return 1;
      if (!b.ok) return -1;
      const pa = priority[a.action] ?? 9;
      const pb = priority[b.action] ?? 9;
      if (pa !== pb) return pa - pb;
      return (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
    });

    for (const item of items) {
      const row = document.createElement("tr");
      if (!item.ok) {
        row.innerHTML = `
          <td>${item.symbol}</td>
          <td colspan="10">${item.error}</td>
        `;
        scanBodyEl.appendChild(row);
        continue;
      }

      row.innerHTML = `
        <td>${item.symbol}</td>
        <td>${actionPill(item.action)}</td>
        <td><span class="${gradeClass(item.grade)}">${fmt(item.confidenceScore)} (${item.grade})</span></td>
        <td>${fmt(item.close)} ${item.quoteUsed}</td>
        <td>${fmt(item.edgeExpectedNetR)}</td>
        <td>${fmtPct(item.edgeProbabilityPositivePct)}</td>
        <td>${fmt(item.riskMultiplier)}</td>
        <td>${fmtPct(item.winRate)}</td>
        <td>${item.providerUsed}</td>
        <td>${fmt(item.riskCurrencyAligned)}</td>
        <td>${fmt(item.warningCount)}</td>
      `;
      scanBodyEl.appendChild(row);
    }

    maybeAlertBtcFromScanRow(items.find((item) => item.ok && item.symbol === "BTC"));

    scanMetaEl.textContent = `Radar updated ${new Date(data.timestamp).toLocaleString()}`;
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (runId !== activeRunId || controller.signal.aborted) return;
    scanMetaEl.textContent = error instanceof Error ? error.message : "Unknown radar error";
    scanBodyEl.innerHTML = "";
  } finally {
    if (scanController === controller) {
      scanController = null;
    }
  }
}

async function runAnalysis() {
  const runId = ++activeRunId;
  enforceUsdQuote();
  saveSettings();
  updateVisibility();
  if (runBtn) runBtn.disabled = true;
  if (analysisController) {
    analysisController.abort();
  }
  const controller = new AbortController();
  analysisController = controller;

  const symbol = document.getElementById("symbol").value;
  const provider = document.getElementById("provider").value;
  const quote = "usd";
  const equity = document.getElementById("equity").value;
  const riskPercent = document.getElementById("riskPercent").value;
  const holding = String(document.getElementById("holding").checked);

  const params = new URLSearchParams({ symbol, provider, quote, equity, riskPercent, holding });

  if (document.getElementById("holding").checked) {
    params.set("entryPrice", document.getElementById("entryPrice").value || "0");
  }

  signalMetaEl.textContent = "Loading...";

  try {
    const response = await fetchWithRetry(
      `/api/analysis?${params.toString()}`,
      { signal: controller.signal },
      1
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Analysis request failed.");
    }
    if (runId !== activeRunId || controller.signal.aborted) return;

    setSignal(data.action);

    if (lastSignal && lastSignal !== data.action) {
      pushNotification(data.action, data.symbol);
    }
    lastSignal = data.action;

    const providerDelta = data.providerDiagnostics?.providerCloseDiffPct;
    const providerDeltaText =
      providerDelta == null || Number.isNaN(providerDelta) ? "" : ` | src diff ${fmtPct(providerDelta)}`;
    const candleTime = data.timestamp ? new Date(data.timestamp).toLocaleString() : "-";
    const updatedTime = data.analyzedAt ? new Date(data.analyzedAt).toLocaleString() : new Date().toLocaleString();
    signalMetaEl.textContent =
      `${data.symbol} | ${data.providerUsed} | Candle ${candleTime} | Updated ${updatedTime}${providerDeltaText}`;

    renderGrid(setupEl, [
      ["Close", `${fmt(data.market.close)} ${data.quoteUsed}`],
      ["SMA 50", data.setup.sma50],
      ["SMA 200", data.setup.sma200],
      ["EMA 10", data.setup.ema10],
      ["ATR 14", data.setup.atr14],
      ["ADX 14", data.setup.adx14],
      ["ATR %", fmtPct(data.setup.atrPct)],
      ["20D Breakout", data.setup.breakout],
      ["Volume Expansion", data.setup.volumeExpansion],
      ["Regime Long", data.setup.regimeLong]
    ]);

    const accountCurrency = data.accountCurrency || data.quoteRequested?.toUpperCase() || "USD";

    renderGrid(riskEl, [
      ["Equity", `${fmt(data.riskPlan.equity)} ${accountCurrency}`],
      ["Requested Risk %", `${fmt(data.riskPlan.requestedRiskPercent)}%`],
      ["Adjusted Risk %", `${fmt(data.riskPlan.riskPercent)}%`],
      ["Requested Risk Amount", `${fmt(data.riskPlan.requestedRiskAmount)} ${accountCurrency}`],
      ["Adjusted Risk Amount", `${fmt(data.riskPlan.riskAmount)} ${accountCurrency}`],
      ["Risk Multiplier", `${fmt(data.edgeGuardian.riskMultiplier)}x`],
      ["Entry", `${fmt(data.riskPlan.entry)} ${data.quoteUsed}`],
      ["Stop", `${fmt(data.riskPlan.stop)} ${data.quoteUsed}`],
      ["Trailing Stop", `${fmt(data.riskPlan.trailingStop)} ${data.quoteUsed}`],
      ["TP1 (2R)", `${fmt(data.riskPlan.tp1)} ${data.quoteUsed}`],
      ["Position Size (Req Risk)", fmt(data.riskPlan.positionSizeRequested)],
      ["Position Size", fmt(data.riskPlan.positionSize)],
      ["Held PnL (R)", data.holding.pnlR]
    ]);

    renderGrid(qualityEl, [
      ["Confidence", `${fmt(data.quality.confidenceScore)} / 100 (${data.quality.grade})`],
      ["Signal Score", `${fmt(data.setup.signalScore)} / 100`],
      ["Currency Aligned", data.riskCurrencyAligned],
      ["Data Staleness", `${fmt(data.quality.staleHours)} hours`],
      ["Volume Coverage", fmtPct(data.quality.volumeCoveragePct)],
      ["Edge Gate", data.edgeGuardian.gateAllow],
      ["Edge Expected Net R", data.edgeGuardian.expectedNetR],
      ["Edge CI95 Low R", data.edgeGuardian.ci95LowR],
      ["Edge CI95 High R", data.edgeGuardian.ci95HighR],
      ["P(+EV)", fmtPct(data.edgeGuardian.probabilityPositivePct)],
      ["P(Win)", fmtPct(data.edgeGuardian.probabilityWinPct)],
      ["Edge Sample Size", data.edgeGuardian.sampleSize],
      ["Edge Effective N", data.edgeGuardian.effectiveSampleSize],
      ["Walk-forward Brier", data.edgeGuardian.walkForwardBrier],
      ["Edge Gate Reason", data.edgeGuardian.gateReason],
      ["OOS Train Trades", data.edgeGuardian.oosTrainTrades],
      ["OOS Trades", data.edgeGuardian.oosTrades],
      ["OOS Expectancy (R)", data.edgeGuardian.oosExpectancyR],
      ["OOS Win Rate", fmtPct(data.edgeGuardian.oosWinRate)],
      ["OOS Profit Factor", data.edgeGuardian.oosProfitFactor],
      ["Throttle Reason", data.edgeGuardian.throttleReason],
      ["Drift Delta R", data.edgeGuardian.driftDeltaR],
      ["Drift Degraded", data.edgeGuardian.driftDegraded],
      ["Backtest Trades", data.backtest.trades],
      ["Backtest Win Rate", fmtPct(data.backtest.winRate)],
      ["Backtest Expectancy (R)", data.backtest.expectancyR],
      ["Backtest Profit Factor", data.backtest.profitFactor],
      ["Backtest Max Drawdown", fmtPct(data.backtest.maxDrawdownPct)],
      ["Backtest Return", fmtPct(data.backtest.returnPct)]
    ]);

    reasonsEl.innerHTML = "";
    for (const reason of data.reasons || []) {
      const li = document.createElement("li");
      li.textContent = reason;
      reasonsEl.appendChild(li);
    }

    warningsEl.innerHTML = "";
    const warnings = data.warnings || [];
    if (!warnings.length) {
      const li = document.createElement("li");
      li.textContent = "No active warnings from data quality or backtest checks.";
      warningsEl.appendChild(li);
    } else {
      for (const warning of warnings) {
        const li = document.createElement("li");
        li.textContent = warning;
        warningsEl.appendChild(li);
      }
    }

    await runScan({ provider, quote, equity, riskPercent }, runId);
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (runId !== activeRunId || controller.signal.aborted) return;
    const userError = toUserFacingFetchError(error);
    setSignal("HOLD");
    signalMetaEl.textContent = userError instanceof Error ? userError.message : "Unknown error";
    clearPanels();
  } finally {
    if (analysisController === controller) {
      analysisController = null;
    }
    if (runBtn && runId === activeRunId) runBtn.disabled = false;
  }
}

function syncRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  const sec = Number(document.getElementById("refreshSec").value);
  if (Number.isFinite(sec) && sec > 0) {
    refreshTimer = setInterval(runAnalysis, sec * 1000);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runAnalysis();
  syncRefresh();
});

holdingInput.addEventListener("change", () => {
  updateVisibility();
  saveSettings();
});

providerInput.addEventListener("change", () => {
  updateVisibility();
  saveSettings();
});

for (const name of fieldsToPersist) {
  const node = document.getElementById(name);
  if (!node) continue;
  node.addEventListener("change", saveSettings);
}

loadSettings();
enforceUsdQuote();
updateVisibility();
runAnalysis();
syncRefresh();

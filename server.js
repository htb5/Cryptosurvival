import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { fetchOHLCV } from "./src/providers.js";
import { analyzeSymbol } from "./src/strategy.js";

const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPPORTED_SYMBOLS = new Set(["BTC", "ETH", "SOL"]);
const SUPPORTED_PROVIDERS = new Set(["auto", "coingecko", "binance"]);
const SUPPORTED_QUOTES = new Set(["gbp", "usd"]);
const ALERT_KEY_TTL_MS = 72 * 60 * 60 * 1000;
let requestCounter = 0;
const sentAlertKeys = new Map();

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "256kb" }));
app.use((req, res, next) => {
  const requestId = `req_${Date.now().toString(36)}_${(requestCounter += 1).toString(36)}`;
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
});

function log(level, event, details = {}) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${event} ${JSON.stringify(details)}`;
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
}

function dedupeWarnings(warnings) {
  return [...new Set((warnings || []).filter(Boolean))];
}

function isCronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const authHeader = String(req.headers.authorization || "");
  const xCronSecret = String(req.headers["x-cron-secret"] || "");
  const querySecret = String(req.query.cronSecret || "");
  return (
    authHeader === `Bearer ${secret}` ||
    xCronSecret === secret ||
    querySecret === secret
  );
}

function pruneSentAlertKeys() {
  const now = Date.now();
  for (const [key, sentAt] of sentAlertKeys.entries()) {
    if (now - sentAt > ALERT_KEY_TTL_MS) {
      sentAlertKeys.delete(key);
    }
  }
}

function wasAlertRecentlySent(key) {
  if (!key) return false;
  pruneSentAlertKeys();
  return sentAlertKeys.has(key);
}

function markAlertSent(key) {
  if (!key) return;
  sentAlertKeys.set(key, Date.now());
}

function deriveTransitionAction(analysis) {
  const action = String(analysis?.system?.latestTransitionAction || "").toUpperCase();
  if (action === "BUY" || action === "SELL") return action;
  return null;
}

function deriveActionableAlertAction(analysis) {
  const transition = deriveTransitionAction(analysis);
  if (transition === "SELL") return "SELL";
  if (transition === "BUY" && analysis?.action === "BUY") return "BUY";
  return null;
}

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { sent: false, reason: "telegram_not_configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text();
      return { sent: false, reason: `telegram_http_${response.status}`, body: body.slice(0, 300) };
    }
    return { sent: true, reason: "ok" };
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "telegram_request_failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function buildSymbolAnalysis({
  symbol,
  provider = "auto",
  quote = "usd",
  equity = 1000,
  riskPercent = 1.5,
  holding = false,
  entryPrice = null
}) {
  const market = await fetchOHLCV({ symbol, provider, quote });
  const accountCurrency = quote.toUpperCase();
  const riskCurrencyAligned = accountCurrency === market.quoteCurrency;
  const analysis = analyzeSymbol({
    symbol,
    candles: market.candles,
    equity,
    riskPercent,
    holding,
    entryPrice,
    quoteCurrency: market.quoteCurrency,
    riskCurrencyAligned
  });
  return { market, analysis, accountCurrency, riskCurrencyAligned };
}

function appendProviderWarnings({ warnings, market, riskCurrencyAligned }) {
  const out = [...(warnings || [])];
  const sourceDiff = Number(market?.diagnostics?.providerCloseDiffPct);
  if (Number.isFinite(sourceDiff) && sourceDiff > 0.8) {
    out.push("CoinGecko/Binance close prices diverge; verify execution venue before trading.");
  }
  if (market?.diagnostics?.conversionFallbackUsed) {
    out.push("GBP conversion unavailable, so prices are shown in USDT.");
  }
  if (market?.diagnostics?.staleCacheUsed) {
    out.push(`Using stale cached market data (${market.diagnostics.cacheAgeSec}s old).`);
  }
  if (market?.diagnostics?.explicitFallbackFrom) {
    out.push(
      `Requested provider failed (${market.diagnostics.explicitFallbackFrom}); fallback source was used.`
    );
  }
  if (!riskCurrencyAligned) {
    out.push("Risk sizing is disabled until account currency matches price quote currency.");
  }
  return dedupeWarnings(out);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "crypto-signal-desk" });
});

app.get("/api/analysis", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "BTC").toUpperCase();
    const provider = String(req.query.provider || "auto").toLowerCase();
    const quote = String(req.query.quote || "usd").toLowerCase();
    const equity = Number(req.query.equity ?? 1000);
    const riskPercent = Number(req.query.riskPercent ?? 1.5);
    const holding = String(req.query.holding || "false").toLowerCase() === "true";
    const entryPrice = req.query.entryPrice == null ? null : Number(req.query.entryPrice);

    if (!SUPPORTED_SYMBOLS.has(symbol)) {
      return res.status(400).json({ error: `Unsupported symbol: ${symbol}` });
    }
    if (!SUPPORTED_PROVIDERS.has(provider)) {
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    }
    if (!SUPPORTED_QUOTES.has(quote)) {
      return res.status(400).json({ error: `Unsupported quote: ${quote}` });
    }
    if (!Number.isFinite(equity) || equity <= 0) {
      return res.status(400).json({ error: "Equity must be a positive number." });
    }
    if (!Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > 5) {
      return res.status(400).json({ error: "Risk percent must be between 0 and 5." });
    }
    if (holding && (!Number.isFinite(entryPrice) || entryPrice <= 0)) {
      return res.status(400).json({ error: "Entry price must be a positive number when holding." });
    }

    const { market, analysis, accountCurrency, riskCurrencyAligned } = await buildSymbolAnalysis({
      symbol,
      provider,
      quote,
      equity,
      riskPercent,
      holding,
      entryPrice
    });
    const warnings = appendProviderWarnings({
      warnings: analysis.warnings || [],
      market,
      riskCurrencyAligned
    });

    if (warnings.length > 0) {
      log("info", "analysis.warnings", {
        requestId: req.requestId,
        symbol,
        providerUsed: market.providerUsed,
        warningCount: warnings.length
      });
    }

    res.json({
      ...analysis,
      warnings,
      accountCurrency,
      riskCurrencyAligned,
      providerRequested: provider,
      providerUsed: market.providerUsed,
      providerDiagnostics: market.diagnostics || {},
      quoteRequested: quote,
      quoteUsed: market.quoteCurrency
    });
  } catch (error) {
    log("error", "analysis.failed", {
      requestId: req.requestId,
      query: req.query,
      error: error instanceof Error ? error.message : "Unknown analysis error"
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown analysis error."
    });
  }
});

app.get("/api/scan", async (req, res) => {
  try {
    const provider = String(req.query.provider || "auto").toLowerCase();
    const quote = String(req.query.quote || "usd").toLowerCase();
    const equity = Number(req.query.equity ?? 1000);
    const riskPercent = Number(req.query.riskPercent ?? 1.5);

    if (!SUPPORTED_PROVIDERS.has(provider)) {
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    }
    if (!SUPPORTED_QUOTES.has(quote)) {
      return res.status(400).json({ error: `Unsupported quote: ${quote}` });
    }
    if (!Number.isFinite(equity) || equity <= 0) {
      return res.status(400).json({ error: "Equity must be a positive number." });
    }
    if (!Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > 5) {
      return res.status(400).json({ error: "Risk percent must be between 0 and 5." });
    }

    const symbols = [...SUPPORTED_SYMBOLS];
    const accountCurrency = quote.toUpperCase();
    const results = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const market = await fetchOHLCV({ symbol, provider, quote });
          const riskCurrencyAligned = accountCurrency === market.quoteCurrency;
          const analysis = analyzeSymbol({
            symbol,
            candles: market.candles,
            equity,
            riskPercent,
            holding: false,
            entryPrice: null,
            quoteCurrency: market.quoteCurrency,
            riskCurrencyAligned
          });
          const warnings = appendProviderWarnings({
            warnings: analysis.warnings || [],
            market,
            riskCurrencyAligned
          });
          const transitionAction = deriveTransitionAction(analysis);
          const displayAction = transitionAction === "SELL" ? "SELL" : analysis.action;
          return {
            ok: true,
            symbol,
            action: displayAction,
            baseAction: analysis.action,
            transitionAction,
            signalTimestamp: analysis.timestamp,
            close: analysis.market.close,
            quoteUsed: market.quoteCurrency,
            confidenceScore: analysis.quality.confidenceScore,
            grade: analysis.quality.grade,
            expectancyR: analysis.backtest.expectancyR,
            edgeExpectedNetR: analysis.edgeGuardian?.expectedNetR ?? null,
            edgeProbabilityPositivePct: analysis.edgeGuardian?.probabilityPositivePct ?? null,
            riskMultiplier: analysis.edgeGuardian?.riskMultiplier ?? null,
            edgeGateAllow: analysis.edgeGuardian?.gateAllow ?? null,
            winRate: analysis.backtest.winRate,
            providerUsed: market.providerUsed,
            riskCurrencyAligned,
            warningCount: warnings.length
          };
        } catch (error) {
          log("error", "scan.symbol_failed", {
            requestId: req.requestId,
            symbol,
            provider,
            quote,
            error: error instanceof Error ? error.message : "Unknown scan symbol error"
          });
          return {
            ok: false,
            symbol,
            error: error instanceof Error ? error.message : "Unknown scan error"
          };
        }
      })
    );

    res.json({
      timestamp: new Date().toISOString(),
      accountCurrency,
      providerRequested: provider,
      quoteRequested: quote,
      results
    });
  } catch (error) {
    log("error", "scan.failed", {
      requestId: req.requestId,
      query: req.query,
      error: error instanceof Error ? error.message : "Unknown scan error"
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown scan error."
    });
  }
});

app.get("/api/alerts/btc", async (req, res) => {
  try {
    if (!isCronAuthorized(req)) {
      return res.status(401).json({ error: "Unauthorized cron request." });
    }

    const preview = String(req.query.preview || "false").toLowerCase() === "true";
    const provider = String(req.query.provider || "auto").toLowerCase();
    const quote = "usd";
    const equity = Number(req.query.equity ?? 1000);
    const riskPercent = Number(req.query.riskPercent ?? 1.5);
    if (!SUPPORTED_PROVIDERS.has(provider)) {
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    }
    if (!Number.isFinite(equity) || equity <= 0) {
      return res.status(400).json({ error: "Equity must be a positive number." });
    }
    if (!Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > 5) {
      return res.status(400).json({ error: "Risk percent must be between 0 and 5." });
    }

    const currentSnapshot = await buildSymbolAnalysis({
      symbol: "BTC",
      provider,
      quote,
      equity,
      riskPercent,
      holding: false,
      entryPrice: null
    });

    const current = currentSnapshot.analysis;
    const candles = currentSnapshot.market.candles;
    const prevCandles = candles.slice(0, -1);
    let previousAction = null;
    if (prevCandles.length >= 220) {
      const prev = analyzeSymbol({
        symbol: "BTC",
        candles: prevCandles,
        equity,
        riskPercent,
        holding: false,
        entryPrice: null,
        quoteCurrency: currentSnapshot.market.quoteCurrency,
        riskCurrencyAligned: true
      });
      previousAction = deriveActionableAlertAction(prev);
    }

    const currentAction = deriveActionableAlertAction(current);
    const actionable = currentAction === "BUY" || currentAction === "SELL";
    const signalChanged = actionable && currentAction !== previousAction;
    const alertKey =
      actionable && current.system?.latestTransitionTimestamp
        ? `BTC:${currentAction}:${current.system.latestTransitionTimestamp}`
        : null;
    let duplicateSuppressed = false;
    let shouldAlert = signalChanged;
    if (shouldAlert && !preview && wasAlertRecentlySent(alertKey)) {
      shouldAlert = false;
      duplicateSuppressed = true;
    }

    let telegram = { sent: false, reason: "not_triggered" };
    if (shouldAlert && !preview) {
      const message =
        `BTC ${currentAction} signal\n` +
        `Price: ${current.market.close} ${currentSnapshot.market.quoteCurrency}\n` +
        `Edge EV R: ${current.edgeGuardian?.expectedNetR ?? "-"}\n` +
        `P(+EV): ${current.edgeGuardian?.probabilityPositivePct ?? "-"}%\n` +
        `Signal time: ${current.timestamp}`;
      telegram = await sendTelegramMessage(message);
      if (telegram.sent) {
        markAlertSent(alertKey);
      }
    } else if (duplicateSuppressed) {
      telegram = { sent: false, reason: "duplicate_suppressed" };
    }

    if (signalChanged || duplicateSuppressed || !telegram.sent) {
      log("info", "btc.alert_check", {
        requestId: req.requestId,
        shouldAlert,
        currentAction,
        previousAction,
        alertKey,
        duplicateSuppressed,
        preview,
        telegram
      });
    }

    res.json({
      ok: true,
      preview,
      shouldAlert,
      duplicateSuppressed,
      currentAction,
      previousAction,
      baseAction: current.action,
      transitionAction: deriveTransitionAction(current),
      timestamp: current.timestamp,
      transitionTimestamp: current.system?.latestTransitionTimestamp || null,
      signalChanged,
      marketClose: current.market.close,
      quoteUsed: currentSnapshot.market.quoteCurrency,
      telegram
    });
  } catch (error) {
    log("error", "btc.alert_failed", {
      requestId: req.requestId,
      error: error instanceof Error ? error.message : "Unknown btc alert error"
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown btc alert error."
    });
  }
});

if (process.env.VERCEL !== "1") {
  app.listen(port, () => {
    console.log(`Crypto Signal Desk running at http://localhost:${port}`);
  });
}

export default app;

const COINGECKO_IDS = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana"
};

const BINANCE_SYMBOLS = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT"
};

const cache = new Map();
const inflight = new Map();
const MARKET_CACHE_TTL_MS = 60 * 1000;
const AUTO_CACHE_TTL_MS = 45 * 1000;
const MAX_STALE_CACHE_MS = 12 * 60 * 1000;

function toDateKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function withDiagnostics(value, extra) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return {
    ...value,
    diagnostics: {
      ...(value.diagnostics || {}),
      ...extra
    }
  };
}

async function withCache(key, ttlMs, fn) {
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && now - existing.time < ttlMs) {
    return existing.value;
  }

  const existingPromise = inflight.get(key);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = (async () => {
    try {
      const value = await fn();
      cache.set(key, { time: Date.now(), value });
      return value;
    } catch (error) {
      if (existing) {
        const ageMs = now - existing.time;
        if (ageMs <= MAX_STALE_CACHE_MS) {
          return withDiagnostics(existing.value, {
            staleCacheUsed: true,
            cacheAgeSec: Math.round(ageMs / 1000),
            cacheFallbackReason: error instanceof Error ? error.message : "Unknown fetch error"
          });
        }
      }
      throw error;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

async function fetchJson(url, attempts = 2) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "crypto-signal-desk/1.0"
        },
        signal: controller.signal
      });
      if (!response.ok) {
        const bodyPreview = (await response.text()).slice(0, 160);
        const error = new Error(
          `HTTP ${response.status} from ${url}${bodyPreview ? `: ${bodyPreview}` : ""}`
        );
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const retryableNetwork =
        lastError.name === "AbortError" ||
        /network|fetch|timed out|aborted/i.test(lastError.message);
      const retryableHttp = Boolean(lastError.retryable);
      if (attempt < attempts && (retryableNetwork || retryableHttp)) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error(`Unable to fetch ${url}`);
}

async function fetchCoinGeckoOHLCV(symbol, quote) {
  const coinId = COINGECKO_IDS[symbol];
  if (!coinId) {
    throw new Error(`CoinGecko mapping not found for ${symbol}`);
  }

  const ohlcUrl = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=${quote}&days=365`;
  const marketUrl = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=${quote}&days=365&interval=daily`;

  const marketChart = await fetchJson(marketUrl);
  let ohlcMaybe = [];
  let ohlcError = null;
  try {
    ohlcMaybe = await fetchJson(ohlcUrl);
  } catch (error) {
    ohlcMaybe = [];
    ohlcError = error instanceof Error ? error.message : "Unknown CoinGecko OHLC error";
  }

  const prices = Array.isArray(marketChart?.prices) ? marketChart.prices : [];
  if (!prices.length) {
    throw new Error("CoinGecko market chart response was empty.");
  }

  const volumeByDate = new Map();
  const volumes = Array.isArray(marketChart?.total_volumes) ? marketChart.total_volumes : [];
  for (const item of volumes) {
    if (!Array.isArray(item) || item.length < 2) continue;
    volumeByDate.set(toDateKey(item[0]), Number(item[1]));
  }

  const ohlcByDate = new Map();
  const ohlc = Array.isArray(ohlcMaybe) ? ohlcMaybe : [];
  for (const item of ohlc) {
    if (!Array.isArray(item) || item.length < 5) continue;
    const [time, open, high, low, close] = item;
    ohlcByDate.set(toDateKey(time), {
      time: Number(time),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close)
    });
  }

  let prevClose = Number(prices[0][1]);
  if (!Number.isFinite(prevClose) || prevClose <= 0) {
    const firstFinite = prices.find((item) => Array.isArray(item) && Number.isFinite(Number(item[1])));
    prevClose = Number(firstFinite?.[1]);
  }
  const candles = prices
    .filter((item) => Array.isArray(item) && item.length >= 2)
    .map(([time, close]) => {
      const dateKey = toDateKey(time);
      const merged = ohlcByDate.get(dateKey);
      const closeNum = Number(close);
      const volume = volumeByDate.get(dateKey) ?? null;

      const openNum = merged ? Number(merged.open) : prevClose;
      const highNum = merged ? Number(merged.high) : Math.max(openNum, closeNum);
      const lowNum = merged ? Number(merged.low) : Math.min(openNum, closeNum);

      prevClose = closeNum;

      return {
        time: Number(time),
        open: openNum,
        high: highNum,
        low: lowNum,
        close: closeNum,
        volume: volume == null ? null : Number(volume)
      };
    })
    .filter((c) => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time);

  if (candles.length < 220) {
    throw new Error("Not enough historical candles from CoinGecko.");
  }

  return {
    providerUsed: "coingecko",
    quoteCurrency: quote.toUpperCase(),
    candles,
    diagnostics: {
      candleCount: candles.length,
      ohlcMergedDays: ohlcByDate.size,
      ohlcError
    }
  };
}

async function fetchUsdtRate(quote) {
  const normalized = String(quote || "usd").toLowerCase();
  if (normalized === "usd" || normalized === "usdt") return 1;
  if (normalized !== "gbp") {
    throw new Error(`Unsupported quote conversion from USDT to ${quote}`);
  }

  const cacheKey = `fx:usdt:${normalized}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < 60 * 60 * 1000) {
    return cached.value;
  }

  try {
    const url = "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=gbp";
    const data = await fetchJson(url);
    const rate = Number(data?.tether?.gbp);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Could not fetch USDT to GBP conversion rate.");
    }
    cache.set(cacheKey, { time: Date.now(), value: rate });
    return rate;
  } catch (error) {
    if (cached && Number.isFinite(cached.value) && cached.value > 0) {
      return cached.value;
    }
    throw error;
  }
}

async function fetchBinanceOHLCV(symbol, quote) {
  const binanceSymbol = BINANCE_SYMBOLS[symbol];
  if (!binanceSymbol) {
    throw new Error(`Binance mapping not found for ${symbol}`);
  }

  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=1d&limit=500`;
  const data = await fetchJson(url);

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Binance klines response was empty.");
  }

  const candles = data
    .filter((k) => Array.isArray(k) && k.length >= 6)
    .map((kline) => ({
      time: Number(kline[0]),
      open: Number(kline[1]),
      high: Number(kline[2]),
      low: Number(kline[3]),
      close: Number(kline[4]),
      volume: Number(kline[7] ?? kline[5])
    }))
    .filter((c) => [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite))
    .sort((a, b) => a.time - b.time);

  if (candles.length < 220) {
    throw new Error("Not enough historical candles from Binance.");
  }

  const normalizedQuote = String(quote || "usd").toLowerCase();
  let conversion = 1;
  let conversionFallbackUsed = false;
  let quoteCurrency = normalizedQuote === "gbp" ? "GBP" : "USD";
  let conversionError = null;

  if (normalizedQuote === "gbp") {
    try {
      conversion = await fetchUsdtRate(normalizedQuote);
      quoteCurrency = "GBP";
    } catch (error) {
      conversionFallbackUsed = true;
      conversionError = error instanceof Error ? error.message : "Unknown FX conversion error";
      conversion = null;
      quoteCurrency = "USDT";
    }
  }

  const converted = candles.map((c) => {
    if (!Number.isFinite(conversion) || (conversion === 1 && quoteCurrency === "USDT")) {
      return c;
    }
    return {
      ...c,
      open: c.open * conversion,
      high: c.high * conversion,
      low: c.low * conversion,
      close: c.close * conversion,
      volume: c.volume * conversion
    };
  });

  return {
    providerUsed: "binance",
    quoteCurrency,
    candles: converted,
    diagnostics: {
      candleCount: converted.length,
      usdtConversionRate: conversion,
      conversionFallbackUsed,
      conversionError
    }
  };
}

function providerScore(market, requestedQuote) {
  const latest = market.candles[market.candles.length - 1];
  const ageHours = latest ? (Date.now() - latest.time) / (1000 * 60 * 60) : 1e9;
  const providerBonus = market.providerUsed === "binance" ? 12 : 7;
  const quoteMatchBonus =
    String(market.quoteCurrency || "").toUpperCase() === String(requestedQuote || "").toUpperCase()
      ? 120
      : -250;
  return market.candles.length - ageHours * 4 + providerBonus + quoteMatchBonus;
}

function canCompareSameQuote(a, b) {
  return (
    String(a?.quoteCurrency || "").toUpperCase() === String(b?.quoteCurrency || "").toUpperCase()
  );
}

export async function fetchOHLCV({ symbol, provider, quote }) {
  const normalizedQuote = String(quote || "usd").toLowerCase();
  const key = `${provider}:${symbol}:${normalizedQuote}`;

  if (provider === "coingecko") {
    return withCache(key, MARKET_CACHE_TTL_MS, async () => {
      try {
        return await fetchCoinGeckoOHLCV(symbol, normalizedQuote);
      } catch (error) {
        const fallback = await fetchBinanceOHLCV(symbol, normalizedQuote);
        return withDiagnostics(fallback, {
          explicitFallbackFrom: "coingecko",
          explicitFallbackReason: error instanceof Error ? error.message : "Unknown CoinGecko error"
        });
      }
    });
  }
  if (provider === "binance") {
    return withCache(key, MARKET_CACHE_TTL_MS, async () => {
      try {
        return await fetchBinanceOHLCV(symbol, normalizedQuote);
      } catch (error) {
        const fallback = await fetchCoinGeckoOHLCV(symbol, normalizedQuote);
        return withDiagnostics(fallback, {
          explicitFallbackFrom: "binance",
          explicitFallbackReason: error instanceof Error ? error.message : "Unknown Binance error"
        });
      }
    });
  }

  return withCache(key, AUTO_CACHE_TTL_MS, async () => {
    const [coingeckoResult, binanceResult] = await Promise.allSettled([
      fetchCoinGeckoOHLCV(symbol, normalizedQuote),
      fetchBinanceOHLCV(symbol, normalizedQuote)
    ]);

    const candidates = [];
    if (coingeckoResult.status === "fulfilled") candidates.push(coingeckoResult.value);
    if (binanceResult.status === "fulfilled") candidates.push(binanceResult.value);
    if (!candidates.length) {
      throw new Error("No market provider succeeded (CoinGecko and Binance failed).");
    }

    candidates.sort((a, b) => providerScore(b, normalizedQuote) - providerScore(a, normalizedQuote));
    const selected = candidates[0];

    let providerCloseDiffPct = null;
    if (coingeckoResult.status === "fulfilled" && binanceResult.status === "fulfilled") {
      const cgValue = coingeckoResult.value;
      const bnValue = binanceResult.value;
      if (canCompareSameQuote(cgValue, bnValue)) {
        const cgClose = cgValue.candles.at(-1)?.close;
        const bnClose = bnValue.candles.at(-1)?.close;
        if (Number.isFinite(cgClose) && Number.isFinite(bnClose) && cgClose > 0 && bnClose > 0) {
          providerCloseDiffPct = (Math.abs(cgClose - bnClose) / ((cgClose + bnClose) / 2)) * 100;
        }
      }
    }

    return {
      ...selected,
      diagnostics: {
        ...(selected.diagnostics || {}),
        providerCloseDiffPct,
        fallbackUsed: candidates.length === 1
      }
    };
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSymbol } from "../src/strategy.js";

function buildCandles(generator, days = 260) {
  const candles = [];
  for (let i = 0; i < days; i += 1) {
    candles.push(generator(i, days, candles));
  }
  return candles;
}

function baseInput(candles) {
  return {
    symbol: "BTC",
    candles,
    equity: 1000,
    riskPercent: 1.5,
    quoteCurrency: "USD",
    riskCurrencyAligned: true
  };
}

test("returns HOLD when long setup is not active", () => {
  const candles = buildCandles((i, days) => {
    const close = 300 - i * 0.4;
    return {
      time: Date.now() - (days - i) * 24 * 3600 * 1000,
      open: close + 0.4,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + i
    };
  });

  const result = analyzeSymbol({
    ...baseInput(candles),
    holding: false,
    entryPrice: null
  });

  assert.equal(result.action, "HOLD");
  assert.equal(result.setup.regimeLong, false);
});

test("returns ABSTAIN when setup is active but Edge Guardian blocks", () => {
  const candles = buildCandles((i, days) => {
    let close = 100 + i * 0.35;
    if (i === days - 1) close += 8;
    return {
      time: Date.now() - (days - i) * 24 * 3600 * 1000,
      open: close - 0.6,
      high: close + 0.9,
      low: close - 1.5,
      close,
      volume: i === days - 1 ? 200000 : 2000 + i * 4
    };
  });

  const result = analyzeSymbol({
    ...baseInput(candles),
    holding: false,
    entryPrice: null
  });

  assert.equal(result.setup.regimeLong, true);
  assert.equal(result.setup.breakout, true);
  assert.equal(result.setup.volumeExpansion, true);
  assert.equal(result.edgeGuardian.gateAllow, false);
  assert.equal(typeof result.edgeGuardian.oosTrainTrades, "number");
  assert.equal(typeof result.edgeGuardian.oosTrades, "number");
  assert.ok(Object.hasOwn(result.edgeGuardian, "oosExpectancyR"));
  assert.ok(Object.hasOwn(result.edgeGuardian, "oosWinRate"));
  assert.ok(Object.hasOwn(result.edgeGuardian, "oosProfitFactor"));
  assert.equal(result.action, "ABSTAIN");
});

test("tracks model BUY transition without forced end-of-window close", () => {
  const candles = buildCandles((i, days) => {
    let close = 100 + i * 0.35;
    if (i === days - 2) close += 10;
    if (i === days - 1) close += 11;
    return {
      time: Date.now() - (days - i) * 24 * 3600 * 1000,
      open: close - 0.6,
      high: close + 1.2,
      low: close - 1.5,
      close,
      volume: i >= days - 2 ? 300000 : 2000 + i * 4
    };
  });

  const result = analyzeSymbol({
    ...baseInput(candles),
    holding: false,
    entryPrice: null
  });

  assert.equal(result.system.latestTransitionAction, "BUY");
  assert.equal(typeof result.system.latestTransitionTimestamp, "string");
  assert.equal(result.backtest.openTrade, true);
  assert.equal(result.backtest.forcedCloseAtEnd, false);
});

test("returns SELL when holding and trailing stop is broken", () => {
  const candles = buildCandles((i, days) => {
    let close = 120 + i * 0.25;
    if (i === days - 1) close -= 18;
    return {
      time: Date.now() - (days - i) * 24 * 3600 * 1000,
      open: close + 0.2,
      high: close + 1,
      low: close - 1.5,
      close,
      volume: 1800 + i * 3
    };
  });

  const result = analyzeSymbol({
    ...baseInput(candles),
    holding: true,
    entryPrice: 170
  });

  assert.equal(result.action, "SELL");
  assert.equal(typeof result.riskPlan.trailingStop, "number");
  assert.equal(result.market.close < result.riskPlan.trailingStop, true);
});

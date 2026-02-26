function average(values) {
  if (!values.length) return NaN;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return NaN;
  const mean = average(values);
  const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function to2(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

function to6(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
}

function normalCdf(z) {
  if (!Number.isFinite(z)) return NaN;
  const abs = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * abs);
  const d = 0.3989423 * Math.exp((-abs * abs) / 2);
  const prob =
    1 -
    d *
      t *
      (0.3193815 +
        t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? prob : 1 - prob;
}

function hasEnoughData(candles) {
  return Array.isArray(candles) && candles.length >= 220;
}

function rollingSMA(values, period) {
  const out = Array(values.length).fill(NaN);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      out[i] = sum / period;
    }
  }
  return out;
}

function rollingEMA(values, period) {
  const out = Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  out[period - 1] = average(values.slice(0, period));
  for (let i = period; i < values.length; i += 1) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function rollingATR(candles, period = 14) {
  const out = Array(candles.length).fill(NaN);
  if (candles.length < period + 1) return out;

  const tr = Array(candles.length).fill(NaN);
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const prevClose = candles[i - 1].close;
    const range1 = current.high - current.low;
    const range2 = Math.abs(current.high - prevClose);
    const range3 = Math.abs(current.low - prevClose);
    tr[i] = Math.max(range1, range2, range3);
  }

  let sum = 0;
  for (let i = 1; i <= period; i += 1) {
    sum += tr[i];
  }
  out[period] = sum / period;

  for (let i = period + 1; i < candles.length; i += 1) {
    sum += tr[i] - tr[i - period];
    out[i] = sum / period;
  }
  return out;
}

function rollingADX(candles, period = 14) {
  const out = Array(candles.length).fill(NaN);
  if (candles.length < period * 2 + 1) return out;

  const plusDM = Array(candles.length).fill(0);
  const minusDM = Array(candles.length).fill(0);
  const tr = Array(candles.length).fill(NaN);

  for (let i = 1; i < candles.length; i += 1) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;

    const range1 = candles[i].high - candles[i].low;
    const range2 = Math.abs(candles[i].high - candles[i - 1].close);
    const range3 = Math.abs(candles[i].low - candles[i - 1].close);
    tr[i] = Math.max(range1, range2, range3);
  }

  const dx = Array(candles.length).fill(NaN);
  for (let i = period; i < candles.length; i += 1) {
    let sumTR = 0;
    let sumPlus = 0;
    let sumMinus = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      sumTR += tr[j];
      sumPlus += plusDM[j];
      sumMinus += minusDM[j];
    }

    if (!Number.isFinite(sumTR) || sumTR <= 0) continue;
    const plusDI = (100 * sumPlus) / sumTR;
    const minusDI = (100 * sumMinus) / sumTR;
    const denominator = plusDI + minusDI;
    if (denominator <= 0) continue;
    dx[i] = (100 * Math.abs(plusDI - minusDI)) / denominator;
  }

  for (let i = period * 2 - 1; i < candles.length; i += 1) {
    const window = dx.slice(i - period + 1, i + 1).filter(Number.isFinite);
    if (window.length === period) {
      out[i] = average(window);
    }
  }
  return out;
}

function maxPrev(values, index, lookback) {
  if (index - lookback < 0) return NaN;
  let max = -Infinity;
  for (let i = index - lookback; i < index; i += 1) {
    if (values[i] > max) max = values[i];
  }
  return max;
}

function minPrev(values, index, lookback) {
  if (index - lookback < 0) return NaN;
  let min = Infinity;
  for (let i = index - lookback; i < index; i += 1) {
    if (values[i] < min) min = values[i];
  }
  return min;
}

function volumeWindowStats(values, index, lookback) {
  if (index - lookback < 0) {
    return { avg: NaN, coverage: 0 };
  }
  const slice = values.slice(index - lookback, index).filter((v) => Number.isFinite(v) && v > 0);
  return {
    avg: slice.length ? average(slice) : NaN,
    coverage: lookback > 0 ? slice.length / lookback : 0
  };
}

function gradeForScore(score) {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

function scoreSetup(setup) {
  let score = 0;
  if (setup.regimeLong) score += 26;
  if (setup.breakout) score += 22;
  if (setup.volumeExpansion) score += 16;
  if (setup.adxPass) score += 14;
  if (setup.volatilityPass) score += 10;
  if (Number.isFinite(setup.sma50) && setup.close > setup.sma50) score += 7;
  if (Number.isFinite(setup.atrPct) && setup.atrPct >= 1.2 && setup.atrPct <= 8) score += 5;
  return clamp(Math.round(score), 0, 100);
}

function kernelWeight(distance, bandwidth = 18) {
  const d = Number(distance);
  if (!Number.isFinite(d)) return 0;
  return Math.exp(-0.5 * (d / bandwidth) ** 2);
}

function weightedMoments(values, weights) {
  if (!values.length || values.length !== weights.length) {
    return { mean: NaN, variance: NaN, stdDev: NaN, sumW: 0, nEff: 0 };
  }

  let sumW = 0;
  let sumW2 = 0;
  let sumWX = 0;
  for (let i = 0; i < values.length; i += 1) {
    const x = values[i];
    const w = weights[i];
    if (!Number.isFinite(x) || !Number.isFinite(w) || w <= 0) continue;
    sumW += w;
    sumW2 += w * w;
    sumWX += w * x;
  }
  if (sumW <= 0) {
    return { mean: NaN, variance: NaN, stdDev: NaN, sumW: 0, nEff: 0 };
  }

  const mean = sumWX / sumW;
  let varianceNumerator = 0;
  for (let i = 0; i < values.length; i += 1) {
    const x = values[i];
    const w = weights[i];
    if (!Number.isFinite(x) || !Number.isFinite(w) || w <= 0) continue;
    varianceNumerator += w * (x - mean) ** 2;
  }

  const variance = varianceNumerator / sumW;
  const nEff = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;

  return {
    mean,
    variance,
    stdDev: Math.sqrt(variance),
    sumW,
    nEff
  };
}

function estimateWinProbability(trades, targetScore) {
  if (!trades.length) return NaN;
  let weightedWins = 0;
  let weightedTotal = 0;

  for (const trade of trades) {
    const weight = kernelWeight(Math.abs(trade.signalScore - targetScore));
    if (!Number.isFinite(weight) || weight <= 0) continue;
    weightedTotal += weight;
    weightedWins += weight * (trade.netR > 0 ? 1 : 0);
  }

  if (weightedTotal <= 0) return NaN;
  return clamp((weightedWins + 1) / (weightedTotal + 2), 0, 1);
}

function computeEdgeEstimate(trades, targetScore) {
  if (!trades.length) {
    return {
      expectedNetR: NaN,
      ci95LowR: NaN,
      ci95HighR: NaN,
      probabilityPositive: NaN,
      probabilityWin: NaN,
      sampleSize: 0,
      effectiveSampleSize: 0,
      rawStdDevR: NaN
    };
  }

  const values = [];
  const winValues = [];
  const weights = [];
  for (const trade of trades) {
    if (!Number.isFinite(trade.netR) || !Number.isFinite(trade.signalScore)) continue;
    const weight = kernelWeight(Math.abs(trade.signalScore - targetScore));
    if (weight <= 0) continue;
    values.push(trade.netR);
    winValues.push(trade.netR > 0 ? 1 : 0);
    weights.push(weight);
  }

  const momentsR = weightedMoments(values, weights);
  const momentsWin = weightedMoments(winValues, weights);
  const effectiveSampleSize = momentsR.nEff;
  const se =
    Number.isFinite(momentsR.stdDev) && Number.isFinite(effectiveSampleSize) && effectiveSampleSize > 1
      ? momentsR.stdDev / Math.sqrt(effectiveSampleSize)
      : NaN;
  const ci95LowR = Number.isFinite(se) ? momentsR.mean - 1.96 * se : NaN;
  const ci95HighR = Number.isFinite(se) ? momentsR.mean + 1.96 * se : NaN;

  let probabilityPositive = NaN;
  if (Number.isFinite(momentsR.mean) && Number.isFinite(se)) {
    if (se <= 1e-9) {
      probabilityPositive = momentsR.mean > 0 ? 1 : 0;
    } else {
      probabilityPositive = clamp(normalCdf(momentsR.mean / se), 0, 1);
    }
  }

  const probabilityWin = Number.isFinite(momentsWin.mean)
    ? clamp((momentsWin.mean * momentsWin.sumW + 1) / (momentsWin.sumW + 2), 0, 1)
    : NaN;

  return {
    expectedNetR: momentsR.mean,
    ci95LowR,
    ci95HighR,
    probabilityPositive,
    probabilityWin,
    sampleSize: values.length,
    effectiveSampleSize,
    rawStdDevR: momentsR.stdDev
  };
}

function walkForwardBrier(trades) {
  if (trades.length < 12) {
    return { brier: NaN, samples: 0 };
  }

  let totalError = 0;
  let samples = 0;
  for (let i = 8; i < trades.length; i += 1) {
    const history = trades.slice(0, i);
    const probability = estimateWinProbability(history, trades[i].signalScore);
    if (!Number.isFinite(probability)) continue;
    const outcome = trades[i].netR > 0 ? 1 : 0;
    totalError += (probability - outcome) ** 2;
    samples += 1;
  }

  return {
    brier: samples > 0 ? totalError / samples : NaN,
    samples
  };
}

function detectDrift(trades) {
  if (trades.length < 12) {
    return {
      baselineExpectancyR: NaN,
      recentExpectancyR: NaN,
      deltaR: NaN,
      degraded: false,
      hardBlock: false
    };
  }

  const recentCount = Math.min(10, Math.max(6, Math.floor(trades.length * 0.33)));
  const baselineCount = Math.min(30, trades.length - recentCount);
  const recentTrades = trades.slice(-recentCount).map((trade) => trade.netR);
  const baselineTrades = trades
    .slice(-(recentCount + baselineCount), -recentCount)
    .map((trade) => trade.netR);

  const recentExpectancyR = average(recentTrades);
  const baselineExpectancyR = average(baselineTrades);
  const deltaR =
    Number.isFinite(recentExpectancyR) && Number.isFinite(baselineExpectancyR)
      ? recentExpectancyR - baselineExpectancyR
      : NaN;

  const degraded =
    Number.isFinite(recentExpectancyR) &&
    Number.isFinite(deltaR) &&
    (recentExpectancyR < 0 || deltaR < -0.2);
  const hardBlock =
    Number.isFinite(recentExpectancyR) &&
    Number.isFinite(deltaR) &&
    recentExpectancyR < -0.25 &&
    deltaR < -0.35;

  return {
    baselineExpectancyR,
    recentExpectancyR,
    deltaR,
    degraded,
    hardBlock
  };
}

function buildEdgeGuardian({ trades, currentSignalScore, requestedRiskPercent }) {
  const edge = computeEdgeEstimate(trades, currentSignalScore);
  const calibration = walkForwardBrier(trades);
  const drift = detectDrift(trades);

  let riskMultiplier = 1;
  const throttleReasons = [];
  if (!Number.isFinite(edge.effectiveSampleSize) || edge.effectiveSampleSize < 8) {
    riskMultiplier *= 0.65;
    throttleReasons.push("insufficient similar historical signals");
  }
  if (Number.isFinite(edge.ci95LowR) && edge.ci95LowR <= 0) {
    riskMultiplier *= 0.6;
    throttleReasons.push("expected value confidence interval includes non-positive outcomes");
  }
  if (Number.isFinite(edge.probabilityPositive) && edge.probabilityPositive < 0.6) {
    riskMultiplier *= 0.7;
    throttleReasons.push("probability of positive edge is below 60%");
  }
  if (Number.isFinite(calibration.brier) && calibration.brier > 0.25) {
    riskMultiplier *= 0.75;
    throttleReasons.push("walk-forward calibration quality is weak");
  }
  if (drift.degraded) {
    riskMultiplier *= 0.5;
    throttleReasons.push("recent live edge degraded versus baseline");
  }
  riskMultiplier = clamp(riskMultiplier, 0.1, 1);

  const highConfidencePositiveEdge =
    Number.isFinite(edge.expectedNetR) &&
    edge.expectedNetR > 0 &&
    Number.isFinite(edge.ci95LowR) &&
    edge.ci95LowR > 0 &&
    Number.isFinite(edge.probabilityPositive) &&
    edge.probabilityPositive >= 0.6;
  const enoughEvidence = Number.isFinite(edge.effectiveSampleSize) && edge.effectiveSampleSize >= 8;
  const calibrationAcceptable = !Number.isFinite(calibration.brier) || calibration.brier <= 0.3;
  const gateAllow = highConfidencePositiveEdge && enoughEvidence && calibrationAcceptable && !drift.hardBlock;

  let gateReason = "Edge Guardian allows trade.";
  if (!gateAllow) {
    if (!enoughEvidence) {
      gateReason = "Edge Guardian blocked: insufficient comparable signal history.";
    } else if (!highConfidencePositiveEdge) {
      gateReason = "Edge Guardian blocked: post-cost edge is not positive with high confidence.";
    } else if (!calibrationAcceptable) {
      gateReason = "Edge Guardian blocked: walk-forward calibration is unreliable.";
    } else if (drift.hardBlock) {
      gateReason = "Edge Guardian blocked: severe negative drift detected.";
    } else {
      gateReason = "Edge Guardian blocked: gating conditions not met.";
    }
  }

  return {
    gateAllow,
    gateReason,
    expectedNetR: edge.expectedNetR,
    ci95LowR: edge.ci95LowR,
    ci95HighR: edge.ci95HighR,
    probabilityWinPct: Number.isFinite(edge.probabilityWin) ? edge.probabilityWin * 100 : NaN,
    probabilityPositivePct: Number.isFinite(edge.probabilityPositive)
      ? edge.probabilityPositive * 100
      : NaN,
    sampleSize: edge.sampleSize,
    effectiveSampleSize: edge.effectiveSampleSize,
    walkForwardBrier: calibration.brier,
    walkForwardSamples: calibration.samples,
    driftBaselineExpectancyR: drift.baselineExpectancyR,
    driftRecentExpectancyR: drift.recentExpectancyR,
    driftDeltaR: drift.deltaR,
    driftDegraded: drift.degraded,
    riskMultiplier,
    recommendedRiskPercent: requestedRiskPercent * riskMultiplier,
    throttleReason:
      throttleReasons.length > 0
        ? `Risk throttled due to ${throttleReasons.join("; ")}.`
        : "No risk throttle applied."
  };
}

function buildIndicators(candles) {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  return {
    closes,
    highs,
    lows,
    volumes,
    sma50: rollingSMA(closes, 50),
    sma200: rollingSMA(closes, 200),
    ema10: rollingEMA(closes, 10),
    atr14: rollingATR(candles, 14),
    adx14: rollingADX(candles, 14)
  };
}

function evaluateSetup({ index, indicators }) {
  const close = indicators.closes[index];
  const volume = indicators.volumes[index];
  const sma50 = indicators.sma50[index];
  const sma200 = indicators.sma200[index];
  const sma50Prev = indicators.sma50[index - 1];
  const ema10 = indicators.ema10[index];
  const atr14 = indicators.atr14[index];
  const adx14 = indicators.adx14[index];

  const breakoutLevel20d = maxPrev(indicators.highs, index, 20);
  const breakout = Number.isFinite(breakoutLevel20d) && close > breakoutLevel20d;

  const { avg: volumeAvg20, coverage: volumeCoverage } = volumeWindowStats(indicators.volumes, index, 20);
  const volumeExpansion = volumeCoverage < 0.6
    ? false
    : Number.isFinite(volumeAvg20) && Number.isFinite(volume) && volume > volumeAvg20 * 1.2;

  const regimeLong =
    Number.isFinite(sma50) &&
    Number.isFinite(sma50Prev) &&
    Number.isFinite(sma200) &&
    close > sma200 &&
    sma50 > sma50Prev;

  const adxPass = Number.isFinite(adx14) && adx14 >= 18;
  const atrPct = Number.isFinite(atr14) && close > 0 ? (atr14 / close) * 100 : NaN;
  const volatilityPass = Number.isFinite(atrPct) && atrPct >= 0.35 && atrPct <= 12;

  const swingLow = minPrev(indicators.lows, index, 5);
  const atrStop = Number.isFinite(atr14) ? close - 1.5 * atr14 : NaN;
  const stopCandidates = [swingLow, atrStop].filter((v) => Number.isFinite(v) && v < close);
  const suggestedStop = stopCandidates.length ? Math.min(...stopCandidates) : NaN;
  const riskPerUnit = Number.isFinite(suggestedStop) ? close - suggestedStop : NaN;

  const entrySignal = regimeLong && breakout && volumeExpansion && adxPass && volatilityPass;
  const signalScore = scoreSetup({
    close,
    regimeLong,
    breakout,
    volumeExpansion,
    adxPass,
    volatilityPass,
    sma50,
    atrPct
  });

  return {
    close,
    volume,
    volumeAvg20,
    volumeCoverage,
    breakoutLevel20d,
    breakout,
    volumeExpansion,
    regimeLong,
    adx14,
    adxPass,
    atr14,
    atrPct,
    volatilityPass,
    sma50,
    sma200,
    ema10,
    swingLow,
    suggestedStop,
    riskPerUnit,
    entrySignal,
    signalScore
  };
}

function computeTrailingStop({ index, indicators, floorStop = NaN, fallbackStop = NaN }) {
  const ema10 = indicators.ema10[index];
  const trailingLow = minPrev(indicators.lows, index, 5);
  return Math.max(
    Number.isFinite(floorStop) ? floorStop : -Infinity,
    Number.isFinite(ema10) ? ema10 : -Infinity,
    Number.isFinite(trailingLow) ? trailingLow : -Infinity,
    Number.isFinite(fallbackStop) ? fallbackStop : -Infinity
  );
}

function buildEntryPosition({ signalIndex, candles, indicators, signalScore }) {
  const nextOpen = candles[signalIndex + 1]?.open;
  if (!Number.isFinite(nextOpen) || nextOpen <= 0) return null;

  const atrForEntry = indicators.atr14[signalIndex];
  const swingLow = minPrev(indicators.lows, signalIndex, 5);
  const atrStop = Number.isFinite(atrForEntry) ? nextOpen - 1.5 * atrForEntry : NaN;
  const stopCandidates = [swingLow, atrStop].filter((v) => Number.isFinite(v) && v < nextOpen);
  if (!stopCandidates.length) return null;

  const stop = Math.min(...stopCandidates);
  const risk = nextOpen - stop;
  if (!Number.isFinite(risk) || risk <= 0) return null;
  if (risk / nextOpen > 0.25) return null;

  return {
    entry: nextOpen,
    stop,
    risk,
    signalScore,
    entryIndex: signalIndex + 1
  };
}

function resolveStopExitPrice(candle, stopPrice) {
  const open = Number(candle?.open);
  if (Number.isFinite(open) && open <= stopPrice) {
    // Gap below stop: exit at open to avoid optimistic fills.
    return open;
  }
  return stopPrice;
}

function runBacktest({ candles, indicators, riskPercent }) {
  const costPctPerSide = (10 + 5) / 10000;
  let position = null;
  const resultsR = [];
  const trades = [];
  let grossProfitR = 0;
  let grossLossR = 0;
  let wins = 0;
  let losses = 0;
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  const latestIndex = candles.length - 1;
  let latestTransitionAction = null;
  let latestTransitionIndex = null;

  function settleTrade(exit, exitIndex) {
    const grossR = (exit - position.entry) / position.risk;
    const costR =
      ((position.entry * costPctPerSide) + (Math.abs(exit) * costPctPerSide)) / position.risk;
    const netR = grossR - costR;

    resultsR.push(netR);
    if (netR >= 0) {
      wins += 1;
      grossProfitR += netR;
    } else {
      losses += 1;
      grossLossR += Math.abs(netR);
    }

    const tradeReturn = netR * (riskPercent / 100);
    equity *= Math.max(0.01, 1 + tradeReturn);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);

    trades.push({
      netR,
      signalScore: position.signalScore,
      entryIndex: position.entryIndex,
      exitIndex
    });
  }

  const startIndex = 210;
  const lastEntryIndex = candles.length - 2;

  for (let i = startIndex; i <= latestIndex; i += 1) {
    if (position) {
      const close = indicators.closes[i];
      const trailStop = computeTrailingStop({
        index: i,
        indicators,
        floorStop: position.stop
      });
      const stopHit = Number.isFinite(trailStop) && candles[i].low <= trailStop;
      const trendExit = Number.isFinite(trailStop) && close < trailStop;

      if (stopHit || trendExit) {
        const exit = stopHit ? resolveStopExitPrice(candles[i], trailStop) : close;
        settleTrade(exit, i);
        if (i === latestIndex) {
          latestTransitionAction = "SELL";
          latestTransitionIndex = i;
        }
        position = null;
      }
    }

    if (!position && i <= lastEntryIndex) {
      const setup = evaluateSetup({ index: i, indicators });
      if (!setup.entrySignal || !Number.isFinite(setup.riskPerUnit) || setup.riskPerUnit <= 0) {
        continue;
      }

      const nextPosition = buildEntryPosition({
        signalIndex: i,
        candles,
        indicators,
        signalScore: setup.signalScore
      });
      if (!nextPosition) continue;

      position = nextPosition;
      if (position.entryIndex === latestIndex) {
        latestTransitionAction = "BUY";
        latestTransitionIndex = latestIndex;
      }
    }
  }

  const tradeCount = resultsR.length;
  const expectancyR = tradeCount ? average(resultsR) : NaN;
  const winRate = tradeCount ? (wins / tradeCount) * 100 : NaN;
  const profitFactor = grossLossR > 0 ? grossProfitR / grossLossR : NaN;
  const returnPct = (equity - 1) * 100;

  return {
    trades: tradeCount,
    tradeHistory: trades,
    wins,
    losses,
    winRate,
    expectancyR,
    profitFactor,
    maxDrawdownPct: maxDrawdown * 100,
    returnPct,
    openTrade: Boolean(position),
    forcedCloseAtEnd: false,
    latestTransitionAction,
    latestTransitionIndex,
    windowDays: candles.length
  };
}

function buildWarnings({ staleHours, volumeCoverage, backtest, confidenceScore, edgeGuardian }) {
  const warnings = [];
  if (staleHours > 36) warnings.push("Market data is stale; avoid acting on delayed candles.");
  if (volumeCoverage < 0.8) warnings.push("Volume coverage is incomplete; breakout confirmation is weaker.");
  if (backtest.trades < 8) warnings.push("Backtest sample is small; expectancy may be noisy.");
  if (Number.isFinite(backtest.expectancyR) && backtest.expectancyR <= 0) {
    warnings.push("Backtest expectancy is non-positive on this market history.");
  }
  if (confidenceScore < 65) warnings.push("Confidence score is below buy threshold.");
  if (edgeGuardian && !edgeGuardian.gateAllow) {
    warnings.push(edgeGuardian.gateReason);
  }
  if (edgeGuardian && Number.isFinite(edgeGuardian.riskMultiplier) && edgeGuardian.riskMultiplier < 1) {
    warnings.push(edgeGuardian.throttleReason);
  }
  if (edgeGuardian && edgeGuardian.driftDegraded) {
    warnings.push("Recent edge drift is negative; risk throttle is active.");
  }
  return warnings;
}

export function analyzeSymbol({
  symbol,
  candles,
  equity,
  riskPercent,
  holding,
  entryPrice,
  quoteCurrency,
  riskCurrencyAligned = true
}) {
  if (!hasEnoughData(candles)) {
    throw new Error("Need at least 220 daily candles for analysis.");
  }

  const indicators = buildIndicators(candles);
  const latestIndex = candles.length - 1;
  const latest = candles[latestIndex];
  const setup = evaluateSetup({ index: latestIndex, indicators });
  const backtest = runBacktest({ candles, indicators, riskPercent });
  const edgeGuardian = buildEdgeGuardian({
    trades: backtest.tradeHistory,
    currentSignalScore: setup.signalScore,
    requestedRiskPercent: riskPercent
  });

  const staleHours = (Date.now() - latest.time) / (1000 * 60 * 60);
  const requestedRiskAmount = equity * (riskPercent / 100);
  const adjustedRiskPercent = edgeGuardian.recommendedRiskPercent;
  const riskAmount = equity * (adjustedRiskPercent / 100);
  const positionSizeRequested =
    riskCurrencyAligned && setup.riskPerUnit > 0 ? requestedRiskAmount / setup.riskPerUnit : NaN;
  const positionSize =
    riskCurrencyAligned && setup.riskPerUnit > 0 ? riskAmount / setup.riskPerUnit : NaN;
  const tp1 = Number.isFinite(setup.riskPerUnit) ? setup.close + 2 * setup.riskPerUnit : NaN;

  let confidenceScore = 0;
  if (setup.regimeLong) confidenceScore += 25;
  if (setup.breakout) confidenceScore += 20;
  if (setup.volumeExpansion) confidenceScore += 15;
  if (setup.adxPass) confidenceScore += 15;
  if (setup.volatilityPass) confidenceScore += 10;
  if (Number.isFinite(backtest.expectancyR) && backtest.expectancyR > 0) confidenceScore += 10;
  if (Number.isFinite(backtest.profitFactor) && backtest.profitFactor >= 1.15) confidenceScore += 5;
  if (Number.isFinite(edgeGuardian.probabilityPositivePct) && edgeGuardian.probabilityPositivePct >= 60) {
    confidenceScore += 5;
  }
  if (setup.volumeCoverage < 0.75) confidenceScore -= 10;
  if (staleHours > 36) confidenceScore -= 20;
  if (backtest.trades < 8) confidenceScore -= 5;
  confidenceScore = clamp(Math.round(confidenceScore), 0, 100);

  const reasons = [];
  reasons.push(setup.regimeLong ? "Trend filter passed." : "Trend filter failed.");
  reasons.push(setup.breakout ? "20-day breakout detected." : "No 20-day breakout.");
  reasons.push(setup.volumeExpansion ? "Volume expansion confirmed." : "Volume expansion not confirmed.");
  reasons.push(setup.adxPass ? "ADX confirms trend strength." : "ADX trend strength is weak.");
  reasons.push(setup.volatilityPass ? "Volatility filter passed." : "Volatility filter failed.");
  if (Number.isFinite(backtest.expectancyR)) {
    reasons.push(
      backtest.expectancyR > 0
        ? "Backtest expectancy is positive."
        : "Backtest expectancy is non-positive."
    );
  }

  const trailingStop = computeTrailingStop({
    index: latestIndex,
    indicators,
    fallbackStop: setup.suggestedStop
  });

  let action = "HOLD";
  if (holding) {
    const stopBroken = Number.isFinite(trailingStop) && setup.close < trailingStop;
    action = stopBroken ? "SELL" : "HOLD";
    reasons.push(stopBroken ? "Exit triggered: close fell below trailing stop." : "Hold: trailing stop intact.");
  } else {
    if (!setup.entrySignal) {
      action = "HOLD";
      reasons.push("Entry setup is not active.");
    } else if (!riskCurrencyAligned) {
      action = "ABSTAIN";
      reasons.push("Entry blocked: account currency does not match price quote currency.");
    } else if (staleHours > 72) {
      action = "ABSTAIN";
      reasons.push("Entry blocked: data is too stale for execution.");
    } else if (!edgeGuardian.gateAllow) {
      action = "ABSTAIN";
      reasons.push(edgeGuardian.gateReason);
    } else if (!Number.isFinite(positionSize) || positionSize <= 0) {
      action = "ABSTAIN";
      reasons.push("Entry blocked: invalid position sizing after risk throttle.");
    } else if (confidenceScore < 65) {
      action = "ABSTAIN";
      reasons.push("Entry blocked: confidence score is below threshold.");
    } else {
      action = "BUY";
      reasons.push("Entry criteria and Edge Guardian gate both passed.");
    }
  }

  const heldPnlR =
    holding && entryPrice && Number.isFinite(entryPrice) && Number.isFinite(setup.suggestedStop) && entryPrice > setup.suggestedStop
      ? (setup.close - entryPrice) / (entryPrice - setup.suggestedStop)
      : null;

  const warnings = buildWarnings({
    staleHours,
    volumeCoverage: setup.volumeCoverage,
    backtest,
    confidenceScore,
    edgeGuardian
  });

  return {
    symbol,
    action,
    timestamp: new Date(latest.time).toISOString(),
    market: {
      close: to2(setup.close),
      high: to2(latest.high),
      low: to2(latest.low),
      volume: to2(setup.volume)
    },
    setup: {
      breakoutLevel20d: to2(setup.breakoutLevel20d),
      regimeLong: setup.regimeLong,
      breakout: setup.breakout,
      volumeExpansion: setup.volumeExpansion,
      signalScore: setup.signalScore,
      sma50: to2(setup.sma50),
      sma200: to2(setup.sma200),
      ema10: to2(setup.ema10),
      atr14: to2(setup.atr14),
      adx14: to2(setup.adx14),
      atrPct: to2(setup.atrPct)
    },
    riskPlan: {
      equity: to2(equity),
      riskPercent: to2(adjustedRiskPercent),
      requestedRiskPercent: to2(riskPercent),
      riskAmount: to2(riskAmount),
      requestedRiskAmount: to2(requestedRiskAmount),
      entry: to2(setup.close),
      stop: to2(setup.suggestedStop),
      trailingStop: to2(trailingStop),
      tp1: to2(tp1),
      positionSizeRequested: to6(positionSizeRequested),
      positionSize: to6(positionSize)
    },
    quality: {
      confidenceScore,
      grade: gradeForScore(confidenceScore),
      staleHours: to2(staleHours),
      volumeCoveragePct: to2(setup.volumeCoverage * 100)
    },
    backtest: {
      windowDays: backtest.windowDays,
      trades: backtest.trades,
      wins: backtest.wins,
      losses: backtest.losses,
      winRate: to2(backtest.winRate),
      expectancyR: to2(backtest.expectancyR),
      profitFactor: to2(backtest.profitFactor),
      maxDrawdownPct: to2(backtest.maxDrawdownPct),
      returnPct: to2(backtest.returnPct),
      openTrade: backtest.openTrade,
      forcedCloseAtEnd: backtest.forcedCloseAtEnd
    },
    system: {
      positionOpen: backtest.openTrade,
      latestTransitionAction: backtest.latestTransitionAction,
      latestTransitionTimestamp:
        backtest.latestTransitionIndex == null
          ? null
          : new Date(candles[backtest.latestTransitionIndex].time).toISOString()
    },
    edgeGuardian: {
      gateAllow: edgeGuardian.gateAllow,
      gateReason: edgeGuardian.gateReason,
      expectedNetR: to2(edgeGuardian.expectedNetR),
      ci95LowR: to2(edgeGuardian.ci95LowR),
      ci95HighR: to2(edgeGuardian.ci95HighR),
      probabilityWinPct: to2(edgeGuardian.probabilityWinPct),
      probabilityPositivePct: to2(edgeGuardian.probabilityPositivePct),
      sampleSize: edgeGuardian.sampleSize,
      effectiveSampleSize: to2(edgeGuardian.effectiveSampleSize),
      walkForwardBrier: to2(edgeGuardian.walkForwardBrier),
      walkForwardSamples: edgeGuardian.walkForwardSamples,
      driftBaselineExpectancyR: to2(edgeGuardian.driftBaselineExpectancyR),
      driftRecentExpectancyR: to2(edgeGuardian.driftRecentExpectancyR),
      driftDeltaR: to2(edgeGuardian.driftDeltaR),
      driftDegraded: edgeGuardian.driftDegraded,
      riskMultiplier: to2(edgeGuardian.riskMultiplier),
      recommendedRiskPercent: to2(edgeGuardian.recommendedRiskPercent),
      throttleReason: edgeGuardian.throttleReason
    },
    holding: {
      enabled: holding,
      entryPrice: to2(entryPrice),
      pnlR: to2(heldPnlR)
    },
    quoteCurrency,
    warnings,
    reasons
  };
}

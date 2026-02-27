# Profit Improvement Plan

## Goal
Increase real-world reliability of the crypto signal engine by upgrading validation, execution realism, and risk controls before sizing up capital.

## Current Baseline
- Strategy logic is coherent, but sample sizes are often too small.
- Backtest evidence can be unstable across symbols/regimes.
- Execution assumptions are simplified versus live venue constraints.

## Phase 1 (Implemented): Validation Hardening
- Add out-of-sample (OOS) metrics derived from trade history.
- Integrate OOS evidence into Edge Guardian throttle and gate decisions.
- Surface OOS metrics in API/UI for operator visibility.
- Keep conservative defaults: block entries when OOS evidence is weak.

### Acceptance Criteria
- `edgeGuardian` exposes:
  - `oosTrainTrades`
  - `oosTrades`
  - `oosExpectancyR`
  - `oosWinRate`
  - `oosProfitFactor`
- Gate blocks when OOS evidence is insufficient/non-positive.
- Tests remain green.

## Phase 2: Execution Realism
- Model per-venue fees and symbol-level constraints (tick size, lot size, min notional).
- Improve slippage model using volatility/liquidity proxies.
- Add rejection states for non-executable position sizes.

### Acceptance Criteria
- Backtest can report net edge under configurable fee/slippage profiles.
- Signals include explicit execution feasibility checks.

## Phase 3: Regime and Universe Expansion
- Expand symbol universe beyond BTC/ETH/SOL with liquidity thresholds.
- Add regime tags (trend/chop/high-vol) and evaluate per-regime performance.
- Build cross-sectional diagnostics (symbol contribution to PnL, drawdown concentration).

### Acceptance Criteria
- Performance report includes regime-level and symbol-level breakdown.
- No single symbol dominates edge contribution beyond configured limits.

## Phase 4: Deployment Safety
- Add live-paper mode with order simulation and latency/cost logs.
- Introduce hard risk controls:
  - max daily drawdown
  - max correlated exposure
  - auto-throttle on edge degradation

### Acceptance Criteria
- Paper run stability over a fixed monitoring window.
- Automatic safety controls trigger correctly in stress scenarios.

## Monitoring Metrics (Always On)
- Net expectancy (R) and confidence bounds
- OOS expectancy and OOS win rate
- Walk-forward calibration error
- Drift delta vs baseline expectancy
- Drawdown, hit rate, and profit factor

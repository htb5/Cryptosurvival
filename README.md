# Crypto Signal Desk

Rule-based web app for spot crypto signals (`BUY` / `SELL` / `HOLD` / `ABSTAIN`) using live market data from trusted third-party providers:

- CoinGecko (default)
- Binance (fallback or direct)

## What it does

- Pulls daily OHLCV market data.
- Applies the strategy rules:
  - Trend filter: close above 200 SMA and 50 SMA rising.
  - Entry trigger: 20-day breakout + volume expansion + ADX trend-strength + volatility filter.
  - Risk plan: stop below swing low or 1.5 ATR, 2R TP1, trailing stop, position sizing by risk%.
  - Exit when holding: sell if close falls below trailing stop.
- Runs an **Edge Guardian** meta-layer that can block entries with `ABSTAIN` unless:
  - post-cost expected net `R` is positive,
  - the 95% confidence interval lower bound is positive,
  - probability of positive edge is high enough.
- Uses walk-forward calibration + drift detection to auto-throttle risk when edge quality degrades.
- Runs a built-in historical backtest (with fee/slippage assumptions) and computes confidence score.
- Scans BTC/ETH/SOL in one radar table so you can compare signals quickly.
- Uses provider fallback/caching and auto-selects the strongest fresh data source.
- Blocks `BUY` when account currency and price quote currency do not align.
- Uses browser alerts for BTC `BUY`/`SELL` events from the market radar.
- Supports Telegram alerts via `/api/alerts/btc` (cron-safe endpoint).
- Shows analysis in a browser dashboard with optional auto-refresh.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Run tests:

```bash
npm test
```

## API

`GET /api/analysis`

Query params:

- `symbol`: `BTC` | `ETH` | `SOL` (default `BTC`)
- `provider`: `auto` | `coingecko` | `binance` (default `auto`)
- `quote`: `gbp` | `usd` (default `usd`; UI is fixed to USD)
- `equity`: number, account size (default `1000`)
- `riskPercent`: number in `(0, 5]` (default `1.5`)
- `holding`: `true` | `false` (default `false`)
- `entryPrice`: required when `holding=true`

Example:

```bash
curl "http://localhost:3000/api/analysis?symbol=BTC&provider=auto&quote=usd&equity=1000&riskPercent=1.5&holding=false"
```

`GET /api/scan`

Query params:

- `provider`: `auto` | `coingecko` | `binance`
- `quote`: `gbp` | `usd`
- `equity`: number
- `riskPercent`: number in `(0, 5]`

Example:

```bash
curl "http://localhost:3000/api/scan?provider=auto&quote=usd&equity=1000&riskPercent=1.5"
```

## Notes

- This is a decision-support tool, not guaranteed profit.
- Spot-only logic, no leverage.
- If GBP conversion is rate-limited, Binance mode safely falls back to `USDT` quotes and reports a warning.
- If a requested provider fails, the API will use the other provider and report a warning.

## BTC Alerts

Browser alert:

- Enable `Alert me on BTC BUY/SELL` in the app UI.
- Keep the page open and allow browser notifications.

Telegram alert:

- Set env vars:
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`
  - `CRON_SECRET` (recommended; secures cron endpoint)
- If `CRON_SECRET` is changed in Vercel, redeploy production so the new value is active.
- Endpoint:
  - `GET /api/alerts/btc`
  - Optional `preview=true` to test without sending.
- The included Vercel cron in `vercel.json` runs daily (Hobby plan limit).
- Alert rules:
  - `BUY` only when a fresh model transition occurs and full entry gating still passes.
  - `SELL` on fresh model exit transitions.
  - Duplicate sends are suppressed in-memory for repeated same-candle checks.
  - If an alert should be sent but Telegram delivery fails, `/api/alerts/btc` returns non-OK so schedulers fail loudly.
- External scheduler included:
  - GitHub Actions workflow: `.github/workflows/btc-alert-cron.yml` (`*/15 * * * *`).
  - It reads GitHub secrets:
    - `ALERT_URL` = `https://cryptosurvival.vercel.app/api/alerts/btc`
    - `CRON_SECRET` = same value as Vercel `CRON_SECRET`
  - It calls `${ALERT_URL}?provider=auto&equity=1000&riskPercent=1.5` with header `x-cron-secret: ${CRON_SECRET}`.
  - It fails the run if an actionable signal is detected but Telegram delivery reports `sent: false`.
  - Once pushed to GitHub, the scheduler runs every 15 minutes automatically.

## Deploy to Vercel

```bash
npx vercel link --project cryptosurvival --scope harouts-projects-6ab63cc3
npx vercel deploy --prod --scope harouts-projects-6ab63cc3
```

# CryptoSurvival Session Handoff

## What This App Is
- Name: **Crypto Signal Desk / cryptosurvival**
- Type: Express web app for spot crypto decision support.
- Purpose:
  - Pull trusted third-party market data (CoinGecko/Binance).
  - Generate `BUY` / `SELL` / `HOLD` / `ABSTAIN` signals for BTC/ETH/SOL.
  - Show risk plan, backtest metrics, and Edge Guardian gating.
  - Send BTC buy/sell alerts (browser + Telegram via alert endpoint).

## Key Endpoints
- `GET /api/analysis`
- `GET /api/scan`
- `GET /api/alerts/btc`
- `GET /api/health`

## Current Production State
- URL: `https://cryptosurvival.vercel.app`
- Vercel project: `harouts-projects-6ab63cc3 / cryptosurvival`
- App is deployed and running.
- Price quote is USD in UI flow.
- Strategy + provider + alert logic include fallback and error visibility.

## GitHub Repo State
- Repo: `https://github.com/htb5/Cryptosurvival`
- Latest known pushed commit on `main`: `38dd6f3`
- Workflow: `.github/workflows/btc-alert-cron.yml` (`*/15 * * * *` + `workflow_dispatch`)
- GitHub Actions secrets configured:
  - `ALERT_URL`
  - `CRON_SECRET`
- Verified successful manual run:
  - `https://github.com/htb5/Cryptosurvival/actions/runs/22484291393`

## Recent Fixes (2026-02-27)
1. Rotated `CRON_SECRET` and synced it between Vercel and GitHub.
2. Ensured workflow sends `x-cron-secret` and uses `ALERT_URL` secret.
3. Redeployed production so updated Vercel env took effect.
4. Confirmed endpoint response in workflow logs includes `"ok": true`.

## What Still Needs To Be Verified
1. Observe the next scheduled (non-manual) GitHub run after the fix and confirm success.
2. Keep monitoring schedule cadence in Actions history.

## Security / Cleanup To Do
- Revoke/rotate any exposed credentials:
  - Telegram bot token (if previously shared in chat).
  - GitHub PAT used in chat.
- Keep secrets only in Vercel/GitHub Secrets, not in repo files.

## Useful Verification Commands
- App health:
  - `curl https://cryptosurvival.vercel.app/api/health`
- Alert endpoint preview (requires cron secret if auth enabled):
  - `curl "https://cryptosurvival.vercel.app/api/alerts/btc?preview=true&provider=auto&equity=1000&riskPercent=1.5&cronSecret=..."`
- Local tests:
  - `npm test`
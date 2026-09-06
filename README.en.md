# MadeClaw Online Server (Railway)

> **OOB public origin:** `https://madeclaw.up.railway.app`. Waffo (`WAFFO_MERCHANT_ID` / private key) is optional at boot — `/health` and ledger APIs start without it; checkout/pay return 503 until configured.

Self-contained **website + billing API + Waffo recharge** for MadeClaw operators.

Deploy this folder as the Railway app root (or as the GitHub repo root that Group 3 pushes to `coderwar021/madeclaw`).

Ledger is **MadeClaw-only** (`creditsMadeApiWallet: false`). Shares Waffo merchant with MadeAPI; never credits MadeAPI wallets.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/` | public | Landing |
| GET | `/recharge` | public | Recharge form (Chinese) |
| GET | `/pay?userId=&amountCents=` | public | Create Waffo checkout → 302 |
| GET | `/pay/success` | public | Post-pay page |
| GET | `/health` | public | Railway health |
| GET | `/v1/balance?userId=` | Bearer | Balance |
| POST | `/v1/credit` | Bearer | Ops/test credit |
| POST | `/v1/debit` | Bearer | Run fee debit (plugin today) |
| POST | `/v1/hold` | Bearer | Pre-debit reserve |
| POST | `/v1/capture` | Bearer | Finalize hold |
| POST | `/v1/release` | Bearer | Refund hold |
| POST | `/v1/checkout` | Bearer | Server-side checkout create |
| POST | `/v1/webhooks/waffo` | webhook secret | Paid → credit ledger |

Bearer: `Authorization: Bearer ${BILLING_SERVICE_TOKEN}`  
Webhook: `Authorization: Bearer ${WAFFO_WEBHOOK_SECRET}` or header `X-Webhook-Secret`

## Production hardening (vs local `billing/` prototype)

- **Auth fail-closed**: `NODE_ENV=production` requires `BILLING_SERVICE_TOKEN` at boot.
- **Webhook auth**: production requires `WAFFO_WEBHOOK_SECRET`; unauthenticated posts return 401.
- **`simulatePaid`**: only when `BILLING_ALLOW_SIMULATE=1` (keep unset in prod).
- **`/pay` owned here**: point `payBaseUrl` at this service — do not use Open WebUI.
- **Hold API**: prefer plugin pre-debit via `/v1/hold` + `/v1/capture`/`/v1/release` (see Group 2). Current plugin still balance-checks then post-run debits — race documented below.

### Post-run debit race (P0 documented)

Today `plugin/index.js` checks balance on `before_agent_run` and debits on `agent_end`. Two concurrent runs can both pass the check and overspend. Server now exposes hold/capture/release; **Group 2** should switch the plugin to:

1. `POST /v1/hold` with `ref=run:{runId}` in `before_agent_run` (block on 402)
2. `POST /v1/capture` on successful `agent_end`
3. `POST /v1/release` on failed/cancelled run

Until then, keep `runFeeCents` small and avoid heavy concurrency per `userId`.

## Env vars

See [`.env.example`](.env.example). Required on Railway:

| Variable | Notes |
| --- | --- |
| `PORT` | Railway sets automatically |
| `NODE_ENV` | `production` |
| `PUBLIC_BASE_URL` | `https://<your-domain>` (no trailing slash) |
| `BILLING_SERVICE_TOKEN` | Same value as MadeClaw plugin `serviceToken` |
| `BILLING_DB` | `/data/balance.json` with volume |
| `WAFFO_MERCHANT_ID` | Shared merchant id |
| `WAFFO_PRIVATE_KEY` | Full PEM (preferred on Railway) **or** mount file + `WAFFO_PRIVATE_KEY_PATH` |
| `WAFFO_STORE_ID` / `WAFFO_PRODUCT_ID` | Defaults in `.env.example` |
| `WAFFO_WEBHOOK_SECRET` | Set the same secret in Waffo dashboard / webhook URL query if needed |
| `BILLING_ALLOW_SIMULATE` | Must be `0` or unset in prod |

**Do not** commit PEM files, tokens, or MadeAPI keys.

### SQLite / persistence

Store is a **JSON file ledger** (portable, no native build). On Railway:

1. Create a Volume, mount path `/data`
2. Set `BILLING_DB=/data/balance.json`

Without a volume, balance is **ephemeral** (lost on redeploy). Postgres is not required.

## Railway deploy

1. Push this folder as the repo root (or set Railway Root Directory to `railway-app` if nested).
2. New Project → Deploy from GitHub (`coderwar021/madeclaw`).
3. Add variables from `.env.example` (real secrets in Railway UI only).
4. Add Volume `/data`.
5. In Waffo dashboard, webhook URL:  
   `https://<railway-domain>/v1/webhooks/waffo`  
   with `Authorization: Bearer <WAFFO_WEBHOOK_SECRET>` (or `?secret=` if the provider only supports query).
6. Confirm `GET https://<domain>/health` → `"creditsMadeApiWallet": false`.
7. Smoke recharge: open `/pay?userId=test&amountCents=100` (small live amount) or use `/recharge`.

### Dockerfile

```bash
docker build -t madeclaw-online .
docker run --rm -p 8787:8787 \
  -e BILLING_SERVICE_TOKEN=dev \
  -e WAFFO_WEBHOOK_SECRET=dev \
  -e WAFFO_MERCHANT_ID=... \
  -e WAFFO_PRIVATE_KEY="$(cat secrets/waffo-private.pem)" \
  -e PUBLIC_BASE_URL=http://127.0.0.1:8787 \
  -e BILLING_DB=/tmp/balance.json \
  -e NODE_ENV=production \
  madeclaw-online
```

## MadeClaw client wiring

Point **both** URLs at this host:

```json
{
  "billingBaseUrl": "https://<railway-domain>",
  "payBaseUrl": "https://<railway-domain>/pay",
  "serviceToken": "<same as BILLING_SERVICE_TOKEN>",
  "userId": "<per-operator id>"
}
```

Or env: `MADECLAW_PAY_URL=https://<railway-domain>/pay`.

After recharge + webhook, `madeclaw_balance` must match ledger deductions from `/v1/debit` (or hold/capture).

## Local

```bash
cd railway-app
cp .env.example .env
# fill WAFFO_PRIVATE_KEY_PATH or WAFFO_PRIVATE_KEY; for smoke no real Waffo needed
npm install
npm run smoke   # SMOKE_OK
NODE_ENV=development BILLING_REQUIRE_AUTH=1 npm start
```

## Group handoff

| Group | Owns |
| --- | --- |
| **1 (this)** | Deployable online server in this folder |
| **2** | Client/plugin: default `billingBaseUrl`/`payBaseUrl` → Railway domain; prefer hold/capture; ensure `userId` + `serviceToken` match |
| **3** | Git push to `git@github.com:coderwar021/madeclaw.git` (repo root = this app or documented subdirectory) |

## Related docs

- Parent contract: [`../PAY-CONTRACT.md`](../PAY-CONTRACT.md)
- Architecture: [`../ARCHITECTURE-billing.md`](../ARCHITECTURE-billing.md)
- Local prototype (non-prod): [`../billing/`](../billing/)

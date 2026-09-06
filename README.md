# MadeClaw Online Server (Railway)

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

- **Auth**: Bearer required when `BILLING_SERVICE_TOKEN` is set (or OOB default from `defaults.js`). Empty custom token falls back to the shared OOB token.
- **Webhook auth**: fail-closed at request time in production if `WAFFO_WEBHOOK_SECRET` unset (503); wrong secret → 401. Not required to boot.
- **Waffo checkout**: `WAFFO_MERCHANT_ID` / private key optional at boot — only `/pay` and `/v1/checkout` fail closed (503) when unset.
- **`simulatePaid`**: only when `BILLING_ALLOW_SIMULATE=1` (keep unset in prod).
- **`/pay` owned here**: point `payBaseUrl` at this service — do not use Open WebUI.
- **Hold API**: optional formal reserve (`/v1/hold` + capture/release). Current plugin (Group 2) already **pre-debits** via `POST /v1/debit` on `before_agent_run` with `ref=run:{runId}` and refunds failed runs — that closes the old post-run race when `runId` is present.

### Debit timing

Prefer gate-time debit (or hold) with idempotent `ref`. Do not rely on post-run-only debit.

## Env vars

See [`.env.example`](.env.example). Required on Railway:

| Variable | Notes |
| --- | --- |
| `PORT` | Railway sets automatically |
| `NODE_ENV` | `production` |
| `PUBLIC_BASE_URL` | Optional; defaults to `https://madeclaw.up.railway.app` (no trailing slash) |
| `BILLING_SERVICE_TOKEN` | Optional; defaults to OOB token in `src/defaults.js` (must match plugin `serviceToken`) |
| `BILLING_DB` | `/data/balance.json` with volume |
| `WAFFO_MERCHANT_ID` / `WAFFO_PRIVATE_KEY` | Optional at boot — `/health`, ledger APIs, and UI work without them; only `/pay` + `/v1/checkout` need them |
| `WAFFO_STORE_ID` / `WAFFO_PRODUCT_ID` | Defaults in `.env.example` |
| `WAFFO_WEBHOOK_SECRET` | Required for webhook credit path (request-time fail-closed in production); not required to boot |
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

`billingBaseUrl` and `payBaseUrl` must be the **same public origin** (no `/pay` suffix — plugin appends `/pay` and `/v1/*`):

```json
{
  "billingBaseUrl": "https://<railway-domain>",
  "payBaseUrl": "https://<railway-domain>",
  "serviceToken": "<same as BILLING_SERVICE_TOKEN>",
  "userId": "<per-operator id>"
}
```

Or env: `MADECLAW_PUBLIC_ORIGIN=https://<railway-domain>`.

After recharge + webhook, `madeclaw_balance` must match ledger deductions from `/v1/debit`.

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
| **2** | Client/plugin defaults → Railway origin; `serviceToken`/`userId` match; pre-debit already preferred |
| **3** | Git push to `git@github.com:coderwar021/madeclaw.git` (repo root = this app, or set Railway root to `railway-app`) |

## Related docs

- Parent contract: [`../PAY-CONTRACT.md`](../PAY-CONTRACT.md)
- Architecture: [`../ARCHITECTURE-billing.md`](../ARCHITECTURE-billing.md)
- Local prototype (non-prod): [`../billing/`](../billing/)

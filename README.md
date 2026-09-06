# MadeClaw Online Server (Railway)

Self-contained **website + auth + billing API + Waffo recharge** for MadeClaw.

Deploy this folder as the Railway app root (or GitHub repo root pushed to `coderwar021/madeclaw`).

Ledger is **MadeClaw-only** (`creditsMadeApiWallet: false`).

## Site pages

| Path | Purpose |
| --- | --- |
| `/` | Motion landing |
| `/features` | 功能介绍 |
| `/models` | 模型选项（MadeAPI 公开稳定 ID） |
| `/download` | 下载包 + **下载后怎么用** |
| `/login` `/register` `/account` | 账号（session cookie） |
| `/recharge` `/usage` | 充值 / 用量 |
| `/health` | Railway health |

Nav: **功能 / 模型 / 下载 / 充值 / 登录**

## Auth model

- **Register / login** with username (+ optional email) and password
- Passwords: **scrypt** hashes only (never plaintext)
- Session: opaque `mc_sid` **HttpOnly** cookie → `sessions` map in the same JSON store as the ledger (`BILLING_DB`, typically `/data/balance.json`)
- Each user gets a stable **`userId`** (`mc_…`) used by recharge, debit, and the App plugin
- Fail closed on bad credentials / missing session

## Downloads

Installer binaries are **too large for git / Railway image**. Defaults point at GitHub Releases:

- macOS DMG: `…/releases/download/v2026.8.1/MadeClaw-macOS-2026.8.1.dmg`
- Windows x64 / ARM64 Setup.exe（同 tag）

Checksums shipped in-repo: [`public/downloads/SHA256SUMS.txt`](public/downloads/SHA256SUMS.txt)  
API: `GET /v1/downloads` (override with `DOWNLOAD_MACOS_URL` / `DOWNLOAD_WINDOWS_*_URL`)

Upload assets once:

```bash
gh release create v2026.8.1 \
  --repo coderwar021/madeclaw \
  --title "MadeClaw 2026.8.1" \
  path/to/MadeClaw-macOS-2026.8.1.dmg \
  path/to/MadeClaw-Windows-x64-Setup.exe \
  path/to/MadeClaw-Windows-arm64-Setup.exe
```

## API (billing)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/balance?userId=` | Bearer | Balance |
| POST | `/v1/credit` `/v1/debit` | Bearer | Ledger |
| POST | `/v1/usage` · GET `/v1/usage` | Bearer | Token usage |
| POST/GET | `/v1/messages*` | Bearer | Inbox downlink |
| POST | `/v1/hold` `/v1/capture` `/v1/release` | Bearer | Pre-debit |
| POST | `/v1/checkout` | Bearer | Checkout |
| POST | `/v1/webhooks/waffo` | webhook secret | Paid → credit |
| POST | `/v1/auth/register` `/login` `/logout` | public | Site auth |
| GET | `/v1/auth/me` | session cookie | Current user |
| GET | `/v1/models` `/v1/downloads` | public | Catalogs |
| GET | `/pay?userId=&amountCents=` | public (+ session) | Waffo redirect |

Bearer: `BILLING_SERVICE_TOKEN` or OOB `MADECLAW_DEFAULT_SERVICE_TOKEN` (`madeclaw-oob-service-token-v1`).

## Production notes

- Waffo merchant/key **lazy**: boot without them; `/pay` + `/v1/checkout` fail closed if unset
- Webhook fail-closed in production if `WAFFO_WEBHOOK_SECRET` unset
- `simulatePaid` only when `BILLING_ALLOW_SIMULATE=1`
- Volume: mount `/data`, set `BILLING_DB=/data/balance.json`

## Railway: `WAFFO_PRIVATE_KEY` (critical)

OpenSSL `error:1E08010C:DECODER routines::unsupported` almost always means the PEM in Railway is malformed (literal `\n` not unescaped, missing `BEGIN`/`END`, truncated, or extra quotes).

1. In Railway → Variables, set **`WAFFO_PRIVATE_KEY`** to the **full** private key PEM.
2. Either paste **multiline** PEM, or one line with `\n` escapes between lines.
3. Headers must be `-----BEGIN PRIVATE KEY-----` (PKCS#8) or `-----BEGIN RSA PRIVATE KEY-----` (PKCS#1).
4. Also set `WAFFO_MERCHANT_ID` (and store/product IDs if not using defaults).
5. Redeploy. `/health` still boots if key is wrong; `/pay` returns a friendly Chinese error and logs the decode detail server-side.
6. Verify with `npm run test:waffo-key` locally (synthetic key only).

**Do not** commit real PEM files or paste merchant keys into git.

## Env

See [`.env.example`](.env.example). **Do not** commit PEM files, tokens, or MadeAPI keys.

## Local

```bash
npm install
npm run smoke   # SMOKE_OK
npm start
```

## Related

- Pay contract / architecture docs in the parent MadeClaw package when present
- Plugin `serviceToken` / `userId` must match this origin

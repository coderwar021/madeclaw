# MadeClaw 网站支付对接契约

## 账本不变量

**充值到账额度 = 可扣余额**

同一 `userId`、同一 MadeClaw ledger：

| 步骤 | 谁 | 调用 |
| --- | --- | --- |
| 支付成功 | Waffo webhook / simulate | credit `userId` |
| 查询 | 插件 `madeclaw_balance` | `GET /v1/balance?userId=` |
| 扣费 | 插件 `before_agent_run`（有 runId） | `POST /v1/debit` `{ userId, amountCents, ref }` |

`billingBaseUrl` 与 `payBaseUrl` 必须是**同一公开 origin**（无 path、无 `/pay`）。插件拼 `/pay` 与 `/v1/*`。

## 产品流

1. MadeClaw App / 工具 `madeclaw_recharge` 打开：  
   `{publicOrigin}/pay?userId={userId}&amountCents={n}`
2. 网站（或本 billing 自带的 `/pay`）创建 Waffo checkout 并 302。
3. 用户在 Waffo 完成支付。
4. Waffo Webhook → `POST {publicOrigin}/v1/webhooks/waffo` → **只** credit MadeClaw 账本。
5. 用户回到 MadeClaw App；`madeclaw_balance` 显示同一 `userId` 余额。

| 环境 | `billingBaseUrl` / `payBaseUrl`（相同） |
| --- | --- |
| **产品 OOB** | `https://madeclaw.up.railway.app` |
| 本机联调 | `http://127.0.0.1:8787`（`MADECLAW_PUBLIC_ORIGIN=…`） |

**禁止**再使用 `https://xuyc.up.railway.app/pay`（Open WebUI，不是 MadeClaw 账本）。

插件配置：`payBaseUrl` / `billingBaseUrl`；环境变量 `MADECLAW_PUBLIC_ORIGIN`（推荐）、`MADECLAW_BILLING_URL`、`MADECLAW_PAY_URL`。粘贴带 `/pay` 的 URL 时，插件与 apply 脚本会 strip 成 origin。

**开箱即用 serviceToken**：常量 `MADECLAW_DEFAULT_SERVICE_TOKEN` = `madeclaw-oob-service-token-v1`  
（插件默认、`railway-app` 在 `BILLING_SERVICE_TOKEN` 未设时回退、`.env.example` 一致）。可日后在 Railway Variables + 插件配置中更换。

运营步骤见 [`docs/OPERATOR-BALANCE.md`](docs/OPERATOR-BALANCE.md)。

## Billing API

| Method | Path | Auth | 说明 |
| --- | --- | --- | --- |
| GET | `/health` | 无 | 探活；`creditsMadeApiWallet: false` |
| GET | `/pay` | 无 | 网站入口；query: `userId`, `amountCents` |
| GET | `/usage` | 无 | Token 统计页（浏览器） |
| GET | `/v1/balance?userId=` | Bearer | 查余额（含 `usage` 汇总 + `inboxPending`） |
| POST | `/v1/credit` | Bearer | 入账（运维/测试/失败退款） |
| POST | `/v1/debit` | Bearer | 扣费（Gateway 插件；ref 幂等） |
| POST | `/v1/usage` | Bearer | 上报 token/usage（插件 `llm_output` / `agent_end`） |
| GET | `/v1/usage?userId=` | Bearer | 用量汇总 + 最近事件 |
| POST | `/v1/messages` | Bearer | 入队下传消息（运营/服务端） |
| GET | `/v1/messages/poll?userId=` | Bearer | 拉取未 ack 消息 |
| POST | `/v1/messages/ack` | Bearer | `{ userId, messageIds }` 确认已读 |
| POST | `/v1/hold` | Bearer | 预扣（推荐；见 railway-app） |
| POST | `/v1/capture` | Bearer | 确认预扣 |
| POST | `/v1/release` | Bearer | 释放预扣 |
| POST | `/v1/checkout` | Bearer | 服务端创建 checkout |
| POST | `/v1/webhooks/waffo` | Webhook Secret | 支付成功入账（生产必验） |

Bearer：`Authorization: Bearer {BILLING_SERVICE_TOKEN}` — 必须与插件 `serviceToken` 一致（OOB 见上）。  
Webhook：`Authorization: Bearer {WAFFO_WEBHOOK_SECRET}` 或 `X-Webhook-Secret`。  
线上可部署包：[`railway-app/`](railway-app/)（站点 + API + Dockerfile）。

### 插件工具

| Tool | 作用 |
| --- | --- |
| `madeclaw_balance` | 查余额（附带用量摘要 / 未读下传数） |
| `madeclaw_recharge` | 返回 `{origin}/pay?...` |
| `madeclaw_usage` | Token 统计 |
| `madeclaw_inbox` | 消息下传 poll + ack |

### Usage body（POST /v1/usage）

```json
{
  "userId": "local-operator",
  "runId": "…",
  "provider": "madeapi",
  "model": "gpt-5.6-luna",
  "inputTokens": 100,
  "outputTokens": 50,
  "ref": "usage:llm:…"
}
```

### 消息下传

```bash
# 入队
curl -sS -X POST "$ORIGIN/v1/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"userId":"local-operator","title":"公告","body":"你好 MadeClaw"}'

# 插件侧：madeclaw_inbox → GET /v1/messages/poll + POST /v1/messages/ack
```

## Checkout body（服务端）

```json
{
  "userId": "local-operator",
  "amountCents": 500,
  "currency": "USD",
  "successUrl": "https://yoursite/pay/success"
}
```

Waffo 侧使用共用 Merchant `MER_24yDgYwX9MaPwheVAyCk3d`；Store/商品默认 `STO_1WjWkflwKXm3BodanakF0J` + `PROD_3YaLDdlAPjTcANQOcxoo3G`。

metadata 固定：

```json
{
  "madeclawUserId": "<userId>",
  "balanceSystem": "madeclaw",
  "creditTarget": "madeclaw_balance"
}
```

## Webhook 期望

- 能匹配 `checkoutSessionId` / `sessionId` 到 pending checkout。
- 识别 paid/completed/succeeded 后 credit，幂等 `ref=waffo:{orderId|sessionId}`。
- 生产必须带 `WAFFO_WEBHOOK_SECRET`；未授权 → 401。
- `simulatePaid` **仅**当 `BILLING_ALLOW_SIMULATE=1`（生产关闭）。

## 网站侧最小实现（正式域名）

```
GET  /               → 落地页
GET  /recharge       → 充值表单
GET  /pay?userId=&amountCents=  → 创建 Waffo checkout → 302
POST (Waffo Dashboard)          → /v1/webhooks/waffo（带 secret）
GET  /pay/success               → 文案：可回 MadeClaw App
GET  /health                    → Railway 探活
```

正式实现：[`railway-app/`](railway-app/)。本机原型：[`billing/`](billing/)。

## 环境变量

见 [`railway-app/.env.example`](railway-app/.env.example)（线上）与 [`billing/.env.example`](billing/.env.example)（本机）。  
Railway 上 `PUBLIC_BASE_URL` 必须等于客户端配置的 origin；挂载 Volume `/data` 持久化 `BILLING_DB`。

## 与 MadeAPI 的边界

- 共用：Waffo 收款账号  
- 不共用：余额账本、用户订单  
- 不加 MadeAPI wallet 额度

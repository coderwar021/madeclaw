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
| 产品占位（Group 3 替换） | `https://YOUR-MADECLAW.up.railway.app` |
| 本机联调 | `http://127.0.0.1:8787` |

**禁止**再使用 `https://xuyc.up.railway.app/pay`（Open WebUI，不是 MadeClaw 账本）。

插件配置：`payBaseUrl` / `billingBaseUrl`；环境变量 `MADECLAW_PUBLIC_ORIGIN`（推荐）、`MADECLAW_BILLING_URL`、`MADECLAW_PAY_URL`。粘贴带 `/pay` 的 URL 时，插件与 apply 脚本会 strip 成 origin。

运营步骤见 [`docs/OPERATOR-BALANCE.md`](docs/OPERATOR-BALANCE.md)。

## Billing API

| Method | Path | Auth | 说明 |
| --- | --- | --- | --- |
| GET | `/health` | 无 | 探活；`creditsMadeApiWallet: false` |
| GET | `/pay` | 无 | 网站入口；query: `userId`, `amountCents` |
| GET | `/v1/balance?userId=` | Bearer | 查余额 |
| POST | `/v1/credit` | Bearer | 入账（运维/测试/失败退款） |
| POST | `/v1/debit` | Bearer | 扣费（Gateway 插件；ref 幂等） |
| POST | `/v1/checkout` | Bearer | 服务端创建 checkout |
| POST | `/v1/webhooks/waffo` | 无（建议后续加签） | 支付成功入账 |

Bearer：`Authorization: Bearer {BILLING_SERVICE_TOKEN}` — 必须与插件 `serviceToken` 一致。

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
- 开发可用：`{ "simulatePaid": true, "userId": "...", "amountCents": 100, "ref": "..." }`。

## 网站侧最小实现（正式域名）

```
GET  /pay?userId=&amountCents=  → 调 Billing POST /v1/checkout → 302 checkoutUrl
POST (Waffo Dashboard)          → Billing /v1/webhooks/waffo
GET  /pay/success               → 文案：可回 MadeClaw App（deep link 后续）
```

本仓库 billing 已内置同等 `/pay`，可直接当网站占位（与 API 同 origin）。

## 环境变量

见 [`billing/.env.example`](billing/.env.example)。Railway 上 `PUBLIC_BASE_URL` 必须等于客户端配置的 origin。

## 与 MadeAPI 的边界

- 共用：Waffo 收款账号  
- 不共用：余额账本、用户订单  
- 不加 MadeAPI wallet 额度

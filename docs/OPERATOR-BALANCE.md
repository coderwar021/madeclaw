# MadeClaw 运营：余额匹配（充值 = 可扣）

## 不变量

**充值到账额度 = 可扣余额**

同一 `userId` 贯穿：

1. 支付页 `GET {origin}/pay?userId=…&amountCents=…`
2. Waffo webhook → billing `credit(userId, amountCents)`（`creditTarget: madeclaw_balance`）
3. 插件 `madeclaw_balance` → `GET {origin}/v1/balance?userId=…`
4. 每次 MadeAPI 运行 → `POST {origin}/v1/debit` body `{ userId, amountCents: runFeeCents, ref: "run:…" }`

`billingBaseUrl` 与 `payBaseUrl` **必须是同一公开 origin**（不要带 `/pay`，不要指向 Open WebUI）。

| 错误配置 | 后果 |
| --- | --- |
| `payBaseUrl=https://xuyc.up.railway.app/pay` | 打开 Open WebUI，不是 MadeClaw 账本 |
| `billingBaseUrl` 与 `payBaseUrl` 不同 host | 付了款但 App 读到另一套余额 |
| `serviceToken` ≠ 服务器 `BILLING_SERVICE_TOKEN` | 401，无法查/扣余额 |
| Gateway `userId` ≠ 支付链接 `userId` | 钱进了别的账户 |

**产品 OOB：**

```text
https://madeclaw.up.railway.app
MADECLAW_DEFAULT_SERVICE_TOKEN=madeclaw-oob-service-token-v1
```

本机联调：

```text
http://127.0.0.1:8787
```

## 配置步骤

### 1. Billing 服务

```bash
cd .artifacts/local-packages/madeclaw/billing
cp .env.example .env   # 已有则可跳过
# 确认 BILLING_SERVICE_TOKEN=madeclaw-oob-service-token-v1（或与插件一致）
# Railway: PUBLIC_BASE_URL=https://madeclaw.up.railway.app
npm start
```

### 2. Gateway 插件配置（开箱即用，无需手填）

模板 / apply 脚本 / 插件代码默认：

```json
{
  "billingBaseUrl": "https://madeclaw.up.railway.app",
  "payBaseUrl": "https://madeclaw.up.railway.app",
  "serviceToken": "madeclaw-oob-service-token-v1",
  "userId": "local-operator",
  "runFeeCents": 1,
  "skipWhenCustomApi": true,
  "defaultPayAmountCents": 500
}
```

环境变量（apply 脚本）：

| Env | 作用 |
| --- | --- |
| `MADECLAW_PUBLIC_ORIGIN` | 同时设 billing + pay origin（推荐；默认已是 Railway） |
| `MADECLAW_BILLING_URL` | 备用；会 strip `/pay` |
| `MADECLAW_PAY_URL` | 仅当必须覆盖 pay origin |
| `BILLING_SERVICE_TOKEN` | 写入插件 `serviceToken`（默认 OOB 常量） |
| `MADECLAW_USER_ID` | 写入插件 `userId` |

### 3. 验证充值到账

```bash
# A) 模拟支付入账（需 BILLING_ALLOW_SIMULATE=1）
curl -sS -X POST "$ORIGIN/v1/webhooks/waffo" \
  -H 'content-type: application/json' \
  -d '{"simulatePaid":true,"userId":"local-operator","amountCents":500,"ref":"op-verify-1"}'

# B) 查余额（Bearer = serviceToken）
curl -sS "$ORIGIN/v1/balance?userId=local-operator" \
  -H "authorization: Bearer $BILLING_SERVICE_TOKEN"

# C) App / 工具 madeclaw_balance 应显示相同「分」数
# D) madeclaw_recharge 链接应是 $ORIGIN/pay?userId=… 而非 xuyc Open WebUI
# E) Token：madeclaw_usage / GET /v1/usage ；下传：madeclaw_inbox / POST /v1/messages
```

或：`node plugin/ledger-smoke.mjs`（credit → balance → debit，无真实支付）。

## 插件行为（匹配相关）

| 行为 | 说明 |
| --- | --- |
| 预扣 | `before_agent_run` 在有 `runId` 时直接 `debit`（避免跑完后 fail-open） |
| 失败退款 | `agent_end` 且 `success=false` 时 `credit` `refund:run:{runId}` |
| Token 统计 | `llm_output` / `agent_end` → `POST /v1/usage` |
| 消息下传 | `madeclaw_inbox` → poll + ack |
| 自备 API | `skipWhenCustomApi`：优先看 `ctx.modelProviderId !== madeapi`，否则看 primary |
| 余额工具 | `madeclaw_balance` **始终**读账本（不因自备 API 跳过），便于核对到账 |

## 已有本机配置（`~/.openclaw-madeclaw`）

若仍是旧的 `payBaseUrl: https://xuyc.up.railway.app/pay`，请改为与 `billingBaseUrl` 相同的 MadeClaw origin（OOB：`https://madeclaw.up.railway.app`）。**不要**用 Open WebUI 域名。改完重启 Gateway / App。

# MadeClaw 支付口径（最终）

与 MadeAPI **只共用 Waffo 收款账号**。  
**充值跳转网站**；日常在 MadeClaw App。余额服务见 `billing/`，对接见 `PAY-CONTRACT.md`。

**不变量：充值到账额度 = 可扣余额**（同一 `userId` 账本：webhook credit → balance → debit）。

```mermaid
flowchart TD
  app[MadeClaw_App]
  site[Website_or_billing_pay]
  waffo[Waffo_shared_merchant]
  billing[MadeClaw_Billing]
  app -->|recharge_same_origin_pay| site
  site --> waffo
  waffo -->|webhook| billing
  billing -->|credit_userId| billing
  app -->|balance_and_debit_userId| billing
```

`billingBaseUrl` ≡ `payBaseUrl` ≡ 公开 origin（占位 `https://YOUR-MADECLAW.up.railway.app`；本机 `http://127.0.0.1:8787`）。  
**不要**配置 `https://xuyc.up.railway.app/pay`（Open WebUI）。  
运营核对：[`docs/OPERATOR-BALANCE.md`](docs/OPERATOR-BALANCE.md)。  
白标 DMG 改名换标：Xcode 26.4+ 后续交付。

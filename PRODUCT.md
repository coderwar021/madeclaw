# MadeClaw 白标运行时

懒人式桌面产品：App 内使用；充值跳转网站；默认 MadeAPI；可自备 API。

## 目录

| 路径 | 作用 |
| --- | --- |
| `branding/` | 图标 JPG / ICNS |
| `config/openclaw.madeclaw.template.json` | 默认 Gateway 配置（MadeAPI + zh-CN + 插件） |
| `billing/` | 本机联调余额原型 |
| `railway-app/` | **线上站 + API + 充值**（Railway / GitHub 可部署） |
| `plugin/` | Gateway 扣费闸门插件 |
| `PAY-CONTRACT.md` | 网站 `/pay` + webhook 契约 |
| `ARCHITECTURE-billing.md` | 产品边界 |
| `docs/OPERATOR-BALANCE.md` | 运营：userId / token / 到账核对 |
| `scripts/apply-madeclaw-defaults.sh` | 写入 Gateway `openclaw.json` |

## 一键本地跑通

```bash
# 1) 余额服务
cd .artifacts/local-packages/madeclaw/billing
cp .env.example .env   # 已含本机 Waffo merchant 路径
npm install
npm run smoke          # 应打印 SMOKE_OK
npm start              # :8787

# 2) 写入 Gateway 配置（需 MADEAPI_API_KEY）
cd ..
cp config/secrets.example.env config/secrets.env
# 编辑 secrets.env
# 本机：MADECLAW_PUBLIC_ORIGIN=http://127.0.0.1:8787
# OOB 默认已是 https://madeclaw.up.railway.app（可不设）
./scripts/apply-madeclaw-defaults.sh

# 3) 重启 openclaw gateway / 桌面 App
node plugin/smoke.mjs         # PLUGIN_SMOKE_OK
node plugin/ledger-smoke.mjs  # LEDGER_SMOKE_OK（credit→balance→debit）
```

充值链接形态：`{origin}/pay?userId=local-operator&amountCents=500`  
**OOB 默认 origin**：`https://madeclaw.up.railway.app`  
**OOB serviceToken**：`MADECLAW_DEFAULT_SERVICE_TOKEN` = `madeclaw-oob-service-token-v1`  
**不要**再用 `https://xuyc.up.railway.app/pay`。

插件工具：`madeclaw_balance` / `madeclaw_recharge` / `madeclaw_usage` / `madeclaw_inbox`（消息下传）。

## 支付口径

- 与 MadeAPI **只共用** Waffo 收款账号  
- 余额是 MadeClaw 自己的（billing JSON 账本）  
- **不加** MadeAPI wallet  
- **充值到账额度 = 可扣余额**（同 userId）

## 安装包

- 上架：macOS `.dmg` / Windows `.exe`（见上级 `desktop/`）  
- 不上架 `.tgz`  
- **MadeClaw 改名换标 DMG**：需 **Xcode 26.4+** 另打；当前用官方包 + 本 seed 配置  

## 安全

- `config/secrets.env`、`waffo-private.pem`、billing `.env` 勿进公开安装包  
- 正式用户应有独立 `userId` / 登录态，不要共用一把平台 sk 给所有下载用户

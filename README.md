# MadeClaw 线上服务（Railway 部署）

本仓库是 **MadeClaw 官网 + 独立余额 API + Waffo 充值** 的可部署单元（Node.js / Docker）。

- 账本只属于 MadeClaw（`creditsMadeApiWallet: false`），**不会**给 MadeAPI / NewAPI 加余额
- 与 MadeAPI **只共用** Waffo 收款商户
- 适合作为 Railway 根目录一键部署

English notes: [README.en.md](README.en.md) · 契约: [docs-PAY-CONTRACT.md](docs-PAY-CONTRACT.md)

---

## Railway 部署清单（按顺序做）

1. 打开 [Railway](https://railway.app) → **New Project** → **Deploy from GitHub** → 选择本仓库 `coderwar021/madeclaw`
2. Build 方式：已提供 `Dockerfile` + `railway.toml`（健康检查 `/health`）
3. 在服务 **Variables** 中按下方表格填写环境变量（**不要**把真实密钥写进 Git）
4. 添加 **Volume**，挂载路径设为 `/data`（对应 `BILLING_DB=/data/balance.json`）
5. 部署成功后记下公网域名，例如 `https://xxxx.up.railway.app`
6. 在 Waffo 后台配置 Webhook：  
   `https://xxxx.up.railway.app/v1/webhooks/waffo`  
   请求头 `Authorization: Bearer <与 WAFFO_WEBHOOK_SECRET 相同>`
7. 浏览器访问 `https://xxxx.up.railway.app/health`，确认 JSON 中 `"creditsMadeApiWallet": false`
8. 小额试充：打开 `/recharge` 或 `/pay?userId=test&amountCents=100`
9. 把域名写回本机 MadeClaw 插件配置（见文末）

> 没有 Volume 时余额文件会在每次重新部署后丢失。

---

## 必须在 Railway 设置的环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | Railway 通常自动注入，可不管 |
| `NODE_ENV` | 填 `production` |
| `PUBLIC_BASE_URL` | `https://你的Railway域名`（**无**末尾斜杠） |
| `BILLING_DB` | `/data/balance.json` |
| `BILLING_SERVICE_TOKEN` | 自拟强随机串；与 MadeClaw 插件 `serviceToken` **必须相同** |
| `WAFFO_MERCHANT_ID` | Waffo 商户 ID |
| `WAFFO_PRIVATE_KEY` | 整段 PEM 私钥内容（推荐在 Railway 多行变量里粘贴） |
| `WAFFO_STORE_ID` | 店铺 ID（见 `.env.example` 默认值） |
| `WAFFO_PRODUCT_ID` | 商品 ID（见 `.env.example` 默认值） |
| `WAFFO_API_BASE` | 一般 `https://api.waffo.ai` |
| `WAFFO_WEBHOOK_SECRET` | 自拟；Webhook 鉴权用 |
| `BILLING_ALLOW_SIMULATE` | 生产环境务必 `0` 或不设置 |

可选：`PAY_SUCCESS_URL`、`WAFFO_PRIVATE_KEY_PATH`（仅本地文件路径调试用，Railway 优先用 `WAFFO_PRIVATE_KEY`）。

完整注释见 [`.env.example`](.env.example)。

**禁止提交**：`.env`、`*.pem`、真实 Token、MadeAPI 密钥。

---

## 主要接口

| 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| GET | `/` | 公开 | 落地页 |
| GET | `/recharge` | 公开 | 中文充值页 |
| GET | `/pay?userId=&amountCents=` | 公开 | 创建 Waffo 收银台并 302 |
| GET | `/pay/success` | 公开 | 支付完成页 |
| GET | `/health` | 公开 | 探活 |
| GET | `/v1/balance` | Bearer | 查余额 |
| POST | `/v1/credit` / `/v1/debit` | Bearer | 入账 / 扣费 |
| POST | `/v1/hold` / `/v1/capture` / `/v1/release` | Bearer | 预扣 / 确认 / 释放 |
| POST | `/v1/checkout` | Bearer | 服务端创建 checkout |
| POST | `/v1/webhooks/waffo` | Webhook Secret | 支付成功入账 |

Bearer：`Authorization: Bearer ${BILLING_SERVICE_TOKEN}`

---

## 拿到 Railway 域名后：MadeClaw 客户端怎么填

把下面的 `https://你的域名` 换成真实域名（无尾斜杠）：

```json
{
  "billingBaseUrl": "https://你的域名",
  "payBaseUrl": "https://你的域名/pay",
  "serviceToken": "<与 BILLING_SERVICE_TOKEN 相同>",
  "userId": "<每个用户独立的 id>"
}
```

或环境变量：`MADECLAW_PAY_URL=https://你的域名/pay`

插件参考代码见 `plugin-reference/`（跑在本机 Gateway，不是 Railway 容器内）。

---

## 本地试跑（可选）

```bash
cp .env.example .env
# 填写变量；本地可用 WAFFO_PRIVATE_KEY_PATH 指向私钥文件（不要提交该文件）
npm install
npm run smoke   # 期望打印 SMOKE_OK
npm start
```

Docker：

```bash
docker build -t madeclaw-online .
docker run --rm -p 8787:8787 \
  -e NODE_ENV=production \
  -e BILLING_SERVICE_TOKEN=dev \
  -e WAFFO_WEBHOOK_SECRET=dev \
  -e WAFFO_MERCHANT_ID=你的商户ID \
  -e WAFFO_PRIVATE_KEY="$(cat /path/to/waffo-private.pem)" \
  -e PUBLIC_BASE_URL=http://127.0.0.1:8787 \
  -e BILLING_DB=/tmp/balance.json \
  madeclaw-online
```

---

## 仓库内容

| 路径 | 说明 |
| --- | --- |
| `Dockerfile` / `railway.toml` | Railway 构建与健康检查 |
| `src/server.js` | 网站 + billing API |
| `public/` | 落地页 / 充值页 / 成功页 |
| `.env.example` | 环境变量模板 |
| `plugin-reference/` | MadeClaw Gateway 插件参考 |
| `docs-*.md` | 支付契约与架构说明 |

#!/usr/bin/env node
/**
 * Ledger matching smoke: credit → balance → debit for the same userId.
 * Spawns local billing (no real Waffo pay). Also asserts pay URL origin + /pay path.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginRoot = path.dirname(fileURLToPath(import.meta.url));
const billingRoot = path.resolve(pluginRoot, "../billing");
const port = 8792;
const base = `http://127.0.0.1:${port}`;
const dbPath = path.join(billingRoot, "data", `ledger-smoke-${process.pid}.json`);
const token = "ledger-smoke-token";
const userId = "ledger-smoke-user";

const { __test } = await import(pathToFileURL(path.join(pluginRoot, "index.js")).href);
const { normalizeConfig, payUrl, normalizePublicOrigin } = __test;

// --- URL / origin contract (no live server) ---
{
  const stripped = normalizePublicOrigin("https://xuyc.up.railway.app/pay", "http://127.0.0.1:8787");
  if (stripped !== "https://xuyc.up.railway.app") {
    throw new Error(`normalizePublicOrigin strip failed: ${stripped}`);
  }
  const cfg = normalizeConfig({
    billingBaseUrl: "https://YOUR-MADECLAW.up.railway.app/",
    payBaseUrl: "https://YOUR-MADECLAW.up.railway.app/pay",
    userId,
    defaultPayAmountCents: 500,
  });
  if (cfg.billingBaseUrl !== "https://YOUR-MADECLAW.up.railway.app") {
    throw new Error(`billingBaseUrl ${cfg.billingBaseUrl}`);
  }
  if (cfg.payBaseUrl !== "https://YOUR-MADECLAW.up.railway.app") {
    throw new Error(`payBaseUrl ${cfg.payBaseUrl}`);
  }
  const url = payUrl(cfg, 500);
  // URL() lowercases host; config may keep YOUR-MADECLAW for operator visibility.
  if (!/^https:\/\/your-madeclaw\.up\.railway\.app\/pay\?/i.test(url)) {
    throw new Error(`payUrl bad: ${url}`);
  }
  if (url.includes("xuyc.up.railway.app")) {
    throw new Error(`payUrl still points at Open WebUI: ${url}`);
  }
  const u = new URL(url);
  if (u.searchParams.get("userId") !== userId || u.searchParams.get("amountCents") !== "500") {
    throw new Error(`payUrl query: ${url}`);
  }
}

const child = spawn(process.execPath, ["src/server.js"], {
  cwd: billingRoot,
  env: {
    ...process.env,
    PORT: String(port),
    BILLING_DB: dbPath,
    BILLING_SERVICE_TOKEN: token,
    WAFFO_MERCHANT_ID: process.env.WAFFO_MERCHANT_ID || "MER_24yDgYwX9MaPwheVAyCk3d",
    WAFFO_PRIVATE_KEY_PATH: process.env.WAFFO_PRIVATE_KEY_PATH || "../config/waffo-private.pem",
    PUBLIC_BASE_URL: base,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

function authHeaders() {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return r.json();
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("billing did not become healthy");
}

async function main() {
  await waitHealth();

  // Simulate pay webhook credit (same path production uses after Waffo)
  let r = await fetch(`${base}/v1/webhooks/waffo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      simulatePaid: true,
      userId,
      amountCents: 200,
      ref: "ledger-smoke-pay-1",
    }),
  });
  let body = await r.json();
  if (!body.credited || body.balanceCents !== 200) {
    throw new Error(`webhook credit ${JSON.stringify(body)}`);
  }

  // Plugin-shaped balance read
  r = await fetch(`${base}/v1/balance?userId=${encodeURIComponent(userId)}`, {
    headers: authHeaders(),
  });
  body = await r.json();
  if (body.balanceCents !== 200) throw new Error(`balance after pay ${body.balanceCents}`);

  // Plugin-shaped debit (pre-run fee)
  r = await fetch(`${base}/v1/debit`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      userId,
      amountCents: 1,
      ref: "run:ledger-smoke-run-1",
      meta: { source: "madeclaw-billing-plugin" },
    }),
  });
  body = await r.json();
  if (body.balanceCents !== 199) throw new Error(`debit ${JSON.stringify(body)}`);

  // Idempotent same run ref
  r = await fetch(`${base}/v1/debit`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ userId, amountCents: 1, ref: "run:ledger-smoke-run-1" }),
  });
  body = await r.json();
  if (body.balanceCents !== 199) throw new Error(`idempotent ${body.balanceCents}`);

  // Failed-run refund shape
  r = await fetch(`${base}/v1/credit`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      userId,
      amountCents: 1,
      ref: "refund:run:ledger-smoke-run-1",
      meta: { reason: "agent_run_failed" },
    }),
  });
  body = await r.json();
  if (body.balanceCents !== 200) throw new Error(`refund ${body.balanceCents}`);

  console.log("LEDGER_SMOKE_OK", {
    userId,
    balanceCents: body.balanceCents,
    invariant: "充值到账额度 = 可扣余额",
    payUrl: payUrl(
      normalizeConfig({
        billingBaseUrl: base,
        payBaseUrl: base,
        userId,
        serviceToken: token,
      }),
    ),
  });
}

main()
  .catch((err) => {
    console.error("LEDGER_SMOKE_FAILED", err);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill("SIGTERM");
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

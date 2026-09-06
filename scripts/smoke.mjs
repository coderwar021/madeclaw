#!/usr/bin/env node
/**
 * Smoke without live Waffo: health, auth, credit/debit/hold, webhook gate + simulate.
 * Generates an ephemeral RSA key so CI/local runs need no real PEM.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8792;
const base = `http://127.0.0.1:${port}`;
const dbPath = path.join(root, "data", `smoke-${process.pid}.json`);
const keyPath = path.join(root, "data", `smoke-key-${process.pid}.pem`);
const token = "smoke-token";
const webhookSecret = "smoke-webhook";

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));

const child = spawn(process.execPath, ["src/server.js"], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(port),
    BILLING_DB: dbPath,
    BILLING_SERVICE_TOKEN: token,
    BILLING_REQUIRE_AUTH: "1",
    BILLING_ALLOW_SIMULATE: "1",
    WAFFO_MERCHANT_ID: "MER_smoke",
    WAFFO_PRIVATE_KEY_PATH: keyPath,
    WAFFO_WEBHOOK_SECRET: webhookSecret,
    PUBLIC_BASE_URL: base,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (c) => {
  stderr += c.toString();
});

function authHeaders() {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

async function waitHealth() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return r.json();
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`billing did not become healthy: ${stderr.slice(-500)}`);
}

async function main() {
  const health = await waitHealth();
  if (!health.ok || health.creditsMadeApiWallet !== false) {
    throw new Error(`bad health: ${JSON.stringify(health)}`);
  }
  if (health.service !== "madeclaw-online-server") {
    throw new Error(`unexpected service ${health.service}`);
  }

  const home = await fetch(`${base}/`);
  if (!home.ok || !(await home.text()).includes("MadeClaw")) {
    throw new Error("landing page missing");
  }

  for (const path of ["/download", "/features", "/models", "/login", "/register"]) {
    const page = await fetch(`${base}${path}`);
    if (!page.ok) throw new Error(`page ${path} status ${page.status}`);
  }

  const dl = await fetch(`${base}/v1/downloads`);
  const dlBody = await dl.json();
  if (!dlBody.platforms?.some((p) => p.id === "macos" && p.url)) {
    throw new Error(`downloads catalog bad: ${JSON.stringify(dlBody)}`);
  }

  // Site auth: register → me → logout
  let r;
  const authUser = `smoke_${process.pid}`;
  const authPass = "smoke-pass-ok";
  r = await fetch(`${base}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: authUser, password: authPass }),
  });
  if (!r.ok) throw new Error(`register failed ${await r.text()}`);
  const reg = await r.json();
  if (!reg.user?.userId?.startsWith("mc_")) throw new Error(`bad userId ${reg.user?.userId}`);
  const setCookie = r.headers.getSetCookie?.() || [];
  const cookieHeader =
    setCookie.map((c) => c.split(";")[0]).join("; ") ||
    (() => {
      const raw = r.headers.get("set-cookie");
      return raw ? raw.split(";")[0] : "";
    })();
  if (!cookieHeader) throw new Error("missing session cookie");

  r = await fetch(`${base}/v1/auth/me`, { headers: { cookie: cookieHeader } });
  if (!r.ok) throw new Error(`me failed ${await r.text()}`);
  const me = await r.json();
  if (me.user.userId !== reg.user.userId) throw new Error("me user mismatch");

  r = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: authUser, password: "wrong-password" }),
  });
  if (r.status !== 401) throw new Error(`expected login 401 got ${r.status}`);

  // Unauthorized balance
  r = await fetch(`${base}/v1/balance?userId=x`);
  if (r.status !== 401) throw new Error(`expected 401 balance, got ${r.status}`);

  const userId = "smoke-user";
  r = await fetch(`${base}/v1/credit`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ userId, amountCents: 100, ref: "smoke-credit-1" }),
  });
  if (!r.ok) throw new Error(`credit failed ${await r.text()}`);
  let body = await r.json();
  if (body.balanceCents !== 100) throw new Error(`credit balance ${body.balanceCents}`);

  r = await fetch(`${base}/v1/balance?userId=${encodeURIComponent(userId)}`, {
    headers: authHeaders(),
  });
  body = await r.json();
  if (body.balanceCents !== 100) throw new Error(`balance ${body.balanceCents}`);

  r = await fetch(`${base}/v1/debit`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ userId, amountCents: 1, ref: "smoke-run-1" }),
  });
  body = await r.json();
  if (body.balanceCents !== 99) throw new Error(`debit balance ${body.balanceCents}`);

  // Hold / capture / release path
  r = await fetch(`${base}/v1/hold`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ userId, amountCents: 10, ref: "smoke-hold-1" }),
  });
  body = await r.json();
  if (body.balanceCents !== 89) throw new Error(`hold balance ${body.balanceCents}`);

  r = await fetch(`${base}/v1/capture`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ref: "smoke-hold-1" }),
  });
  body = await r.json();
  if (body.status !== "captured") throw new Error(`capture ${JSON.stringify(body)}`);

  r = await fetch(`${base}/v1/hold`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ userId, amountCents: 5, ref: "smoke-hold-2" }),
  });
  if (!r.ok) throw new Error(`hold2 ${await r.text()}`);
  r = await fetch(`${base}/v1/release`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ref: "smoke-hold-2" }),
  });
  body = await r.json();
  if (body.balanceCents !== 89) throw new Error(`release balance ${body.balanceCents}`);

  // Webhook without secret → 401
  r = await fetch(`${base}/v1/webhooks/waffo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ simulatePaid: true, userId, amountCents: 1 }),
  });
  if (r.status !== 401) throw new Error(`webhook unauth expected 401 got ${r.status}`);

  r = await fetch(`${base}/v1/webhooks/waffo`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${webhookSecret}`,
    },
    body: JSON.stringify({
      simulatePaid: true,
      userId,
      amountCents: 50,
      ref: "smoke-sim-1",
    }),
  });
  body = await r.json();
  if (!body.credited || body.balanceCents !== 139) {
    throw new Error(`simulate webhook ${JSON.stringify(body)}`);
  }

  console.log("SMOKE_OK", {
    balanceCents: body.balanceCents,
    service: health.service,
    creditsMadeApiWallet: health.creditsMadeApiWallet,
  });
}

main()
  .catch((err) => {
    console.error("SMOKE_FAILED", err);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill("SIGTERM");
    for (const p of [dbPath, keyPath]) {
      try {
        fs.unlinkSync(p);
      } catch {
        // ignore
      }
    }
  });

/**
 * MadeClaw online server — public site + billing API + Waffo recharge.
 * Credits ONLY this MadeClaw ledger (creditsMadeApiWallet: false). Never MadeAPI wallets.
 *
 * Production hardening vs local billing prototype:
 * - Bearer: BILLING_SERVICE_TOKEN or MADECLAW_DEFAULT_SERVICE_TOKEN (OOB)
 * - Webhook auth fail-closed at request time in production if secret unset
 * - Waffo merchant/key optional at boot; /pay and /v1/checkout fail closed if unset
 * - simulatePaid disabled unless BILLING_ALLOW_SIMULATE=1
 * - Token usage (/v1/usage) + message downlink (/v1/messages/*)
 * - Optional hold/capture/release for pre-debit (plugin should migrate; see README)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  MADECLAW_DEFAULT_SERVICE_TOKEN,
  MADECLAW_PUBLIC_ORIGIN,
} from "./defaults.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnvFile(path.join(appRoot, ".env"));

const PORT = Number(process.env.PORT || 8787);
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";
const DB_PATH = path.resolve(appRoot, process.env.BILLING_DB || "./data/balance.json");
const MERCHANT_ID = process.env.WAFFO_MERCHANT_ID || "";
const STORE_ID = process.env.WAFFO_STORE_ID || "STO_1WjWkflwKXm3BodanakF0J";
const PRODUCT_ID = process.env.WAFFO_PRODUCT_ID || "PROD_3YaLDdlAPjTcANQOcxoo3G";
const API_BASE = (process.env.WAFFO_API_BASE || "https://api.waffo.ai").replace(/\/$/, "");
// OOB: product default when BILLING_SERVICE_TOKEN unset — must match plugin serviceToken.
const SERVICE_TOKEN =
  (process.env.BILLING_SERVICE_TOKEN || "").trim() || MADECLAW_DEFAULT_SERVICE_TOKEN;
const WEBHOOK_SECRET = process.env.WAFFO_WEBHOOK_SECRET || "";
const ALLOW_SIMULATE = process.env.BILLING_ALLOW_SIMULATE === "1";
const REQUIRE_AUTH =
  process.env.BILLING_REQUIRE_AUTH === "1" ||
  (IS_PROD && process.env.BILLING_REQUIRE_AUTH !== "0");
// Railway OOB origin; override with PUBLIC_BASE_URL (no trailing slash).
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || MADECLAW_PUBLIC_ORIGIN).replace(/\/$/, "");
const PAY_SUCCESS_URL = process.env.PAY_SUCCESS_URL || `${PUBLIC_BASE}/pay/success`;

/** Lazy: Waffo is optional at boot; only checkout/pay requires merchant + key. */
let cachedPrivateKey = null;

function resolvePrivateKey() {
  const inline = process.env.WAFFO_PRIVATE_KEY || "";
  if (inline.trim()) {
    return inline.replace(/\\n/g, "\n");
  }
  const keyPath = path.resolve(
    appRoot,
    process.env.WAFFO_PRIVATE_KEY_PATH || "./secrets/waffo-private.pem",
  );
  if (!fs.existsSync(keyPath)) {
    const err = new Error(
      `WAFFO private key missing: set WAFFO_PRIVATE_KEY or WAFFO_PRIVATE_KEY_PATH (${keyPath})`,
    );
    err.code = "waffo_not_configured";
    err.status = 503;
    throw err;
  }
  return fs.readFileSync(keyPath, "utf8");
}

function getPrivateKey() {
  if (cachedPrivateKey) return cachedPrivateKey;
  cachedPrivateKey = resolvePrivateKey();
  return cachedPrivateKey;
}

function isWaffoConfigured() {
  if (!MERCHANT_ID) return false;
  if ((process.env.WAFFO_PRIVATE_KEY || "").trim()) return true;
  const keyPath = path.resolve(
    appRoot,
    process.env.WAFFO_PRIVATE_KEY_PATH || "./secrets/waffo-private.pem",
  );
  return fs.existsSync(keyPath);
}

function assertWaffoConfigured() {
  if (!MERCHANT_ID) {
    const err = new Error(
      "WAFFO_MERCHANT_ID is not configured — set Railway env vars to enable checkout",
    );
    err.code = "waffo_not_configured";
    err.status = 503;
    throw err;
  }
  getPrivateKey();
}

// Boot does not require WAFFO_* or webhook secret. Auth uses env or OOB default token.
// Webhook fail-closed at request time (requireWebhookAuth) when secret unset in production.

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

/** @typedef {{
 *   accounts: Record<string,{balanceCents:number,updatedAt:string}>,
 *   ledger: Array<Record<string,unknown>>,
 *   checkouts: Record<string,Record<string,unknown>>,
 *   ledgerRefs: Record<string,true>,
 *   holds: Record<string,{userId:string,amountCents:number,createdAt:string,meta?:unknown}>,
 *   usage: Array<Record<string,unknown>>,
 *   usageRefs: Record<string,true>,
 *   messages: Array<Record<string,unknown>>
 * }} Store */

const MAX_USAGE_EVENTS = 5000;
const MAX_INBOX_MESSAGES = 2000;

function emptyStore() {
  return {
    accounts: {},
    ledger: [],
    checkouts: {},
    ledgerRefs: {},
    holds: {},
    usage: [],
    usageRefs: {},
    messages: [],
  };
}

function loadStore() {
  if (!fs.existsSync(DB_PATH)) return emptyStore();
  try {
    const raw = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    return {
      accounts: raw.accounts || {},
      ledger: Array.isArray(raw.ledger) ? raw.ledger : [],
      checkouts: raw.checkouts || {},
      ledgerRefs: raw.ledgerRefs || {},
      holds: raw.holds || {},
      usage: Array.isArray(raw.usage) ? raw.usage : [],
      usageRefs: raw.usageRefs || {},
      messages: Array.isArray(raw.messages) ? raw.messages : [],
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(store) {
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

function now() {
  return new Date().toISOString();
}

function requireServiceAuth(req, res, next) {
  if (!SERVICE_TOKEN) {
    if (REQUIRE_AUTH) {
      res.status(503).json({ error: "service_token_not_configured" });
      return;
    }
    return next();
  }
  const got = req.get("authorization") || "";
  if (got !== `Bearer ${SERVICE_TOKEN}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

function timingSafeEqualString(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function requireWebhookAuth(req, res, next) {
  if (!WEBHOOK_SECRET) {
    if (IS_PROD) {
      res.status(503).json({ error: "webhook_secret_not_configured" });
      return;
    }
    // Local/dev without secret: allow (smoke). Production refuses above.
    return next();
  }
  const auth = req.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const headerSecret = req.get("x-webhook-secret") || req.get("x-waffo-webhook-secret") || "";
  const querySecret = typeof req.query.secret === "string" ? req.query.secret : "";
  const ok =
    timingSafeEqualString(bearer, WEBHOOK_SECRET) ||
    timingSafeEqualString(headerSecret, WEBHOOK_SECRET) ||
    timingSafeEqualString(querySecret, WEBHOOK_SECRET);
  if (!ok) {
    res.status(401).json({ error: "webhook_unauthorized" });
    return;
  }
  next();
}

function getBalance(store, userId) {
  return store.accounts[userId]?.balanceCents ?? 0;
}

function credit(userId, amountCents, ref, meta) {
  if (amountCents <= 0) throw new Error("amount must be positive");
  const store = loadStore();
  if (ref && store.ledgerRefs[ref]) return getBalance(store, userId);
  const after = getBalance(store, userId) + amountCents;
  store.accounts[userId] = { balanceCents: after, updatedAt: now() };
  store.ledger.push({
    id: crypto.randomUUID(),
    userId,
    kind: "credit",
    amountCents,
    balanceAfter: after,
    ref: ref ?? null,
    meta: meta ?? {},
    createdAt: now(),
  });
  if (ref) store.ledgerRefs[ref] = true;
  saveStore(store);
  return after;
}

function debit(userId, amountCents, ref, meta) {
  if (amountCents <= 0) throw new Error("amount must be positive");
  const store = loadStore();
  if (ref && store.ledgerRefs[ref]) return getBalance(store, userId);
  const current = getBalance(store, userId);
  if (current < amountCents) {
    const err = new Error("insufficient_balance");
    err.code = "insufficient_balance";
    err.balance = current;
    throw err;
  }
  const after = current - amountCents;
  store.accounts[userId] = { balanceCents: after, updatedAt: now() };
  store.ledger.push({
    id: crypto.randomUUID(),
    userId,
    kind: "debit",
    amountCents,
    balanceAfter: after,
    ref: ref ?? null,
    meta: meta ?? {},
    createdAt: now(),
  });
  if (ref) store.ledgerRefs[ref] = true;
  saveStore(store);
  return after;
}

/**
 * Pre-debit hold: atomically reserves funds so concurrent runs cannot both pass a balance check.
 * Plugin should call hold in before_agent_run, then capture on success / release on failure.
 */
function hold(userId, amountCents, ref, meta) {
  if (!ref) throw new Error("hold ref required");
  if (amountCents <= 0) throw new Error("amount must be positive");
  const store = loadStore();
  if (store.holds[ref] || store.ledgerRefs[`hold:${ref}`]) {
    return { balanceCents: getBalance(store, userId), holdRef: ref, status: "already_held" };
  }
  const current = getBalance(store, userId);
  if (current < amountCents) {
    const err = new Error("insufficient_balance");
    err.code = "insufficient_balance";
    err.balance = current;
    throw err;
  }
  const after = current - amountCents;
  store.accounts[userId] = { balanceCents: after, updatedAt: now() };
  store.holds[ref] = { userId, amountCents, createdAt: now(), meta: meta ?? {} };
  store.ledger.push({
    id: crypto.randomUUID(),
    userId,
    kind: "hold",
    amountCents,
    balanceAfter: after,
    ref,
    meta: meta ?? {},
    createdAt: now(),
  });
  store.ledgerRefs[`hold:${ref}`] = true;
  saveStore(store);
  return { balanceCents: after, holdRef: ref, status: "held" };
}

function captureHold(ref) {
  const store = loadStore();
  const row = store.holds[ref];
  if (!row) {
    if (store.ledgerRefs[`capture:${ref}`]) {
      return { status: "already_captured", balanceCents: null };
    }
    const err = new Error("hold_not_found");
    err.code = "hold_not_found";
    throw err;
  }
  delete store.holds[ref];
  store.ledger.push({
    id: crypto.randomUUID(),
    userId: row.userId,
    kind: "capture",
    amountCents: row.amountCents,
    balanceAfter: getBalance(store, row.userId),
    ref,
    meta: { fromHold: true },
    createdAt: now(),
  });
  store.ledgerRefs[`capture:${ref}`] = true;
  // Final debit identity: same ref as run id so post-run debit stays idempotent if both paths used.
  store.ledgerRefs[ref] = true;
  saveStore(store);
  return { status: "captured", userId: row.userId, amountCents: row.amountCents, balanceCents: getBalance(store, row.userId) };
}

function releaseHold(ref) {
  const store = loadStore();
  const row = store.holds[ref];
  if (!row) {
    if (store.ledgerRefs[`release:${ref}`]) {
      return { status: "already_released", balanceCents: null };
    }
    const err = new Error("hold_not_found");
    err.code = "hold_not_found";
    throw err;
  }
  delete store.holds[ref];
  const after = getBalance(store, row.userId) + row.amountCents;
  store.accounts[row.userId] = { balanceCents: after, updatedAt: now() };
  store.ledger.push({
    id: crypto.randomUUID(),
    userId: row.userId,
    kind: "release",
    amountCents: row.amountCents,
    balanceAfter: after,
    ref,
    meta: { fromHold: true },
    createdAt: now(),
  });
  store.ledgerRefs[`release:${ref}`] = true;
  saveStore(store);
  return { status: "released", userId: row.userId, balanceCents: after };
}

function nTokens(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function summarizeUsage(store, userId) {
  const rows = store.usage.filter((u) => u.userId === userId);
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalTokens = 0;
  let events = 0;
  for (const u of rows) {
    events += 1;
    inputTokens += nTokens(u.inputTokens);
    outputTokens += nTokens(u.outputTokens);
    cacheReadTokens += nTokens(u.cacheReadTokens);
    cacheWriteTokens += nTokens(u.cacheWriteTokens);
    totalTokens += nTokens(u.totalTokens);
  }
  if (totalTokens === 0) totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  return {
    events,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
  };
}

/** Record token/usage event. Idempotent when ref set. */
function recordUsage(payload) {
  const userId = String(payload.userId || "");
  if (!userId) throw new Error("userId required");
  const ref = payload.ref ? String(payload.ref) : "";
  const store = loadStore();
  if (ref && store.usageRefs[ref]) {
    return { ok: true, duplicate: true, usage: summarizeUsage(store, userId) };
  }
  const inputTokens = nTokens(payload.inputTokens ?? payload.input);
  const outputTokens = nTokens(payload.outputTokens ?? payload.output);
  const cacheReadTokens = nTokens(payload.cacheReadTokens ?? payload.cacheRead);
  const cacheWriteTokens = nTokens(payload.cacheWriteTokens ?? payload.cacheWrite);
  let totalTokens = nTokens(payload.totalTokens ?? payload.total);
  if (!totalTokens) {
    totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  }
  const row = {
    id: crypto.randomUUID(),
    userId,
    runId: payload.runId ? String(payload.runId) : null,
    provider: payload.provider ? String(payload.provider) : null,
    model: payload.model ? String(payload.model) : null,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    ref: ref || null,
    meta: payload.meta && typeof payload.meta === "object" ? payload.meta : {},
    createdAt: now(),
  };
  store.usage.push(row);
  if (ref) store.usageRefs[ref] = true;
  if (store.usage.length > MAX_USAGE_EVENTS) {
    store.usage = store.usage.slice(-MAX_USAGE_EVENTS);
  }
  saveStore(store);
  return { ok: true, event: row, usage: summarizeUsage(store, userId) };
}

function enqueueMessage({ userId, title, body, meta }) {
  const uid = String(userId || "");
  if (!uid) throw new Error("userId required");
  const text = String(body || "").trim();
  if (!text) throw new Error("body required");
  const store = loadStore();
  const row = {
    id: crypto.randomUUID(),
    userId: uid,
    title: title ? String(title).slice(0, 200) : null,
    body: text.slice(0, 8000),
    meta: meta && typeof meta === "object" ? meta : {},
    createdAt: now(),
    ackedAt: null,
  };
  store.messages.push(row);
  if (store.messages.length > MAX_INBOX_MESSAGES) {
    store.messages = store.messages.slice(-MAX_INBOX_MESSAGES);
  }
  saveStore(store);
  return row;
}

function pollMessages(userId, { limit = 20, includeAcked = false } = {}) {
  const uid = String(userId || "");
  const store = loadStore();
  const cap = Math.min(100, Math.max(1, Number(limit) || 20));
  const pending = store.messages.filter(
    (m) => m.userId === uid && (includeAcked || !m.ackedAt),
  );
  return pending.slice(0, cap);
}

function ackMessages(userId, messageIds) {
  const uid = String(userId || "");
  const ids = Array.isArray(messageIds)
    ? messageIds.map((id) => String(id)).filter(Boolean)
    : [];
  if (!uid || ids.length === 0) {
    throw new Error("userId and messageIds required");
  }
  const want = new Set(ids);
  const store = loadStore();
  let acked = 0;
  const ts = now();
  for (const m of store.messages) {
    if (m.userId === uid && want.has(m.id) && !m.ackedAt) {
      m.ackedAt = ts;
      acked += 1;
    }
  }
  saveStore(store);
  return { acked, remaining: pollMessages(uid).length };
}

async function waffoSigned(method, apiPath, bodyObj) {
  assertWaffoConfigured();
  const bodyStr = bodyObj === undefined ? "" : JSON.stringify(bodyObj);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = crypto.createHash("sha256").update(bodyStr).digest("base64");
  const canonical = `${method}\n${apiPath}\n${timestamp}\n${bodyHash}`;
  const signature = crypto
    .sign("sha256", Buffer.from(canonical), getPrivateKey())
    .toString("base64");
  const res = await fetch(`${API_BASE}${apiPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Merchant-Id": MERCHANT_ID,
      "X-Timestamp": timestamp,
      "X-Signature": signature,
    },
    body: bodyObj === undefined ? undefined : bodyStr,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`waffo ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function extractSession(created) {
  const session = created?.data?.session || created?.session || created?.data || created;
  return {
    sessionId: session?.sessionId || session?.id,
    checkoutUrl: session?.checkoutUrl || session?.url,
  };
}

async function createCheckoutSession({ userId, amountCents, currency, successUrl }) {
  assertWaffoConfigured();
  const amount = (amountCents / 100).toFixed(2);
  const created = await waffoSigned("POST", "/v1/actions/checkout/create-session", {
    storeId: STORE_ID,
    productId: PRODUCT_ID,
    productType: "onetime",
    currency,
    priceSnapshot: {
      [currency]: { amount, taxIncluded: false, taxCategory: "saas" },
    },
    metadata: {
      madeclawUserId: userId,
      balanceSystem: "madeclaw",
      creditTarget: "madeclaw_balance",
    },
    successUrl: successUrl || PAY_SUCCESS_URL,
  });
  const { sessionId, checkoutUrl } = extractSession(created);
  if (!sessionId) {
    const err = new Error("waffo_session_missing");
    err.body = created;
    throw err;
  }
  const store = loadStore();
  store.checkouts[sessionId] = {
    sessionId,
    userId,
    amountCents,
    currency,
    status: "pending",
    checkoutUrl: checkoutUrl || null,
    createdAt: now(),
    updatedAt: now(),
  };
  saveStore(store);
  return { sessionId, checkoutUrl, amountCents, currency, created };
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(appRoot, "public"), { index: false }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "madeclaw-online-server",
    creditsMadeApiWallet: false,
    storeId: STORE_ID,
    productId: PRODUCT_ID,
    waffoConfigured: isWaffoConfigured(),
    authRequired: Boolean(SERVICE_TOKEN) || REQUIRE_AUTH,
    webhookAuthRequired: Boolean(WEBHOOK_SECRET) || IS_PROD,
    simulateAllowed: ALLOW_SIMULATE,
    publicBase: PUBLIC_BASE,
  });
});

const publicRoot = path.join(appRoot, "public");

function sendPublic(res, name) {
  res.sendFile(name, { root: publicRoot });
}

app.get("/", (_req, res) => {
  sendPublic(res, "index.html");
});

app.get("/recharge", (_req, res) => {
  sendPublic(res, "recharge.html");
});

app.get("/usage", (_req, res) => {
  sendPublic(res, "usage.html");
});

app.get("/pay/success", (_req, res) => {
  sendPublic(res, "success.html");
});

// Compat alias used by older PAY_SUCCESS_URL defaults
app.get("/v1/pay/success", (_req, res) => {
  res.redirect(302, "/pay/success");
});

app.get("/v1/balance", requireServiceAuth, (req, res) => {
  const userId = String(req.query.userId || "");
  if (!userId) return res.status(400).json({ error: "userId required" });
  const store = loadStore();
  res.json({
    userId,
    balanceCents: getBalance(store, userId),
    currency: "USD",
    creditTarget: "madeclaw_balance",
    usage: summarizeUsage(store, userId),
    inboxPending: pollMessages(userId).length,
  });
});

app.post("/v1/usage", requireServiceAuth, (req, res) => {
  try {
    const result = recordUsage(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/v1/usage", requireServiceAuth, (req, res) => {
  const userId = String(req.query.userId || "");
  if (!userId) return res.status(400).json({ error: "userId required" });
  const store = loadStore();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const events = store.usage
    .filter((u) => u.userId === userId)
    .slice(-limit)
    .reverse();
  res.json({
    userId,
    usage: summarizeUsage(store, userId),
    events,
  });
});

app.post("/v1/messages", requireServiceAuth, (req, res) => {
  try {
    const row = enqueueMessage(req.body || {});
    res.json({ ok: true, message: row });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/v1/messages/poll", requireServiceAuth, (req, res) => {
  const userId = String(req.query.userId || "");
  if (!userId) return res.status(400).json({ error: "userId required" });
  const messages = pollMessages(userId, {
    limit: req.query.limit,
    includeAcked: req.query.includeAcked === "1",
  });
  res.json({ userId, messages, count: messages.length });
});

app.post("/v1/messages/ack", requireServiceAuth, (req, res) => {
  try {
    const userId = String(req.body?.userId || "");
    const messageIds = req.body?.messageIds || req.body?.ids || [];
    const result = ackMessages(userId, messageIds);
    res.json({ ok: true, userId, ...result });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/v1/credit", requireServiceAuth, (req, res) => {
  const userId = String(req.body?.userId || "");
  const amountCents = Number(req.body?.amountCents || 0);
  const ref = req.body?.ref ? String(req.body.ref) : undefined;
  if (!userId || !amountCents) {
    return res.status(400).json({ error: "userId and amountCents required" });
  }
  const balanceCents = credit(userId, amountCents, ref, req.body?.meta);
  res.json({ userId, balanceCents, creditTarget: "madeclaw_balance" });
});

app.post("/v1/debit", requireServiceAuth, (req, res) => {
  const userId = String(req.body?.userId || "");
  const amountCents = Number(req.body?.amountCents || 0);
  const ref = req.body?.ref ? String(req.body.ref) : undefined;
  if (!userId || !amountCents) {
    return res.status(400).json({ error: "userId and amountCents required" });
  }
  try {
    const balanceCents = debit(userId, amountCents, ref, req.body?.meta);
    res.json({ userId, balanceCents });
  } catch (e) {
    if (e.code === "insufficient_balance") {
      return res.status(402).json({ error: "insufficient_balance", balanceCents: e.balance });
    }
    throw e;
  }
});

app.post("/v1/hold", requireServiceAuth, (req, res) => {
  const userId = String(req.body?.userId || "");
  const amountCents = Number(req.body?.amountCents || 0);
  const ref = req.body?.ref ? String(req.body.ref) : "";
  if (!userId || !amountCents || !ref) {
    return res.status(400).json({ error: "userId, amountCents, and ref required" });
  }
  try {
    const result = hold(userId, amountCents, ref, req.body?.meta);
    res.json({ userId, ...result });
  } catch (e) {
    if (e.code === "insufficient_balance") {
      return res.status(402).json({ error: "insufficient_balance", balanceCents: e.balance });
    }
    throw e;
  }
});

app.post("/v1/capture", requireServiceAuth, (req, res) => {
  const ref = req.body?.ref ? String(req.body.ref) : "";
  if (!ref) return res.status(400).json({ error: "ref required" });
  try {
    res.json(captureHold(ref));
  } catch (e) {
    if (e.code === "hold_not_found") {
      return res.status(404).json({ error: "hold_not_found" });
    }
    throw e;
  }
});

app.post("/v1/release", requireServiceAuth, (req, res) => {
  const ref = req.body?.ref ? String(req.body.ref) : "";
  if (!ref) return res.status(400).json({ error: "ref required" });
  try {
    res.json(releaseHold(ref));
  } catch (e) {
    if (e.code === "hold_not_found") {
      return res.status(404).json({ error: "hold_not_found" });
    }
    throw e;
  }
});

app.post("/v1/checkout", requireServiceAuth, async (req, res) => {
  const userId = String(req.body?.userId || "");
  const amountCents = Number(req.body?.amountCents || 0);
  const currency = String(req.body?.currency || "USD").toUpperCase();
  if (!userId || amountCents < 1) {
    return res.status(400).json({ error: "userId and amountCents (>=1) required" });
  }
  try {
    const { sessionId, checkoutUrl, amountCents: cents } = await createCheckoutSession({
      userId,
      amountCents,
      currency,
      successUrl: req.body?.successUrl || PAY_SUCCESS_URL,
    });
    res.json({
      sessionId,
      checkoutUrl,
      amountCents: cents,
      currency,
      creditTarget: "madeclaw_balance",
    });
  } catch (e) {
    if (e.code === "waffo_not_configured") {
      return res.status(503).json({
        error: "waffo_not_configured",
        detail: String(e.message),
      });
    }
    res
      .status(e.status || 500)
      .json({ error: "waffo_checkout_failed", detail: e.body || String(e.message) });
  }
});

/**
 * Public pay entry — MadeClaw App / madeclaw_recharge opens this URL.
 * GET /pay?userId=...&amountCents=500
 */
app.get("/pay", async (req, res) => {
  const userId = String(req.query.userId || "").trim();
  const amountCents = Number(req.query.amountCents || 500);
  if (!userId) {
    res.redirect(302, `/recharge?error=${encodeURIComponent("缺少 userId，请从 MadeClaw 打开充值链接")}`);
    return;
  }
  if (!Number.isFinite(amountCents) || amountCents < 1) {
    res.redirect(302, `/recharge?userId=${encodeURIComponent(userId)}&error=${encodeURIComponent("金额无效")}`);
    return;
  }
  try {
    const { checkoutUrl } = await createCheckoutSession({
      userId,
      amountCents,
      currency: "USD",
      successUrl: PAY_SUCCESS_URL,
    });
    if (!checkoutUrl) {
      res.status(502).type("html").send("<h1>无法创建支付会话</h1><p>请稍后重试。</p>");
      return;
    }
    res.redirect(302, checkoutUrl);
  } catch (e) {
    const detail =
      e.code === "waffo_not_configured"
        ? String(e.message)
        : typeof e.body === "object"
          ? JSON.stringify(e.body)
          : String(e.message || e);
    const title = e.code === "waffo_not_configured" ? "支付未配置" : "支付创建失败";
    res
      .status(e.status || 500)
      .type("html")
      .send(
        `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/styles.css"></head><body class="page"><main class="panel"><h1>${title}</h1><p>请返回 MadeClaw 或稍后重试。若为部署问题，请在 Railway 配置 WAFFO_MERCHANT_ID 与 WAFFO_PRIVATE_KEY。</p><pre class="err">${detail.replace(/[<>&]/g, "")}</pre><p><a href="/recharge?userId=${encodeURIComponent(userId)}">返回充值页</a></p></main></body></html>`,
      );
  }
});

app.post("/v1/webhooks/waffo", requireWebhookAuth, (req, res) => {
  const event = req.body || {};

  // Dev helper — disabled unless BILLING_ALLOW_SIMULATE=1
  if (event.simulatePaid) {
    if (!ALLOW_SIMULATE) {
      return res.status(403).json({ error: "simulate_disabled" });
    }
    if (!event.userId || !event.amountCents) {
      return res.status(400).json({ error: "simulate requires userId and amountCents" });
    }
    const after = credit(
      String(event.userId),
      Number(event.amountCents),
      event.ref ? String(event.ref) : `simulate:${crypto.randomUUID()}`,
      { simulate: true },
    );
    return res.json({
      ok: true,
      credited: true,
      userId: event.userId,
      balanceCents: after,
      creditTarget: "madeclaw_balance",
    });
  }

  const type = String(event.type || event.event || event.name || "");
  const data = event.data || event.payload || event;
  const sessionId =
    data.checkoutSessionId || data.sessionId || data.checkout_session_id || event.checkoutSessionId;
  const orderId = data.orderId || data.id || event.orderId;
  const meta = data.metadata || event.metadata || {};
  let userId = meta.madeclawUserId || meta.userId;
  const paidHint =
    /complet|paid|succeed/i.test(type) ||
    data.status === "paid" ||
    data.status === "succeeded" ||
    event.status === "paid";

  if (sessionId) {
    const store = loadStore();
    const row = store.checkouts[sessionId];
    if (row) {
      userId = userId || row.userId;
      if (paidHint && userId) {
        const ref = `waffo:${orderId || sessionId}`;
        const after = credit(userId, row.amountCents, ref, { type, sessionId, orderId });
        const next = loadStore();
        next.checkouts[sessionId] = { ...row, status: "paid", updatedAt: now() };
        saveStore(next);
        return res.json({
          ok: true,
          credited: true,
          userId,
          balanceCents: after,
          creditTarget: "madeclaw_balance",
        });
      }
    }
  }

  res.json({ ok: true, credited: false, note: "no matching pending checkout or not a paid event" });
});

app.use((err, _req, res, _next) => {
  console.error("[madeclaw-online]", err);
  res.status(500).json({ error: "internal_error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[madeclaw-online] listening on 0.0.0.0:${PORT}`);
  console.log(`[madeclaw-online] db=${DB_PATH}`);
  console.log(`[madeclaw-online] credits MadeAPI wallet: NO`);
  console.log(`[madeclaw-online] public=${PUBLIC_BASE}`);
  console.log(`[madeclaw-online] waffoConfigured=${isWaffoConfigured()}`);
  console.log(`[madeclaw-online] pay=${PUBLIC_BASE}/pay?userId=demo&amountCents=500`);
  console.log(`[madeclaw-online] authRequired=${Boolean(SERVICE_TOKEN) || REQUIRE_AUTH}`);
  console.log(`[madeclaw-online] webhookAuth=${Boolean(WEBHOOK_SECRET)}`);
  console.log(`[madeclaw-online] simulateAllowed=${ALLOW_SIMULATE}`);
});

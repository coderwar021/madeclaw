/**
 * MadeClaw billing gate — load via plugins.load.paths.
 * Zero runtime dependency on openclaw package imports (host injects api).
 *
 * Ledger invariant (充值到账额度 = 可扣余额):
 *   webhook/credit(userId) → GET /v1/balance?userId → POST /v1/debit {userId}
 * all share the same MadeClaw ledger row for that userId.
 */
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Strip trailing slash and accidental `/pay` path so origin is API-safe. */
function normalizePublicOrigin(raw, fallback) {
  let s = String(raw || fallback || "").trim();
  if (!s) s = String(fallback || "");
  s = s.replace(/\/$/, "");
  // Operators sometimes paste the full pay URL; billing APIs must stay at origin.
  s = s.replace(/\/pay(?:\/.*)?$/i, "");
  return s.replace(/\/$/, "");
}

function normalizeConfig(raw) {
  const c = asRecord(raw);
  // Local-safe code defaults. Product template / apply script set Railway origin.
  const billingBaseUrl = normalizePublicOrigin(c.billingBaseUrl, "http://127.0.0.1:8787");
  const payBaseUrl = normalizePublicOrigin(
    c.payBaseUrl || c.billingBaseUrl,
    billingBaseUrl || "http://127.0.0.1:8787",
  );
  return {
    billingBaseUrl,
    serviceToken: typeof c.serviceToken === "string" ? c.serviceToken : "",
    payBaseUrl,
    userId: String(c.userId || "local-operator"),
    runFeeCents: Math.max(1, Number(c.runFeeCents || 1) || 1),
    skipWhenCustomApi: c.skipWhenCustomApi !== false,
    defaultPayAmountCents: Math.max(1, Number(c.defaultPayAmountCents || 500) || 500),
  };
}

function primaryModelRef(api) {
  const cfg = asRecord(api.config);
  const agents = asRecord(cfg.agents);
  const defaults = asRecord(agents.defaults);
  const model = defaults.model;
  if (typeof model === "string" && model.trim()) return model.trim();
  if (model && typeof model === "object" && typeof model.primary === "string") {
    return model.primary.trim();
  }
  return "";
}

/**
 * Skip gate/debit only for non-MadeAPI runs when skipWhenCustomApi is on.
 * Prefer run ctx.modelProviderId when present; else fall back to config primary.
 */
function shouldSkipBilling(api, cfg, ctx) {
  if (!cfg.skipWhenCustomApi) return false;
  const provider =
    typeof ctx?.modelProviderId === "string" && ctx.modelProviderId.trim()
      ? ctx.modelProviderId.trim().toLowerCase()
      : "";
  if (provider) return provider !== "madeapi";
  const primary = primaryModelRef(api);
  if (!primary) return false;
  return !primary.startsWith("madeapi/");
}

function authHeaders(cfg) {
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (cfg.serviceToken) headers.authorization = `Bearer ${cfg.serviceToken}`;
  return headers;
}

async function fetchBalance(cfg) {
  const url = `${cfg.billingBaseUrl}/v1/balance?userId=${encodeURIComponent(cfg.userId)}`;
  const res = await fetch(url, { headers: authHeaders(cfg) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `balance_http_${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return Number(body.balanceCents || 0);
}

async function postDebit(cfg, ref) {
  const res = await fetch(`${cfg.billingBaseUrl}/v1/debit`, {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify({
      userId: cfg.userId,
      amountCents: cfg.runFeeCents,
      ref,
      meta: { source: "madeclaw-billing-plugin" },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 402) {
    const err = new Error("insufficient_balance");
    err.code = "insufficient_balance";
    err.balanceCents = body.balanceCents ?? 0;
    throw err;
  }
  if (!res.ok) {
    throw new Error(body.error || `debit_http_${res.status}`);
  }
  return Number(body.balanceCents || 0);
}

async function postCredit(cfg, amountCents, ref, meta) {
  const res = await fetch(`${cfg.billingBaseUrl}/v1/credit`, {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify({
      userId: cfg.userId,
      amountCents,
      ref,
      meta: { source: "madeclaw-billing-plugin", ...(meta || {}) },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `credit_http_${res.status}`);
  }
  return Number(body.balanceCents || 0);
}

/** Build MadeClaw `/pay` URL on the configured public origin (not Open WebUI). */
function payUrl(cfg, amountCents) {
  const origin = cfg.payBaseUrl.includes("://") ? cfg.payBaseUrl : `https://${cfg.payBaseUrl}`;
  const u = new URL(origin);
  u.pathname = "/pay";
  u.search = "";
  u.hash = "";
  u.searchParams.set("userId", cfg.userId);
  u.searchParams.set(
    "amountCents",
    String(amountCents && amountCents > 0 ? amountCents : cfg.defaultPayAmountCents),
  );
  return u.toString();
}

function blockMessage(cfg, balanceCents) {
  return (
    `MadeClaw 余额不足（当前 ${balanceCents} 分，每次运行需 ${cfg.runFeeCents} 分）。` +
    `请打开网站充值：${payUrl(cfg)}`
  );
}

const configSchema = {
  safeParse(value) {
    return { success: true, data: value ?? {} };
  },
};

function register(api) {
  if (api.registrationMode === "cli-metadata") return;

  const cfg = normalizeConfig(api.pluginConfig);

  api.registerTool(
    {
      name: "madeclaw_balance",
      description: "Show the MadeClaw independent balance for this operator (not MadeAPI wallet).",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        // Always query the ledger so operators can verify 充值到账 = 可扣余额 after pay,
        // even when skipWhenCustomApi skips run gating.
        try {
          const balanceCents = await fetchBalance(cfg);
          return {
            content: [
              {
                type: "text",
                text: `MadeClaw 余额：${balanceCents} 分（userId=${cfg.userId}）。充值：${payUrl(cfg)}`,
              },
            ],
          };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `无法查询余额：${e instanceof Error ? e.message : String(e)}。确认 billing 服务在 ${cfg.billingBaseUrl}`,
              },
            ],
          };
        }
      },
    },
    { name: "madeclaw_balance" },
  );

  api.registerTool(
    {
      name: "madeclaw_recharge",
      description:
        "Return the MadeClaw website pay URL. Payment happens on the website, not inside the app.",
      parameters: {
        type: "object",
        properties: {
          amountCents: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        const amount =
          typeof params?.amountCents === "number" && params.amountCents > 0
            ? params.amountCents
            : cfg.defaultPayAmountCents;
        return {
          content: [
            {
              type: "text",
              text: `请在浏览器打开网站完成支付（与 MadeAPI 共用收款账号，余额记入 MadeClaw）：\n${payUrl(cfg, amount)}`,
            },
          ],
        };
      },
    },
    { name: "madeclaw_recharge" },
  );

  if (api.registrationMode !== "full") return;

  /** runIds successfully pre-debited in before_agent_run (refund only these on failure). */
  const preDebitedRuns = new Set();

  // Debit at gate (not post-run fail-open): same userId ledger as webhook credit.
  // Failed runs are refunded via /v1/credit so operators are not charged for errors.
  api.on("before_agent_run", async (_event, ctx) => {
    if (shouldSkipBilling(api, cfg, ctx)) return { outcome: "pass" };
    const runId = ctx?.runId || _event?.runId;
    try {
      if (runId) {
        await postDebit(cfg, `run:${runId}`);
        preDebitedRuns.add(runId);
        return { outcome: "pass" };
      }
      // No runId yet: balance check only (debit deferred is unsafe; block if short).
      const balanceCents = await fetchBalance(cfg);
      if (balanceCents < cfg.runFeeCents) {
        return {
          outcome: "block",
          reason: "madeclaw_insufficient_balance",
          message: blockMessage(cfg, balanceCents),
          category: "cost_limit",
        };
      }
      api.logger?.warn?.(
        "madeclaw-billing: before_agent_run missing runId; balance checked but not debited yet",
      );
      return { outcome: "pass" };
    } catch (e) {
      if (e && e.code === "insufficient_balance") {
        return {
          outcome: "block",
          reason: "madeclaw_insufficient_balance",
          message: blockMessage(cfg, e.balanceCents ?? 0),
          category: "cost_limit",
        };
      }
      api.logger?.warn?.(
        `madeclaw-billing balance/debit failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        outcome: "block",
        reason: "madeclaw_billing_unreachable",
        message: `无法连接 MadeClaw 余额服务（${cfg.billingBaseUrl}）。请先启动 billing，或改用自备 API。充值页：${payUrl(cfg)}`,
        category: "cost_limit",
      };
    }
  });

  api.on("agent_end", async (event, ctx) => {
    if (shouldSkipBilling(api, cfg, ctx)) return;
    const runId = event?.runId || ctx?.runId;
    if (!runId) return;

    // Failed run: refund only if this process pre-debited the same runId.
    if (event?.success === false) {
      if (preDebitedRuns.has(runId)) {
        preDebitedRuns.delete(runId);
        try {
          await postCredit(cfg, cfg.runFeeCents, `refund:run:${runId}`, {
            reason: "agent_run_failed",
          });
        } catch (e) {
          api.logger?.warn?.(
            `madeclaw-billing refund failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      return;
    }

    preDebitedRuns.delete(runId);

    // Legacy path: gate had no runId (no pre-debit). Debit now; log if matching breaks.
    try {
      await postDebit(cfg, `run:${runId}`);
    } catch (e) {
      if (e && e.code === "insufficient_balance") {
        api.logger?.warn?.(
          "madeclaw-billing: post-run debit insufficient (preflight lacked runId); matching broken for this run",
        );
        return;
      }
      api.logger?.warn?.(
        `madeclaw-billing post-run debit failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });
}

export default {
  id: "madeclaw-billing",
  name: "MadeClaw Billing",
  description:
    "Gates MadeAPI agent runs against MadeClaw independent balance; recharge opens the website.",
  configSchema,
  register,
};

// Test / smoke helpers (not part of OpenClaw plugin surface).
export const __test = {
  normalizeConfig,
  normalizePublicOrigin,
  payUrl,
  shouldSkipBilling,
  primaryModelRef,
};

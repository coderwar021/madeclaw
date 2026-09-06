/**
 * MadeClaw billing gate — load via plugins.load.paths.
 * Zero runtime dependency on openclaw package imports (host injects api).
 *
 * Ledger invariant (充值到账额度 = 可扣余额):
 *   webhook/credit(userId) → GET /v1/balance?userId → POST /v1/debit {userId}
 * all share the same MadeClaw ledger row for that userId.
 *
 * Also: POST /v1/usage (token stats) + GET /v1/messages/poll (消息下传).
 */
import {
  MADECLAW_DEFAULT_SERVICE_TOKEN,
  MADECLAW_PUBLIC_ORIGIN,
} from "./defaults.js";
import { connectUamgoApp, publicConnectRecipe, UAMGO_APPS } from "./uamgo/connect.js";

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
  // Product OOB defaults — Railway origin + shared service token (no manual fill).
  const billingBaseUrl = normalizePublicOrigin(c.billingBaseUrl, MADECLAW_PUBLIC_ORIGIN);
  const payBaseUrl = normalizePublicOrigin(
    c.payBaseUrl || c.billingBaseUrl,
    billingBaseUrl || MADECLAW_PUBLIC_ORIGIN,
  );
  const token =
    typeof c.serviceToken === "string" && c.serviceToken.trim()
      ? c.serviceToken.trim()
      : MADECLAW_DEFAULT_SERVICE_TOKEN;
  return {
    billingBaseUrl,
    serviceToken: token,
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
  return body;
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

async function postUsage(cfg, payload) {
  const res = await fetch(`${cfg.billingBaseUrl}/v1/usage`, {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify({
      userId: cfg.userId,
      ...payload,
      meta: { source: "madeclaw-billing-plugin", ...(payload.meta || {}) },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `usage_http_${res.status}`);
  }
  return body;
}

async function fetchUsage(cfg) {
  const url = `${cfg.billingBaseUrl}/v1/usage?userId=${encodeURIComponent(cfg.userId)}`;
  const res = await fetch(url, { headers: authHeaders(cfg) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `usage_http_${res.status}`);
  }
  return body;
}

async function pollInbox(cfg, { limit = 20, ack = true } = {}) {
  const url = `${cfg.billingBaseUrl}/v1/messages/poll?userId=${encodeURIComponent(cfg.userId)}&limit=${encodeURIComponent(String(limit))}`;
  const res = await fetch(url, { headers: authHeaders(cfg) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `inbox_http_${res.status}`);
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (ack && messages.length > 0) {
    const ids = messages.map((m) => m.id).filter(Boolean);
    await fetch(`${cfg.billingBaseUrl}/v1/messages/ack`, {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ userId: cfg.userId, messageIds: ids }),
    }).catch(() => null);
  }
  return messages;
}

function extractUsageFromMessages(messages) {
  if (!Array.isArray(messages)) return null;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let total = 0;
  let found = false;
  for (const msg of messages) {
    const u = msg && typeof msg === "object" ? msg.usage || msg.tokenUsage : null;
    if (!u || typeof u !== "object") continue;
    found = true;
    input += Number(u.input || u.inputTokens || 0) || 0;
    output += Number(u.output || u.outputTokens || 0) || 0;
    cacheRead += Number(u.cacheRead || u.cacheReadTokens || 0) || 0;
    cacheWrite += Number(u.cacheWrite || u.cacheWriteTokens || 0) || 0;
    total += Number(u.total || u.totalTokens || 0) || 0;
  }
  if (!found) return null;
  if (!total) total = input + output + cacheRead + cacheWrite;
  return { input, output, cacheRead, cacheWrite, total };
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
        try {
          const body = await fetchBalance(cfg);
          const balanceCents = Number(body.balanceCents || 0);
          const usage = body.usage || {};
          const inbox = body.inboxPending ?? 0;
          const usageLine =
            usage.totalTokens != null
              ? ` Token 累计：${usage.totalTokens}（in ${usage.inputTokens || 0} / out ${usage.outputTokens || 0}）。`
              : "";
          const inboxLine = inbox > 0 ? ` 未读下传消息：${inbox}（用 madeclaw_inbox）。` : "";
          return {
            content: [
              {
                type: "text",
                text: `MadeClaw 余额：${balanceCents} 分（userId=${cfg.userId}）。${usageLine}${inboxLine}充值：${payUrl(cfg)}`,
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

  api.registerTool(
    {
      name: "madeclaw_usage",
      description: "Show MadeClaw token/usage totals reported to the billing service.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        try {
          const body = await fetchUsage(cfg);
          const u = body.usage || {};
          return {
            content: [
              {
                type: "text",
                text:
                  `MadeClaw Token 统计（userId=${cfg.userId}）：` +
                  ` events=${u.events ?? 0} total=${u.totalTokens ?? 0}` +
                  ` in=${u.inputTokens ?? 0} out=${u.outputTokens ?? 0}` +
                  ` cacheR=${u.cacheReadTokens ?? 0} cacheW=${u.cacheWriteTokens ?? 0}` +
                  `\n详情：${cfg.billingBaseUrl}/usage`,
              },
            ],
          };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `无法查询用量：${e instanceof Error ? e.message : String(e)}`,
              },
            ],
          };
        }
      },
    },
    { name: "madeclaw_usage" },
  );

  api.registerTool(
    {
      name: "madeclaw_inbox",
      description:
        "Poll MadeClaw server downlink messages (消息下传) for this userId and acknowledge them.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50 },
          ack: { type: "boolean", description: "Acknowledge after fetch (default true)." },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        try {
          const limit =
            typeof params?.limit === "number" && params.limit > 0 ? params.limit : 20;
          const ack = params?.ack !== false;
          const messages = await pollInbox(cfg, { limit, ack });
          if (messages.length === 0) {
            return { content: [{ type: "text", text: "MadeClaw 收件箱为空。" }] };
          }
          const lines = messages.map((m, i) => {
            const title = m.title ? `[${m.title}] ` : "";
            return `${i + 1}. ${title}${m.body}`;
          });
          return {
            content: [
              {
                type: "text",
                text: `MadeClaw 下传消息（${messages.length}）${ack ? "，已 ack" : ""}：\n${lines.join("\n")}`,
              },
            ],
          };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `无法拉取下传消息：${e instanceof Error ? e.message : String(e)}`,
              },
            ],
          };
        }
      },
    },
    { name: "madeclaw_inbox" },
  );

  if (api.registrationMode !== "full") return;

  /** runIds successfully pre-debited in before_agent_run (refund only these on failure). */
  const preDebitedRuns = new Set();
  /** runIds that already got llm_output usage posts (skip transcript double-count). */
  const usageReportedRuns = new Set();

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
      const body = await fetchBalance(cfg);
      const balanceCents = Number(body.balanceCents || 0);
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

  // Report per-call token usage when the host emits llm_output.
  api.on("llm_output", async (event, ctx) => {
    if (shouldSkipBilling(api, cfg, ctx)) return;
    const usage = event?.usage;
    if (!usage || typeof usage !== "object") return;
    const runId = event?.runId || ctx?.runId;
    const callKey = event?.callId || `${runId || "run"}:${event?.model || "model"}:${Date.now()}`;
    try {
      await postUsage(cfg, {
        runId,
        provider: event?.provider || ctx?.modelProviderId,
        model: event?.model || ctx?.modelId,
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheReadTokens: usage.cacheRead,
        cacheWriteTokens: usage.cacheWrite,
        totalTokens: usage.total,
        ref: `usage:llm:${callKey}`,
      });
      if (runId) usageReportedRuns.add(runId);
    } catch (e) {
      api.logger?.warn?.(
        `madeclaw-billing usage report failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });

  api.on("agent_end", async (event, ctx) => {
    if (shouldSkipBilling(api, cfg, ctx)) return;
    const runId = event?.runId || ctx?.runId;
    if (!runId) return;

    // Best-effort usage from transcript if llm_output was not wired for this run.
    if (!usageReportedRuns.has(runId)) {
      const fromMsgs = extractUsageFromMessages(event?.messages);
      if (fromMsgs && fromMsgs.total > 0) {
        try {
          await postUsage(cfg, {
            runId,
            provider: ctx?.modelProviderId,
            model: ctx?.modelId,
            inputTokens: fromMsgs.input,
            outputTokens: fromMsgs.output,
            cacheReadTokens: fromMsgs.cacheRead,
            cacheWriteTokens: fromMsgs.cacheWrite,
            totalTokens: fromMsgs.total,
            ref: `usage:run:${runId}`,
          });
        } catch (e) {
          api.logger?.warn?.(
            `madeclaw-billing run usage report failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }
    usageReportedRuns.delete(runId);

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

  // Uamgo All: wallet + one-click tool linking (Codex / Claude Code / Kimi).
  const respondOk = (respond, payload) => respond(true, payload);
  const respondErr = (respond, message) =>
    respond(false, { error: message, ok: false, message });

  api.registerGatewayMethod(
    "madeclaw.uamgo.balance",
    async ({ respond }) => {
      try {
        const body = await fetchBalance(cfg);
        respondOk(respond, {
          balanceCents: Number(body.balanceCents || 0),
          userId: cfg.userId,
          payUrl: payUrl(cfg),
          billingBaseUrl: cfg.billingBaseUrl,
          apps: UAMGO_APPS,
        });
      } catch (e) {
        respondErr(
          respond,
          `无法查询余额：${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    { scope: "operator.read" },
  );

  api.registerGatewayMethod(
    "madeclaw.uamgo.connect",
    async ({ params, respond }) => {
      try {
        const result = connectUamgoApp({
          app: params?.app,
          apiKey: typeof params?.apiKey === "string" ? params.apiKey : undefined,
        });
        // Always ack the RPC; product outcome is result.ok (never silent).
        respondOk(respond, result);
      } catch (e) {
        respondOk(respond, {
          ok: false,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    { scope: "operator.write" },
  );

  api.registerGatewayMethod(
    "madeclaw.uamgo.recipes",
    async ({ respond }) => {
      respondOk(respond, {
        apps: UAMGO_APPS.map((id) => ({ id, ...publicConnectRecipe(id) })),
        site: cfg.billingBaseUrl,
      });
    },
    { scope: "operator.read" },
  );
}

export default {
  id: "madeclaw-billing",
  name: "MadeClaw Billing",
  description:
    "Gates MadeAPI agent runs against MadeClaw independent balance; recharge opens the website; reports token usage; polls downlink inbox.",
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
  MADECLAW_PUBLIC_ORIGIN,
  MADECLAW_DEFAULT_SERVICE_TOKEN,
};

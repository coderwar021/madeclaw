/**
 * MadeAPI public model catalog.
 * Live source: https://madeapi.com/api/pricing (no auth).
 * Static FALLBACK_MODELS only if the live fetch fails.
 */

export const MADEAPI_PRICING_URL =
  process.env.MADEAPI_PRICING_URL?.trim() || "https://madeapi.com/api/pricing";

/** Cache TTL for live catalog (ms). */
export const MADEAPI_MODELS_CACHE_TTL_MS = Number(
  process.env.MADEAPI_MODELS_CACHE_TTL_MS || 5 * 60 * 1000,
);

/** Static fallback — used only when madeapi.com is unreachable. */
export const FALLBACK_MODELS = [
  {
    family: "OpenAI",
    models: [
      { id: "gpt-5.6-luna", ref: "madeapi/gpt-5.6-luna", note: "默认推荐" },
      { id: "gpt-5.6-terra", ref: "madeapi/gpt-5.6-terra", note: "" },
      { id: "gpt-5.6-sol", ref: "madeapi/gpt-5.6-sol", note: "" },
      { id: "gpt-5.5", ref: "madeapi/gpt-5.5", note: "" },
      { id: "gpt-5.4", ref: "madeapi/gpt-5.4", note: "" },
      { id: "gpt-5.4-mini", ref: "madeapi/gpt-5.4-mini", note: "轻量" },
    ],
  },
  {
    family: "Anthropic",
    models: [
      { id: "claude-sonnet-4-6", ref: "madeapi/claude-sonnet-4-6", note: "常用后备" },
      { id: "claude-sonnet-5", ref: "madeapi/claude-sonnet-5", note: "" },
      { id: "claude-opus-4-6", ref: "madeapi/claude-opus-4-6", note: "" },
      { id: "claude-opus-5", ref: "madeapi/claude-opus-5", note: "" },
      { id: "claude-haiku-4-5", ref: "madeapi/claude-haiku-4-5", note: "更快" },
      { id: "claude-fable-5-1", ref: "madeapi/claude-fable-5-1", note: "" },
    ],
  },
  {
    family: "其他",
    models: [
      { id: "deepseek-v4-flash", ref: "madeapi/deepseek-v4-flash", note: "" },
      { id: "deepseek-v4-pro", ref: "madeapi/deepseek-v4-pro", note: "" },
      { id: "gemini-3.5-flash", ref: "madeapi/gemini-3.5-flash", note: "" },
      { id: "gemini-3.8-flash", ref: "madeapi/gemini-3.8-flash", note: "" },
      { id: "gemini-3.1-pro-preview", ref: "madeapi/gemini-3.1-pro-preview", note: "" },
      { id: "glm-5.3-flash", ref: "madeapi/glm-5.3-flash", note: "" },
      { id: "glm-5.3", ref: "madeapi/glm-5.3", note: "" },
      { id: "kimi-k3", ref: "madeapi/kimi-k3", note: "" },
      { id: "grok-4.6", ref: "madeapi/grok-4.6", note: "" },
    ],
  },
];

/** @deprecated use FALLBACK_MODELS — kept for older imports */
export const MADECLAW_PUBLIC_MODELS = FALLBACK_MODELS;

const FAMILY_ORDER = ["OpenAI", "Anthropic", "Google", "DeepSeek", "GLM", "Kimi", "Grok"];

/**
 * @param {unknown} row
 * @returns {{ id: string, ref: string, note: string, family: string } | null}
 */
function normalizePricingRow(row) {
  if (!row || typeof row !== "object") return null;
  const id = String(row.model_name || row.id || "").trim();
  if (!id) return null;
  // Skip unnamed / internal-looking rows without a public description when they look like test ids.
  const tags = String(row.tags || "").trim();
  const description = String(row.description || "").trim();
  if (!tags && !description && /^gitland-/i.test(id)) return null;
  const family = tags || "其他";
  return {
    id,
    ref: `madeapi/${id}`,
    note: description && description !== id ? description : "",
    family,
  };
}

/**
 * Group flat model rows into { family, models[] } for the site.
 * @param {Array<{ id: string, ref: string, note: string, family: string }>} rows
 */
export function groupModelsIntoFamilies(rows) {
  /** @type {Map<string, Array<{ id: string, ref: string, note: string }>>} */
  const byFamily = new Map();
  for (const row of rows) {
    const list = byFamily.get(row.family) || [];
    list.push({ id: row.id, ref: row.ref, note: row.note });
    byFamily.set(row.family, list);
  }
  const keys = [...byFamily.keys()].sort((a, b) => {
    const ia = FAMILY_ORDER.indexOf(a);
    const ib = FAMILY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return keys.map((family) => ({
    family,
    models: (byFamily.get(family) || []).sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

/**
 * Parse madeapi.com /api/pricing JSON into family groups.
 * @param {unknown} payload
 */
export function familiesFromPricingPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const data = payload.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const rows = [];
  for (const item of data) {
    const row = normalizePricingRow(item);
    if (row) rows.push(row);
  }
  if (rows.length === 0) return null;
  return groupModelsIntoFamilies(rows);
}

/** @type {{ families: typeof FALLBACK_MODELS, fetchedAt: number, source: string, pricingVersion: string | null } | null} */
let cache = null;

/**
 * Fetch live MadeAPI catalog with in-memory TTL cache.
 * Never throws — falls back to static list.
 */
export async function getPublicModelFamilies() {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < MADEAPI_MODELS_CACHE_TTL_MS) {
    return cache;
  }

  try {
    const res = await fetch(MADEAPI_PRICING_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      throw new Error(`pricing HTTP ${res.status}`);
    }
    const payload = await res.json();
    const families = familiesFromPricingPayload(payload);
    if (!families) {
      throw new Error("pricing payload empty");
    }
    cache = {
      families,
      fetchedAt: now,
      source: "madeapi.com/api/pricing",
      pricingVersion:
        typeof payload.pricing_version === "string" ? payload.pricing_version : null,
    };
    return cache;
  } catch (err) {
    if (cache) {
      return { ...cache, source: `${cache.source} (stale; live error: ${String(err)})` };
    }
    return {
      families: FALLBACK_MODELS,
      fetchedAt: now,
      source: `fallback (live error: ${String(err)})`,
      pricingVersion: null,
    };
  }
}

/** Flat list of model ids from the current catalog (for gateway sync helpers). */
export async function getPublicModelIds() {
  const { families } = await getPublicModelFamilies();
  return families.flatMap((f) => f.models.map((m) => m.id));
}

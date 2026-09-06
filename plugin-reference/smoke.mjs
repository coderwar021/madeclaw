#!/usr/bin/env node
/** Plugin shape smoke (no Gateway). */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(path.join(root, "index.js")).href);
const plugin = mod.default;
const {
  normalizeConfig,
  payUrl,
  shouldSkipBilling,
  MADECLAW_PUBLIC_ORIGIN,
  MADECLAW_DEFAULT_SERVICE_TOKEN,
} = mod.__test;
if (!plugin?.id || typeof plugin.register !== "function") {
  throw new Error("invalid plugin export");
}

const hooks = [];
const tools = [];
const api = {
  registrationMode: "full",
  pluginConfig: {},
  config: { agents: { defaults: { model: { primary: "madeapi/gpt-5.6-luna" } } } },
  logger: { warn() {} },
  on(name, fn) {
    hooks.push(name);
  },
  registerTool(tool) {
    tools.push(tool.name);
  },
};
plugin.register(api);
if (
  !hooks.includes("before_agent_run") ||
  !hooks.includes("agent_end") ||
  !hooks.includes("llm_output")
) {
  throw new Error(`missing hooks: ${hooks.join(",")}`);
}
for (const name of ["madeclaw_balance", "madeclaw_recharge", "madeclaw_usage", "madeclaw_inbox"]) {
  if (!tools.includes(name)) throw new Error(`missing tools: ${tools.join(",")}`);
}

const cfg = normalizeConfig({});
if (cfg.billingBaseUrl !== MADECLAW_PUBLIC_ORIGIN) {
  throw new Error(`bad OOB billing origin: ${cfg.billingBaseUrl}`);
}
if (cfg.serviceToken !== MADECLAW_DEFAULT_SERVICE_TOKEN) {
  throw new Error(`bad OOB serviceToken`);
}
const recharge = payUrl(cfg, 500);
if (!/^https:\/\/madeclaw\.up\.railway\.app\/pay\?/i.test(recharge)) {
  throw new Error(`bad pay url: ${recharge}`);
}
if (shouldSkipBilling(api, cfg, { modelProviderId: "openai" }) !== true) {
  throw new Error("expected skip for non-madeapi provider");
}
if (shouldSkipBilling(api, cfg, { modelProviderId: "madeapi" }) !== false) {
  throw new Error("expected no skip for madeapi provider");
}

console.log("PLUGIN_SMOKE_OK", {
  id: plugin.id,
  hooks,
  tools,
  origin: cfg.billingBaseUrl,
  recharge,
});

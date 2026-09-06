/**
 * MadeClaw Uamgo All — one-click link/config for Codex / Claude Code / Kimi.
 * Implements ljcodex.md, ljcodext.md, ljcc.md, ljkimi.md without echoing secrets.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const UAMGO_APPS = [
  "codex-client",
  "claude-code",
  "codex-cli",
  "kimi-code",
];

const MADEAPI_BASE = "https://madeapi.com";
const MADEAPI_V1 = "https://madeapi.com/v1";

function homeDir() {
  return os.homedir();
}

function shellRcPath() {
  const shell = process.env.SHELL || "";
  if (shell.includes("bash")) return path.join(homeDir(), ".bashrc");
  return path.join(homeDir(), ".zshrc");
}

function resolveApiKey(explicit) {
  const fromParam = typeof explicit === "string" ? explicit.trim() : "";
  if (fromParam) return fromParam;
  const fromEnv = String(process.env.MADEAPI_API_KEY || "").trim();
  return fromEnv;
}

function upsertEnvBlock(filePath, marker, lines) {
  const block = [`# ${marker}`, ...lines, `# end ${marker}`].join("\n");
  let existing = "";
  try {
    existing = fs.readFileSync(filePath, "utf8");
  } catch {
    existing = "";
  }
  const start = `# ${marker}`;
  const end = `# end ${marker}`;
  const startIdx = existing.indexOf(start);
  const endIdx = existing.indexOf(end);
  let next;
  if (startIdx >= 0 && endIdx > startIdx) {
    next =
      existing.slice(0, startIdx) +
      block +
      "\n" +
      existing.slice(endIdx + end.length).replace(/^\n/, "");
  } else {
    next = existing.trimEnd() + (existing ? "\n\n" : "") + block + "\n";
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next, { mode: 0o600 });
  return filePath;
}

function writeCodexConfig() {
  const dir = path.join(homeDir(), ".codex");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "config.toml");
  const body = `model_provider = "madeapi"
model = "gpt-5.6-sol"
model_reasoning_effort = "high"
[model_providers.madeapi]
name = "Madeapi"
base_url = "${MADEAPI_V1}"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
`;
  fs.writeFileSync(file, body, { mode: 0o600 });
  return file;
}

function commandExists(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, [cmd], { encoding: "utf8" });
  return r.status === 0;
}

function detectInstall(app) {
  switch (app) {
    case "codex-client":
    case "codex-cli":
      return {
        installed: commandExists("codex"),
        hint: commandExists("codex")
          ? "检测到 codex 命令"
          : "未检测到 codex；可先从官网下载页安装后再连",
      };
    case "claude-code":
      return {
        installed: commandExists("claude"),
        hint: commandExists("claude")
          ? "检测到 claude 命令"
          : "未检测到 claude；可先 npm i -g @anthropic-ai/claude-code",
      };
    case "kimi-code":
      return {
        installed: commandExists("kimi"),
        hint: commandExists("kimi")
          ? "检测到 kimi 命令"
          : "未检测到 kimi；请先安装 Kimi Code CLI",
      };
    default:
      return { installed: false, hint: "未知应用" };
  }
}

/**
 * @param {{ app: string, apiKey?: string }} params
 */
export function connectUamgoApp(params) {
  const app = String(params?.app || "").trim();
  if (!UAMGO_APPS.includes(app)) {
    return {
      ok: false,
      message: `未知应用：${app || "(empty)"}。支持：${UAMGO_APPS.join(", ")}`,
    };
  }

  const apiKey = resolveApiKey(params?.apiKey);
  if (!apiKey) {
    return {
      ok: false,
      message:
        "未找到 MadeAPI Key。请在 Gateway 环境设置 MADEAPI_API_KEY，或在连接参数中提供 apiKey（不会回显）。",
    };
  }

  const detect = detectInstall(app);
  const written = [];

  try {
    if (app === "codex-client" || app === "codex-cli") {
      written.push(writeCodexConfig());
      const rc = shellRcPath();
      upsertEnvBlock(rc, "madeclaw-uamgo-codex", [
        `export OPENAI_API_KEY=${JSON.stringify(apiKey)}`,
      ]);
      written.push(rc);
      // Best-effort current process (does not affect user's other terminals).
      process.env.OPENAI_API_KEY = apiKey;
    } else if (app === "claude-code") {
      const rc = shellRcPath();
      upsertEnvBlock(rc, "madeclaw-uamgo-claude-code", [
        `export ANTHROPIC_BASE_URL=${JSON.stringify(MADEAPI_BASE)}`,
        `export ANTHROPIC_AUTH_TOKEN=${JSON.stringify(apiKey)}`,
        `export ANTHROPIC_MODEL=claude-opus-4-8`,
        `export ANTHROPIC_DEFAULT_FABLE_MODEL=claude-fable-5-1`,
        `export ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-8`,
        `export ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-5`,
        `export ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-5`,
        `export CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-5`,
        `export CLAUDE_CODE_EFFORT_LEVEL=xhigh`,
      ]);
      written.push(rc);
      process.env.ANTHROPIC_BASE_URL = MADEAPI_BASE;
      process.env.ANTHROPIC_AUTH_TOKEN = apiKey;
    } else if (app === "kimi-code") {
      const rc = shellRcPath();
      upsertEnvBlock(rc, "madeclaw-uamgo-kimi", [
        `export KIMI_MODEL_NAME=kimi-k3`,
        `export KIMI_MODEL_PROVIDER_TYPE=openai`,
        `export KIMI_MODEL_API_KEY=${JSON.stringify(apiKey)}`,
        `export KIMI_MODEL_BASE_URL=${JSON.stringify(MADEAPI_V1)}`,
        `export KIMI_MODEL_MAX_CONTEXT_SIZE=1048576`,
      ]);
      written.push(rc);
      process.env.KIMI_MODEL_API_KEY = apiKey;
      process.env.KIMI_MODEL_BASE_URL = MADEAPI_V1;
    }
  } catch (e) {
    return {
      ok: false,
      installed: detect.installed,
      message: `写入配置失败：${e instanceof Error ? e.message : String(e)}`,
      details: written,
    };
  }

  return {
    ok: true,
    installed: detect.installed,
    message: detect.installed
      ? `已连接 MadeClaw（${app}）。${detect.hint}；新开终端后生效。`
      : `已写入 MadeClaw 配置（${app}）。${detect.hint}。`,
    details: written.map((p) => path.basename(p)),
    // Never return the key.
    baseUrl: app === "claude-code" ? MADEAPI_BASE : MADEAPI_V1,
  };
}

export function publicConnectRecipe(app) {
  const recipes = {
    "codex-client": {
      title: "Codex 客户端",
      configPath: "~/.codex/config.toml",
      baseUrl: MADEAPI_V1,
      env: ["OPENAI_API_KEY"],
      downloadPath: "/download#tools-codex-client",
    },
    "codex-cli": {
      title: "Codex 命令行",
      configPath: "~/.codex/config.toml",
      baseUrl: MADEAPI_V1,
      env: ["OPENAI_API_KEY"],
      downloadPath: "/download#tools-codex-cli",
    },
    "claude-code": {
      title: "Claude Code 命令行",
      configPath: "shell rc (ANTHROPIC_*)",
      baseUrl: MADEAPI_BASE,
      env: ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"],
      downloadPath: "/download#tools-claude-code",
    },
    "kimi-code": {
      title: "Kimi Code 命令行",
      configPath: "shell rc (KIMI_MODEL_*)",
      baseUrl: MADEAPI_V1,
      env: ["KIMI_MODEL_API_KEY", "KIMI_MODEL_BASE_URL"],
      downloadPath: "/download#tools-kimi-code",
    },
  };
  return recipes[app] || null;
}

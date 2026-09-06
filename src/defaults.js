/**
 * MadeClaw product out-of-box defaults (开箱即用).
 * Keep identical across plugin, railway-app, apply script, and templates.
 * Operators may override later via env / plugin config — not a per-user secret.
 */
export const MADECLAW_PUBLIC_ORIGIN = "https://madeclaw.up.railway.app";

/** Shared Bearer for plugin ↔ billing when BILLING_SERVICE_TOKEN unset. Change later in prod. */
export const MADECLAW_DEFAULT_SERVICE_TOKEN = "madeclaw-oob-service-token-v1";

/** Desktop package version shown on /download. */
export const MADECLAW_APP_VERSION = "2026.8.1";

/**
 * Installer assets live on GitHub Releases (DMG/EXE too large for git / Railway image).
 * Override with DOWNLOAD_*_URL env vars when mirroring elsewhere.
 */
export const MADECLAW_RELEASE_TAG = `v${MADECLAW_APP_VERSION}`;
export const MADECLAW_RELEASE_BASE =
  `https://github.com/coderwar021/madeclaw/releases/download/${MADECLAW_RELEASE_TAG}`;

export const MADECLAW_DOWNLOADS = {
  macosDmg: `${MADECLAW_RELEASE_BASE}/MadeClaw-macOS-${MADECLAW_APP_VERSION}.dmg`,
  windowsX64: `${MADECLAW_RELEASE_BASE}/MadeClaw-Windows-x64-Setup.exe`,
  windowsArm64: `${MADECLAW_RELEASE_BASE}/MadeClaw-Windows-arm64-Setup.exe`,
  sha256Sums: "/downloads/SHA256SUMS.txt",
  /** Dev-tool installers / docs hosted on this site (not Teamo). */
  tools: {
    "codex-client": {
      id: "codex-client",
      title: "Codex 客户端",
      note: "配置 ~/.codex/config.toml → madeapi（见 /v1/uamgo/connect）",
      urls: {
        docs: "/download#tools-codex-client",
        // Official Codex installers when mirrored; placeholders until Release assets land.
        mac: `${MADECLAW_RELEASE_BASE}/Codex-macOS.dmg`,
        win: `${MADECLAW_RELEASE_BASE}/Codex-Windows-Setup.exe`,
      },
    },
    "claude-code": {
      id: "claude-code",
      title: "Claude Code 命令行",
      note: "npm i -g @anthropic-ai/claude-code；连接写入 ANTHROPIC_* → madeapi.com",
      urls: {
        docs: "/download#tools-claude-code",
        npm: "https://www.npmjs.com/package/@anthropic-ai/claude-code",
      },
    },
    "codex-cli": {
      id: "codex-cli",
      title: "Codex 命令行",
      note: "配置 ~/.codex/config.toml + OPENAI_API_KEY",
      urls: {
        docs: "/download#tools-codex-cli",
        npm: "https://www.npmjs.com/package/@openai/codex",
      },
    },
    "kimi-code": {
      id: "kimi-code",
      title: "Kimi Code 命令行",
      note: "连接写入 KIMI_MODEL_* → madeapi.com/v1",
      urls: {
        docs: "/download#tools-kimi-code",
        // Placeholder until Release asset published
        mac: `${MADECLAW_RELEASE_BASE}/KimiCode-macOS.dmg`,
      },
    },
  },
};

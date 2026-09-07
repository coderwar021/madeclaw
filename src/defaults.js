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

/** Mirrored third-party tool installers (one-click; not marketing-page anchors). */
export const MADECLAW_TOOLS_RELEASE_TAG = "v2026.8.1-tools";
export const MADECLAW_TOOLS_RELEASE_BASE =
  `https://github.com/coderwar021/madeclaw/releases/download/${MADECLAW_TOOLS_RELEASE_TAG}`;

export const MADECLAW_DOWNLOADS = {
  macosDmg: `${MADECLAW_RELEASE_BASE}/MadeClaw-macOS-${MADECLAW_APP_VERSION}.dmg`,
  windowsX64: `${MADECLAW_RELEASE_BASE}/MadeClaw-Windows-x64-Setup.exe`,
  windowsArm64: `${MADECLAW_RELEASE_BASE}/MadeClaw-Windows-arm64-Setup.exe`,
  sha256Sums: "/downloads/SHA256SUMS.txt",
  toolsSha256Sums: `${MADECLAW_TOOLS_RELEASE_BASE}/TOOLS-SHA256SUMS.txt`,
  toolsRedistribution: `${MADECLAW_TOOLS_RELEASE_BASE}/TOOLS-REDISTRIBUTION.txt`,
  /** Dev-tool installers mirrored on MadeClaw GitHub Releases. */
  tools: {
    "codex-client": {
      id: "codex-client",
      title: "Codex 客户端",
      note: "官方 Codex macOS arm64 DMG（openai/codex rust-v0.153.4 镜像）",
      file: "Codex-Client-macOS-arm64.dmg",
      url: `${MADECLAW_TOOLS_RELEASE_BASE}/Codex-Client-macOS-arm64.dmg`,
      urls: {
        primary: `${MADECLAW_TOOLS_RELEASE_BASE}/Codex-Client-macOS-arm64.dmg`,
      },
    },
    "claude-code": {
      id: "claude-code",
      title: "Claude Code 命令行",
      note: "官方 @anthropic-ai/claude-code-darwin-arm64 2.1.263 原生包镜像",
      file: "Claude-Code-CLI-darwin-arm64-2.1.263.tgz",
      url: `${MADECLAW_TOOLS_RELEASE_BASE}/Claude-Code-CLI-darwin-arm64-2.1.263.tgz`,
      urls: {
        primary: `${MADECLAW_TOOLS_RELEASE_BASE}/Claude-Code-CLI-darwin-arm64-2.1.263.tgz`,
      },
    },
    "codex-cli": {
      id: "codex-cli",
      title: "Codex 命令行",
      note: "官方 Codex CLI macOS arm64 归档（openai/codex rust-v0.153.4 镜像）",
      file: "Codex-CLI-macOS-arm64.tar.gz",
      url: `${MADECLAW_TOOLS_RELEASE_BASE}/Codex-CLI-macOS-arm64.tar.gz`,
      urls: {
        primary: `${MADECLAW_TOOLS_RELEASE_BASE}/Codex-CLI-macOS-arm64.tar.gz`,
      },
    },
    "kimi-code": {
      id: "kimi-code",
      title: "Kimi Code 命令行",
      note: "官方 Kimi CLI macOS arm64（MoonshotAI/kimi-cli 1.50.0 镜像）",
      file: "Kimi-Code-CLI-macOS-arm64.tar.gz",
      url: `${MADECLAW_TOOLS_RELEASE_BASE}/Kimi-Code-CLI-macOS-arm64.tar.gz`,
      urls: {
        primary: `${MADECLAW_TOOLS_RELEASE_BASE}/Kimi-Code-CLI-macOS-arm64.tar.gz`,
      },
    },
  },
};

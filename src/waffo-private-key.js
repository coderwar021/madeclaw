/**
 * Normalize Railway / env Waffo private key material before OpenSSL parse.
 * Common failure: literal `\n` in PEM → error:1E08010C:DECODER routines::unsupported
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** User-facing copy — never surface raw OpenSSL decoder strings. */
export const WAFFO_KEY_USER_MESSAGE = "支付暂不可用，请检查密钥配置";

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeWaffoPrivateKeyPem(raw) {
  let s = String(raw ?? "");
  // Strip UTF-8 BOM and outer whitespace
  s = s.replace(/^\uFEFF/, "").trim();
  // Railway / dotenv often wrap the whole PEM in quotes
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  // Literal backslash-n (and mixed \\r\\n) from single-line env vars
  s = s.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n");
  // Real CR from Windows pastes
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Collapse accidental spaces inside base64 lines but keep header/footer lines intact
  const lines = s
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  s = lines.join("\n");

  const hasPkcs8 = /-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/.test(s);
  const hasPkcs1 = /-----BEGIN RSA PRIVATE KEY-----/.test(s);
  if (!hasPkcs8 && !hasPkcs1) {
    const err = new Error(
      "WAFFO_PRIVATE_KEY missing PEM headers (expected BEGIN PRIVATE KEY or BEGIN RSA PRIVATE KEY)",
    );
    err.code = "waffo_key_invalid";
    err.status = 503;
    throw err;
  }
  if (!/-----END (?:ENCRYPTED )?PRIVATE KEY-----/.test(s) && !/-----END RSA PRIVATE KEY-----/.test(s)) {
    const err = new Error("WAFFO_PRIVATE_KEY missing PEM END footer (truncated?)");
    err.code = "waffo_key_invalid";
    err.status = 503;
    throw err;
  }
  // Ensure trailing newline (OpenSSL often expects it)
  if (!s.endsWith("\n")) s += "\n";
  return s;
}

/**
 * Parse PEM into a KeyObject. Throws waffo_key_invalid on decoder failure.
 * @param {string} pem
 * @returns {crypto.KeyObject}
 */
export function createWaffoPrivateKey(pem) {
  const normalized = normalizeWaffoPrivateKeyPem(pem);
  try {
    return crypto.createPrivateKey({ key: normalized, format: "pem" });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const err = new Error(`WAFFO_PRIVATE_KEY invalid PEM (${detail})`);
    err.code = "waffo_key_invalid";
    err.status = 503;
    err.cause = cause;
    throw err;
  }
}

/**
 * Resolve key from inline env or file path.
 * @param {{ appRoot: string, inline?: string, keyPathEnv?: string }} opts
 * @returns {crypto.KeyObject}
 */
export function resolveWaffoPrivateKey(opts) {
  const inline = (opts.inline ?? process.env.WAFFO_PRIVATE_KEY ?? "").trim();
  if (inline) {
    return createWaffoPrivateKey(inline);
  }
  const keyPath = path.resolve(
    opts.appRoot,
    opts.keyPathEnv ||
      process.env.WAFFO_PRIVATE_KEY_PATH ||
      "./secrets/waffo-private.pem",
  );
  if (!fs.existsSync(keyPath)) {
    const err = new Error(
      `WAFFO private key missing: set WAFFO_PRIVATE_KEY or WAFFO_PRIVATE_KEY_PATH (${keyPath})`,
    );
    err.code = "waffo_not_configured";
    err.status = 503;
    throw err;
  }
  return createWaffoPrivateKey(fs.readFileSync(keyPath, "utf8"));
}

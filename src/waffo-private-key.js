/**
 * Normalize Railway / env Waffo private key material before OpenSSL parse.
 * Common failure: literal `\n` / double-escaped `\\n` in PEM →
 * error:1E08010C:DECODER routines::unsupported
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Generic user-facing copy when we cannot classify further. */
export const WAFFO_KEY_USER_MESSAGE = "支付暂不可用，请检查密钥配置";

/** Key env/file present but OpenSSL / PEM shape failed. */
export const WAFFO_KEY_PARSE_USER_MESSAGE =
  "密钥已配置但无法解析，请检查 PEM 头尾与换行";

/** Merchant id missing. */
export const WAFFO_MERCHANT_USER_MESSAGE =
  "支付商户未配置（缺少 WAFFO_MERCHANT_ID），请联系管理员。";

/** No key material at all. */
export const WAFFO_KEY_MISSING_USER_MESSAGE =
  "支付密钥未配置（缺少 WAFFO_PRIVATE_KEY），请联系管理员。";

const PEM_BEGIN_RE =
  /-----BEGIN (?:(?:ENCRYPTED )?PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY)-----/;
const PEM_END_RE =
  /-----END (?:(?:ENCRYPTED )?PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY)-----/;

/**
 * Safe log fingerprint — PEM header/footer prefixes only, never base64 body.
 * @param {string} raw
 * @returns {{ beginPrefix: string, endSuffix: string, charCount: number, lineCount: number, hasLiteralBackslashN: boolean, hasBegin: boolean, hasEnd: boolean }}
 */
export function waffoPemFingerprint(raw) {
  const s = String(raw ?? "");
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const begin = lines.find((l) => /BEGIN/.test(l)) || "";
  const end = lines.find((l) => /END/.test(l)) || "";
  return {
    beginPrefix: begin.slice(0, 20),
    endSuffix: end.slice(Math.max(0, end.length - 20)),
    charCount: s.length,
    lineCount: lines.length,
    hasLiteralBackslashN: /\\n/.test(s),
    hasBegin: PEM_BEGIN_RE.test(s),
    hasEnd: PEM_END_RE.test(s),
  };
}

/**
 * @param {string} raw
 * @returns {boolean}
 */
export function looksLikePemFilePath(raw) {
  const t = String(raw ?? "").trim();
  if (!t || /-----BEGIN /.test(t) || t.includes("\n") || /\\n/.test(t)) {
    return false;
  }
  if (/\.(pem|key|crt)$/i.test(t)) return true;
  return /^(?:\.\/|\.\.\/|\/|[A-Za-z]:[\\/])/.test(t);
}

/**
 * Unescape Railway / JSON / dotenv newline escapes, including double-escaped forms.
 * @param {string} s
 * @returns {string}
 */
function unescapePemNewlines(s) {
  let out = s;
  // Collapse double-escaped first: \\n → \n (literal), then \n → real newline.
  for (let i = 0; i < 4; i += 1) {
    if (!/\\\\[rn]/.test(out)) break;
    out = out
      .replace(/\\\\r\\\\n/g, "\\n")
      .replace(/\\\\n/g, "\\n")
      .replace(/\\\\r/g, "\\r");
  }
  out = out.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n");
  out = out.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return out;
}

/**
 * Rebuild PEM when headers/body were pasted as one space-separated line.
 * @param {string} s
 * @returns {string}
 */
function reflowCollapsedPem(s) {
  if ((s.match(/\n/g) || []).length >= 2) return s;
  const m = s.match(
    /^(-----BEGIN [^-]+-----)\s+([\s\S]+?)\s+(-----END [^-]+-----)\s*$/,
  );
  if (!m) return s;
  const body = m[2].replace(/\s+/g, "");
  if (!body) return s;
  const wrapped = body.match(/.{1,64}/g)?.join("\n") || body;
  return `${m[1]}\n${wrapped}\n${m[3]}`;
}

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
    s = s.slice(1, -1).replace(/^\uFEFF/, "").trim();
  }

  if (looksLikePemFilePath(s)) {
    const err = new Error(
      "WAFFO_PRIVATE_KEY looks like a file path — put PEM body in WAFFO_PRIVATE_KEY or set WAFFO_PRIVATE_KEY_PATH",
    );
    err.code = "waffo_key_invalid";
    err.status = 503;
    throw err;
  }

  s = unescapePemNewlines(s);
  s = reflowCollapsedPem(s);

  // Collapse accidental spaces inside base64 lines but keep header/footer lines intact
  const lines = s
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  s = lines.join("\n");

  if (!PEM_BEGIN_RE.test(s)) {
    const err = new Error(
      "WAFFO_PRIVATE_KEY missing PEM headers (expected BEGIN PRIVATE KEY, BEGIN RSA PRIVATE KEY, or BEGIN EC PRIVATE KEY)",
    );
    err.code = "waffo_key_invalid";
    err.status = 503;
    err.fingerprint = waffoPemFingerprint(raw);
    throw err;
  }
  if (!PEM_END_RE.test(s)) {
    const err = new Error("WAFFO_PRIVATE_KEY missing PEM END footer (truncated?)");
    err.code = "waffo_key_invalid";
    err.status = 503;
    err.fingerprint = waffoPemFingerprint(raw);
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
    err.fingerprint = waffoPemFingerprint(pem);
    throw err;
  }
}

/**
 * Resolve key from inline env or file path.
 * @param {{ appRoot: string, inline?: string, keyPathEnv?: string }} opts
 * @returns {crypto.KeyObject}
 */
export function resolveWaffoPrivateKey(opts) {
  let inline = (opts.inline ?? process.env.WAFFO_PRIVATE_KEY ?? "").trim();
  if (inline && looksLikePemFilePath(inline)) {
    // Operators sometimes paste the path into WAFFO_PRIVATE_KEY itself.
    const asPath = path.isAbsolute(inline)
      ? inline
      : path.resolve(opts.appRoot, inline);
    if (fs.existsSync(asPath)) {
      return createWaffoPrivateKey(fs.readFileSync(asPath, "utf8"));
    }
  }
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

/**
 * Safe public status — booleans only, no key material.
 * @param {{ appRoot: string }} opts
 * @returns {{ merchantConfigured: boolean, privateKeyConfigured: boolean, privateKeyParseOk: boolean }}
 */
export function probeWaffoPrivateKeyStatus(opts) {
  const merchantConfigured = Boolean((process.env.WAFFO_MERCHANT_ID || "").trim());
  const inline = (process.env.WAFFO_PRIVATE_KEY || "").trim();
  const keyPath = path.resolve(
    opts.appRoot,
    process.env.WAFFO_PRIVATE_KEY_PATH || "./secrets/waffo-private.pem",
  );
  const pathConfigured =
    Boolean(inline && looksLikePemFilePath(inline) && fs.existsSync(
      path.isAbsolute(inline) ? inline : path.resolve(opts.appRoot, inline),
    )) || fs.existsSync(keyPath);
  const privateKeyConfigured = Boolean(inline) || pathConfigured;
  let privateKeyParseOk = false;
  if (privateKeyConfigured) {
    try {
      resolveWaffoPrivateKey({ appRoot: opts.appRoot });
      privateKeyParseOk = true;
    } catch {
      privateKeyParseOk = false;
    }
  }
  return { merchantConfigured, privateKeyConfigured, privateKeyParseOk };
}

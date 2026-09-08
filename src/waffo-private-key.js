/**
 * Normalize Railway / env Waffo private key material before OpenSSL parse.
 * Common failures: literal `\n` / `\\n` / `\\\n`, space-collapsed PEM,
 * outer quotes, JSON-escaped strings, UTF-8 BOM, bare base64 DER (no headers).
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

const HEADER_TYPE_RE =
  /-----BEGIN ([A-Z0-9 ]+)-----/;

/**
 * Bucket raw length for safe diagnostics (never exact size of secret body alone).
 * @param {number} n
 * @returns {string}
 */
export function lengthBucket(n) {
  if (n <= 0) return "0";
  if (n < 100) return "<100";
  if (n < 500) return "100-499";
  if (n < 2000) return "500-1999";
  if (n < 8000) return "2000-7999";
  return "8000+";
}

/**
 * Detect PEM / related header label from raw env text (safe: label only).
 * @param {string} s
 * @returns {string}
 */
export function detectPemHeaderType(s) {
  const m = String(s ?? "").match(HEADER_TYPE_RE);
  if (m) return m[1].trim();
  // Headers may be space-collapsed or dash-mangled — soft detect
  const u = String(s ?? "").toUpperCase();
  if (/BEGIN\s+ENCRYPTED\s+PRIVATE\s+KEY/.test(u)) return "ENCRYPTED PRIVATE KEY";
  if (/BEGIN\s+RSA\s+PRIVATE\s+KEY/.test(u)) return "RSA PRIVATE KEY";
  if (/BEGIN\s+EC\s+PRIVATE\s+KEY/.test(u)) return "EC PRIVATE KEY";
  if (/BEGIN\s+OPENSSH\s+PRIVATE\s+KEY/.test(u)) return "OPENSSH PRIVATE KEY";
  if (/BEGIN\s+PRIVATE\s+KEY/.test(u)) return "PRIVATE KEY";
  if (/BEGIN\s+PUBLIC\s+KEY/.test(u)) return "PUBLIC KEY";
  if (/BEGIN\s+CERTIFICATE/.test(u)) return "CERTIFICATE";
  return "none";
}

/**
 * @param {string} s
 * @returns {boolean}
 */
function looksLikeBareBase64Key(s) {
  const t = String(s ?? "").replace(/\s+/g, "");
  if (t.length < 80 || t.length > 20000) return false;
  if (/-----BEGIN /.test(String(s ?? ""))) return false;
  // Standard base64 (PEM body / DER)
  if (!/^[A-Za-z0-9+/=]+$/.test(t)) return false;
  // PKCS#8 RSA private keys commonly start with MII…
  return /^MII[A-Za-z0-9+/=]+$/.test(t);
}

/**
 * Safe log / status fingerprint — never base64 body or key material.
 * @param {string} raw
 * @param {{ unescapePassCount?: number, parseErrorCode?: string | null }} [extra]
 */
export function waffoPemFingerprint(raw, extra = {}) {
  const s = String(raw ?? "");
  const headerType = detectPemHeaderType(s);
  const hasBegin = PEM_BEGIN_RE.test(s) || headerType !== "none";
  const hasEnd =
    PEM_END_RE.test(s) ||
    /-----END [A-Z0-9 ]+-----/.test(s) ||
    /END\s+(?:ENCRYPTED\s+)?(?:RSA\s+|EC\s+)?PRIVATE\s+KEY/.test(s.toUpperCase());
  const hadBom = s.charCodeAt(0) === 0xfeff || s.startsWith("\uFEFF");
  const trimmed = s.replace(/^\uFEFF/, "").trim();
  const hadOuterQuotes =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  const hadLiteralBackslashN = /\\[rn]/.test(s);
  const hadLiteralDoubleBackslashN = /\\\\[rn]/.test(s);
  return {
    headerType,
    hasBegin: Boolean(hasBegin && headerType !== "none"),
    hasEnd: Boolean(hasEnd),
    lengthBucket: lengthBucket(s.length),
    unescapePassCount: extra.unescapePassCount ?? 0,
    hadBom,
    hadOuterQuotes,
    hadLiteralBackslashN,
    hadLiteralDoubleBackslashN,
    looksLikeBareBase64: looksLikeBareBase64Key(s),
    parseErrorCode: extra.parseErrorCode ?? null,
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
  if (looksLikeBareBase64Key(t)) return false;
  if (/\.(pem|key|crt)$/i.test(t)) return true;
  return /^(?:\.\/|\.\.\/|\/|[A-Za-z]:[\\/])/.test(t);
}

/**
 * Strip markdown fences / env-key prefixes / zero-width junk (not body content).
 * @param {string} s
 * @returns {string}
 */
function stripPemEnvelopeNoise(s) {
  let out = s;
  out = out.replace(/^\uFEFF/, "");
  // Zero-width / BOM variants that break OpenSSL
  out = out.replace(/[\u200B-\u200D\uFEFF]/g, "");
  // Markdown ```pem ... ```
  out = out.replace(/^```(?:pem|key|text)?\s*/i, "").replace(/\s*```$/i, "");
  out = out.trim();
  // Copied ".env" line: WAFFO_PRIVATE_KEY=-----BEGIN...
  out = out.replace(/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?=-----BEGIN )/i, "");
  // Unicode dashes → ASCII hyphen (Railway paste from docs)
  out = out.replace(/[\u2010-\u2015\u2212]/g, "-");
  return out.trim();
}

/**
 * If the whole value is a JSON string literal, parse it (unescapes \n / \uXXXX).
 * @param {string} s
 * @returns {string}
 */
function tryJsonStringUnwrap(s) {
  const t = s.trim();
  if (!(t.startsWith('"') && t.endsWith('"') && t.length >= 2)) return s;
  try {
    const parsed = JSON.parse(t);
    if (typeof parsed === "string") return parsed;
  } catch {
    // fall through — may be PEM with stray quotes
  }
  return s;
}

/**
 * Unescape Railway / JSON / dotenv newline escapes, including multi-escaped forms.
 * @param {string} s
 * @returns {{ text: string, passCount: number }}
 */
function unescapePemNewlines(s) {
  let out = s;
  let passCount = 0;
  // Collapse multi-escaped first: \\\\n → \\n → \n (literal), repeatedly.
  for (let i = 0; i < 8; i += 1) {
    if (!/\\\\[rn]/.test(out)) break;
    out = out
      .replace(/\\\\r\\\\n/g, "\\n")
      .replace(/\\\\n/g, "\\n")
      .replace(/\\\\r/g, "\\r");
    passCount += 1;
  }
  if (/\\[rn]/.test(out)) {
    out = out
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n");
    passCount += 1;
  }
  // Real CR / CRLF
  if (/\r/.test(out)) {
    out = out.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    passCount += 1;
  }
  return { text: out, passCount };
}

/**
 * Rebuild PEM when headers/body were pasted as one space-separated (or glued) line.
 * @param {string} s
 * @returns {string}
 */
function reflowCollapsedPem(s) {
  if ((s.match(/\n/g) || []).length >= 2) {
    // Still fix body lines that contain internal spaces
    return reflowPemBodyWhitespace(s);
  }
  const m = s.match(
    /^(-----BEGIN [^-]+-----)\s*([\s\S]+?)\s*(-----END [^-]+-----)\s*$/,
  );
  if (!m) return s;
  const body = m[2].replace(/\s+/g, "");
  if (!body) return s;
  const wrapped = body.match(/.{1,64}/g)?.join("\n") || body;
  return `${m[1]}\n${wrapped}\n${m[3]}`;
}

/**
 * Remove whitespace inside base64 body lines; keep header/footer intact.
 * @param {string} s
 * @returns {string}
 */
function reflowPemBodyWhitespace(s) {
  const lines = s.split("\n").map((line) => line.trim()).filter(Boolean);
  const beginIdx = lines.findIndex((l) => /-----BEGIN /.test(l));
  const endIdx = lines.findIndex((l) => /-----END /.test(l));
  if (beginIdx < 0 || endIdx <= beginIdx) return lines.join("\n");
  const header = lines[beginIdx];
  const footer = lines[endIdx];
  const body = lines
    .slice(beginIdx + 1, endIdx)
    .join("")
    .replace(/\s+/g, "");
  if (!body) return `${header}\n${footer}`;
  const wrapped = body.match(/.{1,64}/g)?.join("\n") || body;
  return `${header}\n${wrapped}\n${footer}`;
}

/**
 * Wrap bare base64 DER as PKCS#8 PEM (most common Waffo download shape).
 * @param {string} raw
 * @returns {string}
 */
function wrapBareBase64AsPkcs8Pem(raw) {
  const body = String(raw).replace(/\s+/g, "");
  const wrapped = body.match(/.{1,64}/g)?.join("\n") || body;
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
}

/**
 * Try DER formats when PEM headers are absent.
 * @param {string} raw
 * @returns {crypto.KeyObject | null}
 */
function tryCreateKeyFromBareBase64(raw) {
  const body = String(raw).replace(/\s+/g, "");
  if (!looksLikeBareBase64Key(body)) return null;
  let der;
  try {
    der = Buffer.from(body, "base64");
  } catch {
    return null;
  }
  if (der.length < 32) return null;
  for (const type of /** @type {const} */ (["pkcs8", "pkcs1", "sec1"])) {
    try {
      return crypto.createPrivateKey({ key: der, format: "der", type });
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * @param {string} raw
 * @returns {{ pem: string, unescapePassCount: number, usedBareBase64Wrap: boolean }}
 */
export function normalizeWaffoPrivateKeyPemDetailed(raw) {
  let s = String(raw ?? "");
  let unescapePassCount = 0;

  s = stripPemEnvelopeNoise(s);
  s = tryJsonStringUnwrap(s);
  s = stripPemEnvelopeNoise(s);

  // Railway / dotenv often wrap the whole PEM in quotes (non-JSON)
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1);
    s = stripPemEnvelopeNoise(s);
  }

  if (looksLikePemFilePath(s)) {
    const err = new Error(
      "WAFFO_PRIVATE_KEY looks like a file path — put PEM body in WAFFO_PRIVATE_KEY or set WAFFO_PRIVATE_KEY_PATH",
    );
    err.code = "waffo_key_invalid";
    err.status = 503;
    err.fingerprint = waffoPemFingerprint(raw, {
      unescapePassCount,
      parseErrorCode: "path_in_env",
    });
    throw err;
  }

  const unescaped = unescapePemNewlines(s);
  s = unescaped.text;
  unescapePassCount = unescaped.passCount;

  let usedBareBase64Wrap = false;
  if (!PEM_BEGIN_RE.test(s) && looksLikeBareBase64Key(s)) {
    s = wrapBareBase64AsPkcs8Pem(s);
    usedBareBase64Wrap = true;
  }

  s = reflowCollapsedPem(s);

  // Collapse empty lines; trim each line
  const lines = s
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  s = lines.join("\n");

  if (!PEM_BEGIN_RE.test(s)) {
    const err = new Error(
      "WAFFO_PRIVATE_KEY missing PEM headers (expected BEGIN PRIVATE KEY, BEGIN RSA PRIVATE KEY, or BEGIN EC PRIVATE KEY) — bare base64 without headers is also accepted",
    );
    err.code = "waffo_key_invalid";
    err.status = 503;
    err.fingerprint = waffoPemFingerprint(raw, {
      unescapePassCount,
      parseErrorCode: "missing_begin",
    });
    throw err;
  }
  if (!PEM_END_RE.test(s)) {
    const err = new Error("WAFFO_PRIVATE_KEY missing PEM END footer (truncated?)");
    err.code = "waffo_key_invalid";
    err.status = 503;
    err.fingerprint = waffoPemFingerprint(raw, {
      unescapePassCount,
      parseErrorCode: "missing_end",
    });
    throw err;
  }

  const headerType = detectPemHeaderType(s);
  if (headerType === "ENCRYPTED PRIVATE KEY") {
    const err = new Error(
      "WAFFO_PRIVATE_KEY is encrypted PKCS#8 — use an unencrypted private key (no passphrase)",
    );
    err.code = "waffo_key_invalid";
    err.status = 503;
    err.fingerprint = waffoPemFingerprint(raw, {
      unescapePassCount,
      parseErrorCode: "encrypted",
    });
    throw err;
  }

  if (!s.endsWith("\n")) s += "\n";
  return { pem: s, unescapePassCount, usedBareBase64Wrap };
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeWaffoPrivateKeyPem(raw) {
  return normalizeWaffoPrivateKeyPemDetailed(raw).pem;
}

/**
 * Parse PEM into a KeyObject. Throws waffo_key_invalid on decoder failure.
 * @param {string} pem
 * @returns {crypto.KeyObject}
 */
export function createWaffoPrivateKey(pem) {
  // Bare DER base64 (no headers) — try before requiring PEM shape
  const bare = tryCreateKeyFromBareBase64(String(pem ?? ""));
  if (bare) return bare;

  const { pem: normalized, unescapePassCount } =
    normalizeWaffoPrivateKeyPemDetailed(pem);
  try {
    return crypto.createPrivateKey({ key: normalized, format: "pem" });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const err = new Error(`WAFFO_PRIVATE_KEY invalid PEM (${detail})`);
    err.code = "waffo_key_invalid";
    err.status = 503;
    err.cause = cause;
    err.fingerprint = waffoPemFingerprint(pem, {
      unescapePassCount,
      parseErrorCode: "decoder",
    });
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
 * Safe public status — booleans + non-secret fingerprint only.
 * @param {{ appRoot: string }} opts
 */
export function probeWaffoPrivateKeyStatus(opts) {
  const merchantConfigured = Boolean((process.env.WAFFO_MERCHANT_ID || "").trim());
  const inline = (process.env.WAFFO_PRIVATE_KEY || "").trim();
  const keyPath = path.resolve(
    opts.appRoot,
    process.env.WAFFO_PRIVATE_KEY_PATH || "./secrets/waffo-private.pem",
  );
  const pathConfigured =
    Boolean(
      inline &&
        looksLikePemFilePath(inline) &&
        fs.existsSync(
          path.isAbsolute(inline) ? inline : path.resolve(opts.appRoot, inline),
        ),
    ) || fs.existsSync(keyPath);
  const privateKeyConfigured = Boolean(inline) || pathConfigured;
  let privateKeyParseOk = false;
  /** @type {ReturnType<typeof waffoPemFingerprint> | null} */
  let privateKeyDiag = null;
  if (privateKeyConfigured) {
    const rawForDiag = inline || (pathConfigured ? "<file>" : "");
    try {
      resolveWaffoPrivateKey({ appRoot: opts.appRoot });
      privateKeyParseOk = true;
      if (inline) {
        // Successful parse — still expose safe shape hints (no body)
        let unescapePassCount = 0;
        try {
          unescapePassCount =
            normalizeWaffoPrivateKeyPemDetailed(inline).unescapePassCount;
        } catch {
          unescapePassCount = 0;
        }
        privateKeyDiag = waffoPemFingerprint(inline, {
          unescapePassCount,
          parseErrorCode: null,
        });
      } else {
        privateKeyDiag = {
          headerType: "file",
          hasBegin: true,
          hasEnd: true,
          lengthBucket: "file",
          unescapePassCount: 0,
          hadBom: false,
          hadOuterQuotes: false,
          hadLiteralBackslashN: false,
          hadLiteralDoubleBackslashN: false,
          looksLikeBareBase64: false,
          parseErrorCode: null,
        };
      }
    } catch (e) {
      privateKeyParseOk = false;
      const fp =
        e && typeof e === "object" && e.fingerprint
          ? e.fingerprint
          : waffoPemFingerprint(inline || rawForDiag, {
              parseErrorCode: "decoder",
            });
      privateKeyDiag = fp;
    }
  }
  return {
    merchantConfigured,
    privateKeyConfigured,
    privateKeyParseOk,
    privateKeyDiag,
  };
}

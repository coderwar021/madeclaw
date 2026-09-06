/**
 * MadeClaw site auth — scrypt password hashes + opaque session tokens.
 * Fail closed: never store plaintext; reject malformed credentials.
 */
import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;
const SESSION_BYTES = 32;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = "mc_sid";
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export { COOKIE_NAME, SESSION_TTL_MS, MIN_PASSWORD };

export function normalizeUsername(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

export function normalizeEmail(raw) {
  const e = String(raw || "")
    .trim()
    .toLowerCase();
  return e || "";
}

export function validateRegisterInput({ username, email, password }) {
  const u = normalizeUsername(username);
  const e = normalizeEmail(email);
  const p = String(password || "");
  if (!USERNAME_RE.test(u)) {
    return { ok: false, error: "invalid_username", detail: "用户名需 3–32 位字母数字或下划线" };
  }
  if (e && !EMAIL_RE.test(e)) {
    return { ok: false, error: "invalid_email", detail: "邮箱格式无效" };
  }
  if (p.length < MIN_PASSWORD || p.length > MAX_PASSWORD) {
    return {
      ok: false,
      error: "invalid_password",
      detail: `密码长度需 ${MIN_PASSWORD}–${MAX_PASSWORD} 位`,
    };
  }
  return { ok: true, username: u, email: e || null, password: p };
}

export function validateLoginInput({ login, password }) {
  const id = String(login || "")
    .trim()
    .toLowerCase();
  const p = String(password || "");
  if (!id || p.length < 1 || p.length > MAX_PASSWORD) {
    return { ok: false, error: "invalid_credentials" };
  }
  return { ok: true, login: id, password: p };
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64url"),
    Buffer.from(derived).toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password, encoded) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch {
    return false;
  }
  if (salt.length < 8 || expected.length < 32) return false;
  const derived = await scryptAsync(password, salt, expected.length, { N, r, p });
  const got = Buffer.from(derived);
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(got, expected);
}

export function mintUserId() {
  return `mc_${crypto.randomBytes(8).toString("hex")}`;
}

export function mintSessionToken() {
  return crypto.randomBytes(SESSION_BYTES).toString("base64url");
}

export function parseCookies(req) {
  const header = req.get("cookie") || "";
  /** @type {Record<string,string>} */
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function sessionCookieOptions(isProd, maxAgeSec = Math.floor(SESSION_TTL_MS / 1000)) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: maxAgeSec,
  };
}

export function formatSetCookie(name, value, opts) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) parts.push("Secure");
  if (opts.httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}

export function clearSessionCookie(isProd) {
  return formatSetCookie(COOKIE_NAME, "", {
    ...sessionCookieOptions(isProd, 0),
    maxAge: 0,
  });
}

export function publicUser(row) {
  if (!row) return null;
  return {
    userId: row.userId,
    username: row.username,
    email: row.email || null,
    createdAt: row.createdAt,
  };
}

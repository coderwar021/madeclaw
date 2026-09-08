#!/usr/bin/env node
/**
 * Unit smoke: PEM normalization for Railway-style escaped / collapsed keys.
 * Uses ephemeral generated RSA/EC only — no merchant secrets.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createWaffoPrivateKey,
  detectPemHeaderType,
  looksLikePemFilePath,
  normalizeWaffoPrivateKeyPem,
  normalizeWaffoPrivateKeyPemDetailed,
  probeWaffoPrivateKeyStatus,
  resolveWaffoPrivateKey,
  waffoPemFingerprint,
} from "../src/waffo-private-key.js";

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" });
const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" });
const derB64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");

// Escaped newlines as pasted into Railway Variables (single line)
const escaped = JSON.stringify(pkcs8).slice(1, -1); // keeps \\n literals
assert.ok(escaped.includes("\\n"), "fixture must contain literal \\\\n");
assert.ok(!escaped.includes("\n"), "escaped fixture must be single-line");

const normalized = normalizeWaffoPrivateKeyPem(escaped);
assert.ok(normalized.includes("-----BEGIN PRIVATE KEY-----"));
assert.ok(normalized.includes("-----END PRIVATE KEY-----"));
assert.ok(normalized.includes("\n"), "normalized PEM must have real newlines");
assert.equal(normalized.includes("\\n"), false);

const keyFromEscaped = createWaffoPrivateKey(escaped);
assert.equal(keyFromEscaped.type, "private");

// Double-escaped \\\\n (common when env is re-serialized)
const doubleEscaped = escaped.replace(/\\n/g, "\\\\n");
assert.ok(doubleEscaped.includes("\\\\n"));
const keyFromDouble = createWaffoPrivateKey(doubleEscaped);
assert.equal(keyFromDouble.type, "private");

// Triple-escaped \\\\\\n (Railway / JSON / shell layers)
const tripleEscaped = escaped.replace(/\\n/g, "\\\\\\\\n");
assert.ok(tripleEscaped.includes("\\\\\\\\n") || /\\{3,}n/.test(tripleEscaped));
const keyFromTriple = createWaffoPrivateKey(tripleEscaped);
assert.equal(keyFromTriple.type, "private");
assert.ok(
  normalizeWaffoPrivateKeyPemDetailed(tripleEscaped).unescapePassCount >= 2,
);

// Literal \\r\\n escapes
const crlfEscaped = escaped.replace(/\\n/g, "\\r\\n");
assert.equal(createWaffoPrivateKey(crlfEscaped).type, "private");

// Space-separated single line (no newlines)
const spaced = pkcs8.replace(/\n/g, " ").trim();
assert.equal(spaced.includes("\n"), false);
const keyFromSpaced = createWaffoPrivateKey(spaced);
assert.equal(keyFromSpaced.type, "private");

// Glued header+body (no space after BEGIN line)
const glued = pkcs8.replace(/\n/g, "");
assert.equal(createWaffoPrivateKey(glued).type, "private");

// Wrapped in extra quotes (common env paste)
const quoted = `"${escaped}"`;
const keyFromQuoted = createWaffoPrivateKey(quoted);
assert.equal(keyFromQuoted.type, "private");

// Full JSON string value (quotes + escaped newlines)
const jsonWrapped = JSON.stringify(pkcs8);
assert.equal(createWaffoPrivateKey(jsonWrapped).type, "private");

// UTF-8 BOM
const bombed = `\uFEFF${escaped}`;
assert.equal(createWaffoPrivateKey(bombed).type, "private");

// Bare base64 DER — Waffo paste without PEM headers (observed operator failure mode)
assert.equal(detectPemHeaderType(derB64), "none");
assert.equal(createWaffoPrivateKey(derB64).type, "private");
assert.equal(createWaffoPrivateKey(derB64.match(/.{1,64}/g).join(" ")).type, "private");

// PKCS#1 RSA header
const keyFromPkcs1 = createWaffoPrivateKey(pkcs1.replace(/\n/g, "\\n"));
assert.equal(keyFromPkcs1.type, "private");

// EC SEC1 header
const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const ecSec1 = ec.privateKey.export({ type: "sec1", format: "pem" });
assert.ok(ecSec1.includes("BEGIN EC PRIVATE KEY"));
const keyFromEc = createWaffoPrivateKey(ecSec1.replace(/\n/g, "\\n"));
assert.equal(keyFromEc.type, "private");

// Fingerprint never includes base64 body markers beyond header label
const fp = waffoPemFingerprint(escaped);
assert.equal(fp.headerType, "PRIVATE KEY");
assert.equal(fp.hasBegin, true);
assert.equal(fp.hasEnd, true);
assert.equal(fp.hadLiteralBackslashN, true);
assert.ok(["500-1999", "2000-7999"].includes(fp.lengthBucket));
assert.equal(JSON.stringify(fp).includes(derB64.slice(0, 32)), false);

// Path in WAFFO_PRIVATE_KEY → read file
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waffo-key-"));
const pemPath = path.join(tmpDir, "waffo-private.pem");
fs.writeFileSync(pemPath, pkcs8, "utf8");
assert.equal(looksLikePemFilePath(pemPath), true);
const keyFromPathInline = resolveWaffoPrivateKey({
  appRoot: tmpDir,
  inline: pemPath,
});
assert.equal(keyFromPathInline.type, "private");
fs.rmSync(tmpDir, { recursive: true, force: true });

// Signing still works with KeyObject from normalized PEM
const sig = crypto.sign("sha256", Buffer.from("madeclaw-smoke"), keyFromEscaped);
assert.ok(sig.length > 0);

// Invalid: missing headers → friendly code, not raw OpenSSL at call site
let threw = false;
try {
  normalizeWaffoPrivateKeyPem("not-a-pem");
} catch (e) {
  threw = true;
  assert.equal(e.code, "waffo_key_invalid");
  assert.equal(e.fingerprint.parseErrorCode, "missing_begin");
}
assert.ok(threw, "expected waffo_key_invalid");

// Garbage base64 with headers → createPrivateKey fails closed
threw = false;
try {
  createWaffoPrivateKey(
    "-----BEGIN PRIVATE KEY-----\\nYWJjZGVmZ2hpams=\\n-----END PRIVATE KEY-----\\n",
  );
} catch (e) {
  threw = true;
  assert.equal(e.code, "waffo_key_invalid");
  assert.ok(e.fingerprint);
  assert.equal(e.fingerprint.parseErrorCode, "decoder");
}
assert.ok(threw, "expected invalid PEM to throw waffo_key_invalid");

// Probe exposes diag without secrets
const prev = process.env.WAFFO_PRIVATE_KEY;
process.env.WAFFO_PRIVATE_KEY = escaped;
process.env.WAFFO_MERCHANT_ID = process.env.WAFFO_MERCHANT_ID || "MER_test";
const probe = probeWaffoPrivateKeyStatus({ appRoot: process.cwd() });
assert.equal(probe.privateKeyConfigured, true);
assert.equal(probe.privateKeyParseOk, true);
assert.ok(probe.privateKeyDiag);
assert.equal(probe.privateKeyDiag.headerType, "PRIVATE KEY");
assert.equal(JSON.stringify(probe).includes("MII"), false);
if (prev === undefined) delete process.env.WAFFO_PRIVATE_KEY;
else process.env.WAFFO_PRIVATE_KEY = prev;

console.log("WAFFO_KEY_OK");

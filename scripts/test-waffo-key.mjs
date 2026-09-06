#!/usr/bin/env node
/**
 * Unit smoke: PEM normalization for Railway-style \\n-escaped keys.
 * Uses ephemeral generated RSA only — no merchant secrets.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  createWaffoPrivateKey,
  normalizeWaffoPrivateKeyPem,
} from "../src/waffo-private-key.js";

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" });
const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" });

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

// Wrapped in extra quotes (common env paste)
const quoted = `"${escaped}"`;
const keyFromQuoted = createWaffoPrivateKey(quoted);
assert.equal(keyFromQuoted.type, "private");

// PKCS#1 RSA header
const keyFromPkcs1 = createWaffoPrivateKey(pkcs1.replace(/\n/g, "\\n"));
assert.equal(keyFromPkcs1.type, "private");

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
  assert.ok(!/DECODER routines/.test(e.message) || e.code === "waffo_key_invalid");
}
assert.ok(threw, "expected invalid PEM to throw waffo_key_invalid");

console.log("WAFFO_KEY_OK");

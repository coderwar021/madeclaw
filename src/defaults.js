/**
 * MadeClaw product out-of-box defaults (开箱即用).
 * Keep identical across plugin, railway-app, apply script, and templates.
 * Operators may override later via env / plugin config — not a per-user secret.
 */
export const MADECLAW_PUBLIC_ORIGIN = "https://madeclaw.up.railway.app";

/** Shared Bearer for plugin ↔ billing when BILLING_SERVICE_TOKEN unset. Change later in prod. */
export const MADECLAW_DEFAULT_SERVICE_TOKEN = "madeclaw-oob-service-token-v1";

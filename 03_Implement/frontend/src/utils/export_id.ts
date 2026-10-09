// SEC-AUDIT-DUP-01: one identifier per export action (copy / .md download /
// task.json download). The backend suppresses only a repeat of the same
// exportId, so two separate exports of the same kind are both recorded.
// The value is opaque. It must match the backend pattern
// ^[A-Za-z0-9_-]{8,64}$ (routes/docs.py ExportAuditPayload.exportId).

const FALLBACK_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function createExportId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the random-string fallback below.
  }
  // Environments without crypto.randomUUID (for example some non-secure contexts)
  // still usually provide getRandomValues. Math.random is the last resort.
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => FALLBACK_ALPHABET[byte % FALLBACK_ALPHABET.length]).join("");
}

/**
 * `yi.handoff.receipt/v1` の読み取りと照合（Producer側、G2）。
 *
 * 位置づけ:
 * - Receiptは**Consumerの観測**であり、意味受理・権限・業務Effectではない。
 * - ProducerはReceiptを信じない。自分の票のdigestと照合し、Receiptが主張する
 *   claimがProducer側で受理可能な種類かを独立に判定する。
 * - このModuleはI/Oを行わない。読み取りは呼び出し側が明示的に行う。
 *
 * 既存契約との関係:
 * - `yi.handoff.context/v1`（ADR-0117）の票とReceiptの対応づけだけを扱う。
 * - `include`する語彙はConsumer（SHO）の`handoff_envelope.cjs`と共有しない。
 *   片方のbugがもう片方へ無音で伝播しないため、規則は試験で合わせる。
 */

export const HANDOFF_RECEIPT_SCHEMA = "yi.handoff.receipt/v1";
export const HANDOFF_READBACK_SCHEMA = "yi.handoff.receipt-write/v1";

/** Receiptが主張してよいclaim。Producer側が受理できるのはこの範囲だけ。 */
const ACCEPTABLE_CLAIMS = [
  "independentReread",
  "payloadMatchesTicket",
  "conversationHistoryIncluded",
  "authorityCarried",
  "sourceRevisionCurrent",
  "originalSourcesRead",
  "meaningAccepted",
  "writerInvoked",
  "externalSourcesAcquired",
  "externalDisclosure",
  "sessionInheritedAuthority",
] as const;

/**
 * Producerが**受理しない**claim。Receiptがこれらを真にしても、Producerは
 * 「Consumerがそう観測した」以上の意味を与えない。
 */
const NON_ACCEPTABLE_CLAIMS = ["meaningAccepted", "sourceRevisionCurrent"] as const;

const AUTHORITY_BEARING_KEYS = new Set([
  "grant", "grants", "token", "tokens", "credential", "credentials",
  "secret", "secrets", "password", "passphrase", "apikey", "authorization",
  "permission", "permissions", "role", "roles", "entitlement", "lease",
  "scopegrant", "sessiontoken", "accesstoken", "refreshtoken",
]);

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export class HandoffReceiptError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HandoffReceiptError";
    this.code = code;
  }
}

export type ReceiptReviewStatus =
  | "matched"
  | "mismatch"
  | "claim-not-accepted"
  | "receipt-invalid"
  | "receipt-authority";

export type ReceiptReview = {
  schema: "yi.handoff.receipt-review/v1";
  status: ReceiptReviewStatus;
  /** Receiptが申告した票のdigest。照合に使うだけ。 */
  receiptTicketSha256: string | null;
  /** Producer側の票のdigest。呼び出し側が渡す。 */
  expectedTicketSha256: string | null;
  /** 照合したclaimのうち、Producerが意味を与えないもの。 */
  nonAcceptableClaims: string[];
  /** Receiptが持っていたが、Producer側の語彙にないclaim。unknownとして残す。 */
  unknownClaims: string[];
  reason: string;
};

function findAuthorityBearingKey(value: unknown, path = "$"): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findAuthorityBearingKey(value[index], `${path}[${index}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (AUTHORITY_BEARING_KEYS.has(key.toLowerCase())) return `${path}.${key}`;
    const found = findAuthorityBearingKey(child, `${path}.${key}`);
    if (found !== null) return found;
  }
  return null;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HandoffReceiptError("handoff-receipt-missing-field", `${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Receiptを**Producerの視点で**照合する。
 *
 * - `expectedTicketSha256` は呼び出し側が自分の票から計算して渡す。Receiptの自己申告を使わない。
 * - digestが一致しなければ `mismatch`。
 * - Receiptが `meaningAccepted` や `sourceRevisionCurrent` を真にしていれば
 *   `claim-not-accepted`。Consumerの観測をProducerの意味受理へ昇格させない。
 * - 権限系keyがあれば `receipt-authority`。
 */
export function reviewHandoffReceipt(
  receipt: unknown,
  expectedTicketSha256: string,
): ReceiptReview {
  const base: ReceiptReview = {
    schema: "yi.handoff.receipt-review/v1",
    status: "receipt-invalid",
    receiptTicketSha256: null,
    expectedTicketSha256: null,
    nonAcceptableClaims: [],
    unknownClaims: [],
    reason: "",
  };
  if (typeof expectedTicketSha256 !== "string" || !SHA256_PATTERN.test(expectedTicketSha256)) {
    throw new HandoffReceiptError(
      "handoff-receipt-expected-digest",
      "expectedTicketSha256 must be sha256:<64 lowercase hex>",
    );
  }
  base.expectedTicketSha256 = expectedTicketSha256;
  if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
    return { ...base, reason: "receipt must be a JSON object" };
  }
  const value = receipt as Record<string, unknown>;
  const leak = findAuthorityBearingKey(value);
  if (leak !== null) {
    return { ...base, status: "receipt-authority", reason: `authority-bearing field at ${leak}` };
  }
  if (value.schema !== HANDOFF_RECEIPT_SCHEMA) {
    return { ...base, reason: `schema must be ${HANDOFF_RECEIPT_SCHEMA}` };
  }
  if (value.status !== "received") {
    return { ...base, reason: `status is ${JSON.stringify(value.status)}, not "received"` };
  }
  const ticket = value.ticket;
  if (ticket === null || typeof ticket !== "object") {
    return { ...base, reason: "ticket must be an object" };
  }
  let declared: string;
  try {
    declared = requireText((ticket as Record<string, unknown>).sha256, "ticket.sha256");
  } catch (error) {
    return { ...base, reason: (error as Error).message };
  }
  if (!SHA256_PATTERN.test(declared)) {
    return { ...base, reason: "ticket.sha256 must be sha256:<64 lowercase hex>" };
  }
  base.receiptTicketSha256 = declared;
  if (declared !== expectedTicketSha256) {
    return {
      ...base,
      status: "mismatch",
      reason: "the receipt names a different ticket than this Producer emitted",
    };
  }
  const claimsValue = value.claims;
  if (claimsValue === null || typeof claimsValue !== "object" || Array.isArray(claimsValue)) {
    return { ...base, reason: "claims must be an object" };
  }
  const claims = claimsValue as Record<string, unknown>;
  const declaredClaimNames = Object.keys(claims);
  const unknownClaims = declaredClaimNames.filter(
    (name) => !(ACCEPTABLE_CLAIMS as readonly string[]).includes(name),
  );
  for (const name of ACCEPTABLE_CLAIMS) {
    if (!(name in claims) || typeof claims[name] !== "boolean") {
      return { ...base, reason: `claims.${name} must be present and boolean` };
    }
  }
  // 権限・開示・書込み・意味受理は、Producer側でも同じ向きを要求する。
  const mustBeFalse = [
    "conversationHistoryIncluded",
    "authorityCarried",
    "originalSourcesRead",
    "writerInvoked",
    "externalSourcesAcquired",
    "externalDisclosure",
    "sessionInheritedAuthority",
  ] as const;
  for (const name of mustBeFalse) {
    if (claims[name] !== false) {
      return {
        ...base,
        status: "receipt-authority",
        reason: `claims.${name} must be false (a receipt does not grant authority or cause effects)`,
      };
    }
  }
  const nonAcceptable = NON_ACCEPTABLE_CLAIMS.filter((name) => claims[name] === true);
  if (nonAcceptable.length > 0) {
    return {
      ...base,
      status: "claim-not-accepted",
      nonAcceptableClaims: [...nonAcceptable],
      unknownClaims,
      reason:
        `the receipt claims ${nonAcceptable.join(", ")}. A consumer's observation is not a Product's ` +
        "meaning acceptance or a current-source proof.",
    };
  }
  if (unknownClaims.length > 0) {
    // 未知のclaimは落とさず運ぶ。 Producerが意味を知らないだけであり、
    // 「Consumerが嘘をついた」でも「安全」でもない。
    return {
      ...base,
      status: "matched",
      unknownClaims,
      reason: "ticket digests match. unknown claims are carried as unknown, not accepted",
    };
  }
  return { ...base, status: "matched", reason: "ticket digests match" };
}

/** Receiptは自分の票に対応するが、意味受理ではないことを型で示す。 */
export function isReceiptMatchedForTicket(receipt: unknown, expectedTicketSha256: string): boolean {
  return reviewHandoffReceipt(receipt, expectedTicketSha256).status === "matched";
}

/**
 * yi.handoff.context/v1 — 製品横断Handoff票（Producer側）。
 *
 * 位置づけ（ADR-0114 / ADR-0116 / TAI SK-03 §4 の延長であり、新しい共通Schema正本ではない）:
 * - Handoff票は**一時的な受渡し用Projection**である。原本は各Productが保持する。
 * - Harness Sessionは運搬経路であって、データ正本・意味受理・権限・実行結果の集約先ではない。
 * - 会話履歴は運ばない。Task・根拠・未完了の義務・確認が必要な依存関係を別の欄で区別する。
 * - Consumerは票の宣言を信じず、参照先を独立に再読取する。
 *
 * このModuleはI/Oを行わない。書き出しは呼び出し側が明示的な操作としてだけ行う。
 * 自動送信・バックグラウンド送信・直接POSTの経路はここに存在しない。
 */

export const HANDOFF_CONTEXT_SCHEMA = "yi.handoff.context/v1";

/**
 * 開示Scopeの閉集合。既定は `synthetic-only`。
 * 未列挙の値・欠落は受付けない（fail-closed）。語彙はOwner判断待ちの候補である。
 */
export const DISCLOSURE_SCOPES = ["synthetic-only", "reviewed-projection-only"] as const;
export type DisclosureScope = (typeof DISCLOSURE_SCOPES)[number];

export const RAW_SOURCE_POLICY = "not-exportable";
export const TRANSPORT_AUTHORITY = "none";

/** Handoff票が運ぶことを禁じる権限系のkey名（完全一致・大小無視）。 */
const AUTHORITY_BEARING_KEYS = new Set([
  "grant", "grants", "token", "tokens", "credential", "credentials",
  "secret", "secrets", "password", "passphrase", "apikey", "authorization",
  "permission", "permissions", "role", "roles", "entitlement", "lease",
  "scopegrant", "sessiontoken", "accesstoken", "refreshtoken",
]);

/**
 * 直列化後の票に現れてはならない高シグナルの資格マーカー。
 * `grant` や `token` のような一般語はIDや説明文に偶発的に現れ得るため、
 * key名の完全一致（AUTHORITY_BEARING_KEYS）で扱い、部分文字列探索には含めない。
 */
const AUTHORITY_MARKERS = [
  "bearer ", "authorization:", "apikey", "api_key", "password", "passphrase",
  "secret", "credential", "accesstoken", "access_token", "refreshtoken",
  "refresh_token", "sessiontoken", "private key", "-----begin",
];

export type HandoffReference = {
  kind: string;
  locator: string;
  /** `sha256:<64 hex>` のみ。参照先の内容digestが未知なら null。 */
  digest: string | null;
  note: string;
};

export type HandoffEvidence = {
  claim: string;
  basis: string;
  observedAt: string;
  limitation: string;
};

export type HandoffUnknown = {
  id: string;
  kind: string;
  description: string;
};

export type HandoffObligation = {
  id: string;
  description: string;
  owner: string;
};

export type HandoffDependency = {
  id: string;
  description: string;
  confirmWith: string;
};

export type HandoffContextEnvelope = {
  schema: typeof HANDOFF_CONTEXT_SCHEMA;
  handoffId: string;
  emittedAt: string;
  producer: {
    product: string;
    entrypoint: string;
    version: string;
    /** 実ロードされたProduct Skillの識別。未確認なら null。 */
    productSkill: string | null;
  };
  consumer: { product: string; entrypoint: string | null };
  purpose: string;
  /** 会話履歴ではない。一つのTaskだけを持つ。 */
  task: { statement: string; completionDefinition: string };
  target: { product: string; kind: string; id: string };
  revision: { kind: string; value: string; digest: string; observedAt: string };
  disclosure: {
    scope: DisclosureScope;
    audience: string[];
    purpose: string;
    rawSource: typeof RAW_SOURCE_POLICY;
  };
  payload: {
    mediaType: string;
    encoding: "utf-8";
    /** 票と同梱されるpayloadの**ファイル名**。パス区切り・`..`は禁じる。 */
    relPath: string;
    byteLength: number;
    sha256: string;
  };
  references: HandoffReference[];
  evidence: HandoffEvidence[];
  unresolved: HandoffUnknown[];
  usageRestrictions: string[];
  /** 未完了の義務。Consumerが引き継いで完了させるもの。 */
  obligations: HandoffObligation[];
  /** 確認が必要な依存関係。未確認のまま意味決定に使わない。 */
  dependenciesToConfirm: HandoffDependency[];
  /** Consumerが使い始める前に再確認する現在資格。 */
  consumerRecheck: string[];
  residualWork: string[];
  /** 運搬観測のみ。資格・権限・再送保証は持たない。 */
  transport: { harness: string; sessionLabel: string | null; authority: typeof TRANSPORT_AUTHORITY };
  conversationHistory: { included: false; note: string };
};

export type HandoffEnvelopeInput = {
  handoffId: string;
  emittedAt: string;
  producer: HandoffContextEnvelope["producer"];
  consumer: HandoffContextEnvelope["consumer"];
  purpose: string;
  task: HandoffContextEnvelope["task"];
  target: HandoffContextEnvelope["target"];
  revision: HandoffContextEnvelope["revision"];
  disclosure: HandoffContextEnvelope["disclosure"];
  payload: HandoffContextEnvelope["payload"];
  references: HandoffReference[];
  evidence: HandoffEvidence[];
  unresolved: HandoffUnknown[];
  usageRestrictions: string[];
  obligations: HandoffObligation[];
  dependenciesToConfirm: HandoffDependency[];
  consumerRecheck: string[];
  residualWork: string[];
  transport: HandoffContextEnvelope["transport"];
};

export class HandoffEnvelopeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HandoffEnvelopeError";
    this.code = code;
  }
}

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const BARE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HandoffEnvelopeError("handoff-missing-field", `${field} must be a non-empty string`);
  }
  return value;
}

function requireList<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) {
    throw new HandoffEnvelopeError("handoff-missing-field", `${field} must be an array`);
  }
  return value as T[];
}

function requireSha256(value: unknown, field: string): string {
  const text = requireText(value, field);
  if (!SHA256_PATTERN.test(text)) {
    throw new HandoffEnvelopeError("handoff-invalid-digest", `${field} must be sha256:<64 lowercase hex>`);
  }
  return text;
}

/**
 * 閉じた型の票であっても、誤って権限系の値が入らないことを実行時に確認する。
 * Harness差し替え後に「前のSessionで持っていたから」と資格が増幅する経路を作らない。
 */
export function findAuthorityBearingKey(value: unknown, path = "$"): string | null {
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

export function findAuthorityMarker(serialized: string): string | null {
  const lowered = serialized.toLowerCase();
  for (const marker of AUTHORITY_MARKERS) {
    if (lowered.includes(marker)) return marker;
  }
  return null;
}

/** Producer側の閉集合チェック。未知の開示Scopeは `active` や `public` へ読み替えない。 */
export function buildHandoffContextEnvelope(input: HandoffEnvelopeInput): HandoffContextEnvelope {
  const producer = {
    product: requireText(input.producer?.product, "producer.product"),
    entrypoint: requireText(input.producer?.entrypoint, "producer.entrypoint"),
    version: requireText(input.producer?.version, "producer.version"),
    productSkill:
      input.producer?.productSkill === null || input.producer?.productSkill === undefined
        ? null
        : requireText(input.producer.productSkill, "producer.productSkill"),
  };
  const consumer = {
    product: requireText(input.consumer?.product, "consumer.product"),
    entrypoint:
      input.consumer?.entrypoint === null || input.consumer?.entrypoint === undefined
        ? null
        : requireText(input.consumer.entrypoint, "consumer.entrypoint"),
  };
  const target = {
    product: requireText(input.target?.product, "target.product"),
    kind: requireText(input.target?.kind, "target.kind"),
    id: requireText(input.target?.id, "target.id"),
  };
  const revision = {
    kind: requireText(input.revision?.kind, "revision.kind"),
    value: requireText(input.revision?.value, "revision.value"),
    digest: requireSha256(input.revision?.digest, "revision.digest"),
    observedAt: requireText(input.revision?.observedAt, "revision.observedAt"),
  };
  const scope = input.disclosure?.scope;
  if (typeof scope !== "string" || !DISCLOSURE_SCOPES.includes(scope as DisclosureScope)) {
    throw new HandoffEnvelopeError(
      "handoff-disclosure-scope-unknown",
      `disclosure.scope must be one of ${DISCLOSURE_SCOPES.join(", ")}`,
    );
  }
  const audience = requireList<string>(input.disclosure?.audience, "disclosure.audience")
    .map((entry) => requireText(entry, "disclosure.audience[]"));
  if (audience.length === 0) {
    throw new HandoffEnvelopeError("handoff-disclosure-audience-empty", "disclosure.audience must not be empty");
  }
  if (input.disclosure?.rawSource !== RAW_SOURCE_POLICY) {
    throw new HandoffEnvelopeError(
      "handoff-raw-source-policy",
      `disclosure.rawSource must be "${RAW_SOURCE_POLICY}"`,
    );
  }
  const relPath = requireText(input.payload?.relPath, "payload.relPath");
  if (!BARE_FILENAME_PATTERN.test(relPath)) {
    throw new HandoffEnvelopeError(
      "handoff-payload-path-unsafe",
      "payload.relPath must be a bare file name without path separators",
    );
  }
  const byteLength = input.payload?.byteLength;
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new HandoffEnvelopeError("handoff-payload-size-invalid", "payload.byteLength must be a non-negative safe integer");
  }
  if (input.payload?.encoding !== "utf-8") {
    throw new HandoffEnvelopeError("handoff-payload-encoding", 'payload.encoding must be "utf-8"');
  }
  const envelope: HandoffContextEnvelope = {
    schema: HANDOFF_CONTEXT_SCHEMA,
    handoffId: requireText(input.handoffId, "handoffId"),
    emittedAt: requireText(input.emittedAt, "emittedAt"),
    producer,
    consumer,
    purpose: requireText(input.purpose, "purpose"),
    task: {
      statement: requireText(input.task?.statement, "task.statement"),
      completionDefinition: requireText(input.task?.completionDefinition, "task.completionDefinition"),
    },
    target,
    revision,
    disclosure: {
      scope,
      audience,
      purpose: requireText(input.disclosure?.purpose, "disclosure.purpose"),
      rawSource: RAW_SOURCE_POLICY,
    },
    payload: {
      mediaType: requireText(input.payload?.mediaType, "payload.mediaType"),
      encoding: "utf-8",
      relPath,
      byteLength,
      sha256: requireSha256(input.payload?.sha256, "payload.sha256"),
    },
    references: requireList<HandoffReference>(input.references, "references").map((reference) => ({
      kind: requireText(reference?.kind, "references[].kind"),
      locator: requireText(reference?.locator, "references[].locator"),
      digest:
        reference?.digest === null || reference?.digest === undefined
          ? null
          : requireSha256(reference.digest, "references[].digest"),
      note: requireText(reference?.note, "references[].note"),
    })),
    evidence: requireList<HandoffEvidence>(input.evidence, "evidence").map((entry) => ({
      claim: requireText(entry?.claim, "evidence[].claim"),
      basis: requireText(entry?.basis, "evidence[].basis"),
      observedAt: requireText(entry?.observedAt, "evidence[].observedAt"),
      limitation: requireText(entry?.limitation, "evidence[].limitation"),
    })),
    unresolved: requireList<HandoffUnknown>(input.unresolved, "unresolved").map((entry) => ({
      id: requireText(entry?.id, "unresolved[].id"),
      kind: requireText(entry?.kind, "unresolved[].kind"),
      description: requireText(entry?.description, "unresolved[].description"),
    })),
    usageRestrictions: requireList<string>(input.usageRestrictions, "usageRestrictions")
      .map((entry) => requireText(entry, "usageRestrictions[]")),
    obligations: requireList<HandoffObligation>(input.obligations, "obligations").map((entry) => ({
      id: requireText(entry?.id, "obligations[].id"),
      description: requireText(entry?.description, "obligations[].description"),
      owner: requireText(entry?.owner, "obligations[].owner"),
    })),
    dependenciesToConfirm: requireList<HandoffDependency>(input.dependenciesToConfirm, "dependenciesToConfirm")
      .map((entry) => ({
        id: requireText(entry?.id, "dependenciesToConfirm[].id"),
        description: requireText(entry?.description, "dependenciesToConfirm[].description"),
        confirmWith: requireText(entry?.confirmWith, "dependenciesToConfirm[].confirmWith"),
      })),
    consumerRecheck: requireList<string>(input.consumerRecheck, "consumerRecheck")
      .map((entry) => requireText(entry, "consumerRecheck[]")),
    residualWork: requireList<string>(input.residualWork, "residualWork")
      .map((entry) => requireText(entry, "residualWork[]")),
    transport: {
      harness: requireText(input.transport?.harness, "transport.harness"),
      sessionLabel:
        input.transport?.sessionLabel === null || input.transport?.sessionLabel === undefined
          ? null
          : requireText(input.transport.sessionLabel, "transport.sessionLabel"),
      authority: TRANSPORT_AUTHORITY,
    },
    conversationHistory: {
      included: false,
      note: "会話履歴は移さない。Task・根拠・未完了の義務・確認が必要な依存関係だけを運ぶ。",
    },
  };
  const leak = findAuthorityBearingKey(envelope);
  if (leak !== null) {
    throw new HandoffEnvelopeError("handoff-authority-field", `authority-bearing field is not allowed at ${leak}`);
  }
  const marker = findAuthorityMarker(JSON.stringify(envelope));
  if (marker !== null) {
    throw new HandoffEnvelopeError("handoff-authority-marker", `authority marker "${marker}" must not appear in the envelope`);
  }
  return envelope;
}

export function serializeHandoffContextEnvelope(envelope: HandoffContextEnvelope): string {
  return JSON.stringify(envelope, null, 2) + "\n";
}

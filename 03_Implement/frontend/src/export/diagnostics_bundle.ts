// PRODUCT-OPS-02 / ADR-0053: サポート診断バンドル（diag-bundle.v1）。
// 許可リスト方式 -- 本ファイルは入力型自体にカード本文・Document id・生UserAgent・
// error message/stack 等を持たない（受け取りようがない）ことで、SafeMode ON/OFF に
// 関わらず禁止項目を安全側で担保する。スプレッドで入力をそのまま転写せず、
// 各ネストオブジェクトを列挙で再構築するのは、呼び出し側が誤って余計なフィールドを
// input に足しても出力へ漏れないようにするため。

export const DIAG_BUNDLE_SCHEMA_VERSION = "diag-bundle.v1";

export const DIAG_CLASSIFICATION_CODES = [
  "WEB-ENTRY",
  "API-UNAVAILABLE",
  "SAVE-FAILURE",
  "IMPORT-VALIDATION",
  "SHARE-SAFEMODE",
] as const;
export type DiagClassificationCode = (typeof DIAG_CLASSIFICATION_CODES)[number];

export const DIAG_BROWSER_FAMILIES = ["chrome", "firefox", "safari", "edge", "other"] as const;
export type DiagBrowserFamily = (typeof DIAG_BROWSER_FAMILIES)[number];

export const DIAG_OS_FAMILIES = ["windows", "macos", "linux", "android", "ios", "other"] as const;
export type DiagOsFamily = (typeof DIAG_OS_FAMILIES)[number];

// ADR-0053 §許可リスト: provider種別名のみ(none/local/large-scale/deepseek)。unknown は
// providerKind 未解決時(App.tsx の PROV-VIS-01 表示ロジックと同じ意味)。
export const DIAG_PROVIDER_TYPES = ["none", "local", "large-scale", "deepseek", "unknown"] as const;
export type DiagProviderType = (typeof DIAG_PROVIDER_TYPES)[number];

export type DiagBundleV1 = {
  schemaVersion: typeof DIAG_BUNDLE_SCHEMA_VERSION;
  generatedAt: string;
  app: { revision: string };
  client: {
    browserFamily: DiagBrowserFamily;
    browserMajor?: number;
    osFamily: DiagOsFamily;
  };
  incident: {
    classificationCode: DiagClassificationCode;
    httpStatus?: number;
  };
  runtime: {
    safeMode: boolean;
    providerType: DiagProviderType;
  };
  document?: {
    version: number;
    updatedAt?: string;
    counts: { cards: number; islands: number; edges: number };
  };
  error?: {
    errorCode: string;
    contractId: string;
    occurredAt: string;
  };
};

export type DiagBundleDocumentInput = {
  version: number;
  updatedAt?: string;
  cardCount: number;
  islandCount: number;
  edgeCount: number;
};

export type DiagBundleErrorInput = {
  errorCode: string;
  contractId: string;
  occurredAt: string;
};

export type DiagBundleInput = {
  /** Caller-supplied ISO8601 for determinism/testability (agent_task_export.ts と同じ方式)。 */
  generatedAt: string;
  classificationCode: DiagClassificationCode;
  /** 画面が明示的な障害コンテキストとして保持している直近の HTTP status のみ。無ければ省略。 */
  httpStatus?: number;
  /** 検証できない場合は "unknown" に落とす。生の任意文字列をそのまま信用しない。 */
  appRevision?: string;
  safeMode: boolean;
  providerType: DiagProviderType;
  /** 正規化にのみ使用し、生の値は出力へ一切含めない。 */
  userAgent?: string;
  platform?: string;
  document?: DiagBundleDocumentInput;
  error?: DiagBundleErrorInput;
};

const APP_REVISION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const APP_REVISION_LINE_TERMINATOR_PATTERN = /[\r\n\u2028\u2029]/;

function normalizeAppRevision(value: string | undefined): string {
  // JavaScript `$` may match immediately before a final line terminator.
  // Reject those explicitly so this has the same whole-string semantics as
  // Python re.fullmatch() at the backend settings boundary.
  if (
    value
    && !APP_REVISION_LINE_TERMINATOR_PATTERN.test(value)
    && APP_REVISION_PATTERN.test(value)
  ) {
    return value;
  }
  return "unknown";
}

function normalizeBrowserFamily(userAgent: string | undefined): { family: DiagBrowserFamily; major?: number } {
  const ua = userAgent ?? "";

  // Edge/ChromeのUAはどちらも "Chrome" を含むため、"Edg/" を先に見る。
  let match = /Edg\/(\d+)/.exec(ua);
  if (match) return { family: "edge", major: Number(match[1]) };

  match = /Firefox\/(\d+)/.exec(ua);
  if (match) return { family: "firefox", major: Number(match[1]) };

  match = /Chrome\/(\d+)/.exec(ua);
  if (match) return { family: "chrome", major: Number(match[1]) };

  match = /Version\/(\d+)(?:\.\d+)*.*Safari\//.exec(ua);
  if (match) return { family: "safari", major: Number(match[1]) };

  return { family: "other" };
}

function normalizeOsFamily(platform: string | undefined, userAgent: string | undefined): DiagOsFamily {
  const combined = `${platform ?? ""} ${userAgent ?? ""}`;

  if (/iPhone|iPad|iPod/i.test(combined)) return "ios";
  if (/Android/i.test(combined)) return "android";
  if (/Win/i.test(combined)) return "windows";
  if (/Mac/i.test(combined)) return "macos";
  if (/Linux/i.test(combined)) return "linux";
  return "other";
}

export function buildDiagnosticsBundle(input: DiagBundleInput): DiagBundleV1 {
  const { family: browserFamily, major: browserMajor } = normalizeBrowserFamily(input.userAgent);
  const osFamily = normalizeOsFamily(input.platform, input.userAgent);

  const bundle: DiagBundleV1 = {
    schemaVersion: DIAG_BUNDLE_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    app: { revision: normalizeAppRevision(input.appRevision) },
    client: {
      browserFamily,
      ...(browserMajor !== undefined ? { browserMajor } : {}),
      osFamily,
    },
    incident: {
      classificationCode: input.classificationCode,
      ...(input.httpStatus !== undefined ? { httpStatus: input.httpStatus } : {}),
    },
    runtime: {
      safeMode: input.safeMode,
      providerType: input.providerType,
    },
  };

  if (input.document) {
    bundle.document = {
      version: input.document.version,
      ...(input.document.updatedAt !== undefined ? { updatedAt: input.document.updatedAt } : {}),
      counts: {
        cards: input.document.cardCount,
        islands: input.document.islandCount,
        edges: input.document.edgeCount,
      },
    };
  }

  if (input.error) {
    bundle.error = {
      errorCode: input.error.errorCode,
      contractId: input.error.contractId,
      occurredAt: input.error.occurredAt,
    };
  }

  return bundle;
}

export function serializeDiagnosticsBundle(bundle: DiagBundleV1): string {
  return JSON.stringify(bundle, null, 2);
}

const TOP_LEVEL_KEYS = new Set(["schemaVersion", "generatedAt", "app", "client", "incident", "runtime", "document", "error"]);
const APP_KEYS = new Set(["revision"]);
const CLIENT_KEYS = new Set(["browserFamily", "browserMajor", "osFamily"]);
const INCIDENT_KEYS = new Set(["classificationCode", "httpStatus"]);
const RUNTIME_KEYS = new Set(["safeMode", "providerType"]);
const DOCUMENT_KEYS = new Set(["version", "updatedAt", "counts"]);
const COUNTS_KEYS = new Set(["cards", "islands", "edges"]);
const ERROR_KEYS = new Set(["errorCode", "contractId", "occurredAt"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: unknown, allowed: Set<string>): value is Record<string, unknown> {
  return isPlainObject(value) && Object.keys(value).every((key) => allowed.has(key));
}

/**
 * unit: strict schema/unknown-key拒否（ADR-0053 実装着手ゲート）。
 * 未知キーが1つでもあればfalseを返す。値の型までは見ず、キー集合の厳格一致に限定する。
 */
export function isDiagBundleShapeValid(value: unknown): value is DiagBundleV1 {
  if (!hasOnlyKeys(value, TOP_LEVEL_KEYS)) return false;

  if (value.schemaVersion !== DIAG_BUNDLE_SCHEMA_VERSION) return false;
  if (typeof value.generatedAt !== "string") return false;

  if (!hasOnlyKeys(value.app, APP_KEYS) || typeof value.app.revision !== "string") return false;

  if (!hasOnlyKeys(value.client, CLIENT_KEYS)) return false;
  if (!DIAG_BROWSER_FAMILIES.includes(value.client.browserFamily as DiagBrowserFamily)) return false;
  if (!DIAG_OS_FAMILIES.includes(value.client.osFamily as DiagOsFamily)) return false;

  if (!hasOnlyKeys(value.incident, INCIDENT_KEYS)) return false;
  if (!DIAG_CLASSIFICATION_CODES.includes(value.incident.classificationCode as DiagClassificationCode)) return false;

  if (!hasOnlyKeys(value.runtime, RUNTIME_KEYS)) return false;
  if (typeof value.runtime.safeMode !== "boolean") return false;
  if (!DIAG_PROVIDER_TYPES.includes(value.runtime.providerType as DiagProviderType)) return false;

  if (value.document !== undefined) {
    if (!hasOnlyKeys(value.document, DOCUMENT_KEYS)) return false;
    if (!hasOnlyKeys(value.document.counts, COUNTS_KEYS)) return false;
  }

  if (value.error !== undefined) {
    if (!hasOnlyKeys(value.error, ERROR_KEYS)) return false;
  }

  return true;
}

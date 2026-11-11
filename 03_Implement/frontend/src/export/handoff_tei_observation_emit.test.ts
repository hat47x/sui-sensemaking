import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocumentV1 } from "../domain/types";
import { buildContextProjection } from "./context_bundle_projection";
import { renderReadOnlyMarkdownDraft } from "./context_projection_markdown_draft";
import {
  RAW_SOURCE_POLICY,
  TRANSPORT_AUTHORITY,
  buildHandoffContextEnvelope,
  serializeHandoffContextEnvelope,
} from "./handoff_context_envelope";

/**
 * G3: TEI の read-only CLI 観測を、票の `evidence[]` と `references[]` として引用する。
 *
 * - **新しい契約は作らない。** 既存の `yi.handoff.context/v1` の欄に載せるだけ。
 * - TEI 側の変更も不要。`tei.cli.model/v0` の出力をそのまま読む。
 * - 観測を「検証済み」や「意味受理」に昇格させない。TEI 自身が宣言する
 *   `authorityLimits[]` を `limitation` に落とさず運ぶ。
 * - 実行は `SUI_HANDOFF_TEI_OBSERVATION`（TEI catalog JSON の絶対パス）と
 *   `SUI_HANDOFF_OUTPUT_DIR` が明示されたときだけ。未指定なら skip（NOT RUN）。
 */

const PAYLOAD_NAME = "sui-to-sho-handoff.md";
const ENVELOPE_NAME = "sui-to-sho-handoff.handoff.json";
const TEI_COMMAND = "tei.cli.model/v0";

/** TEI catalog から引用してよい最小の観測面。 */
type TeiObservation = {
  worldFingerprint: string;
  modelRevision: string;
  sourceIndexFingerprint: string;
  validation: { ok: boolean; errorCount: number; warningCount: number };
  authorityLimits: string[];
  subject: { kind: string; id: string };
};

function readTeiObservation(raw: unknown): TeiObservation {
  const root = raw as Record<string, unknown>;
  const result = root.result as Record<string, unknown> | undefined;
  if (result === undefined || result === null || typeof result !== "object") {
    throw new Error("TEI catalog output has no result object");
  }
  const text = (value: unknown, field: string): string => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`TEI catalog ${field} must be a non-empty string`);
    }
    return value;
  };
  const worldFingerprint = text(result.worldFingerprint, "worldFingerprint");
  const modelRevision = text(result.modelRevision, "modelRevision");
  const sourceIndexFingerprint = text(result.sourceIndexFingerprint, "sourceIndexFingerprint");
  for (const [field, value] of [
    ["worldFingerprint", worldFingerprint],
    ["modelRevision", modelRevision],
    ["sourceIndexFingerprint", sourceIndexFingerprint],
  ] as const) {
    if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
      throw new Error(`TEI catalog ${field} is not sha256:<64 lowercase hex>`);
    }
  }
  const validation = result.validation as Record<string, unknown> | undefined;
  if (validation === undefined || typeof validation.ok !== "boolean") {
    throw new Error("TEI catalog validation.ok must be a boolean");
  }
  const authorityLimits = result.authorityLimits;
  if (!Array.isArray(authorityLimits) || authorityLimits.length === 0) {
    throw new Error("TEI catalog authorityLimits must be a non-empty array");
  }
  for (const entry of authorityLimits) {
    text(entry, "authorityLimits[]");
  }
  // 標準 `std` のプリミティブではなく、利用者定義のsubjectを1件だけ引用する。
  const entries = result.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("TEI catalog entries must be a non-empty array");
  }
  const chosen = entries.find((entry) => {
    const subject = (entry as Record<string, unknown>).subject as Record<string, unknown> | undefined;
    return subject !== undefined && subject.prelude !== true &&
      typeof subject.kind === "string" && typeof subject.id === "string";
  }) as { subject: { kind: string; id: string } } | undefined;
  if (chosen === undefined) throw new Error("TEI catalog has no non-prelude subject to cite");
  return {
    worldFingerprint,
    modelRevision,
    sourceIndexFingerprint,
    validation: {
      ok: validation.ok,
      errorCount: Number(validation.errorCount ?? 0),
      warningCount: Number(validation.warningCount ?? 0),
    },
    authorityLimits: authorityLimits.map((entry) => String(entry)),
    subject: { kind: chosen.subject.kind, id: chosen.subject.id },
  };
}

function fixture(): DocumentV1 {
  return {
    version: 1,
    id: "sui-sho-p0-cross-product-synthetic",
    title: "Do not export this title",
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "公開された観測\nC:\\notes", x: 0, y: 0,
        textReviewed: true, meta: { source: "hidden:original-A" } },
      { id: "c2", text: "# 疑似見出し\n[出典らしい記述](https://example.invalid/ref)\n[^s1]: 未照合",
        x: 10, y: 10, textReviewed: true },
      { id: "c3", text: "非公開・未レビュー", x: 20, y: 20, textReviewed: false },
      { id: "c4", text: "レビュー済みだが保留", x: 30, y: 30, textReviewed: true, holdState: "held" },
      { id: "c5", text: "非公開の保留", x: 40, y: 40, textReviewed: false, holdState: "held" },
    ],
    islands: [
      { id: "i1", title: "secret island A", titleReviewed: false, cardIds: ["c1", "c3"] },
      { id: "i2", title: "public island B", titleReviewed: true, cardIds: ["c2", "c4"] },
    ],
    edges: [
      { id: "e1", fromId: "c1", toId: "c3", type: "related" },
      { id: "e2", fromId: "c2", toId: "c4", type: "causal" },
    ],
    readingOrder: ["c1", "c2", "c3", "c4", "c5"],
    narratives: [], evidenceLinks: [], mergeSuggestionDecisions: [],
  };
}

describe("SUI→SHO Handoff: TEI read-only観測の引用（G3）", () => {
  it("TEI catalog の観測を evidence と references に引用し、authorityLimits を落とさない", {
    skip: process.env.SUI_HANDOFF_TEI_OBSERVATION === undefined ||
      process.env.SUI_HANDOFF_OUTPUT_DIR === undefined,
  }, async () => {
    const observationPath = process.env.SUI_HANDOFF_TEI_OBSERVATION;
    const outputDirectory = process.env.SUI_HANDOFF_OUTPUT_DIR;
    if (typeof observationPath !== "string" || typeof outputDirectory !== "string") return;
    expect(isAbsolute(observationPath)).toBe(true);
    expect(isAbsolute(outputDirectory)).toBe(true);

    // TEI CLI の出力をシェル経由で保存すると BOM が付くことがある
    // （PowerShell 5.1 の `Out-File -Encoding utf8` など）。BOM は値ではないので
    // 読み取り時に落とす。落とさないと JSON.parse が失敗し、観測の引用ではなく
    // 保存経路の癖で失敗する。
    const rawText = readFileSync(observationPath, "utf8").replace(/^\uFEFF/, "");
    const catalog = JSON.parse(rawText);
    const observation = readTeiObservation(catalog);

    const doc = fixture();
    const projection = await buildContextProjection({ doc, constraint: "reviewed-only", safeMode: false });
    const markdown = renderReadOnlyMarkdownDraft(projection);
    const payloadBytes = new TextEncoder().encode(markdown);
    const payloadSha256 = hex(await crypto.subtle.digest("SHA-256", payloadBytes));
    // revision.digest は SUI 自身の投影識別子から計算する（handoff_context_emit.test.ts
    // と同じ規則）。TEI の modelRevision は references[] 側で運ぶ。
    const revisionDigest = hex(await crypto.subtle.digest("SHA-256",
      new TextEncoder().encode(JSON.stringify({
        schema: "context-projection.v1",
        docId: doc.id,
        baseDocSignature: projection.baseDocSignature,
        bundleHash: projection.bundleHash,
      }))));

    const limitation =
      "TEI catalogは派生read-only投影であり、Sourceへの書込み・意味受理・実行権限を与えない。 " +
      `authorityLimits=[${observation.authorityLimits.join(", ")}]`;
    const envelope = buildHandoffContextEnvelope({
      handoffId: "ho-20261111-sui-sho-tei-0001",
      emittedAt: "2026-11-11T00:00:00.000Z",
      producer: {
        product: "sui-sensemaking",
        entrypoint: "03_Implement/frontend/src/export/handoff_context_envelope.ts",
        version: "sui-sensemaking@main",
        productSkill: null,
      },
      consumer: { product: "sho-composer", entrypoint: "bin/sho-inspect.cjs handoff" },
      purpose: "TEIのread-only観測を根拠として引用した票を、SHOのread-only Research Indexで受領・独立再読取する",
      task: {
        statement: "SUIのレビュー済み投影から作った文章草稿を、TEI read-only観測の根拠付きでSHOが読み、参照出現を索引する",
        completionDefinition: "SHOがpayloadとTEI観測の引用を独立に再読取し、票の宣言と一致する受領Receiptを返す",
      },
      target: { product: "sui-sensemaking", kind: "document", id: doc.id },
      // revision は SUI 自身の投影の同一性を表す。digest も SUI の canonical 識別子
      // から計算する。TEI の modelRevision をここへ入れると、Consumer が
      // revision.value から独立に検証できず、digest の出自が TEI に帰属してしまう。
      // TEI の観測は references[] と evidence[] 側で独自に運ぶ（下記）。
      revision: {
        kind: "context-projection.baseDocSignature",
        value: projection.baseDocSignature,
        digest: `sha256:${revisionDigest}`,
        observedAt: "2026-11-11T00:00:00.000Z",
      },
      disclosure: {
        scope: "synthetic-only",
        audience: ["sho-composer"],
        purpose: "TEI観測を引用した限定read-only受領試験",
        rawSource: RAW_SOURCE_POLICY,
      },
      payload: {
        mediaType: "text/markdown",
        encoding: "utf-8",
        relPath: PAYLOAD_NAME,
        byteLength: payloadBytes.byteLength,
        sha256: `sha256:${payloadSha256}`,
      },
      references: [
        {
          kind: "handoff-payload",
          locator: PAYLOAD_NAME,
          digest: `sha256:${payloadSha256}`,
          note: "票と同梱されるpayload。Consumerは実bytesを独立に再読取する。",
        },
        {
          kind: "producer-source",
          locator: `sui-sensemaking:document:${doc.id}`,
          digest: null,
          note: "原本はSUIが保持する。票は参照のみで、内容は運ばない。",
        },
        {
          kind: "tei-readonly-observation",
          locator: `tei:${TEI_COMMAND}:${observation.subject.kind}:${observation.subject.id}`,
          digest: observation.worldFingerprint,
          // TEI の modelRevision は SUI の revision.digest ではなく、観測の
          // 参照としてここに載せる。revision.value から独立に検証できる形にする。
          note: `TEI read-only CLIの観測。modelRevision=${observation.modelRevision} ` +
            `sourceIndexFingerprint=${observation.sourceIndexFingerprint}`,
        },
      ],
      evidence: [
        {
          claim: `TEI参照Workspaceのread-only catalogに subject ${observation.subject.kind}/${observation.subject.id} が存在する`,
          basis: TEI_COMMAND,
          observedAt: "2026-11-11T00:00:00.000Z",
          limitation,
        },
        {
          claim: `TEI catalogのvalidationはok=${observation.validation.ok ? "true" : "false"}`,
          basis: TEI_COMMAND,
          observedAt: "2026-11-11T00:00:00.000Z",
          limitation: "validationの値はその時点のcatalog出力であり、業務受理や品質期限を意味しない。",
        },
      ],
      unresolved: [
        { id: "source-revision", kind: "provenance", description: "SHOのsource.revisionはunknownであり、現行性確認済ではない。" },
        { id: "tei-source-status", kind: "provenance", description: "TEI artifact生成契約にsource.statusが無い（ADR-0116はOwner判断待ち）。" },
      ],
      usageRestrictions: [
        "read-only。書込み・保存・公開を行わない。",
        "TEI観測を意味受理・Source正本・実行権限として扱わない。",
        "出典引用・原本取得に使わない。",
      ],
      obligations: [
        { id: "carry-authority-limits", description: "ConsumerはTEIのauthorityLimitsを落とさずReceiptへ運ぶ。", owner: "sho-composer" },
      ],
      dependenciesToConfirm: [
        { id: "tei-currentness", description: "受領時点でTEI catalogのworldFingerprintが同一か。", confirmWith: "tei-platform" },
      ],
      consumerRecheck: ["TEI観測の現在性。", "payloadの実bytesと票の宣言の一致。"],
      residualWork: ["TEI観測の現在性を照合するProduct Oracleは未接続（G6）。"],
      transport: { harness: "deepseek-harness", sessionLabel: null, authority: TRANSPORT_AUTHORITY },
    });

    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(join(outputDirectory, PAYLOAD_NAME), payloadBytes, { flag: "wx", mode: 0o600 });
    writeFileSync(join(outputDirectory, ENVELOPE_NAME),
      new TextEncoder().encode(serializeHandoffContextEnvelope(envelope)), { flag: "wx", mode: 0o600 });

    // 引用の形は本文から再確認できる。
    const teiReference = envelope.references.find((reference) => reference.kind === "tei-readonly-observation");
    expect(teiReference).toBeDefined();
    // TEI の観測は references[].digest として独立に運ぶ。
    expect(teiReference?.digest).toBe(observation.worldFingerprint);
    // TEI の modelRevision は revision.digest ではなく、観測の参照として載せる。
    expect(teiReference?.note).toContain(observation.modelRevision);
    // revision は SUI 自身の投影識別子。digest は value と同じ canonical 識別子から作る。
    expect(envelope.revision.value).toBe(projection.baseDocSignature);
    expect(envelope.revision.digest).toBe(`sha256:${revisionDigest}`);
    expect(envelope.revision.digest).not.toBe(observation.modelRevision);
    expect(envelope.evidence[0].basis).toContain(TEI_COMMAND);
    for (const limit of observation.authorityLimits) {
      expect(envelope.evidence[0].limitation).toContain(limit);
    }
  });
});

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, "0")).join("");
}

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocumentV1 } from "../domain/types";
import { buildContextProjection } from "./context_bundle_projection";
import { renderReadOnlyMarkdownDraft } from "./context_projection_markdown_draft";
import {
  HANDOFF_CONTEXT_SCHEMA,
  RAW_SOURCE_POLICY,
  TRANSPORT_AUTHORITY,
  buildHandoffContextEnvelope,
  serializeHandoffContextEnvelope,
  type HandoffEnvelopeInput,
} from "./handoff_context_envelope";

/**
 * 二製品間の**単一のHandoff操作**。SUIのread-only投影から、
 * payload 1ファイルと Handoff票 1ファイルの組だけを書出す。
 *
 * - 既存の P0 byte契約（354 bytes / 固定SHA）をそのまま使う。期待を関数の出力から再生成しない。
 * - 生産 Module（`handoff_context_envelope.ts`）は I/O を行わず、自動送信・
 *   バックグラウンド送信・ネットワークの経路は存在しない。**書き出しは各テストが
 *   明示的に渡す directory だけ**で行う。skip しないテストは `os.tmpdir()` の
 *   scratch に書く。`SUI_HANDOFF_OUTPUT_DIR` を明示したときだけ、その所定の
 *   出力先へ書く（Runner がこの経路を使う）。
 * - 自動送信・バックグラウンド送信・ネットワークの経路は存在しない。
 * - 原本（Card本文の生データ・Island題名・Document題名）は書出さない。
 */

const PAYLOAD_NAME = "sui-to-sho-handoff.md";
const ENVELOPE_NAME = "sui-to-sho-handoff.handoff.json";
const EXPECTED_PAYLOAD_BYTES = 354;
const EXPECTED_PAYLOAD_SHA256 = "7fd6fde2fbc4d9beaf9de14e8b8f4f5d70003cd2129f1502cdd7c73f50c171cd";
/**
 * 変化検出のピン。**独立した意味期待ではない**。独立期待は下の欄レベル assert。
 * payload・Revisionのdigestや票の構成が変わるとここで崩れる。
 */
const CHANGE_DETECTION_PIN = "d0c3c5880d096b3582526858d5d68ab7f809bbf06cf680e7ddc899ed6df2b7e4";
const PAYLOAD_DIGEST = `sha256:${EXPECTED_PAYLOAD_SHA256}`;
const REVISION_DIGEST = "sha256:" + "3".repeat(64);

function scratch(): string {
  return join(tmpdir(), "sui-handoff-" + randomUUID());
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256HexBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
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

type Emission = Awaited<ReturnType<typeof emitHandoff>>;

/** 一つのHandoff操作。戻り値は書出された2ファイルの内容。 */
async function emitHandoff(directory: string) {
  const doc = fixture();
  const projection = await buildContextProjection({ doc, constraint: "reviewed-only", safeMode: false });
  const markdown = renderReadOnlyMarkdownDraft(projection);
  const payloadBytes = new TextEncoder().encode(markdown);
  const payloadSha256 = await sha256Hex(markdown);
  const revisionDigest = await sha256Hex(
    JSON.stringify({
      schema: "context-projection.v1",
      docId: doc.id,
      baseDocSignature: projection.baseDocSignature,
      bundleHash: projection.bundleHash,
    }),
  );

  const envelope = buildHandoffContextEnvelope({
    handoffId: "ho-20261111-sui-sho-0001",
    emittedAt: "2026-11-11T00:00:00.000Z",
    producer: {
      product: "sui-sensemaking",
      entrypoint: "03_Implement/frontend/src/export/handoff_context_envelope.ts",
      version: "sui-sensemaking@main",
      productSkill: null,
    },
    consumer: { product: "sho-composer", entrypoint: "bin/sho-inspect.cjs handoff" },
    purpose: "レビュー済み投影の文章草稿を、SHOのread-only Research Indexで受領・独立再読取する",
    task: {
      statement: "SUIのレビュー済み投影から作った文章草稿を、SHOが実CLIで読み、参照出現を索引する",
      completionDefinition: "SHOがpayloadを独立に再読取し、票の宣言と実bytesの一致を確認して受領Receiptを返す",
    },
    target: { product: "sui-sensemaking", kind: "document", id: doc.id },
    revision: {
      kind: "context-projection.baseDocSignature",
      value: projection.baseDocSignature,
      digest: `sha256:${revisionDigest}`,
      observedAt: "2026-11-11T00:00:00.000Z",
    },
    disclosure: {
      scope: "synthetic-only",
      audience: ["sho-composer"],
      purpose: "二製品間の限定read-only受領試験",
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
    ],
    evidence: [
      {
        claim: "payloadはレビュー済み_card 2件の投影だけで構成される",
        basis: "context-projection.v1 / constraint=reviewed-only / safeMode=false",
        observedAt: "2026-11-11T00:00:00.000Z",
        limitation: "未レビュー・保留中のcardは含まない。含まれないことの確認はしていない。",
      },
      {
        claim: "payloadのbyte数とsha256は独立期待と一致する",
        basis: "SUI P0固定byte契約",
        observedAt: "2026-11-11T00:00:00.000Z",
        limitation: "byte一致はSource現行性・意味受理の証拠ではない。",
      },
    ],
    unresolved: [
      {
        id: "source-revision",
        kind: "provenance",
        description: "SHOのsource.revisionはunknownであり、現行性確認済ではない。",
      },
      {
        id: "document-references",
        kind: "coverage",
        description: "文書内の全参照網羅・未定義参照の評価は未実施。",
      },
      {
        id: "original-source",
        kind: "provenance",
        description: "Cardの原本Source・Island題名・Document題名は取得していない。",
      },
    ],
    usageRestrictions: [
      "read-only。書込み・保存・公開を行わない。",
      "TEIの Accepted Meaning ではない。",
      "出典引用・原本取得・意味受理に使わない。",
      "producerの許可なく他へ再開示しない。",
      "SafeMode外の本文露出を、露出許可の証明として使わない。",
    ],
    obligations: [
      {
        id: "independent-reread",
        description: "Consumerはpayloadを実CLIで独立に再読取し、digestとbyte数の一致を確認する。",
        owner: "sho-composer",
      },
      {
        id: "recheck-disclosure",
        description: "Consumerは使い始める前に、現在の開示ScopeとAudienceを再確認する。",
        owner: "sho-composer",
      },
    ],
    dependenciesToConfirm: [
      {
        id: "review-state-at-use",
        description: "受領時点でSUI側のレビュー状態が票の宣言と同一か。",
        confirmWith: "sui-sensemaking",
      },
      {
        id: "current-host-grant",
        description: "Consumerの現在のHost/OS権限と開示資格。",
        confirmWith: "consumer-host",
      },
    ],
    consumerRecheck: [
      "受領時の開示Scope・Audience・用途。",
      "payloadの実bytesと票の宣言の一致。",
      "原本の現在Revision。",
    ],
    residualWork: [
      "SHO側の受領Receiptを票へ戻す経路は未実装。",
      "三製品以上の連鎖・別Harness実実行は未検証。",
    ],
    transport: { harness: "deepseek-harness", sessionLabel: null, authority: TRANSPORT_AUTHORITY },
  });

  const envelopeText = serializeHandoffContextEnvelope(envelope);
  const envelopeBytes = new TextEncoder().encode(envelopeText);
  const envelopeSha256 = await sha256HexBytes(envelopeBytes);

  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, PAYLOAD_NAME), payloadBytes, { flag: "wx", mode: 0o600 });
  writeFileSync(join(directory, ENVELOPE_NAME), envelopeBytes, { flag: "wx", mode: 0o600 });

  return {
    envelope,
    envelopeText,
    envelopeSha256,
    envelopeBytes,
    payloadBytes,
    payloadSha256,
    payloadPath: join(directory, PAYLOAD_NAME),
    envelopePath: join(directory, ENVELOPE_NAME),
  };
}

describe("SUI→SHO Handoff: 単一操作のemit（Producer側）", () => {
  it("payloadはP0固定byte契約どおりで、原本は書出さない", async () => {
    const directory = scratch();
    let emitted: Emission;
    try {
      emitted = await emitHandoff(directory);
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
    try {
      expect(emitted.payloadBytes.byteLength).toBe(EXPECTED_PAYLOAD_BYTES);
      expect(emitted.payloadSha256).toBe(EXPECTED_PAYLOAD_SHA256);
      const text = new TextDecoder().decode(emitted.payloadBytes);
      expect(text).not.toContain("hidden:original-A");
      expect(text).not.toContain("secret island A");
      expect(text).not.toContain("Do not export this title");
      expect(text).not.toContain("非公開");
      expect(text).not.toContain("sources:");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("票にも原本の生データが入らない（将来の編集に対するguard）", async () => {
    // ADR-0117「本文の適用範囲」: 票へ載せてはならないのは原本の生データ
    // （Document/Island/Card の原本・card meta の原本Source）。payload と同じ
    // 除外を票側にも置く。将来の編集で自由文欄に原本が注入されても CI が通る
    // 状態にしない。
    const directory = scratch();
    let emitted: Emission;
    try {
      emitted = await emitHandoff(directory);
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
    try {
      const envelopeText = emitted.envelopeText;
      // Document 題名
      expect(envelopeText).not.toContain("Do not export this title");
      // Island 題名
      expect(envelopeText).not.toContain("secret island A");
      expect(envelopeText).not.toContain("public island B");
      // card meta の原本Source
      expect(envelopeText).not.toContain("hidden:original-A");
      // 未レビュー・保留中の本文
      expect(envelopeText).not.toContain("非公開");
      expect(envelopeText).not.toContain("レビュー済みだが保留");
      expect(envelopeText).not.toContain("非公開の保留");
      // SafeMode 外の露出を露出許可の証明として使う語
      expect(envelopeText).not.toContain("sources:");
      expect(envelopeText).not.toContain("verified:");
      // レビュー済み投影文本字そのものは、ADR-0117 の解釈により payload 側の
      // 既存 P0 契約として許容される。票側には現状載っていないことを確認する。
      expect(envelopeText).not.toContain("公開された観測");
      expect(envelopeText).not.toContain("疑似見出し");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("票はrequired欄・Task/根拠/義務/依存を運ぶ", async () => {
    const directory = scratch();
    let emitted: Emission;
    try {
      emitted = await emitHandoff(directory);
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
    try {
      const parsed = JSON.parse(emitted.envelopeText);
      expect(parsed.schema).toBe(HANDOFF_CONTEXT_SCHEMA);
      expect(parsed.payload.relPath).toBe(PAYLOAD_NAME);
      expect(parsed.payload.sha256).toBe(PAYLOAD_DIGEST);
      expect(parsed.payload.byteLength).toBe(EXPECTED_PAYLOAD_BYTES);
      expect(parsed.revision.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(parsed.revision.value).toBe(
        "sui-sho-p0-cross-product-synthetic:2026-11-07T00:00:00.000Z",
      );
      expect(parsed.disclosure).toEqual({
        scope: "synthetic-only",
        audience: ["sho-composer"],
        purpose: "二製品間の限定read-only受領試験",
        rawSource: "not-exportable",
      });
      expect(parsed.conversationHistory.included).toBe(false);
      expect(parsed.transport.authority).toBe("none");
      expect(parsed.evidence.length).toBeGreaterThanOrEqual(2);
      expect(parsed.unresolved.map((entry: { id: string }) => entry.id)).toEqual([
        "source-revision",
        "document-references",
        "original-source",
      ]);
      expect(parsed.obligations.map((entry: { id: string }) => entry.id)).toEqual([
        "independent-reread",
        "recheck-disclosure",
      ]);
      expect(parsed.dependenciesToConfirm.map((entry: { id: string }) => entry.id)).toEqual([
        "review-state-at-use",
        "current-host-grant",
      ]);
      expect(parsed.usageRestrictions.length).toBeGreaterThanOrEqual(4);
      // 変化検出ピン（独立期待ではない）。不一致は「票の構成が変わった」ことを示す。
      expect(emitted.envelopeSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(emitted.envelopeSha256).toBe(CHANGE_DETECTION_PIN);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("明示的な出力先があるときだけ書き出し、既存ファイルは上書きしない", async () => {
    const directory = scratch();
    try {
      const first = await emitHandoff(directory);
      expect(readFileSync(first.payloadPath).byteLength).toBe(EXPECTED_PAYLOAD_BYTES);
      expect(readFileSync(first.envelopePath).byteLength).toBe(first.envelopeBytes.byteLength);
      // 同一名の再書出しは拒否される。無条件の上書きをしない。
      await expect(emitHandoff(directory)).rejects.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("明示的な出力先が指定されたときだけ、そこへ単一操作で書出す", {
    skip: process.env.SUI_HANDOFF_OUTPUT_DIR === undefined,
  }, async () => {
    const directory = process.env.SUI_HANDOFF_OUTPUT_DIR;
    if (typeof directory !== "string") return;
    expect(directory.length).toBeGreaterThan(0);
    expect(isAbsolute(directory)).toBe(true);
    const emitted = await emitHandoff(directory);
    expect(readFileSync(emitted.payloadPath).byteLength).toBe(EXPECTED_PAYLOAD_BYTES);
    expect(readFileSync(emitted.envelopePath).byteLength).toBe(emitted.envelopeBytes.byteLength);
    // 書出しはこの一度きり。同一名の再書出しは拒否する。
    await expect(emitHandoff(directory)).rejects.toThrow();
  });

  it("開示Scopeが明示承認されていないと票は作れない（未承認Sourceの自動送出を防ぐ）", async () => {
    const doc = fixture();
    const projection = await buildContextProjection({ doc, constraint: "reviewed-only", safeMode: false });
    const markdown = renderReadOnlyMarkdownDraft(projection);
    const payloadSha256 = await sha256Hex(markdown);
    const base = {
      handoffId: "ho-20261111-sui-sho-0001",
      emittedAt: "2026-11-11T00:00:00.000Z",
      producer: {
        product: "sui-sensemaking",
        entrypoint: "handoff_context_emit.test.ts",
        version: "sui-sensemaking@main",
        productSkill: null,
      },
      consumer: { product: "sho-composer", entrypoint: "bin/sho-inspect.cjs handoff" },
      purpose: "限定read-only受領試験",
      task: { statement: "s", completionDefinition: "c" },
      target: { product: "sui-sensemaking", kind: "document", id: doc.id },
      revision: {
        kind: "context-projection.baseDocSignature",
        value: projection.baseDocSignature,
        digest: REVISION_DIGEST,
        observedAt: "2026-11-11T00:00:00.000Z",
      },
      disclosure: {
        scope: undefined as never,
        audience: ["sho-composer"],
        purpose: "二製品間の限定read-only受領試験",
        rawSource: RAW_SOURCE_POLICY,
      },
      payload: {
        mediaType: "text/markdown",
        encoding: "utf-8" as const,
        relPath: PAYLOAD_NAME,
        byteLength: EXPECTED_PAYLOAD_BYTES,
        sha256: `sha256:${payloadSha256}`,
      },
      references: [], evidence: [], unresolved: [], usageRestrictions: [],
      obligations: [], dependenciesToConfirm: [], consumerRecheck: [], residualWork: [],
      transport: { harness: "deepseek-harness", sessionLabel: null, authority: TRANSPORT_AUTHORITY },
    };
    expect(() => buildHandoffContextEnvelope(base as unknown as HandoffEnvelopeInput))
      .toThrow(/disclosure.scope must be one of/);
    // payloadが未知でも、開示Scopeが未知なら内容を作る前に閉じる。
    expect(() =>
      buildHandoffContextEnvelope(
        { ...base, payload: { ...base.payload, sha256: "nonsense" } } as unknown as HandoffEnvelopeInput,
      ),
    ).toThrow(/disclosure.scope must be one of/);
  });
});

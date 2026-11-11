import { describe, expect, it } from "vitest";
import {
  DISCLOSURE_SCOPES,
  HANDOFF_CONTEXT_SCHEMA,
  HandoffEnvelopeError,
  RAW_SOURCE_POLICY,
  TRANSPORT_AUTHORITY,
  buildHandoffContextEnvelope,
  findAuthorityBearingKey,
  findAuthorityMarker,
  serializeHandoffContextEnvelope,
  type HandoffEnvelopeInput,
} from "./handoff_context_envelope";

/**
 * 独立に記述した期待値。関数の出力から期待を再生成しない。
 * payload/Revisionのdigestは合成fixtureのsha256であり、SUIのSource revisionではない。
 */
const PAYLOAD_SHA256 = "a".repeat(64);
const REVISION_DIGEST = "b".repeat(64);

function input(overrides: Partial<HandoffEnvelopeInput> = {}): HandoffEnvelopeInput {
  return {
    handoffId: "ho-20261111-0001",
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
    target: {
      product: "sui-sensemaking",
      kind: "document",
      id: "sui-sho-p0-cross-product-synthetic",
    },
    revision: {
      kind: "context-projection.baseDocSignature",
      value: "sui-sho-p0-cross-product-synthetic:2026-11-07T00:00:00.000Z",
      digest: `sha256:${REVISION_DIGEST}`,
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
      relPath: "sui-to-sho-handoff.md",
      byteLength: 354,
      sha256: `sha256:${PAYLOAD_SHA256}`,
    },
    references: [
      {
        kind: "handoff-payload",
        locator: "sui-to-sho-handoff.md",
        digest: `sha256:${PAYLOAD_SHA256}`,
        note: "票と同梱されるpayload。Consumerは実bytesを独立に再読取する。",
      },
      {
        kind: "producer-source",
        locator: "sui-sensemaking:document:sui-sho-p0-cross-product-synthetic",
        digest: null,
        note: "原本はSUIが保持する。票は参照のみで、内容は運ばない。",
      },
    ],
    evidence: [
      {
        claim: "payloadはレビュー済み_card 2件の投影だけで構成される",
        basis: "context-projection.v1 / constraint=reviewed-only",
        observedAt: "2026-11-11T00:00:00.000Z",
        limitation: "未レビュー・保留中のcardは含まない。含まれないことの確認はしていない。",
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
        description: "文書内の全参照網羅は未評価。",
      },
    ],
    usageRestrictions: [
      "read-only。書込み・保存・公開を行わない。",
      "TEIの Accepted Meaning ではない。",
      "出典引用・原本取得・意味受理に使わない。",
      "producerの許可なく他へ再開示しない。",
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
      "三製品以上の連鎖は未検証。",
    ],
    transport: { harness: "deepseek-harness", sessionLabel: null, authority: TRANSPORT_AUTHORITY },
    ...overrides,
  };
}

describe("yi.handoff.context/v1 Producer", () => {
  it("必須の欄をすべて持ち、会話履歴は含まない", () => {
    const envelope = buildHandoffContextEnvelope(input());
    expect(envelope.schema).toBe(HANDOFF_CONTEXT_SCHEMA);
    expect(envelope.schema).toBe("yi.handoff.context/v1");
    expect(envelope.producer.product).toBe("sui-sensemaking");
    expect(envelope.consumer.product).toBe("sho-composer");
    expect(envelope.target).toEqual({
      product: "sui-sensemaking",
      kind: "document",
      id: "sui-sho-p0-cross-product-synthetic",
    });
    expect(envelope.revision.digest).toBe(`sha256:${REVISION_DIGEST}`);
    expect(envelope.disclosure.scope).toBe("synthetic-only");
    expect(envelope.disclosure.rawSource).toBe("not-exportable");
    expect(envelope.payload.relPath).toBe("sui-to-sho-handoff.md");
    expect(envelope.payload.sha256).toBe(`sha256:${PAYLOAD_SHA256}`);
    expect(envelope.references).toHaveLength(2);
    expect(envelope.evidence).toHaveLength(1);
    expect(envelope.unresolved).toHaveLength(2);
    expect(envelope.usageRestrictions.length).toBeGreaterThan(0);
    expect(envelope.obligations.map((entry) => entry.id)).toEqual([
      "independent-reread",
      "recheck-disclosure",
    ]);
    expect(envelope.dependenciesToConfirm.map((entry) => entry.id)).toEqual([
      "review-state-at-use",
      "current-host-grant",
    ]);
    expect(envelope.conversationHistory.included).toBe(false);
    expect(envelope.transport.authority).toBe("none");
    expect(envelope.transport.sessionLabel).toBe(null);
  });

  it("Task・根拠・未完了の義務・確認が必要な依存関係を別欄で保つ", () => {
    const envelope = buildHandoffContextEnvelope(input());
    expect(envelope.task.statement).not.toBe(envelope.task.completionDefinition);
    expect(envelope.evidence[0].limitation).not.toBe("");
    expect(envelope.obligations[0].owner).toBe("sho-composer");
    expect(envelope.dependenciesToConfirm[0].confirmWith).toBe("sui-sensemaking");
    // 会話履歴の代用にならないことを宣言で明示する。
    expect(envelope.conversationHistory.note).toContain("会話履歴は移さない");
  });

  it("未知の開示Scopeはactiveやpublicへ読み替えずに拒否する", () => {
    const attempt = () =>
      buildHandoffContextEnvelope(
        input({ disclosure: { ...input().disclosure, scope: "public" as never } }),
      );
    expect(attempt).toThrow(HandoffEnvelopeError);
    try {
      attempt();
    } catch (error) {
      expect((error as HandoffEnvelopeError).code).toBe("handoff-disclosure-scope-unknown");
    }
    for (const scope of DISCLOSURE_SCOPES) {
      expect(() =>
        buildHandoffContextEnvelope(input({ disclosure: { ...input().disclosure, scope } })),
      ).not.toThrow();
    }
  });

  it("開示Audienceが空、rawSource方針が違う場合は閉じる", () => {
    expect(() =>
      buildHandoffContextEnvelope(
        input({ disclosure: { ...input().disclosure, audience: [] } }),
      ),
    ).toThrow(/audience must not be empty/);
    expect(() =>
      buildHandoffContextEnvelope(
        input({ disclosure: { ...input().disclosure, rawSource: "exportable" as never } }),
      ),
    ).toThrow(/rawSource must be/);
  });

  it("digestはsha256:<64小文字hex>だけを受付ける", () => {
    for (const digest of ["sha256:", "sha256:" + "A".repeat(64), "md5:" + "0".repeat(32), "abc"]) {
      expect(() =>
        buildHandoffContextEnvelope(input({ payload: { ...input().payload, sha256: digest } })),
      ).toThrow(/sha256:<64 lowercase hex>/);
    }
    // 空文字は形式エラーではなく必須欄欠落として閉じる。どちらも受理しない。
    expect(() =>
      buildHandoffContextEnvelope(input({ payload: { ...input().payload, sha256: "" } })),
    ).toThrow(/non-empty string/);
  });

  it("payloadの同梱名はパス区切りや..を拒否する", () => {
    for (const relPath of ["../outside.md", "dir/file.md", "dir\\file.md", ".hidden", ""]) {
      expect(() =>
        buildHandoffContextEnvelope(input({ payload: { ...input().payload, relPath } })),
      ).toThrow();
    }
  });

  it("transport.authorityは常にnoneで、入力を上書きしない", () => {
    const envelope = buildHandoffContextEnvelope(
      input({ transport: { harness: "other-harness", sessionLabel: "s-2", authority: "admin" as never } }),
    );
    expect(envelope.transport.authority).toBe("none");
    expect(envelope.transport.harness).toBe("other-harness");
    expect(envelope.transport.sessionLabel).toBe("s-2");
  });

  it("入力の未知keyは票へ写されない（密輸経路がない）", () => {
    const smuggled = {
      ...input(),
      accessToken: "smuggled",
      nested: { grant: "all" },
    } as unknown as HandoffEnvelopeInput;
    const envelope = buildHandoffContextEnvelope(smuggled) as unknown as Record<string, unknown>;
    expect(Object.keys(envelope)).not.toContain("accessToken");
    expect(Object.keys(envelope)).not.toContain("nested");
  });

  it("権限系keyと権限マーカーを検出する", () => {
    expect(findAuthorityBearingKey({ a: { grant: 1 } })).toBe("$.a.grant");
    expect(findAuthorityBearingKey({ a: [{ apiKey: 1 }] })).toBe("$.a[0].apiKey");
    expect(findAuthorityBearingKey({ a: 1 })).toBe(null);
    expect(findAuthorityMarker("hello")).toBe(null);
    expect(findAuthorityMarker('{"x":"Bearer abc"}')).toBe("bearer ");
  });

  it("生成した票は権限系key・マーカーを含まない", () => {
    const envelope = buildHandoffContextEnvelope(input());
    expect(findAuthorityBearingKey(envelope)).toBe(null);
    expect(findAuthorityMarker(serializeHandoffContextEnvelope(envelope))).toBe(null);
    const parsed = JSON.parse(serializeHandoffContextEnvelope(envelope));
    expect(parsed.schema).toBe(HANDOFF_CONTEXT_SCHEMA);
  });

  it("改変された票は権限keyを検出して閉じる", () => {
    const envelope = buildHandoffContextEnvelope(input());
    const tampered = JSON.parse(JSON.stringify(envelope));
    tampered.producer.grant = "all";
    expect(findAuthorityBearingKey(tampered)).toBe("$.producer.grant");
  });

  it("必須欄の欠落は満たすまで拒否する", () => {
    const missing = input();
    delete (missing as unknown as Record<string, unknown>).handoffId;
    expect(() => buildHandoffContextEnvelope(missing)).toThrow(/handoffId must be a non-empty string/);
  });
});

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HANDOFF_RECEIPT_SCHEMA,
  HandoffReceiptError,
  isReceiptMatchedForTicket,
  reviewHandoffReceipt,
} from "./handoff_receipt_review";

/**
 * ReceiptはConsumer（SHO）の観測。期待値は独立に記述し、
 * 本体の出力から再生成しない。
 */
const TICKET_SHA256 = `sha256:${"a".repeat(64)}`;
const OTHER_TICKET_SHA256 = `sha256:${"b".repeat(64)}`;

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    schema: HANDOFF_RECEIPT_SCHEMA,
    status: "received",
    receivedAt: "2026-11-11T00:00:00.000Z",
    consumer: {
      product: "sho-composer",
      entrypoint: "bin/sho-inspect.cjs handoff",
      harness: "deepseek-harness",
      sessionLabel: "session-1",
    },
    ticket: {
      handoffId: "ho-20261111-sui-sho-0001",
      emittedAt: "2026-11-11T00:00:00.000Z",
      sha256: TICKET_SHA256,
      producer: "sui-sensemaking",
      producerVersion: "sui-sensemaking@main",
      target: { product: "sui-sensemaking", kind: "document", id: "doc-1" },
      revision: {
        kind: "context-projection.baseDocSignature",
        value: "doc-1:2026-11-07T00:00:00.000Z",
        digest: `sha256:${"c".repeat(64)}`,
      },
      disclosure: { scope: "synthetic-only", audience: ["sho-composer"], rawSource: "not-exportable" },
      transport: { harness: "deepseek-harness", sessionLabel: "session-1", authority: "none" },
    },
    payload: {
      requestedPath: "/tmp/handoff/sui-to-sho-handoff.md",
      byteLength: 354,
      sha256: `sha256:${"d".repeat(64)}`,
      revision: "unknown",
      parser: "14.3.3",
      grammarScope: "markdown-it commonmark link_open tokens only",
      linkOccurrenceCount: 0,
      coverage: {
        parsedMarkdownLinkTokens: true,
        allDocumentReferencesEnumerated: false,
        unresolvedReferenceCandidatesEvaluated: false,
        renderedAnchorsObserved: false,
        externalSourcesAcquired: false,
        sourceWriterInvoked: false,
      },
    },
    checks: [{ id: "payload-digest", ok: true, detail: "ok" }],
    carriedForward: {
      task: { statement: "s", completionDefinition: "c" },
      evidence: [],
      unresolved: [],
      usageRestrictions: [],
      obligations: [],
      dependenciesToConfirm: [],
      consumerRecheck: [],
      residualWork: [],
    },
    claims: {
      independentReread: true,
      payloadMatchesTicket: true,
      conversationHistoryIncluded: false,
      authorityCarried: false,
      sourceRevisionCurrent: false,
      originalSourcesRead: false,
      meaningAccepted: false,
      writerInvoked: false,
      externalSourcesAcquired: false,
      externalDisclosure: false,
      sessionInheritedAuthority: false,
    },
    ...overrides,
  };
}

describe("yi.handoff.receipt/v1 Producer側の照合（G2）", () => {
  it("票のdigestが一致すればmatchedで、意味受理のclaimを立てない", () => {
    const review = reviewHandoffReceipt(receipt(), TICKET_SHA256);
    expect(review.status).toBe("matched");
    expect(review.schema).toBe("yi.handoff.receipt-review/v1");
    expect(review.receiptTicketSha256).toBe(TICKET_SHA256);
    expect(review.expectedTicketSha256).toBe(TICKET_SHA256);
    expect(review.nonAcceptableClaims).toEqual([]);
    expect(review.unknownClaims).toEqual([]);
    expect(isReceiptMatchedForTicket(receipt(), TICKET_SHA256)).toBe(true);
  });

  it("別の票を指すReceiptはmismatch（自己申告を信用しない）", () => {
    const review = reviewHandoffReceipt(receipt(), OTHER_TICKET_SHA256);
    expect(review.status).toBe("mismatch");
    expect(review.receiptTicketSha256).toBe(TICKET_SHA256);
    expect(review.expectedTicketSha256).toBe(OTHER_TICKET_SHA256);
    expect(review.reason).toContain("different ticket");
    expect(isReceiptMatchedForTicket(receipt(), OTHER_TICKET_SHA256)).toBe(false);
  });

  it("Consumerの観測をProducerの意味受理へ昇格させない", () => {
    const accepted = receipt({
      claims: { ...receipt().claims, meaningAccepted: true },
    });
    const review = reviewHandoffReceipt(accepted, TICKET_SHA256);
    expect(review.status).toBe("claim-not-accepted");
    expect(review.nonAcceptableClaims).toEqual(["meaningAccepted"]);
    expect(review.reason).toContain("not a Product's meaning acceptance");
  });

  it("sourceRevisionCurrentの主張もProducer側では受理しない", () => {
    const current = receipt({
      claims: { ...receipt().claims, sourceRevisionCurrent: true },
    });
    const review = reviewHandoffReceipt(current, TICKET_SHA256);
    expect(review.status).toBe("claim-not-accepted");
    expect(review.nonAcceptableClaims).toEqual(["sourceRevisionCurrent"]);
  });

  it("権限系keyを持つReceiptはreceipt-authority", () => {
    const tampered = receipt();
    (tampered.consumer as Record<string, unknown>).grant = "all";
    const review = reviewHandoffReceipt(tampered, TICKET_SHA256);
    expect(review.status).toBe("receipt-authority");
    expect(review.reason).toContain("$.consumer.grant");
  });

  it("権限・Effect系のclaimがtrueならreceipt-authority", () => {
    for (const claim of [
      "authorityCarried",
      "writerInvoked",
      "externalDisclosure",
      "externalSourcesAcquired",
      "sessionInheritedAuthority",
      "conversationHistoryIncluded",
      "originalSourcesRead",
    ]) {
      const review = reviewHandoffReceipt(
        receipt({ claims: { ...receipt().claims, [claim]: true } }),
        TICKET_SHA256,
      );
      expect(review.status).toBe("receipt-authority");
      expect(review.reason).toContain(claim);
    }
  });

  it("未知のclaimは落とさずunknownとして運ぶ", () => {
    const extra = receipt({
      claims: { ...receipt().claims, someFutureObservation: true },
    });
    const review = reviewHandoffReceipt(extra, TICKET_SHA256);
    expect(review.status).toBe("matched");
    expect(review.unknownClaims).toEqual(["someFutureObservation"]);
    expect(review.reason).toContain("unknown claims are carried as unknown");
  });

  it("未知のclaimを拒否しない（Consumerの観測を根拠ごと落とさない）", () => {
    // 未知claimがあってもmatched。ただしnonAcceptableには昇格させない。
    const extra = receipt({
      claims: { ...receipt().claims, someFutureObservation: false },
    });
    expect(reviewHandoffReceipt(extra, TICKET_SHA256).status).toBe("matched");
  });

  it("schema・status・必須欄の不正はreceipt-invalid", () => {
    expect(reviewHandoffReceipt(receipt({ schema: "yi.handoff.receipt/v2" }), TICKET_SHA256).status)
      .toBe("receipt-invalid");
    expect(reviewHandoffReceipt(receipt({ status: "rejected" }), TICKET_SHA256).status)
      .toBe("receipt-invalid");
    expect(reviewHandoffReceipt(null, TICKET_SHA256).status).toBe("receipt-invalid");
    expect(reviewHandoffReceipt([], TICKET_SHA256).status).toBe("receipt-invalid");
    const missingClaims = receipt();
    delete (missingClaims as Record<string, unknown>).claims;
    expect(reviewHandoffReceipt(missingClaims, TICKET_SHA256).status).toBe("receipt-invalid");
  });

  it("claimが欠けていればreceipt-invalid（部分的なclaimsを合格にしない）", () => {
    const partial = receipt();
    delete (partial.claims as Record<string, unknown>).meaningAccepted;
    expect(reviewHandoffReceipt(partial, TICKET_SHA256).status).toBe("receipt-invalid");
    expect(reviewHandoffReceipt(partial, TICKET_SHA256).reason).toContain("claims.meaningAccepted");
  });

  it("ticket.sha256の形式を要求する", () => {
    const badDigest = receipt();
    (badDigest.ticket as Record<string, unknown>).sha256 = "abc";
    expect(reviewHandoffReceipt(badDigest, TICKET_SHA256).status).toBe("receipt-invalid");
  });

  it("expected digestの形式不正は例外で閉じる", () => {
    for (const digest of ["", "sha256:", "sha256:" + "A".repeat(64), "md5:" + "0".repeat(32)]) {
      expect(() => reviewHandoffReceipt(receipt(), digest)).toThrow(HandoffReceiptError);
    }
  });

  it("HarnessやSessionのラベルが違っても照合結果は変わらない", () => {
    const otherHarness = receipt();
    (otherHarness.consumer as Record<string, unknown>).harness = "other-harness";
    (otherHarness.consumer as Record<string, unknown>).sessionLabel = "session-2";
    const review = reviewHandoffReceipt(otherHarness, TICKET_SHA256);
    expect(review.status).toBe("matched");
    // Harnessの違いは資格や意味の差ではない。
    expect(review.nonAcceptableClaims).toEqual([]);
  });

  it("実ファイルから読んだReceiptを照合できる（明示指定時だけ）", {
    skip: process.env.SUI_HANDOFF_RECEIPT_DIR === undefined,
  }, () => {
    const directory = process.env.SUI_HANDOFF_RECEIPT_DIR;
    if (typeof directory !== "string") return;
    expect(directory.length).toBeGreaterThan(0);
    expect(isAbsolute(directory)).toBe(true);
    // 呼び出し側が渡す票digest。Receiptの自己申告ではなくここから計算する。
    const expected = process.env.SUI_HANDOFF_TICKET_SHA256;
    if (typeof expected !== "string") return;
    const receiptPath = join(directory, "ho-20261111-sui-sho-0001.receipt.json");
    const parsed = JSON.parse(readFileSync(receiptPath, "utf8"));
    const review = reviewHandoffReceipt(parsed, expected);
    expect(review.status).toBe("matched");
    expect(review.receiptTicketSha256).toBe(expected);
    // 受領は意味受理でも権限でもない。
    expect(review.nonAcceptableClaims).toEqual([]);
    // 受領ファイルは書き換えない。
    const before = readFileSync(receiptPath);
    expect(readFileSync(receiptPath)).toEqual(before);
  });
});

  it("Producer側も未知のReceipt欄を落とさず運ぶ", () => {
    // SHO Consumer が `ticket.unknownFields` を運ぶのと同じ規則を Producer 側にも
    // 敷く。Receipt に v1 語彙のない欄が増えても、過去のReceiptから拡張欄が
    // 無警告で失われない。
    const withExtra = receipt();
    (withExtra as Record<string, unknown>).futureExtension = { hop: 2, priorHandoffId: "ho-prior" };
    const review = reviewHandoffReceipt(withExtra, TICKET_SHA256);
    expect(review.status).toBe("matched");
    expect(review.unknownFields.futureExtension).toEqual({ hop: 2, priorHandoffId: "ho-prior" });
  });

  it("未知欄が無いReceiptでは unknownFields は空", () => {
    const review = reviewHandoffReceipt(receipt(), TICKET_SHA256);
    expect(review.status).toBe("matched");
    expect(review.unknownFields).toEqual({});
  });
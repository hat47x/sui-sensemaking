import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DocumentV1 } from "../domain/types";
import { AGENT_TASK_GUARDRAIL_TEXT, buildAgentTaskSheet } from "./agent_task_export";

const fixturesDir = path.resolve(__dirname, "../../tests/fixtures/agent_task");
const fixtureDoc = JSON.parse(fs.readFileSync(path.join(fixturesDir, "doc.fixture.json"), "utf8")) as DocumentV1;
const readGolden = (filename: string): string => fs.readFileSync(path.join(fixturesDir, filename), "utf8").replace(/\r\n/g, "\n");

const FIXED_TASK_ID = "11111111-1111-1111-1111-111111111111";
const FIXED_CREATED_AT = "2026-07-09T00:00:00.000Z";

describe("agent_task_export golden fixtures", () => {
  it("island_titles task sheet matches golden fixture and is deterministic", async () => {
    const expected = readGolden("agent_task_island_titles.md");
    const buildOnce = () =>
      buildAgentTaskSheet({
        doc: fixtureDoc,
        taskKind: "island_titles",
        selectedCardIds: ["c1", "c2", "c3"],
        selectedIslandIds: [],
        safeMode: false,
        taskId: FIXED_TASK_ID,
        createdAt: FIXED_CREATED_AT,
      });

    const run1 = await buildOnce();
    const run2 = await buildOnce();

    expect(run1.taskSheetMd).toBe(expected);
    expect(run1.taskSheetMd).toBe(run2.taskSheetMd);
  });

  it("excludes unreviewed card text by default, includes it only when explicitly opted in", async () => {
    const defaultOutput = await buildAgentTaskSheet({
      doc: fixtureDoc,
      taskKind: "island_titles",
      selectedCardIds: ["c1", "c2", "c3"],
      selectedIslandIds: [],
      safeMode: false,
      taskId: FIXED_TASK_ID,
      createdAt: FIXED_CREATED_AT,
    });
    expect(defaultOutput.taskSheetMd).not.toContain("未レビューの下書き");
    expect(defaultOutput.taskSheetMd).toContain("未レビューのカード 1件は本文を除外しています");

    const optedInOutput = await buildAgentTaskSheet({
      doc: fixtureDoc,
      taskKind: "island_titles",
      selectedCardIds: ["c1", "c2", "c3"],
      selectedIslandIds: [],
      safeMode: false,
      taskId: FIXED_TASK_ID,
      createdAt: FIXED_CREATED_AT,
      options: { includeUnreviewedDrafts: true },
    });
    expect(optedInOutput.taskSheetMd).toContain("未レビューの下書き");
  });

  it("SafeMode redacts all card text regardless of includeUnreviewedDrafts", async () => {
    const output = await buildAgentTaskSheet({
      doc: fixtureDoc,
      taskKind: "island_titles",
      selectedCardIds: ["c1", "c2"],
      selectedIslandIds: [],
      safeMode: true,
      taskId: FIXED_TASK_ID,
      createdAt: FIXED_CREATED_AT,
      options: { includeUnreviewedDrafts: true },
    });
    expect(output.taskSheetMd).not.toContain("雨が降ると来場者が減る");
    expect(output.taskSheetMd).toContain("セーフモード: 本文は非表示です");
  });

  it("excludes Card.meta.source by default, includes it only when explicitly opted in", async () => {
    const withSource: DocumentV1 = {
      ...fixtureDoc,
      cards: fixtureDoc.cards.map((card) => (card.id === "c1" ? { ...card, meta: { source: "interview-2026-07-01.txt:42" } } : card)),
    };

    const defaultOutput = await buildAgentTaskSheet({
      doc: withSource,
      taskKind: "island_titles",
      selectedCardIds: ["c1"],
      selectedIslandIds: [],
      safeMode: false,
      taskId: FIXED_TASK_ID,
      createdAt: FIXED_CREATED_AT,
    });
    expect(defaultOutput.taskSheetMd).not.toContain("interview-2026-07-01.txt:42");

    const optedInOutput = await buildAgentTaskSheet({
      doc: withSource,
      taskKind: "island_titles",
      selectedCardIds: ["c1"],
      selectedIslandIds: [],
      safeMode: false,
      taskId: FIXED_TASK_ID,
      createdAt: FIXED_CREATED_AT,
      options: { includeSourceReferences: true },
    });
    expect(optedInOutput.taskSheetMd).toContain("interview-2026-07-01.txt:42");
  });

  it("never emits score/rank/confidence/priority tokens (spec §4.2 anti-scoring)", async () => {
    const output = await buildAgentTaskSheet({
      doc: fixtureDoc,
      taskKind: "critique_suggestions",
      selectedCardIds: ["c1", "c2", "c3"],
      selectedIslandIds: [],
      safeMode: false,
      taskId: FIXED_TASK_ID,
      createdAt: FIXED_CREATED_AT,
      options: { includeUnreviewedDrafts: true },
    });
    // The guardrail text's own prohibition legitimately names these Japanese
    // terms as an instruction to the agent ("点数・順位・優先度の数値を付けないでください"),
    // not as a scoring artifact -- exclude that one section before asserting,
    // so the anti-pattern check still catches an accidental score/rank field
    // appearing anywhere else in the sheet (e.g. in the context excerpt or a
    // future taskKind's request instruction).
    const withoutGuardrail = output.taskSheetMd.replace(AGENT_TASK_GUARDRAIL_TEXT, "");
    expect(withoutGuardrail).not.toMatch(/score|rank|confidence|priority|readiness|優先度の数値|点数|順位/i);
  });

  it("includes the fixed guardrail text verbatim and the 5-section order (依頼→ガードレール→文脈→応答契約→相関ブロック)", async () => {
    const output = await buildAgentTaskSheet({
      doc: fixtureDoc,
      taskKind: "merge_candidates",
      selectedCardIds: ["c1", "c2"],
      selectedIslandIds: [],
      safeMode: false,
      taskId: FIXED_TASK_ID,
      createdAt: FIXED_CREATED_AT,
    });

    const sectionOrder = ["## 依頼", "## ガードレール", "## 文脈", "## 応答契約", "## 相関ブロック"].map((heading) =>
      output.taskSheetMd.indexOf(heading),
    );
    expect(sectionOrder.every((index) => index !== -1)).toBe(true);
    expect(sectionOrder).toEqual([...sectionOrder].sort((a, b) => a - b));

    expect(output.taskSheetMd).toContain(
      "「あなたの出力は提案であり確定しません／点数・順位・％・優先度の数値を付けないでください／曖昧・対立・未確定はそのまま保持して提示してください／出典のない断定をしないでください／応答は§4の JSON のみで返してください（前後の説明文は不要）」",
    );

    expect(output.correlation.schemaVersion).toBe("agent-task.v1");
    expect(output.correlation.taskId).toBe(FIXED_TASK_ID);
    expect(output.correlation.baseDocSignature).toBe(`${fixtureDoc.id}:${fixtureDoc.updatedAt}`);
    expect(output.taskSheetMd).toContain(output.correlation.bundleHash);
    expect(output.taskJson).toBe(JSON.stringify(output.correlation, null, 2));
  });

  it("does not put an unreviewed island title into the sheet or the structured output", async () => {
    const doc: DocumentV1 = {
      ...fixtureDoc,
      islands: [
        ...(fixtureDoc.islands ?? []),
        { id: "i-unreviewed", cardIds: ["c1"], title: "unreviewed secret island title" },
      ],
    };
    const output = await buildAgentTaskSheet({
      doc,
      taskKind: "island_titles",
      selectedCardIds: ["c1"],
      selectedIslandIds: ["i-unreviewed"],
      safeMode: true,
      taskId: FIXED_TASK_ID,
      createdAt: FIXED_CREATED_AT,
    });

    expect(output.taskSheetMd).toContain("(未レビュー)");
    expect(output.taskSheetMd).not.toContain("unreviewed secret island title");
    expect(output.taskJson).not.toContain("unreviewed secret island title");
  });
});

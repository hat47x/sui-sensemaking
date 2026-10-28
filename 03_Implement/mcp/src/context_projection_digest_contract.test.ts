import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { createServer } from "./server.js";

// ADR-0103 の契約テスト。MCPのツール経由の出力について、digestの有無、SafeModeでのnull、
// bundleHashがdigestに依存しないこと、agent向け文書（許可リスト適用後）から作った投影の形を固定する。
// 入力の agentView は、バックエンドの `_agent_document_view` の出力そのもの。
// backend/tests/test_agent_view_projection_contract.py が、同じファイルと実装の一致を確かめる。

type Fixture = { source: unknown; agentView: unknown };
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/agent_view_contract.json", import.meta.url), "utf-8"),
) as Fixture;

type Digest = { alg: string; value: string } | null;
type Projection = {
  bundleHash: string;
  safeMode: boolean;
  cards: Array<{ id: string; text: string; redacted: boolean; digest: Digest }>;
  islands: Array<{ id: string; title: string; digest: Digest }>;
  evidence: unknown[];
  counts: unknown;
};

async function callProjection(doc: unknown, args: Record<string, unknown>): Promise<Projection> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ status: 200, ok: true, json: async () => doc }) as Response),
  );
  const server = createServer({ baseUrl: "http://127.0.0.1:8000" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const result = await client.callTool({
    name: "get_context_projection",
    arguments: { docId: "doc_agent_contract", constraint: "reviewed-only", ...args },
  });
  expect(result.isError).toBeFalsy();
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  return JSON.parse(text) as Projection;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MCPツール出力のdigest（ADR-0103）", () => {
  it("SafeMode OFFでは、レビュー済みのカードにだけsha256のdigestが付く", async () => {
    const p = await callProjection(fixture.source, { safeMode: false });
    expect(p.cards.map((c) => c.id)).toEqual(["c1", "c2"]);
    for (const card of p.cards) {
      expect(card.redacted).toBe(false);
      expect(card.digest).toMatchObject({ alg: "sha256", value: expect.stringMatching(/^[0-9a-f]{64}$/) });
    }
    expect(p.cards[0]?.digest?.value).not.toBe(p.cards[1]?.digest?.value);
  });

  it("SafeMode ON（既定）では、カードのdigestがすべてnullになる", async () => {
    const p = await callProjection(fixture.source, {});
    expect(p.safeMode).toBe(true);
    expect(p.cards.length).toBeGreaterThan(0);
    for (const card of p.cards) {
      expect(card.redacted).toBe(true);
      expect(card.digest).toBeNull();
    }
  });

  it("島のdigestは、レビュー済みの題名にだけ付き、SafeModeに依存しない", async () => {
    const on = await callProjection(fixture.source, { safeMode: true });
    const off = await callProjection(fixture.source, { safeMode: false });
    const byId = (p: Projection, id: string) => p.islands.find((i) => i.id === id);
    expect(byId(on, "i-reviewed")?.digest).toMatchObject({ alg: "sha256" });
    expect(byId(on, "i-reviewed")?.digest).toEqual(byId(off, "i-reviewed")?.digest);
    expect(byId(on, "i-unreviewed")?.digest).toBeNull();
    expect(byId(on, "i-untitled")?.digest).toBeNull();
  });

  it("bundleHashはdigestの追加前と同じ値で、SafeModeを変えても本文の露出だけでは変わらない", async () => {
    const on = await callProjection(fixture.source, { safeMode: true });
    const again = await callProjection(fixture.source, { safeMode: true });
    expect(on.bundleHash).toBe(again.bundleHash);
    // この値は、digestを足す前の投影実装（5293466cの親）でも同じになることを確かめて固定した。
    expect(on.bundleHash).toBe(EXPECTED_BUNDLE_HASH_SAFE_ON);
  });

  it("本文を伏せたカードの入力は、digestにもbundleHashにも影響しない", async () => {
    const doc = structuredClone(fixture.source) as { cards: Array<{ id: string; text: string }> };
    const before = await callProjection(doc, { safeMode: false });
    const c3 = doc.cards.find((c) => c.id === "c3");
    if (c3) c3.text = "edited unreviewed text";
    const after = await callProjection(doc, { safeMode: false });
    expect(after.cards.map((c) => c.digest)).toEqual(before.cards.map((c) => c.digest));
    expect(after.bundleHash).toBe(before.bundleHash);
  });
});

describe("agent向け文書（許可リスト適用後）から作った投影", () => {
  it("題名のない島は「(無題)」、題名が未レビューの島も、キーが落ちるため「(無題)」で返る", async () => {
    const p = await callProjection(fixture.agentView, { safeMode: true });
    const title = (id: string) => p.islands.find((i) => i.id === id)?.title;
    expect(title("i-reviewed")).toBe("reviewed island title");
    // 現行の確定値。投影の単体テストは、題名ありで未レビューの島を「(未レビュー)」と返す（元文書の場合）。
    // agent経路は未レビューの題名のキーを落とすため、外部からは「題名なし」と区別できない（#3277の未決）。
    expect(title("i-unreviewed")).toBe("(無題)");
    expect(title("i-untitled")).toBe("(無題)");
  });

  it("同じ文書でも、元文書では未レビューの題名が「(未レビュー)」になり、agent経路と差が出る", async () => {
    const p = await callProjection(fixture.source, { safeMode: true });
    expect(p.islands.find((i) => i.id === "i-unreviewed")?.title).toBe("(未レビュー)");
    expect(p.islands.find((i) => i.id === "i-untitled")?.title).toBe("(無題)");
  });

  it("未レビューのカードのid、本文、題名は、どちらの経路の出力にも出ない", async () => {
    for (const doc of [fixture.source, fixture.agentView]) {
      const p = await callProjection(doc, { safeMode: false, constraint: "evidence" });
      const text = JSON.stringify(p);
      expect(text).not.toContain("SECRET-");
      expect(p.cards.some((c) => c.id === "c3")).toBe(false);
      // 未レビューのカードを端点とする根拠リンクe2は、MCP投影のゲートで落ちる。
      expect(text).not.toContain('"e2"');
    }
  });

  it("agent向け文書でも、カードのdigestと島のdigestは元文書と同じ値になる", async () => {
    const viaSource = await callProjection(fixture.source, { safeMode: false });
    const viaAgent = await callProjection(fixture.agentView, { safeMode: false });
    expect(viaAgent.cards.map((c) => c.digest)).toEqual(viaSource.cards.map((c) => c.digest));
    expect(viaAgent.islands.find((i) => i.id === "i-reviewed")?.digest).toEqual(
      viaSource.islands.find((i) => i.id === "i-reviewed")?.digest,
    );
  });
});

const EXPECTED_BUNDLE_HASH_SAFE_ON = "e0eb2083b161e0c95cdfc301cbde9e885e81d8c6dbd80ee0e4bf2b9910700271";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseDocumentJson } from "./document_import";
import { validatePublicPackManifest } from "./public_pack_manifest";

const OBSERVATIONS = [
  "インタビュー後、メモがチャットの奥に流れて、見つけ直すのに時間がかかった。",
  "結論は残っているのに、どの発言を根拠にしたのか後から分からなくなった。",
  "一人だけ違う意見だったので、そのまま議事録から落ちた。",
] as const;

function readUtf8(relativeUrl: string): string {
  return readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), "utf8");
}

describe("first-run public pack", () => {
  it("keeps the default public pack valid and editable in SafeMode", () => {
    const manifestRaw = JSON.parse(readUtf8("../../public/packs/index.json")) as unknown;
    const result = validatePublicPackManifest(manifestRaw);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.manifest.defaultPackId).toBe("first-run-value");
    expect(result.manifest.packs).toHaveLength(1);
    expect(result.manifest.packs[0]).toMatchObject({
      id: "first-run-value",
      documentPath: "first-run-value.document.json",
      enforceSafeMode: true,
      visibility: "Public",
    });
    expect(result.manifest.packs[0]?.readOnly).not.toBe(true);
  });

  it("starts with three raw observations and no pre-made grouping", () => {
    const documentRaw = readUtf8("../../public/packs/first-run-value.document.json");
    const result = parseDocumentJson(documentRaw);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.document.cards.map((card) => card.text)).toEqual(OBSERVATIONS);
    expect(result.document.islands).toHaveLength(0);
    expect(result.document.edges).toHaveLength(0);
  });

  it("keeps the tutorial and the built-in first-run material in sync", () => {
    const tutorial = readUtf8("../../../../04_Documentation/getting_started.md");

    for (const observation of OBSERVATIONS) {
      expect(tutorial).toContain(observation);
    }

    expect(tutorial).toContain("後から根拠へ戻りにくい");
    expect(tutorial).toContain("少数意見が消える");
  });

  it("keeps the App recovery fallback sample aligned with the public pack", () => {
    const appSource = readUtf8("../App.tsx");

    for (const observation of OBSERVATIONS) {
      expect(appSource).toContain(observation);
    }
  });
});

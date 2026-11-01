import { expect, test, type Page } from "@playwright/test";
import { buildFirstMeaningfulMapDocument } from "./helpers/product_value_fixtures";

const START_PANEL = '[data-panel="start-document-entry"]';

async function routeSampleDocument(page: Page): Promise<() => void> {
  let sampleEnabled = false;

  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/docs/doc_phase1_canvas", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sampleEnabled ? buildFirstMeaningfulMapDocument() : buildFirstMeaningfulMapDocument([])),
    });
  });

  return () => {
    sampleEnabled = true;
  };
}

test("the SidePanel can load and display the tenant TEI epistemic projection", async ({ page }) => {
  const enableSample = await routeSampleDocument(page);

  await page.route("**/docs/*/epistemic/projection", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        artifact: {
          contract: "tei.epistemic-projection/v0",
          schema: "tei.reference.epistemic-assessment/v0",
          assessments: [
            {
              assertionId: "a1",
              meaningFingerprint: `sha256:${"a".repeat(64)}`,
              reviewSubjectFingerprint: `sha256:${"b".repeat(64)}`,
              reviewLogSequence: 0,
              contentOrigin: "ai",
              metadataState: "complete",
              statementKind: "hypothesis",
              confirmationState: "unreviewed",
              targetBinding: "exact",
              contextCompatibility: "compatible",
              freshness: "current",
              lifecycleState: "active",
              conflict: "none",
              useState: "candidate-only",
              reasons: [],
            },
          ],
          reviewRequests: [
            {
              assertionId: "a1",
              targetBinding: "exact",
              reasons: ["AI_ORIGIN_UNREVIEWED"],
            },
          ],
          health: { level: "healthy", viewMetadataState: "complete" },
          authorityLimits: [
            "assessment-does-not-assert-objective-truth",
            "content-fingerprint-does-not-restore-review-history",
            "meaning-fingerprint-is-input-not-semantic-proof",
            "assessment-does-not-grant-write-or-runtime-authority",
            "assessment-does-not-grant-canonical-acceptance",
            "target-anchor-resolution-does-not-prove-semantic-identity",
            "coverage-mapping-is-input-not-semantic-completeness-proof",
            "resolution-coverage-is-operational-readiness-not-truth-ratio",
            "partial-transport-health-is-not-project-wide-health",
            "review-history-is-bounded-by-context-as-of",
            "review-binding-includes-context-kind-and-target-identity",
            "review-binding-includes-validity-window",
            "checked-at-is-bound-to-current-subject",
            "reviewer-candidate-is-not-review-authority",
          ],
        },
      }),
    });
  });

  await page.goto("/?locale=en");
  await expect(page.locator(START_PANEL)).toBeVisible();
  enableSample();
  await page.getByRole("button", { name: "Open sample" }).click();

  const panel = page.getByTestId("epistemic-review-panel");
  await expect(panel).toBeVisible();
  await panel.locator("summary").click();
  await panel.getByRole("button", { name: "Load status" }).click();

  await expect(panel.getByRole("group", { name: "Epistemic status: a1" })).toBeVisible();
  await expect(panel.getByText("Loaded 1 epistemic status item(s)")).toBeVisible();

  const queue = panel.getByTestId("epistemic-review-queue");
  await expect(queue).toContainText("Review queue (1)");
  await expect(queue).toContainText("assertion-review: assertion:a1");

  await panel.getByRole("button", { name: "Details", exact: true }).click();
  const inspection = panel.getByTestId("epistemic-inspection-summary");
  await expect(inspection).toBeVisible();
  await expect(inspection).toContainText('"targetBinding": "exact"');
  await expect(inspection).toContainText('"metadataState": "complete"');

  await panel.getByRole("button", { name: "Confirm", exact: true }).click();
  const intent = panel.getByTestId("epistemic-review-intent");
  await expect(intent).toBeVisible();
  await expect(intent).toContainText('"operation": "confirm"');
  await expect(intent).toContainText('"assertionId": "a1"');

  await panel.getByRole("button", { name: "Bulk confirm preview", exact: true }).click();
  const bulk = panel.getByTestId("epistemic-bulk-preview");
  await expect(bulk).toBeVisible();
  await expect(bulk).toContainText('"ok": true');
  await expect(panel.getByText("Display only. Confirmation changes are not saved.")).toBeVisible();
});

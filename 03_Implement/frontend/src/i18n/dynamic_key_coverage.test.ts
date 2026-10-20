import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import en from "./locales/en.json";
import ja from "./locales/ja.json";

const family = (prefix: string, values: readonly string[]): string[] =>
  values.map((value) => `${prefix}${value}`);

const DYNAMIC_KEY_CASES: Record<string, readonly string[]> = {
  "app.status.diagnostics.stage.${}": family("app.status.diagnostics.stage.", [
    "outline", "recommendations", "contradictions", "distribution", "dialectic", "render",
  ]),
  "app.status.diff.stage.${}": family("app.status.diff.stage.", ["cards", "islands", "edges", "evidence", "view"]),
  "app.status.import.review_pack_zip_error_${}": family("app.status.import.review_pack_zip_error_", ["z001", "z002", "z003"]),
  "side_panel.connect.${}": family("side_panel.connect.", ["related", "negate", "causal", "mutual", "equivalence"]),
  "side_panel.claim_type.${}": family("side_panel.claim_type.", ["fact", "claim", "hypothesis", "unknown"]),
  "side_panel.hold_state.${}": family("side_panel.hold_state.", ["active", "held", "pending", "shelved"]),
  "context_query.preview.value.${}.${}": [
    ...family("context_query.preview.value.scope.", ["document", "island", "view"]),
    ...family("context_query.preview.value.review_filter.", ["includeUnreviewed", "reviewedOnly"]),
    "context_query.preview.value.safe_mode_policy.strict",
    ...family("context_query.preview.value.output_mode.", ["candidate", "proposal", "summary"]),
  ],
  "agent_response_import.kind.${}": family("agent_response_import.kind.", [
    "island_title", "merge_candidate", "narrative_draft", "opposing_viewpoint", "critique", "patch",
  ]),
  "agent_response_import.status.${}": family("agent_response_import.status.", ["adopted", "rejected"]),
  "agent_response_import.provenance.${}": family("agent_response_import.provenance.", ["verified-local-export", "unverified-legacy"]),
  "agent_task_export.task_kind.${}": family("agent_task_export.task_kind.", [
    "island_titles", "merge_candidates", "narrative_draft", "opposing_viewpoints", "critique_suggestions", "free_analysis",
  ]),
  "diagnostics_bundle.classification.${}": family("diagnostics_bundle.classification.", [
    "WEB-ENTRY", "API-UNAVAILABLE", "SAVE-FAILURE", "IMPORT-VALIDATION", "SHARE-SAFEMODE",
  ]),
  "inquiry_journey.stage.${}": family("inquiry_journey.stage.", [
    "r1_problem_setting", "r2_situation_grasp", "r3_essence_pursuit", "r4_concept_planning", "r5_concrete_measures", "r6_procedure_planning",
  ]),
  "inquiry_journey.prototype.handoff_artifact_kind.${}": family("inquiry_journey.prototype.handoff_artifact_kind.", [
    "card", "island", "narrative", "relation_summary",
  ]),
  "inquiry_journey.prototype.handoff_question.${}": family("inquiry_journey.prototype.handoff_question.", [
    "understanding", "unresolved_question", "fieldwork_request",
  ]),
  "inquiry_journey.prototype.handoff_input.${}": family("inquiry_journey.prototype.handoff_input.", [
    "understanding", "unresolved_question", "fieldwork_request",
  ]),
  "inquiry_journey.prototype.handoff_decision.${}": family("inquiry_journey.prototype.handoff_decision.", [
    "pending", "adopted", "held", "skipped",
  ]),
  "inquiry_journey.prototype.lineage_kind.${}": family("inquiry_journey.prototype.lineage_kind.", [
    "carried", "edited", "derived", "split", "merged", "new", "retired",
  ]),
  "visual_cue.prototype.condition.${}": family("visual_cue.prototype.condition.", ["C0", "C1", "C2", "C3", "C4"]),
  "side_panel.outline.contradiction_decision.status_${}": family("side_panel.outline.contradiction_decision.status_", [
    "accepted", "held", "rejected",
  ]),
  "tenant_session.bootstrap.blocked.${}": family("tenant_session.bootstrap.blocked.", [
    "authentication_required", "access_denied", "session_unavailable", "invalid_session_response", "invalid_deployment",
  ]),
  "view_controls.ai_provider.kind.${}": family("view_controls.ai_provider.kind.", ["none", "local", "large-scale", "unknown"]),
  "view_controls.ai_provider.outcome.${}": family("view_controls.ai_provider.outcome.", [
    "ok", "disabled", "timeout", "validation", "unavailable", "unknown",
  ]),
  "structure_action.${}": family("structure_action.", [
    "island_create", "cards_added_to_island", "cards_removed_from_island", "hold_state_changed",
  ]),
  "patch_workspace.phase.${}": family("patch_workspace.phase.", [
    "idle", "decision_recorded", "preset_replayed", "rollback_ready", "error",
  ]),
};

function collectSourceFiles(rootDir: string): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
        files.push(path);
      }
    }
  };
  walk(rootDir);
  return files;
}

function collectDynamicTemplates(): Set<string> {
  const sourceRoot = join(process.cwd(), "src");
  const templates = new Set<string>();
  const dynamicCall = /\bt\(\s*`([^`]*\$\{[^`]+)`/g;
  for (const path of collectSourceFiles(sourceRoot)) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(dynamicCall)) {
      templates.add(match[1].replace(/\$\{[^}]+\}/g, "${}"));
    }
  }
  return templates;
}

describe("dynamic i18n key coverage", () => {
  it("declares the reachable value domain for every dynamic translation template", () => {
    const usedTemplates = [...collectDynamicTemplates()].sort();
    const declaredTemplates = Object.keys(DYNAMIC_KEY_CASES).sort();
    expect({ usedTemplates, declaredTemplates }).toEqual({
      usedTemplates: declaredTemplates,
      declaredTemplates,
    });
  });

  it("resolves every reachable dynamic key in both locale catalogs", () => {
    const jaCatalog: Record<string, string> = ja;
    const enCatalog: Record<string, string> = en;
    const reachableKeys = Object.values(DYNAMIC_KEY_CASES).flat();
    const missingInJa = reachableKeys.filter((key) => !(key in jaCatalog));
    const missingInEn = reachableKeys.filter((key) => !(key in enCatalog));
    expect({ missingInJa, missingInEn }).toEqual({ missingInJa: [], missingInEn: [] });
  });
});

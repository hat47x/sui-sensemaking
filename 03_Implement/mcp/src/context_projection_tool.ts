import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildContextProjection,
  CONTEXT_PROJECTION_CONSTRAINTS,
} from "../../frontend/src/export/context_bundle_projection.js";
import { DocumentNotFoundError, fetchDocument, fetchDocumentMetadata, type DocumentClientConfig } from "./document_client.js";
import { computeQueryCanonicalHash, emitContextAuditEvent, logAuditEntry } from "./audit_log.js";

// EXT-CONN-01 subslice B: this is ONE of the read-only capabilities this server
// registers (with get_proposal_status in proposal_status_tool.ts). Read-only
// resources.list() and tools.list() are exercised by
// context_projection_tool.test.ts against a fixed snapshot so a future PR
// cannot silently add a write/ingest/apply/publish/sampling/elicitation
// capability without that test visibly changing (Maintainer代理裁可
// allowlist condition). Both registered tools are read-only.

export function registerContextProjectionTool(server: McpServer, documentClientConfig: DocumentClientConfig): void {
  server.registerTool(
    "get_context_projection",
    {
      title: "Get context projection",
      // safeMode withholds card text only. Island titles (islands[].title) and the
      // document title (documentMetadata.title) are returned regardless of safeMode.
      // The description string below says "only structure and counts", which does
      // not hold for those title fields.
      description:
        "Read-only, constraint-scoped, SafeMode-respecting projection of a sui-sensemaking document " +
        "(ADR-0054 stage 1). The output never includes a score, rank, confidence, or priority " +
        "value of any kind. When safeMode is true (the default), no card text is exposed -- only " +
        "structure and counts. " +
        "Unreviewed cards are never exposed on ANY constraint (even safeMode=false reports " +
        "cards=0 for them, SEC-CONTEXT-PROJECTION-01 fail-closed): use this tool for reviewing " +
        "and structuring already-reviewed content, not for initial exploration of unreviewed " +
        "material (DOGFOOD-05).",
      inputSchema: {
        docId: z.string().min(1).describe("Target Document id."),
        constraint: z
          .enum(CONTEXT_PROJECTION_CONSTRAINTS)
          .describe("One of: reviewed-only, evidence, contradiction, summary."),
        safeMode: z
          .boolean()
          .default(true)
          .describe("Withholds card text when true. Defaults to true (the safe default) when omitted."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ docId, constraint, safeMode }) => {
      const queryCanonicalHash = await computeQueryCanonicalHash({ docId, constraint, safeMode });

      try {
        const doc = await fetchDocument(documentClientConfig, docId);
        const projection = await buildContextProjection({ doc, constraint, safeMode });
        // 第2反復: expose the document's lifecycle metadata (created_by /
        // lifecycle_state) so a generative-AI can verify the lifecycle features.
        // Advisory — null when the list endpoint is unavailable or the doc is
        // absent from it; the projection itself remains the authority.
        const documentMetadata = await fetchDocumentMetadata(documentClientConfig, docId);
        const payload = { ...projection, documentMetadata };

        logAuditEntry({
          schemaVersion: "mcp-context-read.v1",
          occurredAt: new Date().toISOString(),
          docId,
          constraint,
          safeMode,
          queryCanonicalHash,
          bundleHash: projection.bundleHash,
          outcome: "ok",
        });

        // EXT-CONN-01 channel wiring: make this MCP-originated read visible in
        // the backend's CE-4 audit trail (channel="mcp"). Best-effort -- the
        // local entry above is the read's correlation; never fail a successful
        // read over the additional sink.
        await emitContextAuditEvent(documentClientConfig, {
          docId,
          safeMode,
          queryCanonicalHash,
          bundleHash: projection.bundleHash,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        };
      } catch (error) {
        logAuditEntry({
          schemaVersion: "mcp-context-read.v1",
          occurredAt: new Date().toISOString(),
          docId,
          constraint,
          safeMode,
          queryCanonicalHash,
          bundleHash: null,
          outcome: error instanceof DocumentNotFoundError ? "not_found" : "error",
        });

        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    },
  );
}

import { useMemo, useState, type FormEvent } from "react";

import { EpistemicHealthAlert } from "../ui/EpistemicHealthAlert";
import { EpistemicReviewStatus } from "../ui/EpistemicReviewStatus";
import {
  buildEpistemicUiItems,
  type EpistemicProjectionInput,
  type EpistemicUiItem,
} from "../ui/epistemic_review_model";
import {
  EpistemicAdminApiError,
  getEpistemicProjectionArtifact,
  type ControlPlaneCredential,
} from "./epistemic_admin_api";

function formatError(error: unknown): string {
  if (error instanceof EpistemicAdminApiError) {
    const code = error.code ? ` (${error.code})` : "";
    return `${error.message}${code}`;
  }
  return error instanceof Error ? error.message : "Epistemic artifact の読み込みに失敗しました。";
}

export function EpistemicAdminConsole() {
  const [artifactKind, setArtifactKind] = useState("epistemic-assessment");
  const [adminApiKey, setAdminApiKey] = useState("");
  const [projection, setProjection] = useState<EpistemicProjectionInput | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const credential = useMemo<ControlPlaneCredential>(
    () => ({ adminApiKey: adminApiKey.trim() || undefined }),
    [adminApiKey],
  );

  const items = useMemo<EpistemicUiItem[]>(
    () => (projection ? buildEpistemicUiItems(projection) : []),
    [projection],
  );

  async function loadArtifact(event?: FormEvent) {
    event?.preventDefault();
    const requestedKind = artifactKind.trim();
    if (!requestedKind) {
      setError("artifact kind を入力してください。");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const parsed = await getEpistemicProjectionArtifact(requestedKind, credential);
      setProjection(parsed);
      setStatus(`${requestedKind} を読み込みました。`);
    } catch (loadError) {
      setProjection(null);
      setError(formatError(loadError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: "grid", gap: "1rem", padding: "1rem" }}>
      <h2 style={{ margin: 0 }}>TEI epistemic projection（operator view）</h2>
      <p style={{ margin: 0, color: "#475569" }}>
        ADR-0101 Option A / ADR-0102 案B の局所 I/O artifact を読み取り、候補を表示します。
        未設定・fail closed の場合はエラーを表示し、内容は出しません。
      </p>
      <form onSubmit={loadArtifact} style={{ display: "grid", gap: "0.5rem", maxWidth: "32rem" }}>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          <span>artifact kind</span>
          <input
            value={artifactKind}
            onChange={(event) => setArtifactKind(event.target.value)}
            placeholder="epistemic-assessment"
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          <span>admin API key（任意、未設定時は open な local-dev のみ）</span>
          <input
            type="password"
            value={adminApiKey}
            onChange={(event) => setAdminApiKey(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "読み込み中…" : "読み込む"}
        </button>
      </form>
      {status ? <p style={{ color: "#166534", margin: 0 }}>{status}</p> : null}
      {error ? <p style={{ color: "#991b1b", margin: 0 }}>{error}</p> : null}
      {projection ? <EpistemicHealthAlert projection={projection} /> : null}
      {items.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
          {items.map((item) => (
            <li key={item.assertionId}>
              <EpistemicReviewStatus item={item} onAction={() => {}} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { t } from "../i18n/translate";
import { readLocalRawFilePreview, type LocalRawFilePreview } from "./local_raw_file_preview_reference";
import {
  captureRawContentCheckpoint,
  resolveSingleDomTextNodeSelection,
  type RawByteSpan,
} from "./raw_utf8_selection_reference";

/**
 * R2 F1.5: in-memory, explicitly selected local text preview only.
 * Never writes DocumentV1, does not navigate to a persisted Source, and does
 * not send bytes to a server / an AI consumer. Unmount clears all local state.
 */
export function LocalRawPreviewPanel() {
  const [preview, setPreview] = useState<LocalRawFilePreview | null>(null);
  const [span, setSpan] = useState<RawByteSpan | null>(null);
  const [error, setError] = useState<"file" | "selection" | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rawRef = useRef<HTMLPreElement>(null);

  useEffect(() => () => { requestId.current += 1; }, []);

  // A confirmed byte span belongs to the selection at confirmation time,
  // not to a later focus/selection elsewhere in the workspace. This preview
  // has no Pin or persistent Source identity; never display a stale span as
  // though it still described the current user's DOM selection.
  useEffect(() => {
    if (!span || !preview) return;
    const invalidateOnSelectionChange = () => {
      const root = rawRef.current;
      if (!root) {
        setSpan(null);
        return;
      }
      try {
        const current = resolveSingleDomTextNodeSelection(
          preview.projection, root, window.getSelection(),
        );
        if (current.startByte !== span.startByte || current.endByte !== span.endByte) {
          setSpan(null);
        }
      } catch {
        setSpan(null);
      }
    };
    document.addEventListener("selectionchange", invalidateOnSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", invalidateOnSelectionChange);
    };
  }, [preview, span]);

  const clear = () => {
    requestId.current += 1;
    setPreview(null);
    setSpan(null);
    setError(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    // Selection is window-global. Clearing this optional preview must not
    // collapse a user's selection in another Card, Editor or workspace pane.
    const sourceTextNode = rawRef.current?.firstChild;
    const currentSelection = window.getSelection();
    if (sourceTextNode && currentSelection?.rangeCount === 1) {
      const range = currentSelection.getRangeAt(0);
      if (range.startContainer === sourceTextNode &&
          range.endContainer === sourceTextNode) {
        currentSelection.removeAllRanges();
      }
    }
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const id = ++requestId.current;
    const file = event.currentTarget.files?.item(0) ?? null;
    setPreview(null);
    setSpan(null);
    setError(null);
    setBusy(file !== null);
    if (file === null) return;
    try {
      const loaded = await readLocalRawFilePreview(file);
      if (requestId.current !== id) return;
      setPreview(loaded);
    } catch {
      if (requestId.current !== id) return;
      setError("file");
    } finally {
      if (requestId.current === id) setBusy(false);
    }
  };

  const checkSelection = async () => {
    const root = rawRef.current;
    if (!root || !preview || busy) return;
    const id = ++requestId.current;
    setError(null);
    setSpan(null);
    setBusy(true);
    try {
      const selected = resolveSingleDomTextNodeSelection(
        preview.projection, root, window.getSelection(),
      );
      // Compute the same in-memory byte checkpoint; do not persist/egress.
      await captureRawContentCheckpoint(preview.rawBytes, selected);
      if (requestId.current !== id) return;
      // The user may have changed the selection during async WebCrypto. The
      // hash still describes its original snapshot, not the current focus.
      const current = resolveSingleDomTextNodeSelection(
        preview.projection, root, window.getSelection(),
      );
      if (current.startByte !== selected.startByte || current.endByte !== selected.endByte) {
        throw new Error("selection-changed-during-checkpoint");
      }
      setSpan(selected);
    } catch {
      if (requestId.current === id) setError("selection");
    } finally {
      if (requestId.current === id) setBusy(false);
    }
  };

  return (
    <section data-testid="raw-local-preview" style={{ display: "grid", gap: 8, fontSize: 12 }}>
      <p style={{ margin: 0, color: "#475569" }}>{t("raw_preview.hint")}</p>
      <label style={{ display: "grid", gap: 4, fontWeight: 600 }}>
        {t("raw_preview.file_label")}
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          data-testid="raw-local-file-input"
          onChange={(event) => { void onFileChange(event); }}
        />
      </label>
      {error === "file" ? <p role="alert">{t("raw_preview.invalid_file")}</p> : null}
      {preview ? (
        <>
          <p data-testid="raw-local-unqualified" style={{ margin: 0, color: "#92400e" }}>
            {t("raw_preview.unqualified")}
          </p>
          <pre
            ref={rawRef}
            data-testid="raw-local-source-text"
            aria-label={t("raw_preview.source_text")}
            tabIndex={0}
            style={{
              margin: 0, maxHeight: 240, overflow: "auto",
              whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "text",
              border: "1px solid #cbd5e1", borderRadius: 6, padding: 8,
              fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
            }}
          >{preview.projection.text}</pre>
          <button type="button" data-testid="raw-local-confirm-selection"
            disabled={busy} onClick={() => { void checkSelection(); }}>
            {t("raw_preview.check_selection")}
          </button>
          {error === "selection" ? <p role="alert">{t("raw_preview.invalid_selection")}</p> : null}
          {span ? (
            <output data-testid="raw-local-span" style={{ overflowWrap: "anywhere" }}>
              {t("raw_preview.span", { start: span.startByte, end: span.endByte })}
            </output>
          ) : null}
        </>
      ) : null}
      <button type="button" onClick={clear} data-testid="raw-local-clear">
        {t("raw_preview.clear")}
      </button>
    </section>
  );
}


/**
 * Collapsing the disclosure unmounts the preview (and discards its File data).
 * The enclosing StartPanel also unmounts it when the Start panel closes.
 */
export function LocalRawPreviewDisclosure() {
  const [open, setOpen] = useState(false);
  return (
    <details
      data-testid="raw-local-preview-disclosure"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      style={{
        display: "grid", gap: 8, borderTop: "1px solid #e2e8f0",
        paddingTop: 10, minWidth: 0,
      }}
    >
      <summary style={{ fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#334155" }}>
        {t("raw_preview.title")}
      </summary>
      {open ? <LocalRawPreviewPanel /> : null}
    </details>
  );
}

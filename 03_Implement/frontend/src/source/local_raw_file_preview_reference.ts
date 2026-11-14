import {
  projectRawUtf8Bytes,
  type RawTextProjection,
} from "./raw_utf8_selection_reference";

/**
 * A user-selected local File is NOT a durable Source locator, Root/Scope/Grant,
 * revision, or authority to re-open the same file in another process.
 * This is only an in-memory R2 Reader preview, never a production Raw API.
 */
export const MAX_LOCAL_RAW_PREVIEW_BYTES = 1024 * 1024;

export type LocalRawFilePreview = {
  readonly qualification: "unqualified-local-file-preview";
  readonly rawBytes: Uint8Array;
  readonly projection: RawTextProjection;
};

/**
 * Read bytes from a File obtained through an explicit file-input selection.
 * Do not infer provenance from name, lastModified, MIME, or identical bytes.
 * No endpoint, persistence, export, or Card binding is invoked here.
 */
export async function readLocalRawFilePreview(
  selectedFile: File | null,
): Promise<LocalRawFilePreview> {
  if (!selectedFile || !(selectedFile instanceof File) ||
      !Number.isSafeInteger(selectedFile.size) ||
      selectedFile.size < 1 ||
      selectedFile.size > MAX_LOCAL_RAW_PREVIEW_BYTES) {
    throw new Error("unqualified-local-file");
  }

  const buffer = await selectedFile.arrayBuffer();
  if (buffer.byteLength !== selectedFile.size ||
      buffer.byteLength > MAX_LOCAL_RAW_PREVIEW_BYTES) {
    throw new Error("unqualified-local-file");
  }

  const rawBytes = new Uint8Array(buffer);
  const projection = projectRawUtf8Bytes(rawBytes); // fatal UTF-8; original BOM/EOL.
  return {
    qualification: "unqualified-local-file-preview",
    rawBytes,
    projection,
  };
}

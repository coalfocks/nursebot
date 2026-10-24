export type RoomPdfObjectMetadata = {
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
  last_accessed_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type RoomPdfExportEntry = {
  object_name: string;
  sha256: string;
  byte_size: number;
  object_created_at: string | null;
  object_updated_at: string | null;
  object_last_accessed_at: string | null;
  content_type: string;
  bytes_base64: string;
};

const MAX_OBJECTS = 13;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

/**
 * Candidate paths are deployment-owned configuration, never request input.
 * An absent or malformed allowlist fails closed; the UI cannot turn this into
 * an arbitrary Storage browser.
 */
export const configuredRoomPdfCandidates = (raw = '') => {
  let values: unknown;
  try { values = JSON.parse(raw); } catch { throw new Error('ROOM_PDF_EXPORT_NOT_CONFIGURED'); }
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_OBJECTS) throw new Error('ROOM_PDF_EXPORT_NOT_CONFIGURED');
  const paths = values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim());
  if (paths.length !== values.length || new Set(paths).size !== paths.length || paths.some((path) => path.startsWith('/') || path.includes('..') || !path.toLowerCase().endsWith('.pdf'))) throw new Error('ROOM_PDF_EXPORT_NOT_CONFIGURED');
  return paths;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  return btoa(binary);
};

export const hashBytes = async (bytes: Uint8Array) => {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const buildRoomPdfManifest = (entries: RoomPdfExportEntry[]) => ({
  bundle_type: 'private_read_only_room_pdf_review',
  review_status: 'unverified_candidates_only',
  raw_documents_included: true,
  signed_urls_included: false,
  object_count: entries.length,
  total_byte_size: entries.reduce((sum, entry) => sum + entry.byte_size, 0),
  files: entries.map(({ bytes_base64: _bytes, ...entry }) => entry),
});

export const exportAllowlistedRoomPdfs = async (
  storage: { download: (path: string) => Promise<{ data: Blob | null; error: { message?: string } | null }> },
  metadataByName: Map<string, RoomPdfObjectMetadata>,
  candidates: string[],
) => {
  if (candidates.length === 0 || candidates.length > MAX_OBJECTS) throw new Error('ROOM_PDF_EXPORT_NOT_CONFIGURED');
  const entries: RoomPdfExportEntry[] = [];
  let totalBytes = 0;
  for (const objectName of candidates) {
    const metadata = metadataByName.get(objectName);
    if (!metadata) throw new Error(`ROOM_PDF_CANDIDATE_NOT_FOUND:${objectName}`);
    const result = await storage.download(objectName);
    if (result.error || !result.data) throw new Error(`ROOM_PDF_READ_FAILED:${objectName}:${result.error?.message ?? 'empty object'}`);
    const bytes = new Uint8Array(await result.data.arrayBuffer());
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('ROOM_PDF_EXPORT_TOO_LARGE');
    entries.push({
      object_name: objectName,
      sha256: await hashBytes(bytes),
      byte_size: bytes.byteLength,
      object_created_at: metadata.created_at ?? null,
      object_updated_at: metadata.updated_at ?? null,
      object_last_accessed_at: metadata.last_accessed_at ?? null,
      content_type: typeof metadata.metadata?.mimetype === 'string' ? metadata.metadata.mimetype : 'application/pdf',
      bytes_base64: bytesToBase64(bytes),
    });
  }
  return { manifest: buildRoomPdfManifest(entries), files: entries };
};

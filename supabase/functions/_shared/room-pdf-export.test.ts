import { describe, expect, it } from 'vitest';
import { buildRoomPdfManifest, configuredRoomPdfCandidates, exportAllowlistedRoomPdfs } from './room-pdf-export';

describe('room PDF export contract', () => {
  it('fails closed unless deployment-owned candidates are configured', () => {
    expect(() => configuredRoomPdfCandidates('')).toThrow('ROOM_PDF_EXPORT_NOT_CONFIGURED');
    expect(() => configuredRoomPdfCandidates(JSON.stringify(['/outside.pdf']))).toThrow('ROOM_PDF_EXPORT_NOT_CONFIGURED');
    expect(configuredRoomPdfCandidates(JSON.stringify(['1742-candidate.pdf']))).toEqual(['1742-candidate.pdf']);
  });

  it('exports only allowlisted bytes with hashes and storage timestamps', async () => {
    const bytes = new TextEncoder().encode('%PDF-candidate');
    const calls: string[] = [];
    const result = await exportAllowlistedRoomPdfs({ download: async (path) => { calls.push(path); return { data: new Blob([bytes], { type: 'application/pdf' }), error: null }; } }, new Map([
      ['candidate.pdf', { name: 'candidate.pdf', created_at: '2025-03-20T00:00:00Z', updated_at: '2025-08-29T00:00:00Z', metadata: { mimetype: 'application/pdf' } }],
    ]), ['candidate.pdf']);
    expect(calls).toEqual(['candidate.pdf']);
    expect(result.manifest.files[0]).toMatchObject({ object_name: 'candidate.pdf', byte_size: bytes.byteLength, object_created_at: '2025-03-20T00:00:00Z', sha256: 'ea9f1c7917cd49c80ac0667d9b12b23912b5b628cba04a90d579a08b187028d6' });
    expect(result.manifest.files[0]).not.toHaveProperty('bytes_base64');
    expect(result.files[0].bytes_base64).toBe(btoa(String.fromCharCode(...bytes)));
    expect(buildRoomPdfManifest(result.files).total_byte_size).toBe(bytes.byteLength);
  });

  it('rejects candidates absent from the deployment-owned inventory', async () => {
    await expect(exportAllowlistedRoomPdfs({ download: async () => ({ data: null, error: null }) }, new Map(), ['not-allowlisted.pdf'])).rejects.toThrow('ROOM_PDF_CANDIDATE_NOT_FOUND');
  });
});

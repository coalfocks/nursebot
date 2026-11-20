import { describe, expect, it, vi } from 'vitest';
import { saveRoomNursePrompt } from './roomNursePromptSave';

function makeClient(row: unknown, error: { message: string } | null = null) {
  const calls = { update: [] as unknown[], eq: [] as unknown[][], is: [] as unknown[][], select: [] as unknown[] };
  const chain: Record<string, unknown> = {};
  chain.update = vi.fn((p: unknown) => { calls.update.push(p); return chain; });
  chain.eq = vi.fn((c: string, v: unknown) => { calls.eq.push([c, v]); return chain; });
  chain.is = vi.fn((c: string, v: unknown) => { calls.is.push([c, v]); return chain; });
  chain.select = vi.fn((c: unknown) => { calls.select.push(c); return chain; });
  chain.maybeSingle = vi.fn(async () => ({ data: row, error }));
  const from = vi.fn(() => chain);
  return { client: { from } as never, calls, from };
}

const base = {
  roomId: 204,
  roomSchoolId: 'school-1',
  actorSchoolId: 'school-1',
  isSuperAdmin: false,
  loadedUpdatedAt: '2026-11-01T00:00:00Z',
  value: 'edited nurse text',
};

describe('saveRoomNursePrompt', () => {
  it('sends a field-only payload scoped by id, school and updated_at', async () => {
    const { client, calls } = makeClient({ nurse_context: 'edited nurse text', updated_at: '2026-11-20T00:00:00Z' });
    const result = await saveRoomNursePrompt(client, base);
    expect(calls.update).toEqual([{ nurse_context: 'edited nurse text' }]);
    expect(Object.keys(calls.update[0] as object)).toEqual(['nurse_context']);
    expect(calls.eq).toEqual([['id', 204], ['school_id', 'school-1'], ['updated_at', '2026-11-01T00:00:00Z']]);
    expect(result).toEqual({ ok: true, nurseContext: 'edited nurse text', updatedAt: '2026-11-20T00:00:00Z' });
  });

  it('other fields are preserved: payload never includes any other column (incl. context mirror and pinned data)', async () => {
    const { client, calls } = makeClient({ nurse_context: 'x', updated_at: 't' });
    await saveRoomNursePrompt(client, base);
    const payload = calls.update[0] as Record<string, unknown>;
    for (const col of ['context', 'emr_context', 'style', 'objective', 'hospital_timeline', 'patient_conversation_prompt', 'scenario_baseline', 'school_id']) {
      expect(payload).not.toHaveProperty(col);
    }
  });

  it('reports a conflict when no row matches (changed since load) and writes nothing else', async () => {
    const { client, from } = makeClient(null);
    const result = await saveRoomNursePrompt(client, base);
    expect(result).toMatchObject({ ok: false, reason: 'conflict' });
    expect((result as { message: string }).message).toMatch(/conflict/i);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('rooms');
  });

  it('rejects school mismatch before any DB call', async () => {
    const { client, from } = makeClient({});
    const result = await saveRoomNursePrompt(client, { ...base, actorSchoolId: 'school-2' });
    expect(result).toMatchObject({ ok: false, reason: 'school_mismatch' });
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects super-admin active-school mismatch and missing room school', async () => {
    const a = makeClient({});
    expect(await saveRoomNursePrompt(a.client, { ...base, isSuperAdmin: true, actorSchoolId: 'school-2' })).toMatchObject({ reason: 'school_mismatch' });
    expect(await saveRoomNursePrompt(a.client, { ...base, roomSchoolId: null })).toMatchObject({ reason: 'validation' });
    expect(a.from).not.toHaveBeenCalled();
  });

  it('uses IS NULL when the room had no updated_at at load', async () => {
    const { client, calls } = makeClient({ nurse_context: 'v', updated_at: 't' });
    await saveRoomNursePrompt(client, { ...base, loadedUpdatedAt: null });
    expect(calls.is).toEqual([['updated_at', null]]);
  });

  it('rejects empty value and surfaces db errors (e.g. RLS)', async () => {
    const e = makeClient({});
    expect(await saveRoomNursePrompt(e.client, { ...base, value: '  ' })).toMatchObject({ reason: 'validation' });
    expect(e.from).not.toHaveBeenCalled();
    const d = makeClient(null, { message: 'permission denied' });
    expect(await saveRoomNursePrompt(d.client, base)).toEqual({ ok: false, reason: 'error', message: 'permission denied' });
  });
});

describe('saveRoomNursePrompt school scope: every write needs an explicit selected school equal to the room school', () => {
  it('null-scope regression: a super admin with no selected school ("All schools") cannot write', async () => {
    for (const actorSchoolId of [null, undefined, '']) {
      const { client, from } = makeClient({ nurse_context: 'x', updated_at: 't' });
      const result = await saveRoomNursePrompt(client, { ...base, isSuperAdmin: true, actorSchoolId });
      expect(result).toMatchObject({ ok: false, reason: 'scope_required' });
      expect((result as { message: string }).message).toMatch(/All schools/);
      expect(from).not.toHaveBeenCalled();
    }
  });

  it('a non-super-admin with no school scope cannot write either', async () => {
    const { client, from } = makeClient({});
    expect(await saveRoomNursePrompt(client, { ...base, isSuperAdmin: false, actorSchoolId: null })).toMatchObject({ ok: false, reason: 'scope_required' });
    expect(from).not.toHaveBeenCalled();
  });

  it('a super admin writes only when the selected school equals the room school', async () => {
    const ok = makeClient({ nurse_context: 'edited nurse text', updated_at: 't2' });
    expect(await saveRoomNursePrompt(ok.client, { ...base, isSuperAdmin: true, actorSchoolId: 'school-1' })).toMatchObject({ ok: true });
    expect(ok.calls.eq).toContainEqual(['school_id', 'school-1']);
    const bad = makeClient({});
    expect(await saveRoomNursePrompt(bad.client, { ...base, isSuperAdmin: true, actorSchoolId: 'school-2' })).toMatchObject({ ok: false, reason: 'school_mismatch' });
    expect(bad.from).not.toHaveBeenCalled();
  });

  it('shared visibility grants no write: a room primary to school-1 (e.g. shared room 202) cannot be written while another school is selected', async () => {
    const { client, from } = makeClient({});
    // Room 202 is primary to Creighton University SOM and shared with all schools; the writer is scoped to a different school.
    const result = await saveRoomNursePrompt(client, { ...base, roomId: 202, roomSchoolId: 'creighton-som', actorSchoolId: 'school-2', isSuperAdmin: false });
    expect(result).toMatchObject({ ok: false, reason: 'school_mismatch' });
    expect(from).not.toHaveBeenCalled();
  });
});

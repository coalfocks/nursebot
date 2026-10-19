import { describe, expect, it } from 'vitest';
import {
  canonicalConsultantService,
  consultantEpisodeKey,
  consultantPayloadMatches,
  decideConsultantRequestReplay,
  hashConsultantPayload,
  validateConsultantTransportInput,
} from './consultant-transport';

const valid = { assignmentId: 'assignment-a', audience: 'adult' as const, specialty: 'Medicine', message: 'Please review the new finding.', clientRequestId: 'request-a' };

describe('consultant transport API contract', () => {
  it('rejects unknown audience and audience-incompatible service before a write can be planned', () => {
    expect(validateConsultantTransportInput({ ...valid, audience: 'neonatal' })).toEqual({ ok: false, error: 'Consultant audience must be adult or pediatric' });
    expect(validateConsultantTransportInput({ ...valid, audience: 'pediatric', specialty: 'Medicine' })).toEqual({ ok: false, error: 'Consultant service is not available in the selected audience directory' });
    expect(canonicalConsultantService('pediatric', 'Medicine')).toBeNull();
  });

  it('replays an exact same-ID retry but rejects an edited same-ID retry', async () => {
    const first = validateConsultantTransportInput({ ...valid, clientRequestId: 'request-a' });
    const second = validateConsultantTransportInput({ ...valid, clientRequestId: 'request-a' });
    if (!first.ok || !second.ok) throw new Error('test payload did not validate');
    expect(first.payload).toEqual(second.payload);
    expect(consultantPayloadMatches(first.payload, second.payload)).toBe(true);
    expect(consultantPayloadMatches(first.payload, { ...second.payload, message: 'edited message' })).toBe(false);
    expect(decideConsultantRequestReplay('request-a', first.payload, 'request-a', second.payload)).toBe('replay');
    expect(decideConsultantRequestReplay('request-a', first.payload, 'request-a', { ...second.payload, message: 'edited message' })).toBe('conflict');
    expect(decideConsultantRequestReplay('request-a', first.payload, 'request-b', second.payload)).toBe('new');
    expect(await hashConsultantPayload(first.payload)).toBe(await hashConsultantPayload(second.payload));
  });

  it('keeps follow-ups on one authenticated assignment/audience/service episode key', () => {
    expect(consultantEpisodeKey(valid)).toBe(consultantEpisodeKey({ ...valid, message: 'follow-up' }));
    expect(consultantEpisodeKey(valid)).not.toBe(consultantEpisodeKey({ ...valid, audience: 'pediatric' }));
  });
});

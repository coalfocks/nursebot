import { describe, expect, it } from 'vitest';
import { resolveFeedbackProcessorConfig } from './feedbackProcessorConfig';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('resolveFeedbackProcessorConfig', () => {
  it('is disabled by default with no environment flag', () => {
    expect(resolveFeedbackProcessorConfig({})).toEqual({ enabled: false, assignmentIds: null });
  });

  it('requires the exact opt-in value "true"', () => {
    expect(resolveFeedbackProcessorConfig({ VITE_FEEDBACK_PROCESSOR_ENABLED: 'false' }).enabled).toBe(false);
    expect(resolveFeedbackProcessorConfig({ VITE_FEEDBACK_PROCESSOR_ENABLED: '1' }).enabled).toBe(false);
    expect(resolveFeedbackProcessorConfig({ VITE_FEEDBACK_PROCESSOR_ENABLED: 'yes' }).enabled).toBe(false);
    expect(resolveFeedbackProcessorConfig({ VITE_FEEDBACK_PROCESSOR_ENABLED: true }).enabled).toBe(false);
    expect(resolveFeedbackProcessorConfig({ VITE_FEEDBACK_PROCESSOR_ENABLED: ' true ' }).enabled).toBe(true);
  });

  it('parses an assignment allowlist, dropping malformed and duplicate IDs', () => {
    const config = resolveFeedbackProcessorConfig({
      VITE_FEEDBACK_PROCESSOR_ENABLED: 'true',
      VITE_FEEDBACK_PROCESSOR_ASSIGNMENT_IDS: ` ${A} , ${B},${A}, not-a-uuid, "),or(x`,
    });
    expect(config).toEqual({ enabled: true, assignmentIds: [A, B] });
  });

  it('treats a configured but empty allowlist as process-nothing, not unrestricted', () => {
    expect(resolveFeedbackProcessorConfig({ VITE_FEEDBACK_PROCESSOR_ENABLED: 'true', VITE_FEEDBACK_PROCESSOR_ASSIGNMENT_IDS: '' })).toEqual({ enabled: true, assignmentIds: [] });
  });
});

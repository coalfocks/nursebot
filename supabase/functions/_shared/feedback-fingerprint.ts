// Deterministic fingerprint of everything that can change a saved score:
// the frozen scoring-window evidence, source coverage, case key, rubric and
// assessment versions, model, and prompt/config versions. Identical inputs
// produce the same fingerprint, so a successful saved result can be reused.

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
};

export const canonicalJson = (value: unknown): string => JSON.stringify(sortKeys(value));

export const sha256Hex = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export type FeedbackFingerprintInput = {
  attempt_id: string;
  scoring_start_at: string | null;
  evidence: Array<Record<string, unknown>>;
  unordered_event_ids: string[];
  coverage: Record<string, string>;
  progress_note: string | null;
  case_key: unknown;
  rubric_version: string;
  assessment_version: string;
  model: string;
  prompt_versions: Record<string, string>;
  config: Record<string, unknown>;
};

export const computeFeedbackFingerprint = (input: FeedbackFingerprintInput): Promise<string> =>
  sha256Hex(canonicalJson(input));

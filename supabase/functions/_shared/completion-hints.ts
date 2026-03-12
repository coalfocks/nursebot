export type CompletionHintKey = 'assessmentHint' | 'diagnosisDifferentiatorHint' | 'planHint';

export type CompletionHints = {
  assessmentHint: string;
  diagnosisDifferentiatorHint: string;
  planHint: string;
};

export type CompletionHintViews = Partial<
  Record<
    CompletionHintKey,
    {
      viewedAt: string;
    }
  >
>;

const EMPTY_COMPLETION_HINTS: CompletionHints = {
  assessmentHint: '',
  diagnosisDifferentiatorHint: '',
  planHint: '',
};

const HINT_LABELS: Record<CompletionHintKey, string> = {
  assessmentHint: 'Assessment hint',
  diagnosisDifferentiatorHint: 'Clinical reasoning hint',
  planHint: 'Plan hint',
};

export const parseCompletionHints = (raw: string | null | undefined): CompletionHints => {
  if (!raw?.trim()) return { ...EMPTY_COMPLETION_HINTS };

  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as Partial<CompletionHints>;
    if (parsed && typeof parsed === 'object') {
      return {
        assessmentHint: String(parsed.assessmentHint ?? ''),
        diagnosisDifferentiatorHint: String(parsed.diagnosisDifferentiatorHint ?? ''),
        planHint: String(parsed.planHint ?? ''),
      };
    }
  } catch {
    // Continue to plain-text parsing.
  }

  const next = { ...EMPTY_COMPLETION_HINTS };
  trimmed.split('\n').forEach((line) => {
    const [label, ...rest] = line.split(':');
    if (!label || rest.length === 0) return;
    const value = rest.join(':').trim();
    const normalizedLabel = label.trim().toLowerCase();
    if (normalizedLabel.includes('assessment') || normalizedLabel.includes('attending')) {
      next.assessmentHint = value;
    } else if (normalizedLabel.includes('diagnosis')) {
      next.diagnosisDifferentiatorHint = value;
    } else if (normalizedLabel.includes('plan')) {
      next.planHint = value;
    }
  });

  if (next.assessmentHint || next.diagnosisDifferentiatorHint || next.planHint) {
    return next;
  }

  return { ...EMPTY_COMPLETION_HINTS, assessmentHint: trimmed };
};

export const parseCompletionHintViews = (raw: unknown): CompletionHintViews => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const next: CompletionHintViews = {};
  (Object.keys(HINT_LABELS) as CompletionHintKey[]).forEach((key) => {
    const viewedAt = (raw as Record<string, { viewedAt?: unknown }>)[key]?.viewedAt;
    if (typeof viewedAt === 'string' && viewedAt.trim()) {
      next[key] = { viewedAt };
    }
  });
  return next;
};

export const getCompletionHintLabel = (key: CompletionHintKey) => HINT_LABELS[key];

export const getViewedCompletionHints = (
  hints: CompletionHints,
  views: CompletionHintViews,
) =>
  (Object.keys(HINT_LABELS) as CompletionHintKey[])
    .filter((key) => hints[key].trim() && views[key]?.viewedAt)
    .map((key) => ({
      key,
      label: getCompletionHintLabel(key),
      content: hints[key].trim(),
      viewedAt: views[key]?.viewedAt ?? '',
    }));

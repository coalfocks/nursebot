// Diagnostic envelopes deliberately have no top-level evaluation/debrief: never reusable scores.
export const rejectedFeedbackDiagnostic = (candidate: unknown, errors: string[]) => {
  const texts: { location: string; type: string; text: string }[] = [];
  const visit = (value: unknown, location: string) => {
    if (typeof value === 'string') texts.push({ location, type: 'string', text: value });
    else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${location}[${index}]`));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => visit(item, `${location}.${key}`));
  };
  visit(candidate, 'candidate');
  return { status: 'rejected', errors, candidate, texts };
};

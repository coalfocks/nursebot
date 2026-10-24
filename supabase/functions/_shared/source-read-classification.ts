export type SourceReadFailureCategory = 'missing_table' | 'missing_column' | 'denied' | 'read_failed';

export type SourceReadFailure = {
  category: SourceReadFailureCategory;
  code: string;
  message: string;
};

export const classifySourceReadError = (error: { code?: string; message?: string } | null): SourceReadFailure => {
  const code = error?.code ?? 'UNKNOWN';
  const message = error?.message ?? 'unknown source read failure';
  if (code === '42P01' || /relation .* does not exist|table .* does not exist/i.test(message)) {
    return { category: 'missing_table', code, message };
  }
  if (code === '42703' || /column .* does not exist/i.test(message)) {
    return { category: 'missing_column', code, message };
  }
  if (code === '42501' || /permission denied|not authorized|forbidden/i.test(message)) {
    return { category: 'denied', code, message };
  }
  return { category: 'read_failed', code, message };
};

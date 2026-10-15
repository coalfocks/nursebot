import type { Json } from './database.types';

export const CASE_GENERATION_TIMEOUT_MS = 120_000;

export type GenerationStatus = 'not_generated' | 'generating' | 'generated' | 'failed';

export class CaseGenerationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Case package generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = 'CaseGenerationTimeoutError';
  }
}

export const invokeWithTimeout = async <T>(
  invoke: (signal: AbortSignal) => Promise<T>,
  timeoutMs = CASE_GENERATION_TIMEOUT_MS,
): Promise<T> => {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      invoke(controller.signal),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new CaseGenerationTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const getErrorText = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown generation error';

export const formatGenerationError = (section: string | undefined, error: unknown) => {
  const scope = section ? `${section} section` : 'case package';
  return `Unable to generate the ${scope}. Check the blueprint title, objectives, and admitting HPI, then try again. ${getErrorText(error)} Existing generated content was preserved.`;
};

type InvokeResult = { data: { package?: Json; generatedAt?: string } | null; error: unknown };

type RunGenerationOptions = {
  section?: string;
  timeoutMs?: number;
  invoke: (signal: AbortSignal) => Promise<InvokeResult>;
  persistStatus: (status: GenerationStatus, error: string | null) => Promise<void>;
  persistSuccess: (packageData: Json, generatedAt: string) => Promise<void>;
};

export const runCaseGeneration = async ({
  section,
  timeoutMs = CASE_GENERATION_TIMEOUT_MS,
  invoke,
  persistStatus,
  persistSuccess,
}: RunGenerationOptions) => {
  try {
    await persistStatus('generating', null);
    const { data, error } = await invokeWithTimeout(invoke, timeoutMs);
    if (error) throw error;
    if (!data?.package) throw new Error('The generation function returned no package.');

    await persistSuccess(data.package, data.generatedAt ?? new Date().toISOString());
  } catch (error) {
    const message = formatGenerationError(section, error);
    try {
      await persistStatus('failed', message);
    } catch (persistError) {
      console.error('Failed to persist case generation failure', persistError);
    }
    throw new Error(message, { cause: error });
  }
};

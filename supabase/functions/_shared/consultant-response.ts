export type ConsultantCompletionLike = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null } | null;
  }>;
};

export type ParsedConsultantResponse = {
  answer: string;
  disposition: 'routine_review' | 'assumes_care';
  finishReason: string | null;
  outputLength: number;
};

export class ConsultantModelOutputError extends Error {
  readonly code = 'CONSULTANT_MODEL_OUTPUT_INVALID';
  readonly finishReason: string | null;
  readonly outputLength: number;

  constructor(message: string, finishReason: string | null, outputLength: number) {
    super(message);
    this.name = 'ConsultantModelOutputError';
    this.finishReason = finishReason;
    this.outputLength = outputLength;
  }
}

/** Parse only an authored model response; never synthesize a clinical answer. */
export const parseConsultantCompletion = (completion: ConsultantCompletionLike): ParsedConsultantResponse => {
  const choice = completion.choices?.[0];
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
  const raw = typeof choice?.message?.content === 'string' ? choice.message.content : '';
  const outputLength = raw.length;
  if (!raw.trim()) throw new ConsultantModelOutputError('Consultant model returned no JSON content', finishReason, outputLength);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConsultantModelOutputError('Consultant model returned invalid JSON', finishReason, outputLength);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ConsultantModelOutputError('Consultant model JSON was not an object', finishReason, outputLength);
  const answer = typeof (parsed as { message?: unknown }).message === 'string' ? (parsed as { message: string }).message.trim() : '';
  if (!answer) throw new ConsultantModelOutputError('Consultant model JSON did not contain a message', finishReason, outputLength);
  const disposition = (parsed as { disposition?: unknown }).disposition === 'assumes_care' ? 'assumes_care' : 'routine_review';
  return { answer, disposition, finishReason, outputLength };
};

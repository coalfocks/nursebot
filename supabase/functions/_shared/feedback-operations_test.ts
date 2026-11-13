import {
  COMMENTARY_MAX_COMPLETION_TOKENS,
  EVALUATION_MAX_COMPLETION_TOKENS,
  runIndependentFeedbackOperations,
} from './feedback-operations.ts';

Deno.test('uses bounded completion budgets for evaluation and short comments', () => {
  if (EVALUATION_MAX_COMPLETION_TOKENS !== 1800) {
    throw new Error(`Unexpected evaluation completion budget: ${EVALUATION_MAX_COMPLETION_TOKENS}`);
  }
  if (COMMENTARY_MAX_COMPLETION_TOKENS !== 900) {
    throw new Error(`Unexpected commentary completion budget: ${COMMENTARY_MAX_COMPLETION_TOKENS}`);
  }
});

Deno.test('starts evaluation and commentary before either operation completes', async () => {
  const started: string[] = [];
  let finishEvaluation!: (value: string) => void;
  let finishCommentary!: (value: string) => void;
  const requestEvaluation = () => {
    started.push('evaluation');
    return new Promise<string>((resolve) => { finishEvaluation = resolve; });
  };
  const requestCommentary = () => {
    started.push('commentary');
    return new Promise<string>((resolve) => { finishCommentary = resolve; });
  };

  const result = runIndependentFeedbackOperations(requestEvaluation, requestCommentary);

  if (started.join(',') !== 'evaluation,commentary') {
    throw new Error(`Expected both operations to start, got: ${started.join(',')}`);
  }

  finishEvaluation('scored');
  finishCommentary('commented');
  const completed = await result;
  if (completed[0] !== 'scored' || completed[1] !== 'commented') {
    throw new Error(`Unexpected operation results: ${JSON.stringify(completed)}`);
  }
});

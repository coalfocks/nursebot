import { it, expect } from 'vitest';
import { requestCompletionWithLengthRetry } from './feedback-operations';
import { FeedbackDeadline } from './feedback-deadline';
const completion = (finish_reason: string, content = '') => ({ choices: [{ finish_reason, message: { content } }] });
it('retries explicit length once at double budget, preserving the same caller messages', async () => {
 const budgets: number[] = []; const messages = [{ role: 'user', content: 'unchanged' }]; const seen: unknown[] = [];
 const result = await requestCompletionWithLengthRetry(async budget => { budgets.push(budget); seen.push(messages); return budgets.length === 1 ? completion('length') : completion('stop', '{}'); }, 3000);
 expect(budgets).toEqual([3000, 6000]); expect(seen[0]).toBe(seen[1]); expect(result.choices[0].message.content).toBe('{}');
});
it('fails after second length response', async () => {
 let count = 0; await expect(requestCompletionWithLengthRetry(async () => { count++; return completion('length', '{'); }, 3000)).rejects.toThrow('finish_reason=length'); expect(count).toBe(2);
});
it.each(['stop','content_filter'])('does not retry %s even with empty/malformed content', async reason => {
 let count=0; await requestCompletionWithLengthRetry(async () => { count++; return completion(reason); },3000); expect(count).toBe(1);
});
it('does not retry transport errors', async () => {
 let count=0; await expect(requestCompletionWithLengthRetry(async () => { count++; throw new Error('HTTP 429'); },3000)).rejects.toThrow('HTTP 429'); expect(count).toBe(1);
});
it('shares deadline cancellation across retry without late work', async () => {
 const deadline = new FeedbackDeadline(15); let calls=0;
 await expect(deadline.run(() => requestCompletionWithLengthRetry(async () => {
  calls++; if(calls===1) return completion('length');
  await new Promise((_, reject) => deadline.signal.addEventListener('abort', () => reject(new Error('aborted')), {once:true}));
  return completion('stop');
 },3000))).rejects.toThrow(); expect(calls).toBe(2); expect(deadline.signal.aborted).toBe(true);
});

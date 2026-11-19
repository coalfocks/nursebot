import { describe, expect, it } from 'vitest';
import { readFunctionErrorMessage } from './feedbackService';

describe('readFunctionErrorMessage', () => {
  it('returns the server error from a non-2xx edge response body', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'Cannot generate feedback for incomplete assignment' }), { status: 500 }),
    });
    await expect(readFunctionErrorMessage(error)).resolves.toBe('Cannot generate feedback for incomplete assignment');
  });

  it('keeps the response body readable for later callers', async () => {
    const response = new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
    await readFunctionErrorMessage({ message: 'x', context: response });
    await expect(response.json()).resolves.toEqual({ error: 'boom' });
  });

  it('falls back to the client message when the body is not JSON', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response('<html>502</html>', { status: 502 }),
    });
    await expect(readFunctionErrorMessage(error)).resolves.toBe('Edge Function returned a non-2xx status code');
  });

  it('falls back to the client message for network-style errors without a response', async () => {
    await expect(readFunctionErrorMessage(new Error('Failed to fetch'))).resolves.toBe('Failed to fetch');
    await expect(readFunctionErrorMessage(undefined)).resolves.toBe('Failed to generate feedback');
  });
});

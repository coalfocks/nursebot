export class AsyncTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} did not finish within ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = 'AsyncTimeoutError';
  }
}

export async function withTimeout<T>(promise: PromiseLike<T>, label: string, timeoutMs = 20000): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new AsyncTimeoutError(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

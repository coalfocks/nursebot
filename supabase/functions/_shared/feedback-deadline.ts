type OperationTiming = { status: 'pending' | 'completed' | 'failed'; started_at_ms: number; elapsed_ms: number; error?: string };

/** A deadline must stop work, not merely stop awaiting its result. */
export class FeedbackDeadline {
  private readonly controller = new AbortController();
  private readonly startedAt = Date.now();
  private readonly operations: Record<string, OperationTiming> = {};
  private phase = 'load_assignment';
  private expired = false;
  private timeoutError?: Error;
  private timeoutState?: { deadline_ms: number; elapsed_ms: number; phase: string; operations: Record<string, OperationTiming> };

  constructor(private readonly budgetMs = 90000) {}

  get signal(): AbortSignal { return this.controller.signal; }
  get timedOut(): boolean { return this.expired; }

  snapshot() {
    if (this.timeoutState) return this.timeoutState;
    const now = Date.now();
    return {
      deadline_ms: this.budgetMs,
      elapsed_ms: now - this.startedAt,
      phase: this.phase,
      operations: Object.fromEntries(Object.entries(this.operations).map(([name, operation]) => [name, {
        ...operation,
        elapsed_ms: operation.status === 'pending' ? now - operation.started_at_ms : operation.elapsed_ms,
      }])),
    };
  }

  private expire(): Error {
    if (this.timeoutError) return this.timeoutError;
    this.expired = true;
    this.timeoutState = this.snapshot();
    const pending = Object.entries(this.operations).filter(([, operation]) => operation.status === 'pending').map(([name]) => name);
    const error = new Error(`Evaluation scoring timed out (deadline=${this.budgetMs}ms; phase=${this.phase}; pending=${pending.join(',') || 'none'})`);
    this.timeoutError = error;
    this.controller.abort(error);
    return error;
  }

  assertActive(): void {
    if (this.expired || Date.now() - this.startedAt >= this.budgetMs) throw this.expire();
    if (this.signal.aborted) throw this.signal.reason;
  }

  setPhase(phase: string): void { this.assertActive(); this.phase = phase; }

  async track<T>(name: string, work: () => Promise<T>): Promise<T> {
    this.assertActive();
    const operation: OperationTiming = { status: 'pending', started_at_ms: Date.now(), elapsed_ms: 0 };
    this.operations[name] = operation;
    try {
      const result = await work();
      this.assertActive();
      operation.status = 'completed';
      return result;
    } catch (error) {
      operation.status = 'failed';
      operation.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally { operation.elapsed_ms = Date.now() - operation.started_at_ms; }
  }

  /** Used by Supabase too: no late reads/writes may even be initiated. */
  fetch: typeof fetch = (input, init) => {
    this.assertActive();
    return fetch(input, { ...init, signal: this.signal });
  };

  async run<T>(work: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(work),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(this.expire()), Math.max(0, this.budgetMs - (Date.now() - this.startedAt)));
        }),
      ]);
    } catch (error) {
      this.controller.abort(error);
      throw error;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
}

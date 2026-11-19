// Dry-run replacement for `@supabase/supabase-js` used only by the dry-run harness.
// Reads come from a fixture captured read-only from prod. Writes are intercepted and
// recorded; this module has no transport, so nothing can reach the database.
// deno-lint-ignore-file no-explicit-any

type Ctx = {
  fixture: {
    assignment: Record<string, any>;
    manifest: Record<string, unknown>;
  };
  intercepted: Array<
    { table: string; op: string; payload: unknown; filters: unknown[] }
  >;
  rpcCalls: string[];
};

const ctx = (): Ctx => (globalThis as any).__altheaDryRun.supabase as Ctx;

class Builder implements PromiseLike<{ data: any; error: any }> {
  private op = "select";
  private payload: unknown = undefined;
  private filters: unknown[] = [];
  private wantSingle = false;

  constructor(private table: string) {}

  select(_columns?: string) {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  single() {
    this.wantSingle = true;
    return this;
  }
  maybeSingle() {
    this.wantSingle = true;
    return this;
  }
  insert(payload: unknown) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: unknown) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload: unknown) {
    this.op = "upsert";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  then<T1, T2>(
    onfulfilled?: (v: { data: any; error: any }) => T1 | PromiseLike<T1>,
    onrejected?: (e: any) => T2 | PromiseLike<T2>,
  ) {
    return this.exec().then(onfulfilled, onrejected);
  }

  private exec(): Promise<{ data: any; error: any }> {
    if (this.op !== "select") {
      // Intercept: record the would-be write and acknowledge it locally. Nothing is sent.
      ctx().intercepted.push({
        table: this.table,
        op: this.op,
        payload: structuredClone(this.payload),
        filters: this.filters,
      });
      return Promise.resolve({
        data: this.op === "insert"
          ? { id: `dry-run-intercepted-${this.table}` }
          : null,
        error: null,
      });
    }
    if (this.table === "student_room_assignments") {
      const { assignment } = ctx().fixture;
      const matches = this.filters.every(([column, value]) =>
        (assignment as any)[column] === value
      );
      if (!matches) {
        return Promise.resolve({
          data: null,
          error: { message: "dry-run: assignment not in fixture" },
        });
      }
      return Promise.resolve({
        data: this.wantSingle
          ? structuredClone(assignment)
          : [structuredClone(assignment)],
        error: null,
      });
    }
    // Any other table (for example feedback_assessment_runs reuse lookup) returns no rows.
    // That disables saved-score reuse, so the run always performs a fresh evaluation.
    return Promise.resolve({ data: this.wantSingle ? null : [], error: null });
  }
}

const client = {
  from(table: string) {
    return new Builder(table);
  },
  rpc(name: string, _args?: unknown) {
    ctx().rpcCalls.push(name);
    if (name !== "get_assignment_event_manifest") {
      return Promise.resolve({
        data: null,
        error: { message: `dry-run: rpc ${name} is not allowed` },
      });
    }
    return Promise.resolve({
      data: structuredClone(ctx().fixture.manifest),
      error: null,
    });
  },
};

export function createClient(_url: string, _key: string) {
  return client;
}

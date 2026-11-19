// Dry-run replacement for the `openai` Deno module. It mirrors the one method the
// generate-feedback function calls (chat.completions.create) and sends the same JSON body
// the SDK would send. Every request and raw response is recorded for the harness output.
// The API key is never logged or stored in the record.
// deno-lint-ignore-file no-explicit-any

type Ctx = {
  mode: "live" | "mock";
  apiKey: string | undefined;
  mockResponder?: (params: any) => string;
  modelCalls: Array<
    { request: any; rawContent: string | null; httpStatus: number | null }
  >;
};

const ctx = (): Ctx => (globalThis as any).__altheaDryRun.openai as Ctx;

async function create(params: any) {
  const c = ctx();
  const body = { ...params };
  if (c.mode === "mock") {
    const content = c.mockResponder!(body);
    c.modelCalls.push({ request: body, rawContent: content, httpStatus: null });
    return { choices: [{ message: { content } }] };
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    c.modelCalls.push({
      request: body,
      rawContent: null,
      httpStatus: response.status,
    });
    throw new Error(
      `OpenAI request failed with HTTP ${response.status}: ${
        json?.error?.type ?? "unknown_error"
      }`,
    );
  }
  const content: string | null = json?.choices?.[0]?.message?.content ?? null;
  c.modelCalls.push({
    request: body,
    rawContent: content,
    httpStatus: response.status,
  });
  return json;
}

export class OpenAI {
  chat = { completions: { create } };
  constructor(_options?: { apiKey?: string }) {}
}

// Althea feedback dry run (write-free).
//
// Runs the REAL supabase/functions/generate-feedback handler against a read-only snapshot of one
// attempt. Supabase and OpenAI are replaced by guarded stubs (see import_map.json):
//   - every database write is intercepted and recorded; nothing is sent anywhere;
//   - the only RPC allowed is the manifest read, served from the snapshot;
//   - during the pipeline, the only outbound network call allowed is OpenAI chat completions.
// Then it renders the stored (before) and dry-run (after) feedback through the app's own sheet
// code (mapFeedbackSheet, FeedbackSheet, renderFeedbackSheetHtml) and diffs preview vs download.
//
// Usage (from the repo root):
//   deno run -A --import-map scripts/althea-feedback-dryrun/import_map.json \
//     scripts/althea-feedback-dryrun/run.ts --assignment <uuid> --out <dir> [--mock]
//
// Live mode needs the approved key file (mode 600). Mock mode needs no key and is a plumbing check only.
// deno-lint-ignore-file no-explicit-any

import { mockResponse } from "./mock-responder.ts";

const PROJECT_REF = "lvpbwtfvairspufrashl";
const DEFAULT_ASSIGNMENT = "2808c092-d44f-4078-88be-954f11e0ffa3";
const KEY_FILE = `${Deno.env.get("HOME")}/.config/nursebot/openai-eval.env`;
const ALLOWED_ENV_KEYS = new Set([
  "OPENAI_API_KEY",
  "OPENAI_MODEL_GENERATE_FEEDBACK",
  "OPENAI_MODEL",
  "ALTHEA_BEDSIDE_TELEMETRY_SINCE",
]);
const REPO = new URL("../../", import.meta.url);
// Connor's archived Nov 18 download of 2808c092. The file was not located in the workspace or the
// Telegram media dirs, so these counts come from Connor's description and are labelled that way.
const ARCHIVED_BASELINE = {
  source: "per Connor's description, file not located",
  strengths: 1,
  improvements: 2,
  communication: "0/5",
  clinicalReasoning: "2/5",
  safety: "none/0",
  communicationNote: "no linked learner team communication was captured",
};
// Evaluator pins. Explicit values, not model or library defaults. See eval-config.json.
const EVAL_CONFIG = JSON.parse(
  await Deno.readTextFile(new URL("./eval-config.json", import.meta.url)),
);

// ---------- args ----------
const args = parseArgs(Deno.args);
const assignmentId = args.assignment ?? DEFAULT_ASSIGNMENT;
const mock = args.mock === true;
const outDir = args.out ??
  `${Deno.env.get("HOME")}/clawd/.tmp/althea-2808c092/${
    mock ? "mock" : "live"
  }`;
if (!/^[0-9a-f-]{36}$/.test(assignmentId)) fail("assignment id must be a uuid");

function parseArgs(argv: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}
function fail(message: string): never {
  console.error(message);
  Deno.exit(message.startsWith("KEY") ? 3 : 1);
}

// ---------- key file (values are never printed) ----------
async function loadKeyFile(): Promise<
  { values: Record<string, string>; otherKeyNames: number } | null
> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.stat(KEY_FILE);
  } catch {
    return null;
  }
  if (Deno.build.os !== "windows" && (info.mode! & 0o777) !== 0o600) {
    fail(`KEY file mode must be 600; refusing to read it`);
  }
  const text = await Deno.readTextFile(KEY_FILE);
  const values: Record<string, string> = {};
  let otherKeyNames = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m || line.startsWith("#")) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (ALLOWED_ENV_KEYS.has(m[1])) values[m[1]] = value;
    else otherKeyNames++;
  }
  return { values, otherKeyNames };
}

// ---------- read-only prod SQL (SELECT only; READ ONLY transaction) ----------
const token = () =>
  Deno.readTextFile(`${Deno.env.get("HOME")}/.supabase/access-token`).then((
    t,
  ) => t.trim());
async function roSql(query: string): Promise<any[]> {
  if (!/^\s*(select|with)\b/i.test(query)) {
    throw new Error("refused: non-SELECT query");
  }
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: `SET TRANSACTION READ ONLY;\n${query}` }),
    },
  );
  const json = await res.json();
  if (!res.ok || !Array.isArray(json)) {
    throw new Error(`read-only query failed: ${json?.message ?? res.status}`);
  }
  return json;
}

// ---------- global dry-run context consumed by the stubs ----------
const g = globalThis as any;
let phase: "load" | "pipeline" | "report" = "load";
const blockedNetwork: string[] = [];
const openaiHttpCalls: string[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: any, init?: any) => {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
    ? input.href
    : input.url;
  if (phase === "pipeline") {
    if (!url.startsWith("https://api.openai.com/v1/chat/completions")) {
      blockedNetwork.push(new URL(url).host);
      throw new Error(
        `dry-run guard: outbound call blocked during pipeline (${
          new URL(url).host
        })`,
      );
    }
    openaiHttpCalls.push(url);
  }
  return realFetch(input, init);
}) as typeof fetch;

// ---------- main ----------
const keyFile = await loadKeyFile();
if (!mock && !keyFile) {
  fail(
    `KEY FILE NOT FOUND at ${KEY_FILE}. Live run not performed. The only remaining step is the approved key file (mode 600, OPENAI_API_KEY=...). Use --mock to verify the harness without it.`,
  );
}
if (!mock && !keyFile!.values.OPENAI_API_KEY) {
  fail("KEY file has no OPENAI_API_KEY entry");
}

await Deno.mkdir(`${outDir}/internal`, { recursive: true });

// Read-only snapshot of the attempt. Manifest read uses the same service-role claim the function uses.
const assignmentRows = await roSql(
  `select * from student_room_assignments where id = '${assignmentId}'`,
);
if (assignmentRows.length !== 1) fail("assignment not found (read-only)");
const storedRow = assignmentRows[0];
const roomRows = await roSql(
  `select * from rooms where id = ${Number(storedRow.room_id)}`,
);
const room = roomRows[0];
const manifestRows = await roSql(
  `select set_config('request.jwt.claims', '{"role":"service_role"}', true) as _claims, public.get_assignment_event_manifest('${assignmentId}'::uuid) as manifest`,
);
const manifest = typeof manifestRows[0].manifest === "string"
  ? JSON.parse(manifestRows[0].manifest)
  : manifestRows[0].manifest;
let patientNames: string[] = [];
try {
  const patient = await roSql(
    `select first_name, last_name from patients where id = '${room.patient_id}'`,
  );
  patientNames = patient.flatMap((p: any) => [p.first_name, p.last_name])
    .filter((n: any) => typeof n === "string" && n.length > 2);
} catch {
  patientNames = [];
}
patientNames.push("Poppy"); // surname visible in the synthetic progress note; redacted from every shareable output

const assignmentForFunction = { ...storedRow, room };
const fixture = { assignment: assignmentForFunction, manifest };
await Deno.writeTextFile(
  `${outDir}/internal/fixture-snapshot.json`,
  JSON.stringify(
    {
      assignmentId,
      room_id: room.id,
      manifest_events: manifest.events?.length ?? 0,
      fixture_contains_learner_text: true,
    },
    null,
    2,
  ),
);

// Dry-run context: Supabase guard, OpenAI stub, mock responder.
const keyValues = keyFile?.values ?? {};
g.__altheaDryRun = {
  supabase: { fixture, intercepted: [] as any[], rpcCalls: [] as string[] },
  openai: {
    mode: mock ? "mock" : "live",
    apiKey: keyValues.OPENAI_API_KEY,
    mockResponder: mockResponse,
    modelCalls: [] as any[],
  },
};
// Model resolution uses the same env lookup as the function. Only the model-name keys are passed through.
for (
  const name of [
    "OPENAI_MODEL_GENERATE_FEEDBACK",
    "OPENAI_MODEL",
    "ALTHEA_BEDSIDE_TELEMETRY_SINCE",
  ]
) {
  if (keyValues[name]) Deno.env.set(name, keyValues[name]);
}
const telemetrySource = keyValues.ALTHEA_BEDSIDE_TELEMETRY_SINCE
  ? "set in key file"
  : "UNAVAILABLE (function secret not readable; treated as unset, so no bedside penalty path)";

// Capture the function handler instead of serving it.
let handler: ((req: Request) => Promise<Response>) | null = null;
Object.defineProperty(Deno, "serve", {
  configurable: true,
  writable: true,
  value: (...serveArgs: any[]) => {
    handler =
      (typeof serveArgs[0] === "function" ? serveArgs[0] : serveArgs[1]) as any;
    return { finished: Promise.resolve(), shutdown: async () => {} };
  },
});

const fnPath = new URL(
  "../../supabase/functions/generate-feedback/index.ts",
  import.meta.url,
).href;
await import(fnPath);
if (!handler) fail("handler was not captured");

const { getOpenAIModel } = await import(
  new URL("../../supabase/functions/_shared/openai-model.ts", import.meta.url)
    .href
);
const resolvedModel: string = getOpenAIModel("generate_feedback");
const modelSource = keyValues.OPENAI_MODEL_GENERATE_FEEDBACK
  ? "OPENAI_MODEL_GENERATE_FEEDBACK (key file)"
  : keyValues.OPENAI_MODEL
  ? "OPENAI_MODEL (key file)"
  : "code default (prod env secrets are unreadable here; prod may override)";

const modelPin: string | null = EVAL_CONFIG.release_model ?? null;
if (!modelPin && !mock) {
  fail(
    `PIN: release_model is unpinned in eval-config.json (${EVAL_CONFIG.release_model_status}). Live mode refused.`,
  );
}
if (modelPin && resolvedModel !== modelPin) {
  fail(
    `PIN: resolved model ${resolvedModel} differs from pinned ${modelPin}. Refusing to run.`,
  );
}
phase = "pipeline";
const started = new Date().toISOString();
const response = await (handler as (req: Request) => Promise<Response>)(
  new Request("http://dry-run.local/generate-feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assignmentId, forceRegrade: true }),
  }),
);
const responseBody = await response.json();
phase = "report";

const ctx = g.__altheaDryRun;
const intercepted: Array<
  { table: string; op: string; payload: any; filters: any[] }
> = ctx.supabase.intercepted;
const rpcCalls: string[] = ctx.supabase.rpcCalls;
const modelCalls: any[] = ctx.openai.modelCalls;

// ---------- write guard assertions ----------
const checks: Record<string, any> = {};
const insertRun = intercepted.find((w) =>
  w.op === "insert" && w.table === "feedback_assessment_runs"
);
const updateAssignment = intercepted.find((w) =>
  w.op === "update" && w.table === "student_room_assignments"
);
checks.handler_success = response.status === 200 &&
  responseBody?.success === true;
checks.intercepted_write_count = intercepted.length;
checks.only_expected_writes = intercepted.length === 2 && Boolean(insertRun) &&
  Boolean(updateAssignment) &&
  intercepted.every((w) => (w === insertRun || w === updateAssignment));
checks.rpc_calls = rpcCalls.join(",") || "none";
checks.only_manifest_rpc = rpcCalls.every((name) =>
  name === "get_assignment_event_manifest"
);
checks.blocked_network_calls = blockedNetwork.length;
checks.network_writes_sent = 0; // structural: the Supabase stub has no transport; no write path reaches the network
checks.model_calls = modelCalls.length;
const writeGuardOk = checks.only_expected_writes === true &&
  checks.only_manifest_rpc === true && blockedNetwork.length === 0;

if (!insertRun || !updateAssignment) {
  await Deno.writeTextFile(
    `${outDir}/internal/run-error.json`,
    JSON.stringify({ response: responseBody, checks }, null, 2),
  );
  fail(
    `pipeline did not reach the save step: ${
      JSON.stringify(responseBody).slice(0, 600)
    }`,
  );
}

// ---------- sheets: same app code paths ----------
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const sheet = await import(
  new URL("../../src/lib/feedbackSheet.tsx", import.meta.url).href
);

const storedAssignment = {
  ...storedRow,
  room: { room_number: room.room_number },
};
const dryRunAssignment = {
  ...storedRow,
  ...updateAssignment.payload,
  id: storedRow.id,
  room: { room_number: room.room_number },
};
const beforeModel = sheet.mapFeedbackSheet(storedAssignment);
const afterModel = sheet.mapFeedbackSheet(dryRunAssignment);

const deid = (value: string) =>
  patientNames.reduce((acc, name) => acc.split(name).join("[patient]"), value);
const downloadHtml = (model: any) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Feedback sheet</title><style>${sheet.feedbackSheetStyles}</style></head><body>${
    sheet.renderFeedbackSheetHtml(model)
  }</body></html>`;
const previewHtml = (model: any) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Feedback preview</title></head><body>${
    renderToStaticMarkup(React.createElement(sheet.FeedbackSheet, { model }))
  }</body></html>`;
const textOf = (html: string) =>
  html
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<\/?(p|h1|h2|li|b|strong|div|section|header|article|small|ul|span|body|html|head|title)[^>]*>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, "")
    .split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean)
    .join("\n");
const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(
    /&quot;/g,
    '"',
  ).replace(/&#39;/g, "'");

const artifacts: Record<string, string> = {
  "before-download.html": deid(downloadHtml(beforeModel)),
  "after-download.html": deid(downloadHtml(afterModel)),
  "before-preview.html": deid(previewHtml(beforeModel)),
  "after-preview.html": deid(previewHtml(afterModel)),
};
for (const [name, content] of Object.entries(artifacts)) {
  await Deno.writeTextFile(`${outDir}/${name}`, content);
}

// Preview vs download, compared as text (markup and whitespace stripped).
const diffs: Record<string, { identical: boolean; diff: string }> = {};
for (
  const [label, model] of [["before", beforeModel], [
    "after",
    afterModel,
  ]] as const
) {
  const preview = deid(decodeEntities(textOf(previewHtml(model))));
  const download = deid(decodeEntities(textOf(downloadHtml(model))));
  const pFile = `${outDir}/internal/${label}-preview.txt`;
  const dFile = `${outDir}/internal/${label}-download.txt`;
  await Deno.writeTextFile(pFile, preview + "\n");
  await Deno.writeTextFile(dFile, download + "\n");
  const proc = await new Deno.Command("diff", {
    args: [
      "-u",
      "--label",
      `${label}-preview`,
      "--label",
      `${label}-download`,
      pFile,
      dFile,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const diff = new TextDecoder().decode(proc.stdout);
  diffs[label] = { identical: proc.code === 0, diff };
  await Deno.writeTextFile(
    `${outDir}/preview-vs-download-${label}.diff`,
    diff || "IDENTICAL TEXT\n",
  );
}

// ---------- evidence links for changed scores ----------
const eventById = new Map<string, any>(
  (manifest.events ?? []).map((e: any) => [e.event_id, e]),
);
const eventLine = (id: string) => {
  const e = eventById.get(id);
  if (!e) return `- \`${id}\` (not in manifest)`;
  return `- \`${id}\` · ${e.event_type} · ${e.occurred_at} · actor ${
    e.actor?.role ?? "n/a"
  }`;
};
const componentRows = (breakdownBefore: any, breakdownAfter: any) =>
  [
    "focused_information_gathering",
    "closed_loop_team_communication",
    "efficiency_deduction",
    "orders_monitoring_quality",
    "clinical_reasoning_documentation",
    "safety_deduction",
  ]
    .map((key) => ({
      key,
      before: breakdownBefore?.[key]?.score ?? null,
      after: breakdownAfter?.[key]?.score ?? null,
      evidence: breakdownAfter?.[key]?.evidence_event_ids ?? [],
    }));
const cBefore = storedRow.communication_breakdown ?? {};
const mBefore = storedRow.mdm_breakdown ??
  storedRow.clinical_reasoning_breakdown ?? {};
const cAfter = updateAssignment.payload.communication_breakdown ?? {};
const mAfter = updateAssignment.payload.mdm_breakdown ?? {};
const rows = [
  ...componentRows(cBefore, cAfter),
  ...componentRows(mBefore, mAfter),
];
const changed = rows.filter((r) => r.before !== r.after);
const beforeSafety = storedRow.safety_result?.level ?? null;
const afterSafety = updateAssignment.payload.safety_result?.level ?? null;

// ---------- commentary and safety (after) ----------
const debrief = insertRun.payload.result.debrief;
const evaluation = insertRun.payload.result.evaluation;
const attempt = debrief.evidence_packet ?? {};
const structureErrors: string[] = [];
if (afterModel.strengths.length !== 2) {
  structureErrors.push(`strengths count ${afterModel.strengths.length}`);
}
if (afterModel.improvements.length !== 2) {
  structureErrors.push(`improvements count ${afterModel.improvements.length}`);
}
if (
  afterModel.communication.length !== 3 ||
  afterModel.clinicalReasoning.length !== 3
) structureErrors.push("component count not 3+3");
for (const problem of afterModel.commentIntegrity) {
  structureErrors.push(`comment integrity (after): ${problem}`);
}
const bothSheets = [
  artifacts["after-download.html"],
  artifacts["after-preview.html"],
  artifacts["before-download.html"],
  artifacts["before-preview.html"],
];
const obsSectionAbsent = bothSheets.every((h) =>
  !/Observed actions and orders/i.test(h)
);

// Prompt and config provenance (hash of the exact requests sent).
const te = new TextEncoder();
const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(text)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
const requestsCanonical = JSON.stringify(modelCalls.map((c) => c.request));
const promptConfigSha = await sha256(requestsCanonical);
const simPrompt = await import(
  new URL(
    "../../supabase/functions/_shared/simulation-prompt.ts",
    import.meta.url,
  ).href
);
const simPromptRecomputed = await sha256(
  simPrompt.NURSE_ALTHEA_SIMULATION_PROMPT,
);
const gitHead = await new Deno.Command("git", {
  args: ["rev-parse", "HEAD"],
  cwd: REPO.pathname,
  stdout: "piped",
}).output().then((o) => new TextDecoder().decode(o.stdout).trim());
const gitStatus = await new Deno.Command("git", {
  args: ["status", "--porcelain", "--", "supabase", "src", "scripts"],
  cwd: REPO.pathname,
  stdout: "piped",
}).output().then((o) => new TextDecoder().decode(o.stdout).trim());

const { ALTHEA_SAFETY_EVIDENCE_RULE_VERSION, ALTHEA_SCORING_PROMPT_VERSION } =
  await import(
    new URL("../../supabase/functions/_shared/evaluation-prompts.ts", import.meta.url).href
  );
const { FEEDBACK_RUBRIC_VERSION, CASE_KEY_VERSION, ASSESSMENT_VERSION } =
  await import(
    new URL("../../supabase/functions/_shared/feedback-contract.ts", import.meta.url).href
  );
const { EVIDENCE_PACKET_VERSION } = await import(
  new URL("../../supabase/functions/_shared/althea-evidence-packet.ts", import.meta.url).href
);
const { FEEDBACK_COMMENT_PROMPT_VERSION } = await import(
  new URL("../../supabase/functions/_shared/feedback-comments.ts", import.meta.url).href
);
const emittedVersions: Record<string, string> = {
  simulation_prompt_id: simPrompt.NURSE_ALTHEA_SIMULATION_PROMPT_ID,
  simulation_prompt_sha256: simPrompt.NURSE_ALTHEA_SIMULATION_PROMPT_SHA256,
  scoring: ALTHEA_SCORING_PROMPT_VERSION,
  rubric: FEEDBACK_RUBRIC_VERSION,
  assessment: ASSESSMENT_VERSION,
  case_key: CASE_KEY_VERSION,
  evidence_packet: EVIDENCE_PACKET_VERSION,
  safety_evidence_rule: ALTHEA_SAFETY_EVIDENCE_RULE_VERSION,
  commentary: FEEDBACK_COMMENT_PROMPT_VERSION,
};
const pinChecks = Object.fromEntries(
  Object.entries(EVAL_CONFIG.prompt_versions as Record<string, string>).map((
    [key, pinned],
  ) => [key, { pinned, emitted: emittedVersions[key] ?? null, match: emittedVersions[key] === pinned }]),
);
for (const [key, check] of Object.entries(pinChecks) as Array<[string, { pinned: string; emitted: string | null; match: boolean }]>) {
  if (!check.match) structureErrors.push(`pin mismatch (${key}): pinned ${check.pinned}, emitted ${check.emitted}`);
}

const provenance = {
  run_started_at: started,
  run_finished_at: new Date().toISOString(),
  mode: mock ? "MOCK (plumbing only; not an evaluation)" : "LIVE",
  assignment_id: assignmentId,
  git_commit: gitHead,
  git_dirty_paths_under_scope: gitStatus ? gitStatus.split("\n") : [],
  model: resolvedModel,
  model_source: modelSource,
  prompt_id: simPrompt.NURSE_ALTHEA_SIMULATION_PROMPT_ID,
  prompt_sha256_recorded_constant:
    simPrompt.NURSE_ALTHEA_SIMULATION_PROMPT_SHA256,
  prompt_sha256_recomputed: simPromptRecomputed,
  prompt_constant_matches_body:
    simPrompt.NURSE_ALTHEA_SIMULATION_PROMPT_SHA256 === simPromptRecomputed,
  prompt_and_config_sha256_of_requests_sent: promptConfigSha,
  rubric_version: debrief.evaluation_version,
  assessment_version: debrief.assessment_version,
  case_key_version: debrief.case_key_version,
  evidence_packet_version: attempt.version,
  bedside_telemetry_since: telemetrySource,
  bedside_expectation: attempt.bedside_expectation,
  bedside_rule: attempt.bedside_rule,
  leniency_multiplier: debrief.leniency_multiplier,
  input_fingerprint: debrief.input_fingerprint,
  baseline_medications_and_orders: attempt.baseline_medications_and_orders ??
    "unavailable (no baseline snapshot table in prod; PR #46 not applied)",
  checks,
  eval_config_file: "scripts/althea-feedback-dryrun/eval-config.json",
  release_model_pin: modelPin ?? "UNPINNED",
  release_model_status: modelPin ? "pinned" : EVAL_CONFIG.release_model_status,
  pin_checks: pinChecks,
  comment_integrity_after: afterModel.commentIntegrity,
  comment_integrity_before: beforeModel.commentIntegrity,
  archived_baseline: ARCHIVED_BASELINE,
  write_guard_ok: writeGuardOk,
  response_status: response.status,
  response_error: responseBody?.error ?? null,
};
await Deno.writeTextFile(
  `${outDir}/provenance.json`,
  JSON.stringify(provenance, null, 2),
);

// Raw model traffic (internal: includes learner and patient text).
await Deno.writeTextFile(
  `${outDir}/internal/raw-model-calls.json`,
  JSON.stringify(modelCalls, null, 2),
);
await Deno.writeTextFile(
  `${outDir}/internal/canonical-result.json`,
  JSON.stringify(
    { evaluation, debrief, intercepted_writes: intercepted },
    null,
    2,
  ),
);
await Deno.writeTextFile(
  `${outDir}/internal/before-stored.json`,
  JSON.stringify(
    {
      communication_breakdown: cBefore,
      mdm_breakdown: mBefore,
      safety_result: storedRow.safety_result,
      communication_score: storedRow.communication_score,
      mdm_score: storedRow.mdm_score,
      feedback_debrief: storedRow.feedback_debrief,
      rubric_version: storedRow.rubric_version,
    },
    null,
    2,
  ),
);

// ---------- summary (deidentified) ----------
const comp = (m: any) =>
  [...m.communication, ...m.clinicalReasoning].map((c: any) =>
    `${c.label}: ${c.score}\n  - ${c.notScoredReason || c.feedback}`
  ).join("\n");
const sectionText = (m: any) =>
  `- Communication: ${
    m.communicationScore ?? "Not scored"
  }\n- Clinical reasoning: ${
    m.clinicalReasoningScore ?? "Not scored"
  }\n- Safety: ${
    m.safety ? `${m.safety.level}. ${m.safety.detail}` : "none recorded"
  }\n\nCase goals:\n${
    m.goals.map((g: string) => `- ${g}`).join("\n") || "- Not recorded."
  }\n\nComponents:\n${comp(m)}\n\nStrengths:\n${
    m.strengths.map((s: string) => `- ${s}`).join("\n") || "- Not recorded."
  }\n\nImprovements:\n${
    m.improvements.map((s: string) => `- ${s}`).join("\n") || "- Not recorded."
  }`;
const linkLines = changed.length
  ? changed.map((r) =>
    `### ${r.key}: ${r.before} → ${r.after}\n${
      r.evidence.map(eventLine).join("\n") || "- (no evidence IDs)"
    }\n- App view: /assignment/${assignmentId}/feedback`
  ).join("\n\n")
  : "No component score changed.";
const summary = `# Althea feedback dry run (${
  mock ? "MOCK plumbing check, NOT an evaluation" : "live"
})

Deidentified. Run ${provenance.run_started_at}. Git ${
  gitHead.slice(0, 12)
}. Model \`${resolvedModel}\` (${modelSource}); release pin: ${
  modelPin ?? "UNPINNED (see eval-config.json)"
}. Prompt/config hash of requests sent: ${promptConfigSha}. Writes intercepted: ${intercepted.length}, sent: 0.

## Baseline counts (${ARCHIVED_BASELINE.source})
- Strengths: ${ARCHIVED_BASELINE.strengths}; improvements: ${ARCHIVED_BASELINE.improvements}
- Communication ${ARCHIVED_BASELINE.communication}; clinical reasoning ${ARCHIVED_BASELINE.clinicalReasoning}; safety ${ARCHIVED_BASELINE.safety}
- Note: "${ARCHIVED_BASELINE.communicationNote}"

## Rendered counts from current stored data (before) and dry run (after)
- Before: strengths ${beforeModel.strengths.length}; improvements ${beforeModel.improvements.length}; comment integrity: ${beforeModel.commentIntegrity.join("; ") || "ok"}
- After: strengths ${afterModel.strengths.length}; improvements ${afterModel.improvements.length}; comment integrity: ${afterModel.commentIntegrity.join("; ") || "ok"}

## Before (stored, rubric ${storedRow.rubric_version})
${sectionText(beforeModel)}

## After (dry run, rubric ${debrief.evaluation_version})
${sectionText(afterModel)}

## Changed scores and evidence
${linkLines}

## Checks
- Handler success: ${checks.handler_success}
- Writes intercepted: ${intercepted.map((w) => `${w.op} ${w.table}`).join("; ")}
- Only expected writes: ${checks.only_expected_writes}
- RPC calls: ${checks.rpc_calls}
- Blocked network calls: ${checks.blocked_network_calls}
- Structure errors: ${structureErrors.join("; ") || "none"}
- "Observed actions and orders" absent from all sheets: ${obsSectionAbsent}
- Preview vs download identical (after): ${diffs.after.identical}; (before): ${diffs.before.identical}
- Prompt constant matches body: ${provenance.prompt_constant_matches_body}
- Pin checks: ${Object.values(pinChecks).every((c: any) => c.match) ? "all match" : "MISMATCH"}
`;
await Deno.writeTextFile(`${outDir}/summary.md`, deid(summary));
console.log(`commit: ${gitHead}`);
console.log(`prompt_and_config_sha256_of_requests_sent: ${promptConfigSha}`);
console.log(`release_model_pin: ${modelPin ?? "UNPINNED"}; resolved model: ${resolvedModel} (${modelSource})`);
console.log(JSON.stringify(
  {
    outDir,
    checks,
    structureErrors,
    previewVsDownloadIdentical: {
      before: diffs.before.identical,
      after: diffs.after.identical,
    },
    writeGuardOk,
    changedComponents: changed.map((r) => r.key),
    beforeSafety,
    afterSafety,
  },
  null,
  2,
));
Deno.exit(writeGuardOk && structureErrors.length === 0 ? 0 : 2);

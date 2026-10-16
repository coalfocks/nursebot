import { useMemo, useState } from 'react';
import { CheckCircle2, RefreshCw, Send, ShieldCheck } from 'lucide-react';

const STORAGE_KEY = 'nursebot.synthetic-active-case.v1';
const ASSIGNMENT_ID = 'synthetic-active-assignment-001';
const REQUEST_ID = 'synthetic-consult-request-001';

type ConsultantState = {
  status: 'idle' | 'answered';
  attempts: number;
  requestId: string;
  orderId: string;
  studentMessageId: string;
  responseMessageId: string;
};

type FixtureState = {
  consultant: ConsultantState;
  learnerEvents: string[];
};

const initialState: FixtureState = {
  consultant: {
    status: 'idle',
    attempts: 0,
    requestId: REQUEST_ID,
    orderId: 'synthetic-consult-order-001',
    studentMessageId: 'synthetic-consult-message-001',
    responseMessageId: 'synthetic-consult-response-001',
  },
  learnerEvents: ['synthetic-nurse-message-001', 'synthetic-patient-message-001'],
};

function readState(): FixtureState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<FixtureState> | null;
    if (parsed?.consultant && Array.isArray(parsed.learnerEvents)) {
      return { ...initialState, ...parsed, consultant: { ...initialState.consultant, ...parsed.consultant } };
    }
  } catch {
    // A blocked storage implementation should not prevent the fixture from loading.
  }
  return initialState;
}

function saveState(state: FixtureState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export default function SyntheticActiveCaseFixture() {
  const [state, setState] = useState<FixtureState>(() => readState());
  const [notice, setNotice] = useState('');

  const evidence = useMemo(() => [
    { id: 'synthetic-cbc-order-001', type: 'order', label: 'STAT/Once CBC — completed' },
    { id: 'synthetic-cbc-result-001', type: 'lab/result', label: 'CBC result — linked to order' },
    { id: 'synthetic-nurse-message-001', type: 'nurse message', label: 'Learner to nurse — post-page' },
    { id: 'synthetic-patient-message-001', type: 'patient message', label: 'Student to patient — post-page' },
    ...(state.consultant.status === 'answered' ? [
      { id: state.consultant.studentMessageId, type: 'consultant message', label: 'Student consultant request' },
      { id: state.consultant.responseMessageId, type: 'consultant response', label: 'Consultant response — contextual' },
    ] : []),
  ], [state.consultant]);

  const persist = (next: FixtureState, message: string) => {
    setState(next);
    saveState(next);
    setNotice(message);
  };

  const submitConsult = () => {
    const next: FixtureState = {
      ...state,
      consultant: { ...state.consultant, status: 'answered', attempts: state.consultant.attempts + 1 },
    };
    persist(next, `Persisted request ${next.consultant.requestId}; retry count ${next.consultant.attempts}.`);
  };

  const addCommunication = (id: string, label: string) => {
    if (state.learnerEvents.includes(id)) {
      setNotice(`${label} is already persisted with stable ID ${id}.`);
      return;
    }
    persist({ ...state, learnerEvents: [...state.learnerEvents, id] }, `Persisted ${label} as ${id}.`);
  };

  const reset = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setState(initialState);
    setNotice('Synthetic fixture reset locally; no Supabase rows were changed.');
  };

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Synthetic-only preview fixture</p>
              <h1 className="mt-1 text-2xl font-bold">Active case: Internal Medicine QA</h1>
              <p className="mt-1 text-sm text-slate-600">Assignment <code>{ASSIGNMENT_ID}</code> · room SYN-001 · fictional chart SYN-CHART-001</p>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800"><ShieldCheck className="h-4 w-4" />No Supabase requests</div>
          </div>
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">This route uses fictional in-memory/localStorage data only. It demonstrates UI persistence and deterministic retry behavior; it does not verify production RLS, Edge Functions, database RPCs, or generated feedback.</p>
        </header>

        <section className="grid gap-5 lg:grid-cols-2">
          <article className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Synthetic chart</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-slate-500">Patient</dt><dd className="font-medium">Alex Morgan (fictional)</dd></div>
              <div><dt className="text-slate-500">Route scope</dt><dd className="font-medium">assignment + room</dd></div>
              <div><dt className="text-slate-500">Baseline</dt><dd className="font-medium">12 hours prior</dd></div>
              <div><dt className="text-slate-500">Status</dt><dd className="font-medium text-blue-700">Active</dd></div>
            </dl>
            <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm"><b>Order:</b> STAT/Once CBC — completed<br /><b>Result:</b> linked synthetic CBC analytes available after reload</div>
            <h3 className="mt-5 font-semibold">Captured communication</h3>
            <ul className="mt-2 space-y-2 text-sm">{state.learnerEvents.map((id) => <li key={id} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{id === 'synthetic-patient-message-001' ? 'Student to patient' : 'Learner to nurse'} <code className="text-xs text-slate-500">{id}</code></li>)}</ul>
            <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => addCommunication('synthetic-patient-message-001', 'patient communication')} className="rounded-md border px-3 py-2 text-xs">Persist patient message</button><button type="button" onClick={() => addCommunication('synthetic-nurse-message-001', 'nurse communication')} className="rounded-md border px-3 py-2 text-xs">Persist nurse message</button></div>
          </article>

          <article className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Consultant request / retry</h2>
            <p className="mt-1 text-sm text-slate-600">The button simulates submit, then a same-ID retry. It persists one request, one order, one learner message, and one response.</p>
            <div className="mt-4 rounded-lg border p-3 text-sm"><div><b>Status:</b> <span className="text-blue-700">{state.consultant.status}</span></div><div><b>Request ID:</b> <code>{state.consultant.requestId}</code></div><div><b>Retry count:</b> {state.consultant.attempts}</div>{state.consultant.status === 'answered' && <><ul className="mt-2 space-y-1 text-xs text-slate-600"><li>request/order: <code>{state.consultant.requestId} / {state.consultant.orderId}</code></li><li>learner/response messages: <code>{state.consultant.studentMessageId} / {state.consultant.responseMessageId}</code></li></ul><p className="mt-2 rounded bg-slate-50 p-2"><b>Consultant response:</b> acknowledge, monitor the patient, and review in the morning.</p></>}</div>
            <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={submitConsult} className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white"><Send className="mr-2 h-4 w-4" />{state.consultant.status === 'answered' ? 'Retry same request ID' : 'Send consultant request'}</button><button type="button" onClick={reset} className="inline-flex items-center rounded-md border px-3 py-2 text-sm"><RefreshCw className="mr-2 h-4 w-4" />Reset fixture</button></div>
            {notice && <p role="status" className="mt-3 text-xs text-emerald-700">{notice}</p>}
          </article>
        </section>

        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Feedback evidence read-back</h2>
          <p className="mt-1 text-sm text-slate-600">Stable attempt-scoped IDs shown exactly as this fixture would cite them. Replies are contextual and not learner actions.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">{evidence.map((item) => <div key={item.id} className="rounded border px-3 py-2 text-sm"><span className="font-medium">{item.label}</span><span className="ml-2 text-xs text-slate-500">{item.type} · <code>{item.id}</code></span></div>)}</div>
          <p className="mt-4 rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">Target diagnosis: synthetic acute instability · goals: identify acuity, prioritize monitoring/orders, document synthesis, and communicate/escalate with a focused question.</p>
        </section>
      </div>
    </main>
  );
}

export { ASSIGNMENT_ID, REQUEST_ID, STORAGE_KEY, initialState, readState };

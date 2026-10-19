import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsultantPortal } from './ConsultantPortal';
import { CONSULTANT_DIRECTORY } from './consultantPortalModel';
import type { Message } from './consultantPortalModel';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  from: vi.fn(),
  rowsByAssignment: {} as Record<string, Message[]>,
  messageQueryError: null as { message: string } | null,
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    functions: { invoke: mocks.invoke },
    from: mocks.from,
  },
}));

const message = (id: string, role: 'student' | 'consultant', content: string, audience: Message['audience'], specialty: string | null, requestId?: string, orderId?: string): Message => ({ id, role, content, audience, specialty, created_at: id, request_id: requestId, consult_order_id: orderId });

const installMessageQuery = () => {
  mocks.from.mockImplementation(() => {
    const filters: Record<string, string> = {};
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((field: string, value: string) => { filters[field] = value; return query; }),
      order: vi.fn(() => query),
      then: (resolve: (value: { data: Message[]; error: { message: string } | null }) => unknown) => Promise.resolve(resolve({ data: mocks.rowsByAssignment[filters.assignment_id] ?? [], error: mocks.messageQueryError })),
    };
    return query;
  });
};

const readyPreflight = () => {
  mocks.rpc.mockResolvedValue({ data: { ready: true, schemaVersion: 2 }, error: null });
  mocks.invoke.mockImplementation((_name: string, options: { body: { mode?: string } }) => {
    if (options.body.mode === 'preflight') return Promise.resolve({ data: { ready: true, schemaVersion: 2, functionVersion: 2, atomicPersistence: 'separate_dependency' }, error: null });
    return Promise.resolve({ data: null, error: new Error('No response configured') });
  });
};

describe('consultant portal transport integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rowsByAssignment = {};
    mocks.messageQueryError = null;
    readyPreflight();
    installMessageQuery();
  });

  it('keeps the canonical directory available to the UI', () => {
    expect(CONSULTANT_DIRECTORY.find((item) => item.value === 'Medicine')).toEqual({ value: 'Medicine', label: 'Medicine / Hospitalist', audiences: ['adult'] });
  });

  it('renders exact stored successful messages and does not reconstruct from the draft', async () => {
    const stored = [message('1', 'student', 'server-stored request', 'adult', 'Medicine'), message('2', 'consultant', 'server-stored answer', 'adult', 'Medicine')];
    mocks.invoke.mockImplementation((_name: string, options: { body: { mode?: string } }) => options.body.mode === 'preflight'
      ? Promise.resolve({ data: { ready: true, schemaVersion: 2, functionVersion: 2, atomicPersistence: 'separate_dependency' }, error: null })
      : Promise.resolve({ data: { message: 'server-stored answer', messages: stored, orderId: 'order-a' }, error: null }));
    render(<ConsultantPortal assignmentId="assignment-a" open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Medicine' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'draft before server response' } });
    fireEvent.submit(screen.getByLabelText('Message').closest('form')!);
    await waitFor(() => expect(screen.getByText('server-stored request')).toBeInTheDocument());
    expect(screen.queryByText('draft before server response')).not.toBeInTheDocument();
    expect(screen.getByText('server-stored answer')).toBeInTheDocument();
  });

  it('keeps distinct follow-up request transcripts in one thread while reusing one active order', async () => {
    const responses = [
      { message: 'first answer', messages: [message('1', 'student', 'first', 'adult', 'Medicine', 'request-1', 'shared-order'), message('2', 'consultant', 'first answer', 'adult', 'Medicine', 'request-1', 'shared-order')], orderId: 'shared-order' },
      { message: 'follow-up answer', messages: [message('3', 'student', 'follow-up', 'adult', 'Medicine', 'request-2', 'shared-order'), message('4', 'consultant', 'follow-up answer', 'adult', 'Medicine', 'request-2', 'shared-order')], orderId: 'shared-order' },
    ];
    const responsesToServe = [...responses];
    mocks.invoke.mockImplementation((_name: string, options: { body: { mode?: string } }) => options.body.mode === 'preflight' ? Promise.resolve({ data: { ready: true, schemaVersion: 2, functionVersion: 2, atomicPersistence: 'separate_dependency' }, error: null }) : Promise.resolve({ data: responsesToServe.shift(), error: null }));
    render(<ConsultantPortal assignmentId="assignment-a" open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Medicine' } });
    const form = () => screen.getByLabelText('Message').closest('form')!;
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'first' } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText('first answer')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'follow-up' } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText('follow-up answer')).toBeInTheDocument());
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('follow-up')).toBeInTheDocument();
    expect(responses.map((response) => response.messages.map((item) => item.request_id))).toEqual([['request-1', 'request-1'], ['request-2', 'request-2']]);
    expect(responses.map((response) => response.messages.map((item) => item.consult_order_id))).toEqual([['shared-order', 'shared-order'], ['shared-order', 'shared-order']]);
    const requests = mocks.invoke.mock.calls.filter(([, options]) => !(options as { body: { mode?: string } }).body.mode);
    expect(requests).toHaveLength(2);
    expect(requests[0][1].body.request.clientRequestId).not.toBe(requests[1][1].body.request.clientRequestId);
    expect(requests[0][1].body.request.audience).toBe('adult');
  });

  it('freezes an attempted draft, retries the exact same ID and text, then clears only after stored messages arrive', async () => {
    let attempt = 0;
    mocks.invoke.mockImplementation((_name: string, options: { body: { mode?: string; request?: { message: string } } }) => {
      if (options.body.mode === 'preflight') return Promise.resolve({ data: { ready: true, schemaVersion: 2, functionVersion: 2, atomicPersistence: 'separate_dependency' }, error: null });
      attempt += 1;
      if (attempt === 1) return Promise.resolve({ data: null, error: new Error('Request outcome unknown') });
      return Promise.resolve({ data: { message: `stored answer ${attempt}`, messages: [message(`${attempt}-student`, 'student', options.body.request?.message ?? '', 'adult', 'Medicine'), message(`${attempt}-consultant`, 'consultant', `stored answer ${attempt}`, 'adult', 'Medicine')] }, error: null });
    });
    render(<ConsultantPortal assignmentId="assignment-a" open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Medicine' } });
    const textarea = () => screen.getByLabelText('Message');
    const form = () => textarea().closest('form')!;
    fireEvent.change(textarea(), { target: { value: 'exact frozen request' } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Request outcome unknown'));
    expect(textarea()).toHaveValue('exact frozen request');
    expect(textarea()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    fireEvent.change(textarea(), { target: { value: 'edited after failure' } });
    expect(textarea()).toHaveValue('exact frozen request');

    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText('stored answer 2')).toBeInTheDocument());
    const requests = mocks.invoke.mock.calls.filter(([, options]) => !(options as { body: { mode?: string } }).body.mode);
    expect(requests).toHaveLength(2);
    expect(requests[0][1].body.request).toEqual(requests[1][1].body.request);
    expect(textarea()).toHaveValue('');
    expect(textarea()).not.toBeDisabled();

    fireEvent.change(textarea(), { target: { value: 'distinct follow-up' } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText('stored answer 3')).toBeInTheDocument());
    const allRequests = mocks.invoke.mock.calls.filter(([, options]) => !(options as { body: { mode?: string } }).body.mode);
    expect(allRequests[2][1].body.request.message).toBe('distinct follow-up');
    expect(allRequests[2][1].body.request.clientRequestId).not.toBe(allRequests[0][1].body.request.clientRequestId);
  });

  it('does not let an assignment switch apply a stale read', async () => {
    mocks.rowsByAssignment = {
      'assignment-a': [message('a', 'student', 'old assignment', 'adult', 'Medicine')],
      'assignment-b': [message('b', 'student', 'new assignment', 'adult', 'Medicine')],
    };
    const { rerender } = render(<ConsultantPortal assignmentId="assignment-a" open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Medicine' } });
    await waitFor(() => expect(screen.getByText('old assignment')).toBeInTheDocument());
    rerender(<ConsultantPortal assignmentId="assignment-b" open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Medicine' } });
    await waitFor(() => expect(screen.getByText('new assignment')).toBeInTheDocument());
    expect(screen.queryByText('old assignment')).not.toBeInTheDocument();
  });

  it('keeps service transcripts and pending replies isolated during a service switch', async () => {
    let resolveReply: ((value: { data: unknown; error: null }) => void) | undefined;
    mocks.invoke.mockImplementation((_name: string, options: { body: { mode?: string } }) => {
      if (options.body.mode === 'preflight') return Promise.resolve({ data: { ready: true, schemaVersion: 2, functionVersion: 2, atomicPersistence: 'separate_dependency' }, error: null });
      return new Promise((resolve) => { resolveReply = resolve; });
    });
    render(<ConsultantPortal assignmentId="assignment-a" open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Medicine' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'pending medicine' } });
    fireEvent.submit(screen.getByLabelText('Message').closest('form')!);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Cardiology' } });
    expect(screen.getByLabelText('Message')).toHaveValue('');
    expect(screen.queryByText('pending medicine')).not.toBeInTheDocument();
    resolveReply?.({ data: { message: 'medicine reply', messages: [message('m1', 'student', 'pending medicine', 'adult', 'Medicine'), message('m2', 'consultant', 'medicine reply', 'adult', 'Medicine')], orderId: 'order-m' }, error: null });
    await waitFor(() => expect(screen.getByText('No messages in this adult Cardiology thread yet.')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Medicine' } });
    await waitFor(() => expect(screen.getByText('medicine reply')).toBeInTheDocument());
  });

  it('shows legacy null-audience messages separately and read-only', async () => {
    mocks.rowsByAssignment = { 'assignment-a': [message('legacy', 'student', 'old transcript', null, null), message('current', 'student', 'current transcript', 'adult', 'Medicine')] };
    render(<ConsultantPortal assignmentId="assignment-a" open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Legacy / unclassified transcript')).toBeInTheDocument());
    expect(screen.getByText(/not assigned to this current service thread/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Medicine' } });
    expect(screen.getByText('current transcript')).toBeInTheDocument();
    expect(screen.getByText('old transcript')).toBeInTheDocument();
  });

  it('keeps the portal unavailable and does not query messages when schema preflight fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'function missing' } });
    render(<ConsultantPortal assignmentId="assignment-a" open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('schema is not ready'));
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('keeps the portal unavailable when the Edge Function contract preflight fails', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: 'old function deployment' } });
    render(<ConsultantPortal assignmentId="assignment-a" open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('function deployment'));
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('leaves checking state when readiness preflight throws', async () => {
    mocks.rpc.mockRejectedValue(new Error('network unavailable'));
    render(<ConsultantPortal assignmentId="assignment-a" open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('could not be checked'));
    expect(screen.getByRole('status')).not.toHaveTextContent('Checking');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('shows an assignment-scoped transcript load failure instead of an empty thread', async () => {
    mocks.messageQueryError = { message: 'history query failed' };
    render(<ConsultantPortal assignmentId="assignment-a" open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('history query failed'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Medicine' } });
    expect(screen.getByRole('alert')).toHaveTextContent('history query failed');
    expect(screen.queryByText(/No messages in this adult Medicine thread/)).not.toBeInTheDocument();
  });
});

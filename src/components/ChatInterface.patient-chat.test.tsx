import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInterface } from './ChatInterface';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  invoke: vi.fn(),
  getPatientByRoomId: vi.fn(),
  listOrders: vi.fn(),
  listLabResults: vi.fn(),
  listVitals: vi.fn(),
  listImagingStudies: vi.fn(),
  generateInitialPrompt: vi.fn(),
  patientRows: [] as Array<{ role: string; content: string }>,
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: mocks.from,
    functions: { invoke: mocks.invoke },
    channel: () => {
      const channel = { on: function(this: unknown) { return this; }, subscribe: () => channel, unsubscribe: vi.fn() };
      return channel;
    },
  },
}));
vi.mock('../features/emr/lib/api', () => ({ emrApi: {
  getPatientByRoomId: mocks.getPatientByRoomId,
  listOrders: mocks.listOrders,
  listLabResults: mocks.listLabResults,
  listVitals: mocks.listVitals,
  listImagingStudies: mocks.listImagingStudies,
} }));
vi.mock('../lib/openai', () => ({ generateInitialPrompt: mocks.generateInitialPrompt }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const queryResult = (table: string) => {
  const query: Record<string, unknown> = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    update: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve(table === 'rooms'
      ? { data: { bedside_hint: 'Ask about pain', completion_hint: null, emr_context: null, patient_conversation_enabled: true, patient_conversation_prompt: 'Answer as the patient.', patient_participation_reason: null, patient_speaker_type: 'patient' }, error: null }
      : { data: { status: 'assigned', student_progress_note: null, completed_at: null, completion_hint_views: {} }, error: null })),
    then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve(resolve({
      data: table === 'patient_chat_messages' ? mocks.patientRows : table === 'chat_messages' ? [{ id: 'existing', assignment_id: 'assignment-1', role: 'assistant', content: 'Welcome', created_at: '2026-10-29T15:00:00Z' }] : [],
      error: null,
    })),
  };
  return query;
};

describe('ChatInterface patient transport contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.patientRows = [{ role: 'student', content: 'Earlier question' }, { role: 'patient', content: 'Earlier answer' }];
    mocks.getPatientByRoomId.mockResolvedValue({ id: 'patient-1' });
    mocks.listOrders.mockResolvedValue([]);
    mocks.listLabResults.mockResolvedValue([]);
    mocks.listVitals.mockResolvedValue([]);
    mocks.listImagingStudies.mockResolvedValue([]);
    mocks.generateInitialPrompt.mockResolvedValue('system prompt');
    mocks.invoke.mockImplementation((name: string) => name === 'patient-chat'
      ? Promise.resolve({ data: { message: 'New patient answer' }, error: null })
      : Promise.resolve({ data: null, error: null }));
    mocks.from.mockImplementation((table: string) => queryResult(table));
  });

  it('reloads persisted questions, saves a stable question ID, and retries the exact transport body', async () => {
    render(<ChatInterface assignmentId="assignment-1" roomNumber="204" roomId={204} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Go to Bedside' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Go to Bedside' }));
    await waitFor(() => expect(screen.getByText('Earlier question')).toBeInTheDocument());

    const input = screen.getByPlaceholderText('Ask the patient...');
    fireEvent.change(input, { target: { value: 'Do you have nausea?' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(screen.getByText('New patient answer')).toBeInTheDocument());
    const patientInsert = mocks.from.mock.results
      .map((result) => result.value)
      .find((query) => query.insert?.mock?.calls?.length);
    expect(patientInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      assignment_id: 'assignment-1', role: 'student', content: 'Do you have nausea?', client_message_id: expect.any(String),
    }));
    const patientCall = mocks.invoke.mock.calls.find(([name]) => name === 'patient-chat');
    expect(patientCall[1].body).toMatchObject({ assignmentId: 'assignment-1', clientMessageId: expect.any(String) });
    expect(patientCall[1].body.messages.at(-1)).toEqual({ role: 'user', content: 'Do you have nausea?' });
  });

  it('removes the optimistic question and shows the truthful transport error instead of fabricating a reply', async () => {
    mocks.invoke.mockImplementation((name: string) => name === 'patient-chat'
      ? Promise.resolve({ data: null, error: new Error('patient transport 409') })
      : Promise.resolve({ data: null, error: null }));
    render(<ChatInterface assignmentId="assignment-1" roomNumber="204" roomId={204} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Go to Bedside' }));
    const input = await screen.findByPlaceholderText('Ask the patient...');
    fireEvent.change(input, { target: { value: 'Question that fails' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('patient transport 409'));
    expect(screen.queryByText('I am having trouble answering right now.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('retries the frozen question and full body after an edited draft', async () => {
    let patientCalls = 0;
    mocks.invoke.mockImplementation((name: string) => {
      if (name !== 'patient-chat') return Promise.resolve({ data: null, error: null });
      patientCalls += 1;
      return patientCalls === 1
        ? Promise.resolve({ data: null, error: new Error('patient transport 409') })
        : Promise.resolve({ data: { message: 'Recovered patient answer' }, error: null });
    });

    render(<ChatInterface assignmentId="assignment-1" roomNumber="204" roomId={204} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Go to Bedside' }));
    const input = await screen.findByPlaceholderText('Ask the patient...');
    fireEvent.change(input, { target: { value: 'What is your pain level?' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument());
    fireEvent.change(input, { target: { value: 'EDITED DIFFERENT QUESTION' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('Recovered patient answer')).toBeInTheDocument());
    const patientCallsByName = mocks.invoke.mock.calls.filter(([name]) => name === 'patient-chat');
    expect(patientCallsByName).toHaveLength(2);
    expect(patientCallsByName[1][1].body).toEqual(patientCallsByName[0][1].body);
    expect(patientCallsByName[1][1].body.messages.at(-1)).toEqual({ role: 'user', content: 'What is your pain level?' });
    expect(patientCallsByName[1][1].body.messages.at(-1)).not.toEqual({ role: 'user', content: 'EDITED DIFFERENT QUESTION' });
  });
});

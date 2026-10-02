import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClinicalNote, Patient } from '../lib/types';
import { ClinicalNotes } from './ClinicalNotes';

const { listClinicalNotes } = vi.hoisted(() => ({ listClinicalNotes: vi.fn() }));

vi.mock('../lib/api', () => ({
  emrApi: {
    listClinicalNotes,
    addClinicalNote: vi.fn(),
    updateClinicalNote: vi.fn(),
    deleteClinicalNote: vi.fn(),
  },
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}));

const patient = (id: string): Patient => ({
  id,
  schoolId: 'school-1',
  roomId: null,
  firstName: id,
  lastName: 'Patient',
  mrn: `MRN-${id}`,
  dateOfBirth: '1990-01-01',
  gender: 'Other',
  allergies: [],
  codeStatus: undefined,
});

const note = (id: string): ClinicalNote => ({
  id: `note-${id}`,
  patientId: id,
  type: 'Progress',
  title: `${id} note`,
  content: `${id} content`,
  author: 'Nurse',
  signed: false,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('ClinicalNotes patient request identity', () => {
  beforeEach(() => {
    listClinicalNotes.mockReset();
  });

  it('keeps patient B visible when patient A resolves late', async () => {
    const patientA = deferred<ClinicalNote[]>();
    const patientB = deferred<ClinicalNote[]>();
    listClinicalNotes.mockReturnValueOnce(patientA.promise).mockReturnValueOnce(patientB.promise);

    const { rerender } = render(<ClinicalNotes patient={patient('A')} />);
    rerender(<ClinicalNotes patient={patient('B')} />);

    await act(async () => {
      patientB.resolve([note('B')]);
      await patientB.promise;
    });
    expect(await screen.findByText('B note')).toBeInTheDocument();

    await act(async () => {
      patientA.resolve([note('A')]);
      await patientA.promise;
    });
    await waitFor(() => expect(screen.queryByText('A note')).not.toBeInTheDocument());
    expect(screen.getByText('B content')).toBeInTheDocument();
    expect(listClinicalNotes).toHaveBeenNthCalledWith(1, 'A', undefined, null);
    expect(listClinicalNotes).toHaveBeenNthCalledWith(2, 'B', undefined, null);
  });
});

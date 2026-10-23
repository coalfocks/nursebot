import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import type { Patient } from '../features/emr/lib/types';
import EmrDashboard from './EmrDashboard';

const { getPatientByRoomId, listPatients, apiMethods, roomQuery } = vi.hoisted(() => ({
  getPatientByRoomId: vi.fn(),
  listPatients: vi.fn(),
  apiMethods: {} as Record<string, ReturnType<typeof vi.fn>>,
  roomQuery: vi.fn(),
}));
const capturePatientRequest = vi.fn(() => 1);
const isCurrentPatientRequest = vi.fn(() => true);

const patient = (id: string, roomId: number, firstName = 'Sim'): Patient => ({
  id,
  roomId,
  mrn: `MRN-${id}`,
  firstName,
  lastName: 'Patient',
  dateOfBirth: '1980-01-01',
  gender: 'Female',
  allergies: [],
  room: String(roomId),
  codeStatus: 'Full Code',
});

vi.mock('../features/emr/lib/api', () => ({
  emrApi: new Proxy(apiMethods, {
    get(target, property: string) {
      if (property === 'getPatientByRoomId') return getPatientByRoomId;
      if (property === 'listPatients') return listPatients;
      if (!target[property]) target[property] = vi.fn(async () => []);
      return target[property];
    },
  }),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'admin-user' },
    profile: { id: 'admin-profile', role: 'super_admin', school_id: 'school-a' },
    activeSchoolId: 'school-a',
  }),
}));

vi.mock('../lib/roles', () => ({
  hasAdminAccess: () => true,
  isSuperAdmin: () => true,
  isTestUser: () => false,
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => roomQuery(),
    storage: { from: () => ({ upload: vi.fn(), getPublicUrl: vi.fn(() => ({ data: { publicUrl: '' } })) }) },
  },
}));

vi.mock('../lib/roomHelpers', () => ({
  fetchSpecialtiesForRoom: vi.fn(async () => []),
  hasObgynSpecialty: vi.fn(() => false),
}));

vi.mock('../hooks/useRequestIdentity', () => ({
  useRequestIdentity: () => ({ capture: capturePatientRequest, isCurrent: isCurrentPatientRequest }),
}));

vi.mock('../lib/assignmentEncounterAnchor', () => ({ resolveAssignmentEncounterAnchor: vi.fn(() => null) }));

vi.mock('../features/emr/components/PatientSidebar', () => ({
  PatientSidebar: ({ selectedPatient, patients }: { selectedPatient: Patient; patients: Patient[] }) => (
    <div data-testid="patient-sidebar">{selectedPatient?.id}:{patients.map((entry) => entry.id).join(',')}</div>
  ),
}));

vi.mock('../features/emr/components/MedicationAdministrationRecord', () => ({
  MedicationAdministrationRecord: ({ patient }: { patient: Patient }) => (
    <div data-testid="editable-mar">Editable MAR:{patient.id}</div>
  ),
}));

vi.mock('../features/emr/components/ClinicalNotes', () => ({ ClinicalNotes: () => null }));
vi.mock('../features/emr/components/LabResults', () => ({ LabResults: () => null }));
vi.mock('../features/emr/components/VitalSigns', () => ({ VitalSignsComponent: () => null }));
vi.mock('../features/emr/components/OrdersManagement', () => ({ OrdersManagement: () => null }));
vi.mock('../features/emr/components/ImagingStudies', () => ({ ImagingStudies: () => null }));
vi.mock('../components/Navbar', () => ({ default: () => null }));
vi.mock('../components/admin/AdminLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../features/emr/components/ui/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../features/emr/components/ui/Button', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
vi.mock('../features/emr/components/ui/Badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock('../features/emr/components/ui/Tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

const RouteControls = () => {
  const [, setSearchParams] = useSearchParams();
  return <button onClick={() => setSearchParams({ roomId: '205' })}>switch room</button>;
};

const renderDashboard = (entry: string) => render(
  <MemoryRouter initialEntries={[entry]}>
    <RouteControls />
    <EmrDashboard />
  </MemoryRouter>,
);

describe('EmrDashboard canonical patient lifecycle', () => {
  beforeEach(() => {
    getPatientByRoomId.mockReset();
    listPatients.mockReset();
    roomQuery.mockReset();
    Object.values(apiMethods).forEach((method) => method.mockReset());
    roomQuery.mockReturnValue({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })) });
    listPatients.mockResolvedValue([patient('duplicate-sim', 84), patient('canonical-ed28', 84)]);
  });

  it.each([
    ['duplicate-Sim ED28', '84', 'canonical-ed28'],
    ['shared-patient OB stage', '205', 'canonical-ob'],
  ])('keeps one bounded canonical read and an editable MAR for %s', async (_label, roomId, canonicalId) => {
    const canonical = patient(canonicalId, Number(roomId));
    getPatientByRoomId.mockResolvedValue(canonical);
    renderDashboard(`/admin/emr?roomId=${roomId}`);

    await waitFor(() => expect(screen.getByTestId('editable-mar')).toHaveTextContent(`Editable MAR:${canonicalId}`));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getPatientByRoomId).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('editable-mar')).toHaveTextContent(`Editable MAR:${canonicalId}`);
  });

  it('fails closed when an explicit patient does not match the canonical room patient', async () => {
    getPatientByRoomId.mockResolvedValue(patient('canonical-ed28', 84));
    renderDashboard('/admin/emr?roomId=84&patientId=duplicate-sim');

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/does not match the room’s canonical patient binding/));
    expect(screen.queryByTestId('editable-mar')).not.toBeInTheDocument();
  });

  it('does not let a deferred broad list overwrite canonical ED28 identity', async () => {
    let resolveList!: (value: Patient[]) => void;
    listPatients.mockReturnValue(new Promise<Patient[]>((resolve) => { resolveList = resolve; }));
    const canonical = patient('canonical-ed28', 84);
    getPatientByRoomId.mockResolvedValue(canonical);

    renderDashboard('/admin/emr?roomId=84&patientId=canonical-ed28');
    await waitFor(() => expect(screen.getByTestId('editable-mar')).toHaveTextContent('Editable MAR:canonical-ed28'));
    resolveList([patient('duplicate-sim', 84), canonical]);

    await waitFor(() => expect(screen.getByTestId('patient-sidebar')).toHaveTextContent('canonical-ed28:duplicate-sim,canonical-ed28'));
    expect(screen.getByRole('heading', { name: 'Patient, Sim' })).toBeInTheDocument();
    expect(screen.getByText('Room 84')).toBeInTheDocument();
    expect(screen.getByTestId('editable-mar')).toHaveTextContent('Editable MAR:canonical-ed28');
  });

  it('keeps a deferred broad list fail-closed after a canonical mismatch', async () => {
    let resolveList!: (value: Patient[]) => void;
    listPatients.mockReturnValue(new Promise<Patient[]>((resolve) => { resolveList = resolve; }));
    getPatientByRoomId.mockResolvedValue(patient('canonical-ed28', 84));

    renderDashboard('/admin/emr?roomId=84&patientId=duplicate-sim');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/does not match the room’s canonical patient binding/));
    resolveList([patient('duplicate-sim', 84), patient('canonical-ed28', 84)]);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId('editable-mar')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/does not match the room’s canonical patient binding/);
  });

  it('cancels a stale room response during rapid route switching', async () => {
    let resolve84!: (value: Patient) => void;
    let resolve205!: (value: Patient) => void;
    getPatientByRoomId.mockImplementation((roomId: number) => new Promise<Patient>((resolve) => {
      if (roomId === 84) resolve84 = resolve;
      else resolve205 = resolve;
    }));
    renderDashboard('/admin/emr?roomId=84');
    fireEvent.click(screen.getByRole('button', { name: 'switch room' }));
    resolve84(patient('stale-ed28', 84));
    resolve205(patient('canonical-ob', 205));

    await waitFor(() => expect(screen.getByTestId('editable-mar')).toHaveTextContent('Editable MAR:canonical-ob'));
    expect(screen.getByTestId('editable-mar')).not.toHaveTextContent('stale-ed28');
    expect(getPatientByRoomId).toHaveBeenCalledTimes(2);
  });
});

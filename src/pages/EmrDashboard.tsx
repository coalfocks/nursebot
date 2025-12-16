import { useEffect, useMemo, useState } from 'react';
import { Activity, FileText, TestTube, Pill, Calendar, User, Droplets, Plus, Edit } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type {
  LabResult,
  Patient,
  CustomOverviewSection,
  VitalSigns,
  IntakeOutput,
  MedicalOrder,
} from '../features/emr/lib/types';
import { emrApi } from '../features/emr/lib/api';
import { PatientSidebar } from '../features/emr/components/PatientSidebar';
import { ClinicalNotes } from '../features/emr/components/ClinicalNotes';
import { LabResults } from '../features/emr/components/LabResults';
import { VitalSignsComponent } from '../features/emr/components/VitalSigns';
import { OrdersManagement } from '../features/emr/components/OrdersManagement';
import { Card, CardContent, CardHeader, CardTitle } from '../features/emr/components/ui/Card';
import { Button } from '../features/emr/components/ui/Button';
import { Badge } from '../features/emr/components/ui/Badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../features/emr/components/ui/Tabs';
import Navbar from '../components/Navbar';
import AdminLayout from '../components/admin/AdminLayout';
import { useAuthStore } from '../stores/authStore';
import { hasAdminAccess, isSuperAdmin } from '../lib/roles';
import { supabase } from '../lib/supabase';

export default function EmrDashboard() {
  const { profile, user } = useAuthStore();
  const [searchParams] = useSearchParams();
  const showAdminLayout = useMemo(() => hasAdminAccess(profile), [profile]);
  const assignmentId = searchParams.get('assignmentId') || undefined;
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [sandboxLabs, setSandboxLabs] = useState<LabResult[]>([]);
  const [medicationOrders, setMedicationOrders] = useState<MedicalOrder[]>([]);
  const [labsRefreshToken, setLabsRefreshToken] = useState(0);
  const [isEditingCustomSections, setIsEditingCustomSections] = useState(false);
  const [customSectionDraft, setCustomSectionDraft] = useState<CustomOverviewSection[]>([]);
  const [customImageHeights, setCustomImageHeights] = useState<Record<string, number>>({});
  const [overviewVitals, setOverviewVitals] = useState<VitalSigns | null>(null);
  const [showVitalsModal, setShowVitalsModal] = useState(false);
  const [vitalsForm, setVitalsForm] = useState<Partial<VitalSigns>>({});
  const [activeTab, setActiveTab] = useState('overview');
  const [derivedAssignmentId, setDerivedAssignmentId] = useState<string | undefined>(undefined);
  const forceBaseline = isSuperAdmin(profile);
  const effectiveAssignmentId = forceBaseline ? undefined : assignmentId ?? derivedAssignmentId;
  const [showMedModal, setShowMedModal] = useState(false);
  const [medForm, setMedForm] = useState({
    name: '',
    dose: '',
    route: '',
    frequency: '',
    priority: 'Routine' as 'Routine' | 'STAT' | 'Timed',
  });
  const [ioModalOpen, setIoModalOpen] = useState(false);
  const [ioForm, setIoForm] = useState<IntakeOutput>({
    intake: { iv: '', oral: '', other: '' },
    output: { urine: '', stool: '', other: '' },
    notes: '',
  });
  // Disable sandbox mode - everyone should fetch from database
  // Superadmins see baseline scope, students see baseline + room + assignment scope
  const isSandbox = false;
  const [sandboxLabForm, setSandboxLabForm] = useState({
    testName: '',
    value: '',
    unit: '',
    referenceRange: '',
    status: 'Normal',
  });
  const [isSavingSandboxLab, setIsSavingSandboxLab] = useState(false);
  const [baselineEditForm, setBaselineEditForm] = useState({
    firstName: '',
    lastName: '',
    mrn: '',
    roomNumber: '',
  });
  const [roomMeta, setRoomMeta] = useState<{ id?: number; room_number?: string } | null>(null);

  useEffect(() => {
    void (async () => {
      if (!user) return;
      if (hasAdminAccess(profile)) {
        const data = await emrApi.listPatients();
        if (data.length) {
          setPatients(data);
          setSelectedPatient(data[0]);
        }
        return;
      }

      const data = await emrApi.listPatientsForStudent(user.id);
      setPatients(data);
      if (data.length) {
        setSelectedPatient(data[0]);
      } else {
        setSelectedPatient(null);
      }
    })();
  }, [profile, user]);

  useEffect(() => {
    const patientIdParam = searchParams.get('patientId');
    const roomIdParam = searchParams.get('roomId');
    if (patients.length) {
      const matchingPatient =
        patients.find(
          (p) =>
            (patientIdParam && p.id === patientIdParam) ||
            (roomIdParam && p.roomId && String(p.roomId) === roomIdParam),
        ) || null;

      if (matchingPatient) {
        setSelectedPatient(matchingPatient);
        return;
      }
    }

    if (roomIdParam) {
      void (async () => {
        const patient = await emrApi.getPatientByRoomId(Number.parseInt(roomIdParam, 10));
        if (patient) {
          setPatients((prev) => {
            if (prev.some((p) => p.id === patient.id)) return prev;
            return [...prev, patient];
          });
          setSelectedPatient(patient);
        }
      })();
    } else if (patientIdParam) {
      void (async () => {
        const patient = await emrApi.getPatient(patientIdParam);
        if (patient) {
          setPatients((prev) => {
            if (prev.some((p) => p.id === patient.id)) return prev;
            return [...prev, patient];
          });
          setSelectedPatient(patient);
          setBaselineEditForm({
            firstName: patient.firstName,
            lastName: patient.lastName,
            mrn: patient.mrn,
            roomNumber: patient.room ?? '',
          });
        }
      })();
    }
  }, [patients, searchParams]);

  useEffect(() => {
    if (!selectedPatient) return;

    void (async () => {
      if (selectedPatient.roomId) {
        const { data } = await supabase
          .from('rooms')
          .select('id, room_number')
          .eq('id', selectedPatient.roomId)
          .maybeSingle();
        if (data) {
          setRoomMeta({ id: data.id, room_number: data.room_number });
          setBaselineEditForm((prev) => ({ ...prev, roomNumber: data.room_number }));
        }
      }
      const orders = await emrApi.listOrders(selectedPatient.id, effectiveAssignmentId, selectedPatient.roomId ?? null);
      const meds = orders.filter((order) => order.category === 'Medication');
      setMedicationOrders(meds);
      const vitals = await emrApi.listVitals(selectedPatient.id, effectiveAssignmentId, selectedPatient.roomId ?? null);
      if (vitals.length) {
        setOverviewVitals(vitals[0]);
        setVitalsForm({
          temperature: vitals[0].temperature,
          bloodPressureSystolic: vitals[0].bloodPressureSystolic,
          bloodPressureDiastolic: vitals[0].bloodPressureDiastolic,
          heartRate: vitals[0].heartRate,
          respiratoryRate: vitals[0].respiratoryRate,
          oxygenSaturation: vitals[0].oxygenSaturation,
          pain: vitals[0].pain,
        });
      } else {
        setOverviewVitals(null);
        setVitalsForm({});
      }
    })();
  }, [selectedPatient, effectiveAssignmentId]);

  useEffect(() => {
    if (!selectedPatient || !user || forceBaseline) {
      setDerivedAssignmentId(undefined);
      return;
    }
    const fetchAssignmentForPatient = async () => {
      if (!selectedPatient.roomId) {
        setDerivedAssignmentId(undefined);
        return;
      }
      const { data, error } = await supabase
        .from('student_room_assignments')
        .select('id')
        .eq('student_id', user.id)
        .eq('room_id', selectedPatient.roomId)
        .in('status', ['assigned', 'in_progress']);
      if (error) {
        console.error('Failed to fetch assignment for patient', error);
        setDerivedAssignmentId(undefined);
        return;
      }
      setDerivedAssignmentId(data?.[0]?.id ?? undefined);
    };
    void fetchAssignmentForPatient();
  }, [selectedPatient, user, forceBaseline]);

  const startEditCustomSections = () => {
    if (!selectedPatient) return;
    setCustomSectionDraft(
      selectedPatient.customOverviewSections?.map((section) => ({ ...section })) ?? [],
    );
    setIsEditingCustomSections(true);
  };

  const handleSaveCustomSections = async () => {
    if (!selectedPatient) return;
    const filtered = customSectionDraft
      .map((section) => ({
        ...section,
        id: section.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
        title: section.title.trim(),
        content: section.content.trim(),
      }))
      .filter((section) => section.title && section.content);

    const updated = await emrApi.updatePatientCustomSections(selectedPatient.id, filtered);
    if (updated) {
      setSelectedPatient({ ...selectedPatient, customOverviewSections: updated });
      setPatients((prev) =>
        prev.map((p) => (p.id === selectedPatient.id ? { ...p, customOverviewSections: updated } : p)),
      );
    }
    setIsEditingCustomSections(false);
  };

  const handleSaveVitals = async () => {
    if (!selectedPatient) return;
    const roomIdForScope =
      !forceBaseline && typeof selectedPatient.roomId === 'number' ? selectedPatient.roomId : null;
    const basePayload: VitalSigns = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      patientId: selectedPatient.id,
      assignmentId: forceBaseline ? null : assignmentId ?? null,
      roomId: forceBaseline ? null : roomIdForScope,
      overrideScope: forceBaseline ? 'baseline' : undefined,
      timestamp: new Date().toISOString(),
      temperature: vitalsForm.temperature ? Number(vitalsForm.temperature) : undefined,
      bloodPressureSystolic: vitalsForm.bloodPressureSystolic ? Number(vitalsForm.bloodPressureSystolic) : undefined,
      bloodPressureDiastolic: vitalsForm.bloodPressureDiastolic ? Number(vitalsForm.bloodPressureDiastolic) : undefined,
      heartRate: vitalsForm.heartRate ? Number(vitalsForm.heartRate) : undefined,
      respiratoryRate: vitalsForm.respiratoryRate ? Number(vitalsForm.respiratoryRate) : undefined,
      oxygenSaturation: vitalsForm.oxygenSaturation ? Number(vitalsForm.oxygenSaturation) : undefined,
      pain: vitalsForm.pain ? Number(vitalsForm.pain) : undefined,
    };
    await emrApi.addVitals([basePayload], forceBaseline ? null : roomIdForScope);
    const vitals = await emrApi.listVitals(selectedPatient.id, effectiveAssignmentId, roomIdForScope);
    if (vitals.length) {
      setOverviewVitals(vitals[0]);
      setVitalsForm({
        temperature: vitals[0].temperature,
        bloodPressureSystolic: vitals[0].bloodPressureSystolic,
        bloodPressureDiastolic: vitals[0].bloodPressureDiastolic,
        heartRate: vitals[0].heartRate,
        respiratoryRate: vitals[0].respiratoryRate,
        oxygenSaturation: vitals[0].oxygenSaturation,
        pain: vitals[0].pain,
      });
    }
    setShowVitalsModal(false);
  };

  const content = selectedPatient ? (
    <div className="medical-grid" style={{ minHeight: showAdminLayout ? 'calc(100vh - 64px)' : undefined }}>
      <PatientSidebar selectedPatient={selectedPatient} onPatientSelect={setSelectedPatient} patients={patients} />

      <div className="main-content">
        {/* Patient Header */}
        <div className="bg-card border-b border-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {selectedPatient.lastName}, {selectedPatient.firstName}
              </h1>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                <span>MRN: {selectedPatient.mrn}</span>
                <span>DOB: {new Date(selectedPatient.dateOfBirth).toLocaleDateString()}</span>
                <span>{selectedPatient.gender}</span>
                <span>Room {selectedPatient.room}</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Attending: {selectedPatient.attendingPhysician}</p>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-4">
            <Badge variant={selectedPatient.codeStatus === 'Full Code' ? 'default' : 'destructive'}>
              {selectedPatient.codeStatus}
            </Badge>
            <div className="text-sm">
              <span className="text-muted-foreground">Allergies: </span>
              <span className="font-medium">{selectedPatient.allergies.join(', ')}</span>
            </div>
          </div>
        </div>

        {/* Main Content Tabs */}
        <div className="p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="overview" className="flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="vitals" className="flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Vitals
              </TabsTrigger>
              <TabsTrigger value="notes" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Notes
              </TabsTrigger>
              <TabsTrigger value="labs" className="flex items-center gap-2">
                <TestTube className="h-4 w-4" />
                Labs
              </TabsTrigger>
              <TabsTrigger value="imaging" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Imaging
              </TabsTrigger>
              <TabsTrigger value="orders" className="flex items-center gap-2">
                <Pill className="h-4 w-4" />
                Orders
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-semibold">Overview</h2>
                  {isSuperAdmin(profile) && (
                    <Button
                      size="sm"
                      variant={isEditingCustomSections ? 'secondary' : 'outline'}
                      onClick={startEditCustomSections}
                      className="flex items-center gap-2"
                    >
                      {isEditingCustomSections ? (
                        <>
                          <Edit className="h-4 w-4" />
                          Editing sections
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4" />
                          Add custom section
                        </>
                      )}
                    </Button>
                  )}
                </div>
                {isEditingCustomSections && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setIsEditingCustomSections(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveCustomSections}>
                      Save sections
                    </Button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="h-5 w-5" />
                      Recent Vitals
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Temperature</span>
                        <span className="text-sm font-medium">
                          {overviewVitals?.temperature ? `${((overviewVitals.temperature - 32) * 5 / 9).toFixed(1)}°C` : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Blood Pressure</span>
                        <span className="text-sm font-medium">
                          {overviewVitals?.bloodPressureSystolic ?? '—'}/{overviewVitals?.bloodPressureDiastolic ?? '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Heart Rate</span>
                        <span className="text-sm font-medium">
                          {overviewVitals?.heartRate ?? '—'} bpm
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">O2 Sat</span>
                        <span className="text-sm font-medium">
                          {overviewVitals?.oxygenSaturation ?? '—'}%
                        </span>
                      </div>
                    </div>
                    {isSuperAdmin(profile) && (
                      <Button size="sm" className="mt-3" variant="outline" onClick={() => setShowVitalsModal(true)}>
                        Edit vitals
                      </Button>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Droplets className="h-5 w-5" />
                      Intake & Output
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <h4 className="text-sm font-semibold text-muted-foreground mb-2">Intake</h4>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">IV Fluids</span>
                            <span className="text-sm font-medium">{selectedPatient.intakeOutput?.intake?.iv || '—'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Oral Fluids</span>
                            <span className="text-sm font-medium">{selectedPatient.intakeOutput?.intake?.oral || '—'}</span>
                          </div>
                          {selectedPatient.intakeOutput?.intake?.other && (
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Other</span>
                              <span className="text-sm font-medium">{selectedPatient.intakeOutput?.intake?.other}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-muted-foreground mb-2">Output</h4>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Urine</span>
                            <span className="text-sm font-medium">{selectedPatient.intakeOutput?.output?.urine || '—'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Stool</span>
                            <span className="text-sm font-medium">{selectedPatient.intakeOutput?.output?.stool || '—'}</span>
                          </div>
                          {selectedPatient.intakeOutput?.output?.other && (
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Other</span>
                              <span className="text-sm font-medium">{selectedPatient.intakeOutput?.output?.other}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      {selectedPatient.intakeOutput?.notes && (
                        <div>
                          <h4 className="text-sm font-semibold text-muted-foreground mb-2">Notes</h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                            {selectedPatient.intakeOutput?.notes}
                          </p>
                        </div>
                      )}
                    </div>
                    {isSuperAdmin(profile) && (
                      <Button size="sm" className="mt-3" variant="outline" onClick={() => {
                        setIoForm(selectedPatient.intakeOutput ?? { intake: { iv: '', oral: '', other: '' }, output: { urine: '', stool: '', other: '' }, notes: '' });
                        setIoModalOpen(true);
                      }}>
                        Edit intake/output
                      </Button>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Pill className="h-5 w-5" />
                      Active Medications
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {medicationOrders.length ? (
                      <div className="space-y-3">
                        {medicationOrders.map((order) => (
                          <div key={order.id} className="text-sm">
                            <div className="font-medium">{order.orderName}</div>
                            <div className="text-muted-foreground">
                              {[order.dose, order.route, order.frequency].filter(Boolean).join(' • ') || 'Medication'}
                            </div>
                          </div>
                        ))}
                        {isSuperAdmin(profile) && (
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => setActiveTab('orders')}>
                              Manage orders
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setShowMedModal(true)}>
                              Add medication
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No active medications recorded.</p>
                    )}
                  </CardContent>
                </Card>

              {activeTab === 'overview' &&
                selectedPatient.customOverviewSections?.map((section) => (
                    <Card key={section.id}>
                      <CardHeader>
                        <CardTitle>{section.title}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {section.type === 'image' ? (
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-full flex justify-center">
                              <img
                                src={section.content}
                                alt={section.title}
                                className="w-full object-contain rounded border border-border"
                                style={{ maxHeight: `${customImageHeights[section.id] ?? 320}px` }}
                              />
                            </div>
                            <div className="flex items-center gap-3 w-full text-xs text-muted-foreground">
                              <span className="whitespace-nowrap">Image size</span>
                              <input
                                type="range"
                                min={200}
                                max={900}
                                step={50}
                                value={customImageHeights[section.id] ?? 320}
                                onChange={(e) =>
                                  setCustomImageHeights((prev) => ({
                                    ...prev,
                                    [section.id]: Number(e.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                              <span className="tabular-nums">{customImageHeights[section.id] ?? 320}px</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{section.content}</p>
                        )}
                      </CardContent>
                    </Card>
                ))}
              {activeTab === 'overview' && isSuperAdmin(profile) && (
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">Sandbox Builder (Baseline)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-muted-foreground">Edit patient baseline</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <input
                            className="rounded-md border border-border px-3 py-2 text-sm"
                            placeholder="First name"
                            value={baselineEditForm.firstName}
                            onChange={(e) => setBaselineEditForm((prev) => ({ ...prev, firstName: e.target.value }))}
                          />
                          <input
                            className="rounded-md border border-border px-3 py-2 text-sm"
                            placeholder="Last name"
                            value={baselineEditForm.lastName}
                            onChange={(e) => setBaselineEditForm((prev) => ({ ...prev, lastName: e.target.value }))}
                          />
                          <input
                            className="rounded-md border border-border px-3 py-2 text-sm"
                            placeholder="MRN"
                            value={baselineEditForm.mrn}
                            onChange={(e) => setBaselineEditForm((prev) => ({ ...prev, mrn: e.target.value }))}
                          />
                          <input
                            className="rounded-md border border-border px-3 py-2 text-sm"
                            placeholder="Room number"
                            value={baselineEditForm.roomNumber}
                            onChange={(e) => setBaselineEditForm((prev) => ({ ...prev, roomNumber: e.target.value }))}
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            if (!selectedPatient) return;
                            const updated = await emrApi.updatePatient(selectedPatient.id, {
                              firstName: baselineEditForm.firstName || selectedPatient.firstName,
                              lastName: baselineEditForm.lastName || selectedPatient.lastName,
                              mrn: baselineEditForm.mrn || selectedPatient.mrn,
                            });
                            if (roomMeta?.id && baselineEditForm.roomNumber) {
                              await emrApi.updateRoom(roomMeta.id, { room_number: baselineEditForm.roomNumber });
                            }
                            if (updated) {
                              setSelectedPatient({
                                ...selectedPatient,
                                ...updated,
                                room: baselineEditForm.roomNumber || selectedPatient.room,
                              });
                              setPatients((prev) =>
                                prev.map((p) =>
                                  p.id === selectedPatient.id
                                    ? { ...p, ...updated, room: baselineEditForm.roomNumber || p.room }
                                    : p,
                                ),
                              );
                            }
                          }}
                        >
                          Save baseline
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-muted-foreground">Add lab (baseline)</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <input
                            className="rounded-md border border-border px-3 py-2 text-sm"
                            placeholder="Lab name"
                            value={sandboxLabForm.testName}
                            onChange={(e) => setSandboxLabForm((prev) => ({ ...prev, testName: e.target.value }))}
                          />
                          <input
                            className="rounded-md border border-border px-3 py-2 text-sm"
                            placeholder="Value (optional)"
                            value={sandboxLabForm.value}
                            onChange={(e) => setSandboxLabForm((prev) => ({ ...prev, value: e.target.value }))}
                          />
                          <input
                            className="rounded-md border border-border px-3 py-2 text-sm"
                            placeholder="Unit"
                            value={sandboxLabForm.unit}
                            onChange={(e) => setSandboxLabForm((prev) => ({ ...prev, unit: e.target.value }))}
                          />
                          <input
                            className="rounded-md border border-border px-3 py-2 text-sm"
                            placeholder="Reference range"
                            value={sandboxLabForm.referenceRange}
                            onChange={(e) => setSandboxLabForm((prev) => ({ ...prev, referenceRange: e.target.value }))}
                          />
                          <input
                            className="rounded-md border border-border px-3 py-2 text-sm"
                            placeholder="Status"
                            value={sandboxLabForm.status}
                            onChange={(e) => setSandboxLabForm((prev) => ({ ...prev, status: e.target.value }))}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            disabled={isSavingSandboxLab || !sandboxLabForm.testName.trim()}
                            onClick={async () => {
                              if (!selectedPatient || !sandboxLabForm.testName.trim()) return;
                              setIsSavingSandboxLab(true);
                              try {
                                const labsWithAssignment = [
                                  {
                                    id: `manual-${Date.now()}`,
                                    patientId: selectedPatient.id,
                                    assignmentId: null,
                                    roomId: selectedPatient.roomId ?? null,
                                    overrideScope: 'baseline' as const,
                                    testName: sandboxLabForm.testName.trim(),
                                    value: sandboxLabForm.value || '',
                                    unit: sandboxLabForm.unit,
                                    referenceRange: sandboxLabForm.referenceRange,
                                    status: (sandboxLabForm.status as LabResult['status']) || 'Normal',
                                    collectionTime: new Date().toISOString(),
                                    resultTime: new Date().toISOString(),
                                    orderedBy: selectedPatient.attendingPhysician || 'Super Admin',
                                  },
                                ];
                                await emrApi.addLabResults(labsWithAssignment, selectedPatient.roomId ?? null);
                                setLabsRefreshToken((t) => t + 1);
                                setSandboxLabForm({
                                  testName: '',
                                  value: '',
                                  unit: '',
                                  referenceRange: '',
                                  status: 'Normal',
                                });
                              } catch (err) {
                                console.error('Failed to add manual lab', err);
                              } finally {
                                setIsSavingSandboxLab(false);
                              }
                            }}
                          >
                            Add lab (manual)
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isSavingSandboxLab || !sandboxLabForm.testName.trim()}
                            onClick={async () => {
                              if (!selectedPatient || !sandboxLabForm.testName.trim()) return;
                              setIsSavingSandboxLab(true);
                              try {
                                const [contextLabs, clinicalNotes, vitals, orders] = await Promise.all([
                                  emrApi.listLabResults(selectedPatient.id, null, selectedPatient.roomId ?? null),
                                  emrApi.listClinicalNotes(selectedPatient.id, null, selectedPatient.roomId ?? null),
                                  emrApi.listVitals(selectedPatient.id, null, selectedPatient.roomId ?? null),
                                  emrApi.listOrders(selectedPatient.id, null, selectedPatient.roomId ?? null),
                                ]);
                                const tests = resolveLabTemplates(sandboxLabForm.testName.trim());
                                const aiResponse = await supabase.functions.invoke('lab-results', {
                                  body: {
                                    orderName: sandboxLabForm.testName.trim(),
                                    priority: 'STAT',
                                    tests: tests.map((t) => ({
                                      testName: t.testName,
                                      unit: t.unit,
                                      referenceRange: t.referenceRange,
                                    })),
                                    context: {
                                      patient: {
                                        firstName: selectedPatient.firstName,
                                        lastName: selectedPatient.lastName,
                                        dateOfBirth: selectedPatient.dateOfBirth,
                                        gender: selectedPatient.gender,
                                        mrn: selectedPatient.mrn,
                                        allergies: selectedPatient.allergies,
                                        codeStatus: selectedPatient.codeStatus,
                                        attendingPhysician: selectedPatient.attendingPhysician,
                                        service: selectedPatient.service,
                                      },
                                      room: {
                                        id: selectedPatient.roomId,
                                        number: selectedPatient.room,
                                      },
                                      assignmentId: null,
                                      clinicalNotes,
                                      vitals,
                                      previousLabs: contextLabs,
                                      orders,
                                      emrContext: null,
                                      nurseContext: null,
                                    },
                                  },
                                });
                                const aiLabs = Array.isArray((aiResponse.data as { labs?: unknown })?.labs)
                                  ? ((aiResponse.data as { labs: unknown }).labs as LabResult[])
                                  : null;
                                const generatedLabs =
                                  aiLabs?.length
                                    ? aiLabs
                                    : await generateLabResults(selectedPatient.id, sandboxLabForm.testName.trim(), {
                                        patient: selectedPatient,
                                        assignmentId: null,
                                        roomId: selectedPatient.roomId ?? null,
                                        orderName: sandboxLabForm.testName.trim(),
                                        previousLabs: contextLabs,
                                        clinicalNotes,
                                        vitals,
                                      });
                                const labsWithAssignment = generatedLabs.map((lab, index) => ({
                                  id: (lab as { id?: string }).id ?? `manual-ai-${Date.now()}-${index}`,
                                  patientId: selectedPatient.id,
                                  assignmentId: null,
                                  roomId: selectedPatient.roomId ?? null,
                                  overrideScope: 'baseline' as const,
                                  testName: (lab as { testName?: string }).testName ?? tests[index]?.testName ?? 'Lab',
                                  value: (lab as { value?: string | number }).value ?? '',
                                  unit: (lab as { unit?: string }).unit ?? tests[index]?.unit ?? '',
                                  referenceRange:
                                    (lab as { referenceRange?: string }).referenceRange ??
                                    tests[index]?.referenceRange ??
                                    '',
                                  status: (lab as { status?: LabResult['status'] }).status ?? 'Normal',
                                  collectionTime: (lab as { collectionTime?: string }).collectionTime ?? new Date().toISOString(),
                                  resultTime: (lab as { resultTime?: string }).resultTime ?? new Date().toISOString(),
                                  orderedBy: selectedPatient.attendingPhysician || 'Super Admin',
                                }));
                                await emrApi.addLabResults(labsWithAssignment, selectedPatient.roomId ?? null);
                                setLabsRefreshToken((t) => t + 1);
                                setSandboxLabForm({
                                  testName: '',
                                  value: '',
                                  unit: '',
                                  referenceRange: '',
                                  status: 'Normal',
                                });
                              } catch (err) {
                                console.error('Failed to generate AI lab', err);
                              } finally {
                                setIsSavingSandboxLab(false);
                              }
                            }}
                          >
                            {isSavingSandboxLab ? 'Generating…' : 'Generate via AI'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              </div>
            </TabsContent>

            <TabsContent value="vitals">
              <VitalSignsComponent patient={selectedPatient} assignmentId={effectiveAssignmentId} />
            </TabsContent>

            <TabsContent value="notes">
              <ClinicalNotes patient={selectedPatient} assignmentId={effectiveAssignmentId} forceBaseline={forceBaseline} />
            </TabsContent>

            <TabsContent value="labs">
              <LabResults
                patient={selectedPatient}
                assignmentId={effectiveAssignmentId}
                isSandbox={isSandbox}
                sandboxLabs={sandboxLabs}
                refreshToken={labsRefreshToken}
                onSandboxLabsChange={setSandboxLabs}
              />
            </TabsContent>

            <TabsContent value="imaging">
              <Card>
                <CardHeader>
                  <CardTitle>Imaging Studies</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">Imaging results will appear here...</p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="orders">
              <OrdersManagement
                patient={selectedPatient}
                assignmentId={effectiveAssignmentId}
                forceBaseline={forceBaseline}
                onOrderAdded={() => setLabsRefreshToken((token) => token + 1)}
                onLabsGenerated={() => setLabsRefreshToken((token) => token + 1)}
              />
            </TabsContent>

            {isEditingCustomSections && (
              <div className="mt-6 space-y-4">
                <h3 className="text-lg font-semibold">Custom Overview Sections</h3>
                <div className="space-y-3">
                  {customSectionDraft.map((section, index) => (
                    <Card key={section.id || index}>
                      <CardContent className="space-y-3 pt-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium text-muted-foreground">Title</label>
                            <input
                              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                              value={section.title}
                              onChange={(e) =>
                                setCustomSectionDraft((prev) =>
                                  prev.map((s, i) => (i === index ? { ...s, title: e.target.value } : s)),
                                )
                              }
                              placeholder="Fetal Tracing"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-muted-foreground">Type</label>
                            <select
                              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                              value={section.type}
                              onChange={(e) =>
                                setCustomSectionDraft((prev) =>
                                  prev.map((s, i) => (i === index ? { ...s, type: e.target.value as 'text' | 'image' } : s)),
                                )
                              }
                            >
                              <option value="text">Text</option>
                              <option value="image">Image</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-muted-foreground">
                            {section.type === 'image' ? 'Image URL' : 'Content'}
                          </label>
                          {section.type === 'image' ? (
                            <input
                              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                              value={section.content}
                              onChange={(e) =>
                                setCustomSectionDraft((prev) =>
                                  prev.map((s, i) => (i === index ? { ...s, content: e.target.value } : s)),
                                )
                              }
                              placeholder="https://example.com/image.png"
                            />
                          ) : (
                            <textarea
                              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                              rows={3}
                              value={section.content}
                              onChange={(e) =>
                                setCustomSectionDraft((prev) =>
                                  prev.map((s, i) => (i === index ? { ...s, content: e.target.value } : s)),
                                )
                              }
                              placeholder="Describe monitoring instructions or findings..."
                            />
                          )}
                        </div>
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              setCustomSectionDraft((prev) => prev.filter((_, i) => i !== index))
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  <Button
                    variant="outline"
                    className="flex items-center gap-2"
                    onClick={() =>
                      setCustomSectionDraft((prev) => [
                        ...prev,
                        {
                          id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
                          title: '',
                          type: 'text',
                          content: '',
                        },
                      ])
                    }
                  >
                    <Plus className="h-4 w-4" />
                    Add section
                  </Button>
                </div>
              </div>
            )}
          </Tabs>
        </div>
      </div>
    </div>
  ) : (
    <div className="medical-grid" style={{ minHeight: showAdminLayout ? 'calc(100vh - 64px)' : undefined }}>
      <PatientSidebar selectedPatient={selectedPatient} onPatientSelect={setSelectedPatient} patients={patients} />
      <div className="main-content flex items-center justify-center">
        <div className="text-center">
          <User className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Select a Patient</h2>
          <p className="text-muted-foreground">Choose a patient from the sidebar to view their medical record</p>
        </div>
      </div>
    </div>
  );

  const adminShell = (
    <AdminLayout>
      <div className="flex-1">{content}</div>
      {showVitalsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold">Edit vitals</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-muted-foreground">
                Temp (°F)
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={vitalsForm.temperature ?? ''}
                  onChange={(e) => setVitalsForm((prev) => ({ ...prev, temperature: e.target.value }))}
                />
              </label>
              <label className="text-sm text-muted-foreground">
                Heart Rate
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={vitalsForm.heartRate ?? ''}
                  onChange={(e) => setVitalsForm((prev) => ({ ...prev, heartRate: e.target.value }))}
                />
              </label>
              <label className="text-sm text-muted-foreground">
                BP Systolic
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={vitalsForm.bloodPressureSystolic ?? ''}
                  onChange={(e) => setVitalsForm((prev) => ({ ...prev, bloodPressureSystolic: e.target.value }))}
                />
              </label>
              <label className="text-sm text-muted-foreground">
                BP Diastolic
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={vitalsForm.bloodPressureDiastolic ?? ''}
                  onChange={(e) => setVitalsForm((prev) => ({ ...prev, bloodPressureDiastolic: e.target.value }))}
                />
              </label>
              <label className="text-sm text-muted-foreground">
                Resp Rate
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={vitalsForm.respiratoryRate ?? ''}
                  onChange={(e) => setVitalsForm((prev) => ({ ...prev, respiratoryRate: e.target.value }))}
                />
              </label>
              <label className="text-sm text-muted-foreground">
                O2 Sat
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={vitalsForm.oxygenSaturation ?? ''}
                  onChange={(e) => setVitalsForm((prev) => ({ ...prev, oxygenSaturation: e.target.value }))}
                />
              </label>
              <label className="text-sm text-muted-foreground">
                Pain
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={vitalsForm.pain ?? ''}
                  onChange={(e) => setVitalsForm((prev) => ({ ...prev, pain: e.target.value }))}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowVitalsModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveVitals}>Save</Button>
            </div>
          </div>
        </div>
      )}
      {ioModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg space-y-4">
            <h3 className="text-lg font-semibold">Edit intake & output</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-2">Intake</h4>
                <label className="text-xs text-muted-foreground">IV Fluids</label>
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={ioForm.intake?.iv ?? ''}
                  onChange={(e) =>
                    setIoForm((prev) => ({
                      ...prev,
                      intake: { ...(prev.intake ?? {}), iv: e.target.value },
                    }))
                  }
                />
                <label className="text-xs text-muted-foreground mt-3 block">Oral Fluids</label>
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={ioForm.intake?.oral ?? ''}
                  onChange={(e) =>
                    setIoForm((prev) => ({
                      ...prev,
                      intake: { ...(prev.intake ?? {}), oral: e.target.value },
                    }))
                  }
                />
                <label className="text-xs text-muted-foreground mt-3 block">Other Intake</label>
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={ioForm.intake?.other ?? ''}
                  onChange={(e) =>
                    setIoForm((prev) => ({
                      ...prev,
                      intake: { ...(prev.intake ?? {}), other: e.target.value },
                    }))
                  }
                />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-2">Output</h4>
                <label className="text-xs text-muted-foreground">Urine</label>
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={ioForm.output?.urine ?? ''}
                  onChange={(e) =>
                    setIoForm((prev) => ({
                      ...prev,
                      output: { ...(prev.output ?? {}), urine: e.target.value },
                    }))
                  }
                />
                <label className="text-xs text-muted-foreground mt-3 block">Stool</label>
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={ioForm.output?.stool ?? ''}
                  onChange={(e) =>
                    setIoForm((prev) => ({
                      ...prev,
                      output: { ...(prev.output ?? {}), stool: e.target.value },
                    }))
                  }
                />
                <label className="text-xs text-muted-foreground mt-3 block">Other Output</label>
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={ioForm.output?.other ?? ''}
                  onChange={(e) =>
                    setIoForm((prev) => ({
                      ...prev,
                      output: { ...(prev.output ?? {}), other: e.target.value },
                    }))
                  }
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <textarea
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                rows={3}
                value={ioForm.notes ?? ''}
                onChange={(e) => setIoForm((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIoModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  const updated = await emrApi.updatePatientIntakeOutput(selectedPatient.id, ioForm);
                  if (updated) {
                    setSelectedPatient({ ...selectedPatient, intakeOutput: updated });
                    setPatients((prev) =>
                      prev.map((p) => (p.id === selectedPatient.id ? { ...p, intakeOutput: updated } : p)),
                    );
                  }
                  setIoModalOpen(false);
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
      {showMedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold">Add medication</h3>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Medication name</label>
              <input
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                value={medForm.name}
                onChange={(e) => setMedForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-muted-foreground">Dose</label>
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={medForm.dose}
                  onChange={(e) => setMedForm((prev) => ({ ...prev, dose: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Route</label>
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={medForm.route}
                  onChange={(e) => setMedForm((prev) => ({ ...prev, route: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Frequency</label>
                <input
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={medForm.frequency}
                  onChange={(e) => setMedForm((prev) => ({ ...prev, frequency: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Priority</label>
                <select
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={medForm.priority}
                  onChange={(e) => setMedForm((prev) => ({ ...prev, priority: e.target.value as 'Routine' | 'STAT' | 'Timed' }))}
                >
                  <option value="Routine">Routine</option>
                  <option value="STAT">STAT</option>
                  <option value="Timed">Timed</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowMedModal(false)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!medForm.name.trim()) return;
                  const newOrder: MedicalOrder = {
                    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
                    patientId: selectedPatient.id,
                    assignmentId: forceBaseline ? null : effectiveAssignmentId,
                    roomId: forceBaseline ? null : selectedPatient.roomId ?? null,
                    overrideScope: forceBaseline ? 'baseline' : 'assignment',
                    category: 'Medication',
                    orderName: medForm.name.trim(),
                    dose: medForm.dose || undefined,
                    route: medForm.route || undefined,
                    frequency: medForm.frequency || undefined,
                    priority: medForm.priority,
                    status: 'Active',
                    orderedBy: selectedPatient.attendingPhysician,
                    orderTime: new Date().toISOString(),
                  };
                  setMedicationOrders((prev) => [newOrder, ...prev]);
                  await emrApi.addOrder(newOrder, forceBaseline ? null : selectedPatient.roomId ?? null);
                  setShowMedModal(false);
                  setMedForm({ name: '', dose: '', route: '', frequency: '', priority: 'Routine' });
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );

  const userShell = (
    <div className="min-h-screen bg-background">
      <Navbar />
      {content}
    </div>
  );

  return showAdminLayout ? adminShell : userShell;
}

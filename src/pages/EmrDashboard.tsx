import { useEffect, useMemo, useState } from 'react';
import { Activity, FileText, TestTube, Pill, Calendar, User } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { Patient } from '../features/emr/lib/types';
import { mockPatients } from '../features/emr/lib/mockData';
import { emrApi } from '../features/emr/lib/api';
import { PatientSidebar } from '../features/emr/components/PatientSidebar';
import { ClinicalNotes } from '../features/emr/components/ClinicalNotes';
import { LabResults } from '../features/emr/components/LabResults';
import { VitalSignsComponent } from '../features/emr/components/VitalSigns';
import { OrdersManagement } from '../features/emr/components/OrdersManagement';
import { Card, CardContent, CardHeader, CardTitle } from '../features/emr/components/ui/Card';
import { Badge } from '../features/emr/components/ui/Badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../features/emr/components/ui/Tabs';
import Navbar from '../components/Navbar';
import AdminLayout from '../components/admin/AdminLayout';
import { useAuthStore } from '../stores/authStore';
import { hasAdminAccess } from '../lib/roles';
import type { RoomOrdersConfig } from '../features/emr/lib/types';

export default function EmrDashboard() {
  const { profile } = useAuthStore();
  const [searchParams] = useSearchParams();
  const showAdminLayout = useMemo(() => hasAdminAccess(profile), [profile]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(mockPatients[0]);
  const [patients, setPatients] = useState<Patient[]>(mockPatients);
  const [ordersConfig, setOrdersConfig] = useState<RoomOrdersConfig | null>(null);
  const [labRefreshToken, setLabRefreshToken] = useState(0);
  const [sandboxLabs, setSandboxLabs] = useState<LabResult[]>([]);
  const assignmentId = searchParams.get('assignmentId') || undefined;
  const isSandbox = !assignmentId;

  useEffect(() => {
    void (async () => {
      const data = await emrApi.listPatients();
      if (data.length) {
        setPatients(data);
        setSelectedPatient(data[0]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!patients.length) return;

    const patientIdParam = searchParams.get('patientId');
    const roomIdParam = searchParams.get('roomId');
    const matchingPatient =
      patients.find((p) => (patientIdParam && p.id === patientIdParam) || (roomIdParam && p.roomId && String(p.roomId) === roomIdParam)) ||
      null;

    if (matchingPatient) {
      setSelectedPatient(matchingPatient);
      return;
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
        }
      })();
    }
  }, [patients, searchParams]);

  useEffect(() => {
    if (!selectedPatient?.roomId) {
      setOrdersConfig(null);
      return;
    }
    void (async () => {
      const config = await emrApi.getRoomOrdersConfig(selectedPatient.roomId as number);
      setOrdersConfig(config);
    })();
  }, [selectedPatient?.roomId]);

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
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="overview" className="flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="notes" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Notes
              </TabsTrigger>
              <TabsTrigger value="labs" className="flex items-center gap-2">
                <TestTube className="h-4 w-4" />
                Labs
              </TabsTrigger>
              <TabsTrigger value="vitals" className="flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Vitals
              </TabsTrigger>
              <TabsTrigger value="orders" className="flex items-center gap-2">
                <Pill className="h-4 w-4" />
                Orders
              </TabsTrigger>
              <TabsTrigger value="imaging" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Imaging
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6">
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
                        <span className="text-sm font-medium">99.1°F</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Blood Pressure</span>
                        <span className="text-sm font-medium">135/88</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Heart Rate</span>
                        <span className="text-sm font-medium">85 bpm</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">O2 Sat</span>
                        <span className="text-sm font-medium">97%</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TestTube className="h-5 w-5" />
                      Recent Labs
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Hemoglobin</span>
                        <span className="text-sm font-medium lab-value-abnormal">8.7 g/dL ↓</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">WBC</span>
                        <span className="text-sm font-medium lab-value-abnormal">12.5 K/uL ↑</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Creatinine</span>
                        <span className="text-sm font-medium lab-value-normal">1.2 mg/dL</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Pill className="h-5 w-5" />
                      Active Orders
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="text-sm">
                        <div className="font-medium">Lisinopril 10mg PO Daily</div>
                        <div className="text-muted-foreground">Routine</div>
                      </div>
                      <div className="text-sm">
                        <div className="font-medium">CBC with Diff</div>
                        <div className="text-muted-foreground">Scheduled for tomorrow AM</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="notes">
              <ClinicalNotes patient={selectedPatient} />
            </TabsContent>

            <TabsContent value="labs">
              <LabResults
                patient={selectedPatient}
                assignmentId={assignmentId}
                refreshToken={labRefreshToken}
                isSandbox={isSandbox}
                sandboxLabs={sandboxLabs}
                onSandboxLabsChange={setSandboxLabs}
              />
            </TabsContent>

            <TabsContent value="vitals">
              <VitalSignsComponent patient={selectedPatient} />
            </TabsContent>

            <TabsContent value="orders">
              <OrdersManagement
                patient={selectedPatient}
                ordersConfig={ordersConfig}
                assignmentId={assignmentId}
                isSandbox={isSandbox}
                onLabResultsUpdated={() => setLabRefreshToken((prev) => prev + 1)}
                onSandboxLabResult={(lab) => setSandboxLabs((prev) => [lab, ...prev])}
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

  return showAdminLayout ? (
    <AdminLayout>
      <div className="flex-1">{content}</div>
    </AdminLayout>
  ) : (
    <div className="min-h-screen bg-background">
      <Navbar />
      {content}
    </div>
  );
}

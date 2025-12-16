import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/Tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Bar,
} from 'recharts';
import { Activity, Heart, Thermometer, Gauge, Droplets, Zap, Sparkles } from 'lucide-react';
import { mockVitals } from '../lib/mockData';
import { generateVitalSigns } from '../lib/aiLabGenerator';
import { emrApi } from '../lib/api';
import type { Patient, VitalSigns } from '../lib/types';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../stores/authStore';
import { isSuperAdmin } from '../../../lib/roles';

interface VitalSignsProps {
  patient: Patient;
  assignmentId?: string;
}

export function VitalSignsComponent({ patient, assignmentId }: VitalSignsProps) {
  const [vitals, setVitals] = useState<VitalSigns[]>(mockVitals);
  const [isGenerating, setIsGenerating] = useState(false);
  const { profile } = useAuthStore();
  const isAdmin = isSuperAdmin(profile);
  const [roomMeta, setRoomMeta] = useState<{
    id?: number | null;
    room_number?: string | null;
    context?: string | null;
    nurse_context?: string | null;
    emr_context?: Record<string, unknown> | string | null;
    expected_diagnosis?: string | null;
    expected_treatment?: string[] | null;
    case_goals?: string | null;
    difficulty_level?: string | null;
    objective?: string | null;
    progress_note?: string | null;
    completion_hint?: string | null;
  } | null>(null);
  const [customRanges, setCustomRanges] = useState<
    Record<
      'temperature' | 'heartRate' | 'bloodPressureSystolic' | 'bloodPressureDiastolic' | 'respiratoryRate' | 'oxygenSaturation',
      { low: string; high: string }
    >
  >({
    temperature: { low: '', high: '' },
    heartRate: { low: '', high: '' },
    bloodPressureSystolic: { low: '', high: '' },
    bloodPressureDiastolic: { low: '', high: '' },
    respiratoryRate: { low: '', high: '' },
    oxygenSaturation: { low: '', high: '' },
  });

  useEffect(() => {
    void (async () => {
      const data = await emrApi.listVitals(patient.id, assignmentId, patient.roomId ?? null);
      if (data.length) {
        setVitals(data);
      }
    })();
  }, [patient.id, patient.roomId, assignmentId]);

  useEffect(() => {
    let isActive = true;
    if (!patient.roomId) {
      setRoomMeta(null);
      return;
    }
    void (async () => {
      const { data, error } = await supabase
        .from('rooms')
        .select(
          'id, room_number, context, nurse_context, emr_context, expected_diagnosis, expected_treatment, case_goals, difficulty_level, objective, progress_note, completion_hint',
        )
        .eq('id', patient.roomId)
        .maybeSingle();
      if (!isActive) return;
      if (error) {
        console.error('Failed to load room context for vitals', error);
        return;
      }
      if (data) {
        let emrContext = data.emr_context ?? null;
        if (typeof emrContext === 'string') {
          try {
            emrContext = JSON.parse(emrContext);
          } catch {
            // leave as string
          }
        }
        setRoomMeta({ ...data, emr_context: emrContext });
      }
    })();
    return () => {
      isActive = false;
    };
  }, [patient.roomId]);

  const handleGenerateVitals = async () => {
    setIsGenerating(true);
    try {
      const [contextVitals, clinicalNotes, labs, orders] = await Promise.all([
        emrApi.listVitals(patient.id, assignmentId, patient.roomId ?? null),
        emrApi.listClinicalNotes(patient.id, assignmentId, patient.roomId ?? null),
        emrApi.listLabResults(patient.id, assignmentId, patient.roomId ?? null),
        emrApi.listOrders(patient.id, assignmentId, patient.roomId ?? null),
      ]);

      const aiResponse = await supabase.functions.invoke('vitals-generator', {
        body: {
          context: {
            patient: {
              firstName: patient.firstName,
              lastName: patient.lastName,
              dateOfBirth: patient.dateOfBirth,
              gender: patient.gender,
              mrn: patient.mrn,
              allergies: patient.allergies,
              codeStatus: patient.codeStatus,
              attendingPhysician: patient.attendingPhysician,
              service: patient.service,
            },
            room: {
              id: patient.roomId,
              number: patient.room,
            },
            assignmentId: assignmentId ?? null,
            emrContext: roomMeta?.emr_context ?? null,
            nurseContext: roomMeta?.nurse_context ?? roomMeta?.context ?? null,
            expectedDiagnosis: roomMeta?.expected_diagnosis ?? null,
            expectedTreatment: roomMeta?.expected_treatment ?? null,
            caseGoals: roomMeta?.case_goals ?? null,
            difficultyLevel: roomMeta?.difficulty_level ?? null,
            objective: roomMeta?.objective ?? null,
            progressNote: roomMeta?.progress_note ?? null,
            completionHint: roomMeta?.completion_hint ?? null,
            clinicalNotes,
            previousVitals: contextVitals,
            previousLabs: labs,
            orders,
          },
          count: 6,
        },
      });

      if (aiResponse.error) {
        throw aiResponse.error;
      }

      const aiVitals = Array.isArray((aiResponse.data as { vitals?: unknown })?.vitals)
        ? ((aiResponse.data as { vitals: unknown }).vitals as VitalSigns[])
        : null;

      const roomIdForScope =
        typeof patient.roomId === 'number' && patient.roomId > 0 ? patient.roomId : null;
      const newVitals = (aiVitals?.length ? aiVitals : await generateVitalSigns(patient.id, 'ai-vitals')).map(
        (vital, index) => ({
          ...vital,
          id: (vital as { id?: string }).id ?? `vital-${Date.now()}-${index}`,
          patientId: patient.id,
          assignmentId: assignmentId ?? null,
          roomId: isAdmin ? null : roomIdForScope,
          overrideScope: isAdmin ? 'baseline' : assignmentId ? 'assignment' : roomIdForScope ? 'room' : 'baseline',
        }),
      );

      const parseRangeValue = (val: string) => {
        if (!val.trim()) return undefined;
        const num = Number(val);
        return Number.isFinite(num) ? num : undefined;
      };

      const clampValue = (value: number | undefined, key: keyof typeof customRanges) => {
        if (value === undefined) return value;
        const low = parseRangeValue(customRanges[key].low);
        const high = parseRangeValue(customRanges[key].high);
        const hasLow = typeof low === 'number';
        const hasHigh = typeof high === 'number';
        if (hasLow && value < low) return low;
        if (hasHigh && value > high) return high;
        return value;
      };

      const rangedVitals = newVitals.map((vital) => ({
        ...vital,
        temperature: clampValue(vital.temperature, 'temperature'),
        heartRate: clampValue(vital.heartRate, 'heartRate'),
        bloodPressureSystolic: clampValue(vital.bloodPressureSystolic, 'bloodPressureSystolic'),
        bloodPressureDiastolic: clampValue(vital.bloodPressureDiastolic, 'bloodPressureDiastolic'),
        respiratoryRate: clampValue(vital.respiratoryRate, 'respiratoryRate'),
        oxygenSaturation: clampValue(vital.oxygenSaturation, 'oxygenSaturation'),
      }));

      setVitals([...rangedVitals, ...vitals]);
      void emrApi.addVitals(rangedVitals, isAdmin ? null : roomIdForScope);
    } catch (error) {
      console.error('Error generating vitals:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const latestVitals = vitals[0];

  // Convert Fahrenheit to Celsius
  const fahrenheitToCelsius = (f: number | undefined) => {
    if (!f) return undefined;
    return Number(((f - 32) * 5 / 9).toFixed(1));
  };

  // Prepare data for trending charts
  const vitalTrends = vitals
    .map((vital) => ({
      time: 'Run',
      temperature: fahrenheitToCelsius(vital.temperature),
      systolic: vital.bloodPressureSystolic,
      diastolic: vital.bloodPressureDiastolic,
      heartRate: vital.heartRate,
      respiratoryRate: vital.respiratoryRate,
      oxygenSaturation: vital.oxygenSaturation,
      pain: vital.pain,
    }))
    .reverse()
    .map((entry, index) => ({ ...entry, time: `Run ${index + 1}` }));

  const getVitalStatus = (vital: string, value: number | undefined) => {
    if (!value) return 'normal';

    switch (vital) {
      case 'temperature':
        // Check in Fahrenheit (stored value), display in Celsius
        return value < 97 || value > 100.4 ? 'abnormal' : 'normal';
      case 'heartRate':
        return value < 60 || value > 100 ? 'abnormal' : 'normal';
      case 'systolic':
        return value < 90 || value > 140 ? 'abnormal' : 'normal';
      case 'diastolic':
        return value < 60 || value > 90 ? 'abnormal' : 'normal';
      case 'respiratoryRate':
        return value < 12 || value > 20 ? 'abnormal' : 'normal';
      case 'oxygenSaturation':
        return value < 95 ? 'abnormal' : 'normal';
      case 'pain':
        return value > 7 ? 'abnormal' : value > 4 ? 'moderate' : 'normal';
      default:
        return 'normal';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'abnormal':
        return 'text-red-600 font-semibold';
      case 'moderate':
        return 'text-yellow-600 font-semibold';
      default:
        return 'text-green-600';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Vital Signs</h2>
          <p className="text-muted-foreground">{latestVitals ? 'Latest vitals' : 'No data'}</p>
        </div>
        {isAdmin && (
          <Button onClick={handleGenerateVitals} disabled={isGenerating} className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {isGenerating ? 'Generating...' : 'Generate AI Vitals'}
          </Button>
        )}
      </div>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Clamp AI vitals (optional)</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            {[
              { key: 'temperature', label: 'Temp (°C)' },
              { key: 'heartRate', label: 'HR' },
              { key: 'bloodPressureSystolic', label: 'BP Systolic' },
              { key: 'bloodPressureDiastolic', label: 'BP Diastolic' },
              { key: 'respiratoryRate', label: 'Resp Rate' },
              { key: 'oxygenSaturation', label: 'O2 Sat' },
            ].map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    placeholder="Low"
                    className="rounded-md border border-border px-2 py-1 text-sm"
                    value={customRanges[key as keyof typeof customRanges].low}
                    onChange={(e) =>
                      setCustomRanges((prev) => ({
                        ...prev,
                        [key]: { ...prev[key as keyof typeof customRanges], low: e.target.value },
                      }))
                    }
                  />
                  <input
                    type="number"
                    placeholder="High"
                    className="rounded-md border border-border px-2 py-1 text-sm"
                    value={customRanges[key as keyof typeof customRanges].high}
                    onChange={(e) =>
                      setCustomRanges((prev) => ({
                        ...prev,
                        [key]: { ...prev[key as keyof typeof customRanges], high: e.target.value },
                      }))
                    }
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Current Vitals Overview */}
      {latestVitals && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Thermometer className="h-4 w-4 text-red-500" />
                <span className="text-sm font-medium">Temp</span>
              </div>
              <div
                className={`text-2xl font-bold ${getStatusColor(getVitalStatus('temperature', latestVitals.temperature))}`}
              >
                {fahrenheitToCelsius(latestVitals.temperature)}°C
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Heart className="h-4 w-4 text-red-500" />
                <span className="text-sm font-medium">HR</span>
              </div>
              <div
                className={`text-2xl font-bold ${getStatusColor(getVitalStatus('heartRate', latestVitals.heartRate))}`}
              >
                {latestVitals.heartRate}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Gauge className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium">BP</span>
              </div>
              <div className="text-lg font-bold">
                <span className={getStatusColor(getVitalStatus('systolic', latestVitals.bloodPressureSystolic))}>
                  {latestVitals.bloodPressureSystolic}
                </span>
                /
                <span className={getStatusColor(getVitalStatus('diastolic', latestVitals.bloodPressureDiastolic))}>
                  {latestVitals.bloodPressureDiastolic}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium">RR</span>
              </div>
              <div
                className={`text-2xl font-bold ${getStatusColor(getVitalStatus('respiratoryRate', latestVitals.respiratoryRate))}`}
              >
                {latestVitals.respiratoryRate}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Droplets className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium">SpO₂</span>
              </div>
              <div
                className={`text-2xl font-bold ${getStatusColor(getVitalStatus('oxygenSaturation', latestVitals.oxygenSaturation))}`}
              >
                {latestVitals.oxygenSaturation}%
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                <span className="text-sm font-medium">Pain</span>
              </div>
              <div className={`text-2xl font-bold ${getStatusColor(getVitalStatus('pain', latestVitals.pain))}`}>
                {latestVitals.pain}/10
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="h-4 w-4 text-purple-500" />
                <span className="text-sm font-medium">Weight</span>
              </div>
              <div className="text-2xl font-bold">{latestVitals.weight || 'N/A'}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="trends" className="w-full">
        <TabsList>
          <TabsTrigger value="trends">Trending Charts</TabsTrigger>
          <TabsTrigger value="table">Data Table</TabsTrigger>
          <TabsTrigger value="flowsheet">Flowsheet View</TabsTrigger>
        </TabsList>

        <TabsContent value="trends" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Heart className="h-4 w-4" />
                  Heart Rate & Blood Pressure
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart data={vitalTrends}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="heartRate" stroke="#ef4444" strokeWidth={2} name="Heart Rate" />
                    <Line type="monotone" dataKey="systolic" stroke="#3b82f6" strokeWidth={2} name="Systolic BP" />
                    <Line type="monotone" dataKey="diastolic" stroke="#06b6d4" strokeWidth={2} name="Diastolic BP" />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Thermometer className="h-4 w-4" />
                  Temperature & Respiratory Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart data={vitalTrends}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="temperature" stroke="#f59e0b" strokeWidth={2} name="Temperature" />
                    <Bar dataKey="respiratoryRate" fill="#10b981" name="Respiratory Rate" />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Droplets className="h-4 w-4" />
                  Oxygen Saturation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={vitalTrends}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis domain={[90, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="oxygenSaturation" stroke="#8b5cf6" strokeWidth={2} name="SpO₂" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Pain Score
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={vitalTrends}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis domain={[0, 10]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="pain" stroke="#f97316" strokeWidth={2} name="Pain Score" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="table" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Vital Signs Data</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date/Time</TableHead>
                      <TableHead>Temp (°C)</TableHead>
                      <TableHead>HR</TableHead>
                      <TableHead>BP</TableHead>
                      <TableHead>RR</TableHead>
                      <TableHead>SpO₂</TableHead>
                      <TableHead>Pain</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vitals.map((vital) => (
                      <TableRow key={vital.id}>
                        <TableCell className="font-medium">{new Date(vital.timestamp).toLocaleString()}</TableCell>
                        <TableCell className={getStatusColor(getVitalStatus('temperature', vital.temperature))}>
                          {fahrenheitToCelsius(vital.temperature)}
                        </TableCell>
                        <TableCell className={getStatusColor(getVitalStatus('heartRate', vital.heartRate))}>
                          {vital.heartRate}
                        </TableCell>
                        <TableCell>
                          <span className={getStatusColor(getVitalStatus('systolic', vital.bloodPressureSystolic))}>
                            {vital.bloodPressureSystolic}
                          </span>
                          /
                          <span className={getStatusColor(getVitalStatus('diastolic', vital.bloodPressureDiastolic))}>
                            {vital.bloodPressureDiastolic}
                          </span>
                        </TableCell>
                        <TableCell className={getStatusColor(getVitalStatus('respiratoryRate', vital.respiratoryRate))}>
                          {vital.respiratoryRate}
                        </TableCell>
                        <TableCell
                          className={getStatusColor(getVitalStatus('oxygenSaturation', vital.oxygenSaturation))}
                        >
                          {vital.oxygenSaturation}%
                        </TableCell>
                        <TableCell className={getStatusColor(getVitalStatus('pain', vital.pain))}>
                          {vital.pain}/10
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="flowsheet" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Flowsheet View</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Flowsheet view similar to Epic EMR coming soon...</p>
                <p className="text-sm">This will display vitals in a time-based grid format</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/Tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TestTube, TrendingUp, Sparkles, Trash2, Edit } from 'lucide-react';
import { generateLabResults, resolveLabTemplates } from '../lib/aiLabGenerator';
import { emrApi } from '../lib/api';
import type { Patient, LabResult } from '../lib/types';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../stores/authStore';
import { isSuperAdmin } from '../../../lib/roles';
import { instantLabs, pendingLabs } from '../lib/labCatalog';

interface LabResultsProps {
  patient: Patient;
  assignmentId?: string;
  refreshToken?: number;
  isSandbox?: boolean;
  sandboxLabs?: LabResult[];
  onSandboxLabsChange?: (labs: LabResult[]) => void;
}

type LabTrendPoint = {
  time: string;
  value: number;
  status: LabResult['status'];
};

export function LabResults({ patient, assignmentId, refreshToken, isSandbox, sandboxLabs, onSandboxLabsChange }: LabResultsProps) {
  const [labResults, setLabResults] = useState<LabResult[]>(sandboxLabs ?? []);
  const [isGenerating, setIsGenerating] = useState(false);
  const { profile } = useAuthStore();
  const canEdit = isSuperAdmin(profile);
  const [aiLabName, setAiLabName] = useState('');
  const [aiLabRequest, setAiLabRequest] = useState('');
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
  const labOptions = useMemo(
    () => [...instantLabs, ...pendingLabs].sort((a, b) => a.localeCompare(b)),
    [],
  );

  useEffect(() => {
    if (isSandbox) {
      setLabResults(sandboxLabs ?? []);
      return;
    }
    void (async () => {
      const data = await emrApi.listLabResults(patient.id, assignmentId, patient.roomId ?? null);
      setLabResults(data);
    })();
  }, [patient.id, patient.roomId, assignmentId, refreshToken, isSandbox, sandboxLabs]);

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
        console.error('Failed to load room context for labs', error);
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
        if (emrContext && typeof emrContext === 'object' && 'admission' in emrContext) {
          const labs = (emrContext as Record<string, unknown>)?.admission as { labs?: LabResult[] } | undefined;
          if (labs?.labs && labs.labs.length) {
            const admissionLabs = labs.labs
              .filter((lab) => lab.testName && lab.value !== undefined)
              .map((lab, idx) => ({
                ...lab,
                id: lab.id ?? `admission-${data.id}-${idx}`,
                patientId: patient.id,
                assignmentId: assignmentId ?? null,
                roomId: patient.roomId ?? null,
                collectionTime: lab.collectionTime ?? new Date().toISOString(),
                resultTime: lab.resultTime ?? new Date().toISOString(),
                orderedBy: lab.orderedBy ?? 'Admission',
                status: lab.status ?? 'Normal',
              }));
            setLabResults((prev) => [...admissionLabs, ...prev]);
          }
        }
      }
    })();
    return () => {
      isActive = false;
    };
  }, [patient.roomId]);

  const handleGenerateLabResults = async () => {
    if (!aiLabName.trim()) return;
    const orderName = aiLabName.trim();
    const requestDetails = aiLabRequest.trim();
    setIsGenerating(true);
    try {
      const [contextLabs, clinicalNotes, vitals, orders] = await Promise.all([
        emrApi.listLabResults(patient.id, assignmentId, patient.roomId ?? null),
        emrApi.listClinicalNotes(patient.id, assignmentId, patient.roomId ?? null),
        emrApi.listVitals(patient.id, assignmentId, patient.roomId ?? null),
        emrApi.listOrders(patient.id, assignmentId, patient.roomId ?? null),
      ]);

      const tests = resolveLabTemplates(orderName);
      const requestedTests = tests.length ? tests : resolveLabTemplates('default');

      const aiResponse = await supabase.functions.invoke('lab-results', {
        body: {
          orderName,
          priority: 'STAT',
          instructions: requestDetails || undefined,
          tests: requestedTests.map((t) => ({
            testName: t.testName,
            unit: t.unit,
            referenceRange: t.referenceRange,
          })),
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
            vitals,
            previousLabs: contextLabs,
            orders,
            userRequest: requestDetails || undefined,
          },
        },
      });

      if (aiResponse.error) {
        throw aiResponse.error;
      }

      const aiLabs = Array.isArray((aiResponse.data as { labs?: unknown })?.labs)
        ? ((aiResponse.data as { labs: unknown }).labs as Array<{
            testName?: string;
            value?: string | number;
            unit?: string;
            referenceRange?: string;
            status?: LabResult['status'];
            collectionTime?: string;
            resultTime?: string;
          }>)
        : null;

      const generatedLabs =
        aiLabs?.length && requestedTests.length
          ? aiLabs
          : await generateLabResults(patient.id, orderName, {
              patient,
              assignmentId: assignmentId ?? null,
              roomId: patient.roomId ?? null,
              orderName: requestDetails ? `${orderName} — ${requestDetails}` : orderName,
              previousLabs: contextLabs,
              clinicalNotes,
              vitals,
            });

      const labsWithAssignment = generatedLabs.map((lab, index) => ({
        id: (lab as { id?: string }).id ?? `lab-${Date.now()}-${index}`,
        patientId: patient.id,
        assignmentId: assignmentId ?? null,
        roomId: patient.roomId ?? null,
        testName: (lab as { testName?: string }).testName ?? requestedTests[index]?.testName ?? 'Lab',
        value: (lab as { value?: string | number }).value ?? '',
        unit: (lab as { unit?: string }).unit ?? requestedTests[index]?.unit ?? '',
        referenceRange:
          (lab as { referenceRange?: string }).referenceRange ?? requestedTests[index]?.referenceRange ?? '',
        status: (lab as { status?: string }).status ?? 'Normal',
        collectionTime: (lab as { collectionTime?: string }).collectionTime ?? new Date().toISOString(),
        resultTime: (lab as { resultTime?: string }).resultTime ?? new Date().toISOString(),
        orderedBy: patient.attendingPhysician ?? 'Attending',
      }));
      setLabResults((prev) => {
        const updated = [...labsWithAssignment, ...prev];
        if (isSandbox) {
          onSandboxLabsChange?.(updated);
        }
        return updated;
      });
      if (!isSandbox) {
        void emrApi.addLabResults(labsWithAssignment, patient.roomId ?? null);
      }
      setAiLabName('');
      setAiLabRequest('');
    } catch (error) {
      console.error('Error generating labs:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Normal':
        return 'text-green-600';
      case 'Abnormal':
        return 'text-yellow-600 font-semibold';
      case 'Critical':
        return 'text-red-600 font-bold';
      default:
        return 'text-gray-500';
    }
  };

  const sortedCollectionTimes = useMemo(() => {
    const uniqueTimes = Array.from(
      new Set(
        labResults
          .map((lab) => lab.collectionTime)
          .filter((time): time is string => Boolean(time)),
      ),
    );
    return uniqueTimes.sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime(),
    );
  }, [labResults]);

  const labsByTest = useMemo(
    () =>
      labResults.reduce<Record<string, Record<string, LabResult>>>((acc, lab) => {
        const time = lab.collectionTime;
        if (!time) return acc;
        if (!acc[lab.testName]) {
          acc[lab.testName] = {};
        }
        acc[lab.testName][time] = lab;
        return acc;
      }, {}),
    [labResults],
  );

  const formatCollectionLabel = (_value: string, index: number) => `Run ${index + 1}`;

  // Group labs by category for trending
  const labTrends = labResults.reduce<Record<string, LabTrendPoint[]>>((acc, lab) => {
    if (lab.status === 'Pending' || !lab.collectionTime) return acc;
    const numericValue =
      typeof lab.value === 'number' ? lab.value : Number.parseFloat(String(lab.value));
    if (Number.isNaN(numericValue)) return acc;
    if (!acc[lab.testName]) {
      acc[lab.testName] = [];
    }
    acc[lab.testName].push({
      time: '',
      value: numericValue,
      status: lab.status,
    });
    return acc;
  }, {});

  const labTrendsWithSequence = Object.fromEntries(
    Object.entries(labTrends).map(([key, data]) => [
      key,
      data.map((entry, index) => ({ ...entry, time: `Run ${index + 1}` })),
    ]),
  );

  const abnormalLabs = useMemo(() => labResults.filter((lab) => lab.status === 'Abnormal'), [labResults]);

  const handleDeleteLab = async (labId: string) => {
    if (!canEdit) return;
    setLabResults((prev) => prev.filter((lab) => lab.id !== labId));
    if (!isSandbox) {
      const { error } = await supabase.from('lab_results').update({ deleted_at: new Date().toISOString() }).eq('id', labId);
      if (error) {
        console.error('Failed to delete lab', error);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Laboratory Results</h2>
            <p className="text-muted-foreground">
              {abnormalLabs.length} Abnormal • {labResults.length} Total
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1.3fr,1fr,auto] gap-3 items-end">
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">Choose a lab to generate</label>
            <div className="flex gap-2">
              <input
                list="lab-options"
                className="w-full rounded-md border border-border px-3 py-2 text-sm"
                placeholder="Start typing a lab name"
                value={aiLabName}
                onChange={(e) => setAiLabName(e.target.value)}
              />
              <datalist id="lab-options">
                {labOptions.map((lab) => (
                  <option key={lab} value={lab} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">AI instructions (optional)</label>
            <textarea
              rows={2}
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              placeholder="E.g., simulate septic shock with rising lactate"
              value={aiLabRequest}
              onChange={(e) => setAiLabRequest(e.target.value)}
            />
          </div>
          <div className="flex justify-end md:justify-start">
            <Button
              onClick={handleGenerateLabResults}
              disabled={isGenerating || !aiLabName.trim()}
              className="flex items-center gap-2 whitespace-nowrap"
            >
              <Sparkles className="h-4 w-4" />
              {isGenerating ? 'Generating...' : 'Generate AI Labs'}
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="results" className="w-full">
        <TabsList>
          <TabsTrigger value="results">Results Grid</TabsTrigger>
          <TabsTrigger value="trends">Trending</TabsTrigger>
        </TabsList>

        <TabsContent value="results" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TestTube className="h-5 w-5" />
                Lab Results
              </CardTitle>
            </CardHeader>
            <CardContent>
              {labResults.length === 0 ? (
                <p className="text-sm text-muted-foreground">No labs yet. Order labs from the Orders tab.</p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Test</TableHead>
                        {sortedCollectionTimes.map((time, idx) => (
                          <TableHead key={time} className="whitespace-nowrap">
                            {formatCollectionLabel(time, idx)}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(labsByTest).map(([testName, resultsByTime]) => (
                        <TableRow key={testName}>
                          <TableCell className="font-medium whitespace-nowrap">{testName}</TableCell>
                          {sortedCollectionTimes.map((time) => {
                            const lab = resultsByTime?.[time];
                            return (
                              <TableCell
                                key={time}
                                className={lab ? getStatusColor(lab.status) : 'text-muted-foreground'}
                              >
                                {lab ? (
                                  <div className="space-y-1">
                                    <div className="font-semibold">
                                      {lab.value}
                                      {lab.unit ? ` ${lab.unit}` : ''}
                                    </div>
                                    <div className="text-xs text-muted-foreground">{lab.referenceRange}</div>
                                    <div className="text-xs text-muted-foreground">{lab.status}</div>
                                    {canEdit && (
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <button
                                          type="button"
                                          className="inline-flex items-center gap-1 text-red-600 hover:text-red-800"
                                          onClick={() => void handleDeleteLab(lab.id)}
                                          title="Delete lab"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                          Delete
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="mt-6">
          {Object.keys(labTrendsWithSequence).length === 0 ? (
            <p className="text-sm text-muted-foreground">No trendable labs yet. Order labs to see trends.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {Object.entries(labTrendsWithSequence)
                .slice(0, 4)
                .map(([testName, data]) => (
                  <Card key={testName}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" />
                        {testName} Trend
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={data}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="time" />
                          <YAxis />
                          <Tooltip />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke="#2563eb"
                            strokeWidth={2}
                            dot={{ fill: '#2563eb', strokeWidth: 2, r: 4 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/Tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TestTube, TrendingUp, Sparkles, Trash2 } from 'lucide-react';
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
  const forceBaseline = isSuperAdmin(profile);
  const [aiLabName, setAiLabName] = useState('');
  const [aiLabRequest, setAiLabRequest] = useState('');
  const [showManualLabModal, setShowManualLabModal] = useState(false);
  const [manualLabForm, setManualLabForm] = useState({
    testName: '',
    value: '',
    unit: '',
    referenceRange: '',
    status: 'Normal' as LabResult['status'],
  });
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
    delivery_note?: string | null;
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
          'id, room_number, context, nurse_context, emr_context, expected_diagnosis, expected_treatment, case_goals, difficulty_level, objective, progress_note, delivery_note, completion_hint',
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
            deliveryNote: roomMeta?.delivery_note ?? null,
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

      const roomIdForScope = forceBaseline ? null : patient.roomId ?? null;
      const assignmentForScope = forceBaseline ? null : assignmentId ?? null;

      const generatedLabs =
        aiLabs?.length && requestedTests.length
          ? aiLabs
          : await generateLabResults(patient.id, orderName, {
              patient,
              assignmentId: assignmentForScope,
              roomId: roomIdForScope,
              orderName: requestDetails ? `${orderName} — ${requestDetails}` : orderName,
              previousLabs: contextLabs,
              clinicalNotes,
              vitals,
            });

      const runTimestamp = new Date().toISOString();
      const labsWithAssignment = generatedLabs.map((lab, index) => ({
        id: (lab as { id?: string }).id ?? `lab-${Date.now()}-${index}`,
        patientId: patient.id,
        assignmentId: assignmentForScope,
        roomId: roomIdForScope,
        overrideScope: forceBaseline ? 'baseline' : undefined,
        testName: (lab as { testName?: string }).testName ?? requestedTests[index]?.testName ?? 'Lab',
        value: (lab as { value?: string | number }).value ?? '',
        unit: (lab as { unit?: string }).unit ?? requestedTests[index]?.unit ?? '',
        referenceRange:
          (lab as { referenceRange?: string }).referenceRange ?? requestedTests[index]?.referenceRange ?? '',
        status: (lab as { status?: string }).status ?? 'Normal',
        collectionTime: runTimestamp,
        resultTime: runTimestamp,
        orderedBy: patient.attendingPhysician ?? 'Attending',
      }));
      if (isSandbox) {
        setLabResults((prev) => {
          const updated = [...labsWithAssignment, ...prev];
          onSandboxLabsChange?.(updated);
          return updated;
        });
      } else {
        // Save to database
        await emrApi.addLabResults(labsWithAssignment, roomIdForScope);
        
        // Refresh labs from database to get merged results
        const refreshedLabs = await emrApi.listLabResults(patient.id, assignmentId, patient.roomId ?? null);
        setLabResults(refreshedLabs);
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
          .map((lab) => lab.collectionTime ?? lab.resultTime)
          .filter((time): time is string => Boolean(time)),
      ),
    );
    return uniqueTimes.sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime(),
    );
  }, [labResults]);

  // Categorize labs by type
  const getLabCategory = (testName: string): string => {
    const name = testName.toLowerCase();

    if (name.includes('serum lactate')) {
      return 'Chemistry/Electrolytes';
    }

    // Hematology
    if (name.includes('hemoglobin') || name.includes('hematocrit') || name.includes('wbc') || 
        name.includes('white blood cell') || name.includes('platelet') || name.includes('neutrophil') ||
        name.includes('lymphocyte') || name.includes('rbc') || name.includes('red blood cell')) {
      return 'Hematology';
    }
    
    // Chemistry/Electrolytes
    if (name.includes('sodium') || name.includes('potassium') || name.includes('chloride') || 
        name.includes('co2') || name.includes('bicarbonate') || name.includes('calcium') || 
        name.includes('magnesium') || name.includes('phosphorus') || name.includes('lactate')) {
      return 'Chemistry/Electrolytes';
    }
    
    // Renal Function
    if (name.includes('bun') || name.includes('creatinine') || name.includes('gfr')) {
      return 'Renal Function';
    }
    
    // Liver Function
    if (name.includes('ast') || name.includes('alt') || name.includes('alkaline phosphatase') || 
        name.includes('bilirubin') || name.includes('albumin') || name.includes('protein')) {
      return 'Liver Function';
    }
    
    // Coagulation
    if (name.includes('pt') || name.includes('inr') || name.includes('ptt') || name.includes('aptt') ||
        name.includes('fibrinogen') || name.includes('d-dimer')) {
      return 'Coagulation';
    }
    
    // Cardiac
    if (name.includes('troponin') || name.includes('bnp') || name.includes('ck') || 
        name.includes('creatine kinase')) {
      return 'Cardiac Markers';
    }
    
    // Blood Gas
    if (name.includes('ph') || name.includes('paco2') || name.includes('pao2') || 
        name.includes('hco3') || name.includes('base excess')) {
      return 'Blood Gas';
    }
    
    // Inflammatory
    if (name.includes('crp') || name.includes('esr') || name.includes('procalcitonin')) {
      return 'Inflammatory Markers';
    }
    
    // Metabolic
    if (name.includes('glucose') || name.includes('a1c') || name.includes('hemoglobin a1c') ||
        name.includes('cholesterol') || name.includes('triglyceride') || name.includes('hdl') || 
        name.includes('ldl')) {
      return 'Metabolic';
    }
    
    // Endocrine
    if (name.includes('tsh') || name.includes('t3') || name.includes('t4') || name.includes('thyroid')) {
      return 'Endocrine';
    }
    
    // Other
    return 'Other';
  };

  const labsByTest = useMemo(
    () =>
      labResults.reduce<Record<string, Record<string, LabResult>>>((acc, lab) => {
        const time = lab.collectionTime ?? lab.resultTime;
        if (!time) return acc;
        if (!acc[lab.testName]) {
          acc[lab.testName] = {};
        }
        acc[lab.testName][time] = lab;
        return acc;
      }, {}),
    [labResults],
  );

  // Group labs by category
  const labsByCategory = useMemo(() => {
    const categories: Record<string, Record<string, Record<string, LabResult>>> = {};
    
    Object.entries(labsByTest).forEach(([testName, timeMap]) => {
      const category = getLabCategory(testName);
      if (!categories[category]) {
        categories[category] = {};
      }
      categories[category][testName] = timeMap;
    });
    
    // Sort categories
    const categoryOrder = [
      'Hematology',
      'Chemistry/Electrolytes',
      'Renal Function',
      'Liver Function',
      'Metabolic',
      'Coagulation',
      'Cardiac Markers',
      'Blood Gas',
      'Inflammatory Markers',
      'Endocrine',
      'Other',
    ];
    
    const sorted: Record<string, Record<string, Record<string, LabResult>>> = {};
    categoryOrder.forEach(cat => {
      if (categories[cat]) {
        sorted[cat] = categories[cat];
      }
    });
    
    return sorted;
  }, [labsByTest]);

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
      {canEdit && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Laboratory Results</h2>
              <p className="text-muted-foreground">
                {abnormalLabs.length} Abnormal • {labResults.length} Total
              </p>
            </div>
            <Button
              onClick={() => setShowManualLabModal(true)}
              variant="outline"
              className="flex items-center gap-2"
            >
              <TestTube className="h-4 w-4" />
              Add Manual Lab
            </Button>
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
      )}
      {!canEdit && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Laboratory Results</h2>
            <p className="text-muted-foreground">
              {abnormalLabs.length} Abnormal • {labResults.length} Total
            </p>
          </div>
        </div>
      )}

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
                      {Object.entries(labsByCategory).map(([category, tests]) => (
                        <Fragment key={category}>
                          <TableRow>
                            <TableCell
                              className="bg-muted font-semibold text-muted-foreground"
                              colSpan={sortedCollectionTimes.length + 1}
                            >
                              {category}
                            </TableCell>
                          </TableRow>
                          {Object.entries(tests).map(([testName, resultsByTime]) => (
                            <TableRow key={`${category}-${testName}`}>
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
                        </Fragment>
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

      {/* Manual Lab Entry Modal */}
      {showManualLabModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowManualLabModal(false)}
        >
          <div 
            className="relative w-full max-w-md bg-background rounded-lg shadow-xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-4">Add Manual Lab Result</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Test Name</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-border px-3 py-2 text-sm mt-1"
                  placeholder="e.g., Hemoglobin"
                  value={manualLabForm.testName}
                  onChange={(e) => setManualLabForm((prev) => ({ ...prev, testName: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Value</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-border px-3 py-2 text-sm mt-1"
                  placeholder="e.g., 12.5"
                  value={manualLabForm.value}
                  onChange={(e) => setManualLabForm((prev) => ({ ...prev, value: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Unit (optional)</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-border px-3 py-2 text-sm mt-1"
                  placeholder="e.g., g/dL"
                  value={manualLabForm.unit}
                  onChange={(e) => setManualLabForm((prev) => ({ ...prev, unit: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Reference Range (optional)</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-border px-3 py-2 text-sm mt-1"
                  placeholder="e.g., 12.0-15.5"
                  value={manualLabForm.referenceRange}
                  onChange={(e) => setManualLabForm((prev) => ({ ...prev, referenceRange: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Status</label>
                <select
                  className="w-full rounded-md border border-border px-3 py-2 text-sm mt-1"
                  value={manualLabForm.status}
                  onChange={(e) => setManualLabForm((prev) => ({ ...prev, status: e.target.value as LabResult['status'] }))}
                >
                  <option value="Normal">Normal</option>
                  <option value="Abnormal">Abnormal</option>
                  <option value="Critical">Critical</option>
                  <option value="Pending">Pending</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  setShowManualLabModal(false);
                  setManualLabForm({ testName: '', value: '', unit: '', referenceRange: '', status: 'Normal' });
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!manualLabForm.testName.trim() || !manualLabForm.value.trim()) return;
                  
                  const roomIdForScope = forceBaseline ? null : patient.roomId ?? null;
                  const assignmentForScope = forceBaseline ? null : assignmentId ?? null;

                  const newLab: LabResult = {
                    id: `lab-${Date.now()}`,
                    patientId: patient.id,
                    assignmentId: assignmentForScope,
                    roomId: roomIdForScope,
                    overrideScope: forceBaseline ? 'baseline' : undefined,
                    testName: manualLabForm.testName.trim(),
                    value: manualLabForm.value.trim(),
                    unit: manualLabForm.unit.trim(),
                    referenceRange: manualLabForm.referenceRange.trim(),
                    status: manualLabForm.status,
                    collectionTime: new Date().toISOString(),
                    resultTime: new Date().toISOString(),
                    orderedBy: patient.attendingPhysician ?? 'Manual Entry',
                  };

                  if (isSandbox) {
                    setLabResults((prev) => {
                      const updated = [newLab, ...prev];
                      onSandboxLabsChange?.(updated);
                      return updated;
                    });
                  } else {
                    // Save to database
                    await emrApi.addLabResults([newLab], roomIdForScope);
                    
                    // Refresh labs from database to get merged results
                    const refreshedLabs = await emrApi.listLabResults(patient.id, assignmentId, patient.roomId ?? null);
                    setLabResults(refreshedLabs);
                  }

                  setShowManualLabModal(false);
                  setManualLabForm({ testName: '', value: '', unit: '', referenceRange: '', status: 'Normal' });
                }}
                disabled={!manualLabForm.testName.trim() || !manualLabForm.value.trim()}
              >
                Add Lab
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

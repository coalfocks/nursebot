import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/Tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TestTube, TrendingUp, Sparkles } from 'lucide-react';
import { generateLabResults } from '../lib/aiLabGenerator';
import { emrApi } from '../lib/api';
import type { Patient, LabResult } from '../lib/types';

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

  useEffect(() => {
    if (isSandbox) {
      setLabResults(sandboxLabs ?? []);
      return;
    }
    void (async () => {
      const data = await emrApi.listLabResults(patient.id, assignmentId);
      setLabResults(data);
    })();
  }, [patient.id, assignmentId, refreshToken, isSandbox, sandboxLabs]);

  const handleGenerateLabResults = async () => {
    setIsGenerating(true);
    try {
      const caseDescription =
        '37-year-old male with epigastric pain, possible peptic ulcer disease, taking Excedrin for migraines, history of GERD';
      const newLabs = await generateLabResults(patient.id, caseDescription);
      const labsWithAssignment = newLabs.map((lab) => ({ ...lab, assignmentId: assignmentId ?? null }));
      setLabResults((prev) => [...labsWithAssignment, ...prev]);
      if (isSandbox) {
        onSandboxLabsChange?.([...labsWithAssignment, ...labResults]);
      } else {
        void emrApi.addLabResults(labsWithAssignment);
      }
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

  const formatCollectionLabel = (value: string) =>
    new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

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
      time: new Date(lab.collectionTime).toLocaleDateString(),
      value: numericValue,
      status: lab.status,
    });
    return acc;
  }, {});

  const abnormalLabs = useMemo(() => labResults.filter((lab) => lab.status === 'Abnormal'), [labResults]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Laboratory Results</h2>
          <p className="text-muted-foreground">
            {abnormalLabs.length} Abnormal • {labResults.length} Total
          </p>
        </div>
        <Button onClick={handleGenerateLabResults} disabled={isGenerating} className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          {isGenerating ? 'Generating...' : 'Generate AI Labs'}
        </Button>
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
                        {sortedCollectionTimes.map((time) => (
                          <TableHead key={time} className="whitespace-nowrap">
                            {formatCollectionLabel(time)}
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
          {Object.keys(labTrends).length === 0 ? (
            <p className="text-sm text-muted-foreground">No trendable labs yet. Order labs to see trends.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {Object.entries(labTrends)
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

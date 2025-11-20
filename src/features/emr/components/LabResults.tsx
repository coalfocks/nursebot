import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/Tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TestTube, TrendingUp, AlertTriangle, CheckCircle, Clock, Sparkles } from 'lucide-react';
import { mockLabResults } from '../lib/mockData';
import { generateLabResults } from '../lib/aiLabGenerator';
import { emrApi } from '../lib/api';
import type { Patient, LabResult } from '../lib/types';

interface LabResultsProps {
  patient: Patient;
}

type LabTrendPoint = {
  time: string;
  value: number;
  status: LabResult['status'];
};

export function LabResults({ patient }: LabResultsProps) {
  const [labResults, setLabResults] = useState<LabResult[]>(mockLabResults);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    void (async () => {
      const data = await emrApi.listLabResults(patient.id);
      if (data.length) {
        setLabResults(data);
      }
    })();
  }, [patient.id]);

  const handleGenerateLabResults = async () => {
    setIsGenerating(true);
    try {
      const caseDescription =
        '37-year-old male with epigastric pain, possible peptic ulcer disease, taking Excedrin for migraines, history of GERD';
      const newLabs = await generateLabResults(patient.id, caseDescription);
      setLabResults([...newLabs, ...labResults]);
      void emrApi.addLabResults(newLabs);
    } catch (error) {
      console.error('Error generating labs:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Normal':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'Abnormal':
        return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
      case 'Critical':
        return <AlertTriangle className="h-4 w-4 text-red-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
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

  // Group labs by category for trending
  const labTrends = labResults.reduce<Record<string, LabTrendPoint[]>>((acc, lab) => {
    if (!acc[lab.testName]) {
      acc[lab.testName] = [];
    }
    acc[lab.testName].push({
      time: new Date(lab.collectionTime).toLocaleDateString(),
      value: typeof lab.value === 'number' ? lab.value : Number.parseFloat(lab.value as string) || 0,
      status: lab.status,
    });
    return acc;
  }, {});

  const criticalLabs = useMemo(() => labResults.filter((lab) => lab.status === 'Critical'), [labResults]);
  const abnormalLabs = useMemo(() => labResults.filter((lab) => lab.status === 'Abnormal'), [labResults]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Laboratory Results</h2>
          <p className="text-muted-foreground">
            {criticalLabs.length} Critical • {abnormalLabs.length} Abnormal • {labResults.length} Total
          </p>
        </div>
        <Button onClick={handleGenerateLabResults} disabled={isGenerating} className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          {isGenerating ? 'Generating...' : 'Generate AI Labs'}
        </Button>
      </div>

      <Tabs defaultValue="results" className="w-full">
        <TabsList>
          <TabsTrigger value="results">Results Table</TabsTrigger>
          <TabsTrigger value="trends">Trending</TabsTrigger>
          <TabsTrigger value="critical">Critical Values</TabsTrigger>
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
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Test Name</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Reference Range</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Collection Time</TableHead>
                      <TableHead>Ordered By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {labResults.map((lab) => (
                      <TableRow key={lab.id}>
                        <TableCell className="font-medium">{lab.testName}</TableCell>
                        <TableCell className={getStatusColor(lab.status)}>
                          {lab.value}
                          {lab.status === 'Abnormal' && (
                            <span className="ml-1">
                              {typeof lab.value === 'number' && lab.referenceRange
                                ? lab.value < Number.parseFloat(lab.referenceRange.split('-')[0])
                                  ? '↓'
                                  : '↑'
                                : ''}
                            </span>
                          )}
                          {lab.status === 'Critical' && <span className="ml-1">⚠️</span>}
                        </TableCell>
                        <TableCell>{lab.unit}</TableCell>
                        <TableCell className="text-muted-foreground">{lab.referenceRange}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(lab.status)}
                            <Badge
                              variant={
                                lab.status === 'Normal'
                                  ? 'default'
                                  : lab.status === 'Critical'
                                    ? 'destructive'
                                    : 'secondary'
                              }
                            >
                              {lab.status}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(lab.collectionTime).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{lab.orderedBy}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="mt-6">
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
        </TabsContent>

        <TabsContent value="critical" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-600">
                  <AlertTriangle className="h-5 w-5" />
                  Critical Values
                </CardTitle>
              </CardHeader>
              <CardContent>
                {criticalLabs.length > 0 ? (
                  <div className="space-y-3">
                    {criticalLabs.map((lab) => (
                      <div key={lab.id} className="p-3 border border-red-200 rounded-lg bg-red-50">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-red-800">{lab.testName}</p>
                            <p className="text-sm text-red-600">
                              {lab.value} {lab.unit} (Ref: {lab.referenceRange})
                            </p>
                          </div>
                          <Badge variant="destructive">Critical</Badge>
                        </div>
                        <p className="text-xs text-red-600 mt-1">{new Date(lab.collectionTime).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No critical values</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-yellow-600">
                  <AlertTriangle className="h-5 w-5" />
                  Abnormal Values
                </CardTitle>
              </CardHeader>
              <CardContent>
                {abnormalLabs.length > 0 ? (
                  <div className="space-y-3">
                    {abnormalLabs.slice(0, 5).map((lab) => (
                      <div key={lab.id} className="p-3 border border-yellow-200 rounded-lg bg-yellow-50">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-yellow-800">{lab.testName}</p>
                            <p className="text-sm text-yellow-600">
                              {lab.value} {lab.unit} (Ref: {lab.referenceRange})
                            </p>
                          </div>
                          <Badge variant="secondary">Abnormal</Badge>
                        </div>
                        <p className="text-xs text-yellow-600 mt-1">{new Date(lab.collectionTime).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No abnormal values</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

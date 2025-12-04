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

interface VitalSignsProps {
  patient: Patient;
  assignmentId?: string;
}

export function VitalSignsComponent({ patient, assignmentId }: VitalSignsProps) {
  const [vitals, setVitals] = useState<VitalSigns[]>(mockVitals);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    void (async () => {
      const data = await emrApi.listVitals(patient.id, assignmentId, patient.roomId ?? null);
      if (data.length) {
        setVitals(data);
      }
    })();
  }, [patient.id, patient.roomId, assignmentId]);

  const handleGenerateVitals = async () => {
    setIsGenerating(true);
    try {
      const caseDescription = '37-year-old male with epigastric pain, possible peptic ulcer disease, stable condition';
      const newVitals = (await generateVitalSigns(patient.id, caseDescription)).map((vital) => ({
        ...vital,
        assignmentId: assignmentId ?? null,
        roomId: patient.roomId ?? null,
      }));
      setVitals([...newVitals, ...vitals]);
      void emrApi.addVitals(newVitals, patient.roomId ?? null);
    } catch (error) {
      console.error('Error generating vitals:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const latestVitals = vitals[0];

  // Prepare data for trending charts
  const vitalTrends = vitals
    .map((vital) => ({
      time: 'Run',
      temperature: vital.temperature,
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
        <Button onClick={handleGenerateVitals} disabled={isGenerating} className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          {isGenerating ? 'Generating...' : 'Generate AI Vitals'}
        </Button>
      </div>

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
                {latestVitals.temperature}°F
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
                      <TableHead>Temp (°F)</TableHead>
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
                          {vital.temperature}
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

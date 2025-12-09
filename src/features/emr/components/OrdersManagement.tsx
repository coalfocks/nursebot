import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';
import { OrderEntry } from './OrderEntry';
import { Plus, Clock, CheckCircle, XCircle, AlertCircle, Calendar, User } from 'lucide-react';
import type { Patient, MedicalOrder } from '../lib/types';
import { emrApi } from '../lib/api';
import { generateLabResults, resolveLabTemplates } from '../lib/aiLabGenerator';
import { supabase } from '../../../lib/supabase';

interface OrdersManagementProps {
  patient: Patient;
  assignmentId?: string;
  forceBaseline?: boolean;
  onOrderAdded?: (order: MedicalOrder) => void;
  onLabsGenerated?: () => void;
}

type RoomMeta = {
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
};

export function OrdersManagement({
  patient,
  assignmentId,
  forceBaseline,
  onOrderAdded,
  onLabsGenerated,
}: OrdersManagementProps) {
  const [orders, setOrders] = useState<MedicalOrder[]>([]);
  const [showOrderEntry, setShowOrderEntry] = useState(false);
  const [roomMeta, setRoomMeta] = useState<RoomMeta | null>(null);

  useEffect(() => {
    void (async () => {
      const data = await emrApi.listOrders(patient.id, assignmentId, patient.roomId ?? null);
      if (data.length) {
        setOrders(data);
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
        console.error('Failed to load room context', error);
        return;
      }
      if (data) {
        let emrContext: RoomMeta['emr_context'] = data.emr_context ?? null;
        if (typeof emrContext === 'string') {
          try {
            emrContext = JSON.parse(emrContext);
          } catch {
            // keep original string
          }
        }
        setRoomMeta({
          ...data,
          emr_context: emrContext,
        });
      }
    })();
    return () => {
      isActive = false;
    };
  }, [patient.roomId]);

  const handleOrderPlaced = async (newOrder: MedicalOrder) => {
    const adjustedOrder: MedicalOrder = {
      ...newOrder,
      assignmentId: forceBaseline ? null : newOrder.assignmentId,
      roomId: forceBaseline ? null : newOrder.roomId,
      overrideScope: forceBaseline ? 'baseline' : newOrder.overrideScope,
    };
    const contextualRoomId = adjustedOrder.roomId ?? patient.roomId ?? null;
    const effectiveRoomId = forceBaseline ? null : contextualRoomId;
    const effectiveAssignmentId = forceBaseline
      ? adjustedOrder.assignmentId ?? assignmentId ?? null
      : adjustedOrder.assignmentId ?? assignmentId ?? null;
    const orderForState = { ...adjustedOrder, roomId: effectiveRoomId, assignmentId: effectiveAssignmentId };

    setOrders((prev) => [orderForState, ...prev]);
    setShowOrderEntry(false);
    void emrApi.addOrder(
      {
        ...orderForState,
      },
      effectiveRoomId,
    );

    if (adjustedOrder.category === 'Lab' && adjustedOrder.priority === 'STAT') {
      try {
        const [previousLabs, clinicalNotes, vitals] = await Promise.all([
          emrApi.listLabResults(patient.id, effectiveAssignmentId ?? undefined, contextualRoomId),
          emrApi.listClinicalNotes(patient.id, effectiveAssignmentId ?? undefined, contextualRoomId),
          emrApi.listVitals(patient.id, effectiveAssignmentId ?? undefined, contextualRoomId),
        ]);
        const requestedTests = resolveLabTemplates(adjustedOrder.orderName).map((template) => ({
          testName: template.testName,
          unit: template.unit,
          referenceRange: template.referenceRange,
        }));

        const aiResponse = await supabase.functions.invoke('lab-results', {
          body: {
            orderName: adjustedOrder.orderName,
            priority: adjustedOrder.priority,
            tests: requestedTests,
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
                id: contextualRoomId,
                number: patient.room,
              },
              assignmentId: effectiveAssignmentId,
              emrContext: roomMeta?.emr_context ?? null,
              nurseContext: roomMeta?.nurse_context ?? roomMeta?.context ?? null,
              expectedDiagnosis: roomMeta?.expected_diagnosis ?? null,
              expectedTreatment: roomMeta?.expected_treatment ?? null,
              caseGoals: roomMeta?.case_goals ?? null,
              difficultyLevel: roomMeta?.difficulty_level ?? null,
              objective: roomMeta?.objective ?? null,
              progressNote: roomMeta?.progress_note ?? null,
              completionHint: roomMeta?.completion_hint ?? null,
              clinicalNotes: clinicalNotes.slice(0, 6).map((note) => ({
                type: note.type,
                title: note.title,
                content: note.content,
                timestamp: note.timestamp,
              })),
              vitals: vitals.slice(0, 6),
              previousLabs: previousLabs.slice(0, 10).map((lab) => ({
                testName: lab.testName,
                value: lab.value,
                unit: lab.unit,
                referenceRange: lab.referenceRange,
                status: lab.status,
                collectionTime: lab.collectionTime,
              })),
              orders: orders.slice(0, 6).map((order) => ({
                orderName: order.orderName,
                category: order.category,
                priority: order.priority,
                status: order.status,
                instructions: order.instructions,
              })),
            },
          },
        });

        if (aiResponse.error) {
          throw aiResponse.error;
        }

        const aiLabs = Array.isArray((aiResponse.data as { labs?: unknown })?.labs)
          ? ((aiResponse.data as { labs: unknown }).labs as Array<{
              testName: string;
              value: string | number;
              unit?: string;
              referenceRange?: string;
              status?: string;
              collectionTime?: string;
              resultTime?: string;
            }>)
          : null;

        const generatedLabs =
          aiLabs?.length && requestedTests.length
            ? aiLabs
            : await generateLabResults(patient.id, adjustedOrder.orderName, {
                patient,
                assignmentId: effectiveAssignmentId,
                roomId: contextualRoomId,
                orderName: adjustedOrder.orderName,
                previousLabs,
                clinicalNotes,
                vitals,
              });

        const labsWithScope = generatedLabs.map((lab, index) => ({
          id: (lab as { id?: string }).id ?? `lab-${Date.now()}-${index}`,
          patientId: patient.id,
          assignmentId: effectiveAssignmentId,
          roomId: effectiveRoomId,
          overrideScope: forceBaseline ? 'baseline' : (lab as { overrideScope?: string }).overrideScope,
          testName: (lab as { testName?: string }).testName ?? requestedTests[index]?.testName ?? 'Lab',
          value: (lab as { value?: string | number }).value ?? '',
          unit: (lab as { unit?: string }).unit ?? requestedTests[index]?.unit ?? '',
          referenceRange:
            (lab as { referenceRange?: string }).referenceRange ?? requestedTests[index]?.referenceRange ?? '',
          status: (lab as { status?: string }).status ?? 'Normal',
          collectionTime:
            (lab as { collectionTime?: string }).collectionTime ?? new Date().toISOString(),
          resultTime: (lab as { resultTime?: string }).resultTime ?? new Date().toISOString(),
          orderedBy: adjustedOrder.orderedBy,
        }));

        await emrApi.addLabResults(labsWithScope, effectiveRoomId);
        onLabsGenerated?.();
      } catch (err) {
        console.error('Failed to generate STAT labs', err);
      }
    }
    onOrderAdded?.(orderForState);
  };

  const handleOrderStatusChange = (orderId: string, newStatus: MedicalOrder['status']) => {
    setOrders((prev) => prev.map((order) => (order.id === orderId ? { ...order, status: newStatus } : order)));
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Active':
        return <Clock className="h-4 w-4 text-blue-500" />;
      case 'Completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'Discontinued':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'Pending':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active':
        return 'default';
      case 'Completed':
        return 'secondary';
      case 'Discontinued':
        return 'destructive';
      case 'Pending':
        return 'outline';
      default:
        return 'outline';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'STAT':
        return 'destructive';
      case 'Timed':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const activeOrders = orders.filter((order) => order.status === 'Active');
  const pendingOrders = orders.filter((order) => order.status === 'Pending');

  const renderOrdersTable = (orderList: MedicalOrder[]) => (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Details</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Ordered</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orderList.map((order) => (
            <TableRow key={order.id}>
              <TableCell className="font-medium">{order.orderName}</TableCell>
              <TableCell>
                <div className="text-sm">
                  {order.dose && <div>Dose: {order.dose}</div>}
                  {order.frequency && <div>Frequency: {order.frequency}</div>}
                  {order.route && <div>Route: {order.route}</div>}
                  {order.instructions && <div>Notes: {order.instructions}</div>}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={getPriorityColor(order.priority)}>{order.priority}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {getStatusIcon(order.status)}
                  <Badge variant={getStatusColor(order.status)}>{order.status}</Badge>
                </div>
              </TableCell>
              <TableCell>
                <div className="text-sm">
                  <div className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {order.orderedBy}
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {new Date(order.orderTime).toLocaleString()}
                  </div>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Medical Orders</h2>
          <p className="text-muted-foreground">
            {activeOrders.length} Active • {pendingOrders.length} Pending • {orders.length} Total
          </p>
        </div>
        <Button onClick={() => setShowOrderEntry(!showOrderEntry)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          New Order
        </Button>
      </div>

      {showOrderEntry && (
        <OrderEntry
          patient={patient}
          assignmentId={assignmentId}
          forceBaseline={forceBaseline}
          onOrderPlaced={handleOrderPlaced}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>All Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length ? (
            renderOrdersTable(orders)
          ) : (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Active Orders
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {activeOrders.length} Active • {pendingOrders.length} Pending • {orders.length} Total
          </p>
        </CardHeader>
        <CardContent>
          {activeOrders.length ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ordered</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.orderName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{order.category}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {order.dose && <div>Dose: {order.dose}</div>}
                          {order.frequency && <div>Frequency: {order.frequency}</div>}
                          {order.route && <div>Route: {order.route}</div>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getPriorityColor(order.priority)}>{order.priority}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(order.status)}
                          <Badge variant={getStatusColor(order.status)}>{order.status}</Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {order.orderedBy}
                          </div>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {new Date(order.orderTime).toLocaleString()}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOrderStatusChange(order.id, 'Completed')}
                          >
                            Complete
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleOrderStatusChange(order.id, 'Discontinued')}
                          >
                            D/C
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active orders at the moment.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

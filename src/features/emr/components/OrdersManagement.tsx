import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';
import { Tabs, TabsList, TabsTrigger } from './ui/Tabs';
import { OrderEntry } from './OrderEntry';
import { Plus, Clock, CheckCircle, XCircle, AlertCircle, User, Pencil, Trash } from 'lucide-react';
import type { Patient, MedicalOrder, ImagingStudy } from '../lib/types';
import { emrApi } from '../lib/api';
import { generateLabResults, resolveLabTemplates } from '../lib/aiLabGenerator';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../stores/authStore';
import { isSuperAdmin } from '../../../lib/roles';

interface OrdersManagementProps {
  patient: Patient;
  assignmentId?: string;
  forceBaseline?: boolean;
  onOrderAdded?: (order: MedicalOrder) => void;
  onLabsGenerated?: () => void;
  onImagingStudyUpdated?: () => void;
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
  onImagingStudyUpdated,
}: OrdersManagementProps) {
  const { profile } = useAuthStore();
  const canEditOrders = isSuperAdmin(profile);
  const [orders, setOrders] = useState<MedicalOrder[]>([]);
  const [showOrderEntry, setShowOrderEntry] = useState(false);
  const [roomMeta, setRoomMeta] = useState<RoomMeta | null>(null);
  const [editingOrder, setEditingOrder] = useState<MedicalOrder | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'Lab' | 'Medication' | 'Imaging' | 'Other'>('all');
  const [editForm, setEditForm] = useState({
    orderName: '',
    dose: '',
    route: '',
    frequency: '',
    priority: 'Routine' as MedicalOrder['priority'],
    status: 'Active' as MedicalOrder['status'],
    instructions: '',
  });

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

  const deriveImagingDetails = (orderName: string) => {
    const normalized = orderName.toLowerCase();
    let studyType = orderName;
    if (normalized.includes('ct')) {
      studyType = 'CT';
    } else if (normalized.includes('mri')) {
      studyType = 'MRI';
    } else if (normalized.includes('ultrasound')) {
      studyType = 'Ultrasound';
    } else if (normalized.includes('echo')) {
      studyType = 'Echocardiogram';
    } else if (normalized.includes('x-ray') || normalized.includes('xray')) {
      studyType = 'X-ray';
    }

    let contrast: ImagingStudy['contrast'] = null;
    if (normalized.includes('with') && normalized.includes('contrast')) {
      contrast = 'with';
    } else if (normalized.includes('without') || normalized.includes('no contrast')) {
      contrast = 'without';
    }

    return { studyType, contrast };
  };

  const createImagingStudyForOrder = async (
    order: MedicalOrder,
    contextualRoomId: number | null,
    effectiveRoomId: number | null,
    effectiveAssignmentId: string | null,
  ) => {
    const { studyType, contrast } = deriveImagingDetails(order.orderName);
    const now = order.orderTime || new Date().toISOString();
    const overrideScope = forceBaseline
      ? 'baseline'
      : order.overrideScope ?? (effectiveAssignmentId ? 'assignment' : effectiveRoomId ? 'room' : 'baseline');
    const imagingStudy: ImagingStudy = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
      patientId: patient.id,
      assignmentId: effectiveAssignmentId ?? null,
      roomId: effectiveRoomId ?? null,
      overrideScope,
      orderName: order.orderName,
      studyType,
      contrast,
      priority: order.priority,
      status: 'Pending',
      orderedBy: order.orderedBy ?? 'Unknown',
      orderTime: now,
      images: [],
    };

    const inserted = await emrApi.addImagingStudy(imagingStudy);
    if (!inserted) return;
    onImagingStudyUpdated?.();

    try {
      const [previousLabs, clinicalNotes, vitals] = await Promise.all([
        emrApi.listLabResults(patient.id, effectiveAssignmentId ?? undefined, contextualRoomId),
        emrApi.listClinicalNotes(patient.id, effectiveAssignmentId ?? undefined, contextualRoomId),
        emrApi.listVitals(patient.id, effectiveAssignmentId ?? undefined, contextualRoomId),
      ]);

      const response = await supabase.functions.invoke('imaging-results', {
        body: {
          orderName: order.orderName,
          priority: order.priority,
          modality: studyType,
          contrast,
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
            userRequest: order.instructions ?? null,
            clinicalNotes: clinicalNotes.slice(0, 6).map((note) => ({
              type: note.type,
              title: note.title,
              content: note.content,
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
            orders: orders.slice(0, 6).map((existingOrder) => ({
              orderName: existingOrder.orderName,
              category: existingOrder.category,
              priority: existingOrder.priority,
              status: existingOrder.status,
              instructions: existingOrder.instructions,
            })),
          },
        },
      });

      if (response.error) {
        throw response.error;
      }

      const report = (response.data as { report?: string })?.report;
      if (!report) {
        throw new Error('Imaging report missing from response');
      }

      await emrApi.updateImagingStudy(inserted.id, {
        report,
        reportGeneratedAt: new Date().toISOString(),
        status: 'Completed',
      });
    } catch (error) {
      console.error('Failed to generate imaging report', error);
      await emrApi.updateImagingStudy(inserted.id, { status: 'Failed' });
    } finally {
      onImagingStudyUpdated?.();
    }
  };

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

    if (adjustedOrder.category === 'Imaging') {
      void createImagingStudyForOrder(
        orderForState,
        contextualRoomId,
        effectiveRoomId,
        effectiveAssignmentId,
      );
    }

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

        const runTimestamp = new Date().toISOString();
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
          collectionTime: runTimestamp,
          resultTime: runTimestamp,
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

  const handlePlaceIvOrder = async () => {
    const ivOrder: MedicalOrder = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      patientId: patient.id,
      assignmentId: forceBaseline ? null : assignmentId ?? null,
      roomId: forceBaseline ? null : patient.roomId ?? null,
      overrideScope: forceBaseline ? 'baseline' : assignmentId ? 'assignment' : patient.roomId ? 'room' : 'baseline',
      category: 'Nursing',
      orderName: 'Place IV Access',
      route: 'IV',
      priority: 'Routine',
      status: 'Active',
      orderedBy: patient.attendingPhysician ?? 'Attending',
      orderTime: new Date().toISOString(),
      instructions: 'Initiate peripheral IV access.',
    };
    await handleOrderPlaced(ivOrder);
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

  const startEdit = (order: MedicalOrder) => {
    setEditingOrder(order);
    setEditForm({
      orderName: order.orderName,
      dose: order.dose ?? '',
      route: order.route ?? '',
      frequency: order.frequency ?? '',
      priority: order.priority,
      status: order.status,
      instructions: order.instructions ?? '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingOrder) return;
    const updates: Partial<MedicalOrder> = {
      orderName: editForm.orderName.trim() || editingOrder.orderName,
      dose: editForm.dose || null,
      route: editForm.route || null,
      frequency: editForm.frequency || null,
      priority: editForm.priority,
      status: editForm.status,
      instructions: editForm.instructions || undefined,
    };

    const updated = await emrApi.updateOrder(editingOrder.id, updates);
    if (updated) {
      setOrders((prev) => prev.map((o) => (o.id === editingOrder.id ? { ...o, ...updated } : o)));
    }
    setEditingOrder(null);
  };

  const handleDelete = async (orderId: string) => {
    await emrApi.deleteOrder(orderId);
    setOrders((prev) => prev.filter((o) => o.id !== orderId));
  };

  const matchesCategory = (order: MedicalOrder) => {
    if (selectedCategory === 'all') return true;
    if (selectedCategory === 'Other') {
      return !['Lab', 'Medication', 'Imaging'].includes(order.category);
    }
    return order.category === selectedCategory;
  };

  const filteredOrders = orders.filter((order) => matchesCategory(order));
  const activeOrders = filteredOrders.filter((order) => order.status === 'Active');
  const pendingOrders = filteredOrders.filter((order) => order.status === 'Pending');

  const renderOrdersTable = (orderList: MedicalOrder[]) => (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Details</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Ordered By</TableHead>
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
            {activeOrders.length} Active • {pendingOrders.length} Pending • {filteredOrders.length} Total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void handlePlaceIvOrder()} variant="outline">
            Place IV Order
          </Button>
          <Button onClick={() => setShowOrderEntry(!showOrderEntry)} className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            New Order
          </Button>
        </div>
      </div>

      <Tabs value={selectedCategory} onValueChange={(value) => setSelectedCategory(value as typeof selectedCategory)}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="Lab">Labs</TabsTrigger>
          <TabsTrigger value="Medication">Meds</TabsTrigger>
          <TabsTrigger value="Imaging">Imaging</TabsTrigger>
          <TabsTrigger value="Other">Other</TabsTrigger>
        </TabsList>
      </Tabs>

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
          {filteredOrders.length ? (
            renderOrdersTable(filteredOrders)
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
            {activeOrders.length} Active • {pendingOrders.length} Pending • {filteredOrders.length} Total
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
                    <TableHead>Ordered By</TableHead>
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
                          {canEditOrders && order.category === 'Medication' && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => startEdit(order)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => handleDelete(order.id)}>
                                <Trash className="h-4 w-4 text-red-600" />
                              </Button>
                            </>
                          )}
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
      <EditOrderModal
        order={editingOrder}
        form={editForm}
        onChange={(field, value) =>
          setEditForm((prev) => ({
            ...prev,
            [field]: value as (typeof editForm)[keyof typeof editForm],
          }))
        }
        onSave={handleSaveEdit}
        onCancel={() => setEditingOrder(null)}
      />
    </div>
  );
}

function EditOrderModal({
  order,
  form,
  onChange,
  onSave,
  onCancel,
}: {
  order: MedicalOrder | null;
  form: {
    orderName: string;
    dose: string;
    route: string;
    frequency: string;
    priority: MedicalOrder['priority'];
    status: MedicalOrder['status'];
    instructions: string;
  };
  onChange: (field: keyof typeof form, value: string | MedicalOrder['priority'] | MedicalOrder['status']) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (!order) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Edit order</h3>
          <Badge variant="outline">{order.category}</Badge>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-muted-foreground">Order name</label>
            <input
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              value={form.orderName}
              onChange={(e) => onChange('orderName', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground">Dose</label>
              <input
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                value={form.dose}
                onChange={(e) => onChange('dose', e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Route</label>
              <input
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                value={form.route}
                onChange={(e) => onChange('route', e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground">Frequency</label>
              <input
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                value={form.frequency}
                onChange={(e) => onChange('frequency', e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Priority</label>
              <select
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                value={form.priority}
                onChange={(e) => onChange('priority', e.target.value as MedicalOrder['priority'])}
              >
                <option value="Routine">Routine</option>
                <option value="STAT">STAT</option>
                <option value="Timed">Timed</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground">Status</label>
              <select
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                value={form.status}
                onChange={(e) => onChange('status', e.target.value as MedicalOrder['status'])}
              >
                <option value="Active">Active</option>
                <option value="Pending">Pending</option>
                <option value="Completed">Completed</option>
                <option value="Discontinued">Discontinued</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Instructions</label>
              <input
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                value={form.instructions}
                onChange={(e) => onChange('instructions', e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSave}>Save changes</Button>
        </div>
      </div>
    </div>
  );
}

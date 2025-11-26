import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';
import { OrderEntry } from './OrderEntry';
import { Plus, Clock, CheckCircle, XCircle, AlertCircle, Calendar, User, TestTube, Loader2 } from 'lucide-react';
import { mockOrders } from '../lib/mockData';
import type { Patient, MedicalOrder, RoomOrdersConfig, LabOrderSetting, LabResult } from '../lib/types';
import { emrApi } from '../lib/api';
import { instantLabs, pendingLabs, labTypeByName } from '../lib/labCatalog';
import { generateLabResultForOrder } from '../lib/labOrderService';

interface OrdersManagementProps {
  patient: Patient;
  ordersConfig?: RoomOrdersConfig | null;
  assignmentId?: string;
  onLabResultsUpdated?: () => void;
  onSandboxLabResult?: (lab: LabResult) => void;
  isSandbox?: boolean;
}

export function OrdersManagement({
  patient,
  assignmentId,
  ordersConfig,
  onLabResultsUpdated,
  onSandboxLabResult,
  isSandbox,
}: OrdersManagementProps) {
  const [orders, setOrders] = useState<MedicalOrder[]>(mockOrders);
  const [showOrderEntry, setShowOrderEntry] = useState(false);
  const [isOrderingLab, setIsOrderingLab] = useState(false);
  const [selectedLabName, setSelectedLabName] = useState('');
  const [priority, setPriority] = useState<'Routine' | 'STAT'>('Routine');
  const [labSearch, setLabSearch] = useState('');
  const availableLabs = useMemo<LabOrderSetting[]>(() => {
    if (ordersConfig?.labs?.length) {
      return ordersConfig.labs;
    }
    return [...instantLabs, ...pendingLabs].map((name) => ({
      name,
      type: labTypeByName.get(name) ?? (instantLabs.includes(name) ? 'instant' : 'pending'),
    }));
  }, [ordersConfig]);
  const selectedLabSetting = useMemo(
    () => availableLabs.find((lab) => lab.name === selectedLabName) ?? null,
    [availableLabs, selectedLabName],
  );
  const selectedLabType = selectedLabSetting?.type ?? (selectedLabName ? labTypeByName.get(selectedLabName) ?? 'instant' : 'instant');
  const isPendingOnly = selectedLabType === 'pending';
  const willAutoGenerate = !isPendingOnly && (priority === 'STAT' || selectedLabType === 'instant');

  useEffect(() => {
    void (async () => {
      const data = await emrApi.listOrders(patient.id, assignmentId);
      if (data.length) {
        setOrders(data);
      }
    })();
  }, [patient.id, assignmentId]);

  useEffect(() => {
    if (!selectedLabName && availableLabs.length) {
      const first = availableLabs[0];
      setSelectedLabName(first.name);
    }
  }, [availableLabs, selectedLabName]);

  const handleOrderPlaced = (newOrder: MedicalOrder) => {
    setOrders((prev) => [newOrder, ...prev]);
    setShowOrderEntry(false);
    if (!isSandbox) {
      void emrApi.addOrder(newOrder);
    }
  };

  const handleOrderStatusChange = (orderId: string, newStatus: MedicalOrder['status']) => {
    setOrders((prev) => prev.map((order) => (order.id === orderId ? { ...order, status: newStatus } : order)));
  };

  const handleOrderLab = async () => {
    if (!selectedLabName) return;
    setIsOrderingLab(true);
    const orderedBy = patient.attendingPhysician || 'Ordering Provider';
    const nowIso = new Date().toISOString();
    const orderId = crypto.randomUUID ? crypto.randomUUID() : `lab-order-${Date.now()}`;
    const selectedPriority = priority;

    const orderPayload: MedicalOrder = {
      id: orderId,
      patientId: patient.id,
      assignmentId: assignmentId ?? undefined,
      category: 'Lab',
      orderName: selectedLabName,
      priority: selectedPriority,
      status: willAutoGenerate ? 'Completed' : 'Pending',
      orderedBy,
      orderTime: nowIso,
      instructions: selectedLabSetting?.instruction,
    };

    setOrders((prev) => [orderPayload, ...prev]);
    if (!isSandbox) {
      void emrApi.addOrder(orderPayload);
    }

    if (willAutoGenerate) {
      try {
        const labResult = await generateLabResultForOrder({
          patientId: patient.id,
          labName: selectedLabName,
          priority: selectedPriority,
          orderedBy,
          ordersConfig,
          labSetting: selectedLabSetting,
          assignmentId: assignmentId ?? null,
        });
        if (isSandbox) {
          onSandboxLabResult?.(labResult);
        } else {
          await emrApi.addLabResults([labResult]);
          onLabResultsUpdated?.();
        }
      } catch (error) {
        console.error('Error generating lab result:', error);
      } finally {
        setIsOrderingLab(false);
      }
      return;
    }

    const pendingResult: LabResult = {
      id: orderId,
      patientId: patient.id,
      assignmentId: assignmentId ?? undefined,
      testName: selectedLabName,
      value: 'Pending',
      unit: '',
      referenceRange: '',
      status: 'Pending',
      collectionTime: nowIso,
      orderedBy,
    };

    try {
      if (isSandbox) {
        onSandboxLabResult?.(pendingResult);
      } else {
        await emrApi.addLabResults([pendingResult]);
        onLabResultsUpdated?.();
      }
    } catch (error) {
      console.error('Error saving pending lab result', error);
    } finally {
      setIsOrderingLab(false);
    }
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

  const ordersByCategory = orders.reduce(
    (acc, order) => {
      if (!acc[order.category]) acc[order.category] = [];
      acc[order.category].push(order);
      return acc;
    },
    {} as Record<string, MedicalOrder[]>,
  );

  const activeOrders = orders.filter((order) => order.status === 'Active');
  const pendingOrders = orders.filter((order) => order.status === 'Pending');
  const labOrdersList = ordersByCategory['Lab'] ?? [];
  const medicationOrdersList = ordersByCategory['Medication'] ?? [];
  const imagingOrdersList = ordersByCategory['Imaging'] ?? [];

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

      {showOrderEntry && <OrderEntry patient={patient} assignmentId={assignmentId} onOrderPlaced={handleOrderPlaced} />}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TestTube className="h-5 w-5" />
                Order Labs
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {ordersConfig?.notes
                  ? ordersConfig.notes
                  : 'Choose a lab and priority. STAT labs will auto-generate results in the Labs tab; pending labs will stay pending.'}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {availableLabs.length ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">Lab</label>
                      <input
                        type="text"
                        value={labSearch}
                        onChange={(e) => setLabSearch(e.target.value)}
                        placeholder="Search labs..."
                        className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <div className="max-h-48 overflow-y-auto rounded-md border border-gray-200">
                        {availableLabs
                          .filter((lab) => lab.name.toLowerCase().includes(labSearch.toLowerCase()))
                          .map((lab) => (
                            <button
                              key={lab.name}
                              type="button"
                              onClick={() => {
                                setSelectedLabName(lab.name);
                                setLabSearch(lab.name);
                              }}
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${
                                selectedLabName === lab.name ? 'bg-blue-100' : ''
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium">{lab.name}</span>
                              </div>
                              {lab.instruction && (
                                <p className="text-xs text-muted-foreground mt-1">{lab.instruction}</p>
                              )}
                            </button>
                          ))}
                      </div>
                    </div>
                    <div className="flex flex-col justify-end gap-2">
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                          Priority
                          <select
                            value={priority}
                            onChange={(e) => setPriority(e.target.value as 'Routine' | 'STAT')}
                            className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="Routine">Routine</option>
                            <option value="STAT">STAT</option>
                          </select>
                        </label>
                      </div>
                      {selectedLabSetting?.instruction && (
                        <p className="text-xs text-muted-foreground">Instructions: {selectedLabSetting.instruction}</p>
                      )}
                      {selectedLabSetting?.valueOverride && (
                        <p className="text-xs text-muted-foreground">
                          Preset values: {selectedLabSetting.valueOverride}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={handleOrderLab} disabled={isOrderingLab} className="flex items-center gap-2">
                      {isOrderingLab ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube className="h-4 w-4" />}
                      {isOrderingLab ? 'Ordering...' : 'Order lab'}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No labs are configured for this room yet. Add them in the room builder to enable lab ordering.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lab Orders</CardTitle>
            </CardHeader>
            <CardContent>
              {labOrdersList.length ? (
                renderOrdersTable(labOrdersList)
              ) : (
                <p className="text-sm text-muted-foreground">No lab orders yet.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Medication Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {medicationOrdersList.length ? (
              renderOrdersTable(medicationOrdersList)
            ) : (
              <p className="text-sm text-muted-foreground">No medication orders yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Imaging Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {imagingOrdersList.length ? (
              renderOrdersTable(imagingOrdersList)
            ) : (
              <p className="text-sm text-muted-foreground">No imaging orders yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

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

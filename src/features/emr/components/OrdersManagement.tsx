import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';
import { OrderEntry } from './OrderEntry';
import { Plus, Clock, CheckCircle, XCircle, AlertCircle, Calendar, User } from 'lucide-react';
import { mockOrders } from '../lib/mockData';
import type { Patient, MedicalOrder } from '../lib/types';
import { emrApi } from '../lib/api';

interface OrdersManagementProps {
  patient: Patient;
  assignmentId?: string;
}

export function OrdersManagement({
  patient,
  assignmentId,
}: OrdersManagementProps) {
  const [orders, setOrders] = useState<MedicalOrder[]>(mockOrders);
  const [showOrderEntry, setShowOrderEntry] = useState(false);

  useEffect(() => {
    void (async () => {
      const data = await emrApi.listOrders(patient.id, assignmentId);
      if (data.length) {
        setOrders(data);
      }
    })();
  }, [patient.id, assignmentId]);

  const handleOrderPlaced = (newOrder: MedicalOrder) => {
    setOrders((prev) => [newOrder, ...prev]);
    setShowOrderEntry(false);
    void emrApi.addOrder(newOrder);
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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

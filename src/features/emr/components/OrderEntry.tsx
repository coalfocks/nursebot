import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Badge } from './ui/Badge';
import { Tabs, TabsList, TabsTrigger } from './ui/Tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select';
import { Textarea } from './ui/Textarea';
import { ScrollArea } from './ui/ScrollArea';
import { Search, Plus, Clock, AlertCircle, CheckCircle, Pill, TestTube, Camera } from 'lucide-react';
import { allOrders, type OrderItem } from '../lib/ordersData';
import type { Patient, MedicalOrder } from '../lib/types';

type OrderCategory = 'all' | 'Lab' | 'Medication' | 'Imaging';
type OrderPriority = 'Routine' | 'STAT' | 'Timed';

interface OrderEntryProps {
  patient: Patient;
  assignmentId?: string;
  onOrderPlaced: (order: MedicalOrder) => void;
}

export function OrderEntry({ patient, onOrderPlaced, assignmentId }: OrderEntryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<OrderCategory>('all');
  const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null);
  const [orderDetails, setOrderDetails] = useState({
    frequency: '',
    route: '',
    dose: '',
    unit: '',
    priority: 'Routine' as OrderPriority,
    scheduledTime: '',
    instructions: '',
  });

  const filteredOrders = allOrders.filter((order) => {
    const matchesSearch = order.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || order.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleOrderSelect = (order: OrderItem) => {
    setSelectedOrder(order);
    setOrderDetails({
      frequency: order.frequencies?.[0] || '',
      route: order.routes?.[0] || '',
      dose: order.defaultDose || '',
      unit: order.units?.[0] || '',
      priority: 'Routine',
      scheduledTime: '',
      instructions: '',
    });
  };

  const handlePlaceOrder = () => {
    if (!selectedOrder) return;

    const newOrder: MedicalOrder = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      patientId: patient.id,
      assignmentId,
      category: selectedOrder.category,
      orderName: selectedOrder.name,
      frequency: orderDetails.frequency,
      route: orderDetails.route,
      dose: orderDetails.dose ? `${orderDetails.dose} ${orderDetails.unit}` : undefined,
      priority: orderDetails.priority,
      status: 'Active',
      orderedBy: patient.attendingPhysician,
      orderTime: new Date().toISOString(),
      scheduledTime: orderDetails.scheduledTime || undefined,
      instructions: orderDetails.instructions || undefined,
    };

    onOrderPlaced(newOrder);
    setSelectedOrder(null);
    setOrderDetails({
      frequency: '',
      route: '',
      dose: '',
      unit: '',
      priority: 'Routine',
      scheduledTime: '',
      instructions: '',
    });
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'Lab':
        return <TestTube className="h-4 w-4" />;
      case 'Medication':
        return <Pill className="h-4 w-4" />;
      case 'Imaging':
        return <Camera className="h-4 w-4" />;
      default:
        return <Plus className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Order Entry</h2>
        <Badge variant="outline">1500+ Available Orders</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Order Search and Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Search Orders
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="search">Search for orders</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  id="search"
                  placeholder="Type lab, medication, or imaging name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="Lab">Labs</TabsTrigger>
                <TabsTrigger value="Medication">Meds</TabsTrigger>
                <TabsTrigger value="Imaging">Imaging</TabsTrigger>
              </TabsList>
            </Tabs>

            <ScrollArea className="h-96 w-full">
              <div className="space-y-2">
                {filteredOrders.map((order) => (
                  <div
                    key={order.id}
                    className={`p-3 border rounded-lg cursor-pointer transition-colors hover:bg-accent ${
                      selectedOrder?.id === order.id ? 'bg-accent border-primary' : ''
                    }`}
                    onClick={() => handleOrderSelect(order)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {getCategoryIcon(order.category)}
                      <span className="font-medium text-sm">{order.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {order.category}
                      </Badge>
                      {order.subcategory && (
                        <Badge variant="secondary" className="text-xs">
                          {order.subcategory}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Order Details and Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Order Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedOrder ? (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg">{selectedOrder.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline">{selectedOrder.category}</Badge>
                    {selectedOrder.subcategory && <Badge variant="secondary">{selectedOrder.subcategory}</Badge>}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="priority">Priority</Label>
                    <Select
                      value={orderDetails.priority}
                      onValueChange={(value: OrderPriority) => setOrderDetails({ ...orderDetails, priority: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedOrder.priorities.map((priority) => (
                          <SelectItem key={priority} value={priority}>
                            <div className="flex items-center gap-2">
                              {priority === 'STAT' && <AlertCircle className="h-4 w-4 text-red-500" />}
                              {priority === 'Timed' && <Clock className="h-4 w-4 text-blue-500" />}
                              {priority === 'Routine' && <CheckCircle className="h-4 w-4 text-green-500" />}
                              {priority}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedOrder.frequencies && (
                    <div className="space-y-2">
                      <Label htmlFor="frequency">Frequency</Label>
                      <Select
                        value={orderDetails.frequency}
                        onValueChange={(value) => setOrderDetails({ ...orderDetails, frequency: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedOrder.frequencies.map((freq) => (
                            <SelectItem key={freq} value={freq}>
                              {freq}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {selectedOrder.routes && (
                    <div className="space-y-2">
                      <Label htmlFor="route">Route</Label>
                      <Select
                        value={orderDetails.route}
                        onValueChange={(value) => setOrderDetails({ ...orderDetails, route: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedOrder.routes.map((route) => (
                            <SelectItem key={route} value={route}>
                              {route}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {selectedOrder.defaultDose && (
                    <div className="space-y-2">
                      <Label htmlFor="dose">Dose</Label>
                      <div className="flex gap-2">
                        <Input
                          id="dose"
                          type="number"
                          placeholder="Dose"
                          value={orderDetails.dose}
                          onChange={(e) => setOrderDetails({ ...orderDetails, dose: e.target.value })}
                        />
                        {selectedOrder.units && (
                          <Select
                            value={orderDetails.unit}
                            onValueChange={(value) => setOrderDetails({ ...orderDetails, unit: value })}
                          >
                            <SelectTrigger className="w-20">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {selectedOrder.units.map((unit) => (
                                <SelectItem key={unit} value={unit}>
                                  {unit}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                  )}

                  {orderDetails.priority === 'Timed' && (
                    <div className="space-y-2">
                      <Label htmlFor="scheduledTime">Scheduled Time</Label>
                      <Input
                        id="scheduledTime"
                        type="datetime-local"
                        value={orderDetails.scheduledTime}
                        onChange={(e) => setOrderDetails({ ...orderDetails, scheduledTime: e.target.value })}
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="instructions">Special Instructions</Label>
                  <Textarea
                    id="instructions"
                    placeholder="Enter any special instructions..."
                    value={orderDetails.instructions}
                    onChange={(e) => setOrderDetails({ ...orderDetails, instructions: e.target.value })}
                    rows={3}
                  />
                </div>

                <Button onClick={handlePlaceOrder} className="w-full">
                  <Plus className="h-4 w-4 mr-2" />
                  Place Order
                </Button>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Plus className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select an order from the list to configure details</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

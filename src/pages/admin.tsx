import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Pencil, Trash2, Plus, X, Check, Loader2 } from 'lucide-react';
import Navbar from '../components/Navbar';

interface Room {
  id: number;
  room_number: string;
  role: string;
  objective: string;
  context: string;
  style: string;
}

export default function AdminPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newRoom, setNewRoom] = useState<Omit<Room, 'id'>>({
    room_number: '',
    role: '',
    objective: '',
    context: '',
    style: ''
  });

  useEffect(() => {
    fetchRooms();
  }, []);

  const fetchRooms = async () => {
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .order('room_number');

      if (error) throw error;
      setRooms(data || []);
    } catch (error) {
      console.error('Error fetching rooms:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this room?')) return;

    try {
      const { error } = await supabase
        .from('rooms')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await fetchRooms();
    } catch (error) {
      console.error('Error deleting room:', error);
    }
  };

  const handleEdit = async (room: Room) => {
    try {
      const { error } = await supabase
        .from('rooms')
        .update({
          room_number: room.room_number,
          role: room.role,
          objective: room.objective,
          context: room.context,
          style: room.style
        })
        .eq('id', room.id);

      if (error) throw error;
      setEditingRoom(null);
      await fetchRooms();
    } catch (error) {
      console.error('Error updating room:', error);
    }
  };

  const handleAdd = async () => {
    try {
      const { error } = await supabase
        .from('rooms')
        .insert([newRoom]);

      if (error) throw error;
      setIsAdding(false);
      setNewRoom({
        room_number: '',
        role: '',
        objective: '',
        context: '',
        style: ''
      });
      await fetchRooms();
    } catch (error) {
      console.error('Error adding room:', error);
    }
  };

  const RoomForm = ({ room, onSave, onCancel }: { 
    room: Partial<Room>, 
    onSave: (room: Partial<Room>) => void, 
    onCancel: () => void 
  }) => {
    const [formData, setFormData] = useState(room);

    const handleSubmit = () => {
      if (!formData.room_number?.trim()) {
        alert('Room number is required');
        return;
      }
      onSave(formData);
    };

    return (
      <div className="space-y-4 p-4 bg-white rounded-lg shadow">
        <div>
          <label className="block text-sm font-medium text-gray-700">Room Number</label>
          <input
            type="text"
            value={formData.room_number || ''}
            onChange={(e) => setFormData({ ...formData, room_number: e.target.value })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Role</label>
          <textarea
            value={formData.role || ''}
            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            rows={2}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Objective</label>
          <textarea
            value={formData.objective || ''}
            onChange={(e) => setFormData({ ...formData, objective: e.target.value })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            rows={3}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Context</label>
          <textarea
            value={formData.context || ''}
            onChange={(e) => setFormData({ ...formData, context: e.target.value })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            rows={3}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Style</label>
          <textarea
            value={formData.style || ''}
            onChange={(e) => setFormData({ ...formData, style: e.target.value })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            rows={2}
          />
        </div>
        <div className="flex justify-end space-x-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Room Management</h1>
          <button
            onClick={() => setIsAdding(true)}
            className="px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700 flex items-center"
          >
            <Plus className="w-5 h-5 mr-1" />
            Add Room
          </button>
        </div>

      {isAdding && (
        <div className="mb-8">
          <RoomForm
            room={newRoom}
            onSave={(room) => {
              setNewRoom(room as Omit<Room, 'id'>);
              handleAdd();
            }}
            onCancel={() => setIsAdding(false)}
          />
        </div>
      )}

      <div className="space-y-6">
        {rooms.map((room) => (
          <div key={room.id} className="bg-white rounded-lg shadow p-6">
            {editingRoom?.id === room.id ? (
              <RoomForm
                room={editingRoom}
                onSave={(updatedRoom) => handleEdit(updatedRoom as Room)}
                onCancel={() => setEditingRoom(null)}
              />
            ) : (
              <div>
                <div className="flex justify-between items-start mb-4">
                  <h2 className="text-xl font-semibold">Room {room.room_number}</h2>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setEditingRoom(room)}
                      className="p-2 text-gray-600 hover:text-blue-600"
                    >
                      <Pencil className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(room.id)}
                      className="p-2 text-gray-600 hover:text-red-600"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <h3 className="font-medium text-gray-700">Role</h3>
                    <p className="mt-1 text-gray-600">{room.role}</p>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-700">Objective</h3>
                    <p className="mt-1 text-gray-600">{room.objective}</p>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-700">Context</h3>
                    <p className="mt-1 text-gray-600">{room.context}</p>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-700">Style</h3>
                    <p className="mt-1 text-gray-600">{room.style}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
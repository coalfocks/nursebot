import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Pencil, Trash2, Plus, Loader2 } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import RoomEditor from '../components/RoomEditor';
import type { Database } from '../lib/database.types';

type Room = Database['public']['Tables']['rooms']['Row'];

export default function AdminPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [isAdding, setIsAdding] = useState(false);

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

  const handleSave = async () => {
    setEditingRoom(null);
    setIsAdding(false);
    await fetchRooms();
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex h-full items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
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
          <div className="mb-8 bg-white shadow rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Create New Room</h2>
            <RoomEditor
              onSave={handleSave}
              onCancel={() => setIsAdding(false)}
            />
          </div>
        )}

        <div className="space-y-6">
          {rooms.map((room) => (
            <div key={room.id} className="bg-white rounded-lg shadow p-6">
              {editingRoom?.id === room.id ? (
                <div>
                  <h2 className="text-xl font-semibold mb-4">Edit Room {room.room_number}</h2>
                  <RoomEditor
                    room={editingRoom}
                    onSave={handleSave}
                    onCancel={() => setEditingRoom(null)}
                  />
                </div>
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
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Role</h3>
                      <p className="mt-1 text-sm text-gray-900">{room.role}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Objective</h3>
                      <p className="mt-1 text-sm text-gray-900">{room.objective}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Context</h3>
                      <p className="mt-1 text-sm text-gray-900">{room.context}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Style</h3>
                      <p className="mt-1 text-sm text-gray-900">{room.style}</p>
                    </div>
                    {room.pdf_url && (
                      <div>
                        <h3 className="text-sm font-medium text-gray-500">PDF Document</h3>
                        <a
                          href={room.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 text-sm text-blue-600 hover:text-blue-800"
                        >
                          View PDF
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}

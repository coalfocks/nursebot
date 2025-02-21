import React, { useState, useEffect } from 'react';
import { ChatInterface } from '../components/ChatInterface';
import { useAuthStore } from '../stores/authStore';
import { Link } from 'react-router-dom';
import { Settings, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Room {
  id: number;
  room_number: string;
}

export default function Dashboard() {
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useAuthStore();

  useEffect(() => {
    fetchRooms();
  }, []);

  const fetchRooms = async () => {
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('id, room_number')
        .order('room_number');

      if (error) throw error;
      setRooms(data || []);
    } catch (error) {
      console.error('Error fetching rooms:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-900">Medical Student Dashboard</h1>
          {profile?.is_admin && (
            <Link
              to="/admin"
              className="flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              <Settings className="w-4 h-4 mr-2" />
              Room Management
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="flex gap-6 h-[calc(100vh-200px)]">
            {/* Room Selection Sidebar */}
            <div className="w-64 bg-white rounded-lg shadow p-4">
              <h2 className="text-lg font-semibold mb-4">Patient Rooms</h2>
              {loading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                </div>
              ) : (
                <div className="space-y-2">
                  {rooms.map((room) => (
                    <button
                      key={room.id}
                      onClick={() => setSelectedRoom(room.room_number)}
                      className={`w-full p-3 text-left rounded-lg transition-colors ${
                        selectedRoom === room.room_number
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-50 hover:bg-gray-100'
                      }`}
                    >
                      Room {room.room_number}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Chat Interface */}
            <div className="flex-1">
              {selectedRoom ? (
                <ChatInterface roomNumber={selectedRoom} />
              ) : (
                <div className="h-full flex items-center justify-center bg-white rounded-lg shadow">
                  <p className="text-gray-500">Select a room to start chatting</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
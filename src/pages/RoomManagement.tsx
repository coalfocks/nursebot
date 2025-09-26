import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { Plus, Loader2, Edit, ChevronDown, ChevronUp } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import RoomEditor from '../components/RoomEditor';
import type { Database } from '../lib/database.types';

type Room = Database['public']['Tables']['rooms']['Row'] & {
  specialty: {
    name: string;
  } | null;
};

export default function RoomManagement() {
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<Room | undefined>();
  const [expandedRooms, setExpandedRooms] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!user || !profile?.is_admin) {
      navigate('/dashboard');
      return;
    }
    
    fetchRooms();
  }, [user, profile, navigate]);

  const fetchRooms = async () => {
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select(`
          *,
          specialty:specialty_id (
            name
          )
        `)
        .order('room_number');
      
      if (error) throw error;
      setRooms(data || []);
    } catch (error) {
      console.error('Error fetching rooms:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEditRoom = (room: Room) => {
    setSelectedRoom(room);
    setIsEditing(true);
  };

  const handleCreateRoom = () => {
    setSelectedRoom(undefined);
    setIsEditing(true);
  };

  const handleSave = () => {
    setIsEditing(false);
    fetchRooms();
  };

  const toggleRoomExpanded = (roomId: number) => {
    const newExpanded = new Set(expandedRooms);
    if (newExpanded.has(roomId)) {
      newExpanded.delete(roomId);
    } else {
      newExpanded.add(roomId);
    }
    setExpandedRooms(newExpanded);
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

  if (isEditing) {
    return (
      <AdminLayout>
        <div className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
          <div className="px-4 sm:px-0 mb-6">
            <h2 className="text-2xl font-bold text-gray-900">
              {selectedRoom ? 'Edit Room' : 'Create New Room'}
            </h2>
          </div>
          <div className="bg-white shadow rounded-lg p-6">
            <RoomEditor
              room={selectedRoom}
              onSave={handleSave}
              onCancel={() => setIsEditing(false)}
            />
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0">
          <div className="sm:flex sm:items-center">
            <div className="sm:flex-auto">
              <h2 className="text-2xl font-bold text-gray-900">Patient Rooms</h2>
              <p className="mt-2 text-sm text-gray-700">
                A list of all patient rooms in the system. Click on a room to view more details.
              </p>
            </div>
            <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
              <button
                type="button"
                onClick={handleCreateRoom}
                className="inline-flex items-center justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:w-auto"
              >
                <Plus className="h-4 w-4 mr-2" />
                New Room
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col">
          <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
              <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
                <div className="bg-white">
                  <ul role="list" className="divide-y divide-gray-200">
                    {rooms.map((room) => (
                      <li key={room.id} className="p-4">
                        <div className="w-full">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <button
                                onClick={() => toggleRoomExpanded(room.id)}
                                className="mr-2 text-gray-400 hover:text-gray-600"
                              >
                                {expandedRooms.has(room.id) ? (
                                  <ChevronUp className="h-5 w-5" />
                                ) : (
                                  <ChevronDown className="h-5 w-5" />
                                )}
                              </button>
                              <div>
                                <h3 className="text-sm font-medium text-gray-900">
                                  Room {room.room_number}
                                </h3>
                                <div className="flex items-center space-x-2 mt-1">
                                  {room.specialty && (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                      {room.specialty.name}
                                    </span>
                                  )}
                                  {room.difficulty_level && (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                      {room.difficulty_level}
                                    </span>
                                  )}
                                  {!room.is_active && (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                      Inactive
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => handleEditRoom(room)}
                              className="text-blue-600 hover:text-blue-900"
                            >
                              <Edit className="h-5 w-5" />
                            </button>
                          </div>

                          {expandedRooms.has(room.id) && (
                            <div className="mt-4 pl-7 space-y-4">
                              <div>
                                <h4 className="text-xs font-medium text-gray-500 uppercase">Role</h4>
                                <p className="mt-1 text-sm text-gray-900">{room.role}</p>
                              </div>
                              <div>
                                <h4 className="text-xs font-medium text-gray-500 uppercase">Objective</h4>
                                <p className="mt-1 text-sm text-gray-900">{room.objective}</p>
                              </div>
                              <div>
                                <h4 className="text-xs font-medium text-gray-500 uppercase">Context</h4>
                                <p className="mt-1 text-sm text-gray-900">{room.context}</p>
                              </div>
                              <div>
                                <h4 className="text-xs font-medium text-gray-500 uppercase">Style</h4>
                                <p className="mt-1 text-sm text-gray-900">{room.style}</p>
                              </div>
                              {room.expected_diagnosis && (
                                <div>
                                  <h4 className="text-xs font-medium text-gray-500 uppercase">Expected Diagnosis</h4>
                                  <p className="mt-1 text-sm text-gray-900">{room.expected_diagnosis}</p>
                                </div>
                              )}
                              {room.expected_treatment && room.expected_treatment.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-medium text-gray-500 uppercase">Expected Treatment Steps</h4>
                                  <ul className="mt-1 list-disc list-inside space-y-1">
                                    {room.expected_treatment.map((step, index) => (
                                      <li key={index} className="text-sm text-gray-900">{step}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

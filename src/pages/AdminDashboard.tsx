import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { Loader2, FileText } from 'lucide-react';
import Navbar from '../components/Navbar';
import EmbeddedPdfViewer from '../components/EmbeddedPdfViewer';
import type { Database } from '../lib/database.types';

type Room = Database['public']['Tables']['rooms']['Row'] & {
  specialty?: {
    name: string;
  };
};

export default function AdminDashboard() {
  const { user, profile } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [pdfUrls, setPdfUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    console.log('AdminDashboard mounted, user:', user);
    if (!user) {
      console.log('No user found, returning early');
      return;
    }
    fetchRooms();
  }, [user]);

  const getSignedUrl = async (path: string) => {
    try {
      // Extract just the filename from the full URL
      const filename = path.split('/').pop();
      if (!filename) {
        console.error('No filename found in path:', path);
        return null;
      }

      console.log('Getting signed URL for:', filename);
      const { data, error } = await supabase.storage
        .from('room_pdfs')
        .createSignedUrl(filename, 3600); // URL valid for 1 hour

      if (error) {
        console.error('Error getting signed URL:', error);
        return null;
      }

      console.log('Generated signed URL:', data?.signedUrl);
      return data?.signedUrl;
    } catch (error) {
      console.error('Error getting signed URL:', error);
      return null;
    }
  };

  const fetchRooms = async () => {
    try {
      console.log('Starting to fetch rooms...');
      const { data, error } = await supabase
        .from('rooms')
        .select(`
          *,
          specialty:specialty_id (
            name
          )
        `)
        .order('room_number');

      if (error) {
        console.error('Error fetching rooms:', error);
        throw error;
      }

      console.log('Successfully fetched rooms:', data);
      setRooms(data || []);

      // Get signed URLs for all PDFs
      const urls: Record<string, string> = {};
      for (const room of data || []) {
        if (room.pdf_url) {
          const signedUrl = await getSignedUrl(room.pdf_url);
          if (signedUrl) {
            urls[room.pdf_url] = signedUrl;
          }
        }
      }
      setPdfUrls(urls);
    } catch (error) {
      console.error('Error in fetchRooms:', error);
    } finally {
      setLoading(false);
    }
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
      <div className="flex h-[calc(100vh-64px)]">
        {/* Left column - Room list */}
        <div className="w-1/3 border-r border-gray-200 bg-white overflow-y-auto">
          <div className="p-4">
            <h2 className="text-lg font-semibold text-gray-900">Rooms</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {rooms.length === 0 ? (
              <div className="p-4 text-gray-500">No rooms found</div>
            ) : (
              rooms.map((room) => (
                <button
                  key={room.id}
                  onClick={() => setSelectedRoom(room)}
                  className={`w-full p-4 text-left hover:bg-gray-50 focus:outline-none ${
                    selectedRoom?.id === room.id ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-medium text-gray-900">
                        Room {room.room_number}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {room.specialty?.name || 'General Practice'}
                      </p>
                    </div>
                    {room.pdf_url && (
                      <FileText className="h-5 w-5 text-gray-400" />
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right column - PDF viewer */}
        <div className="flex-1 bg-white p-4">
          {selectedRoom ? (
            <div className="h-full">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Room {selectedRoom.room_number} - {selectedRoom.specialty?.name || 'General Practice'}
                </h2>
              </div>
              {selectedRoom.pdf_url && pdfUrls[selectedRoom.pdf_url] ? (
                <div className="h-[calc(100vh-180px)] border rounded-lg overflow-hidden">
                  <EmbeddedPdfViewer pdfUrl={pdfUrls[selectedRoom.pdf_url]} />
                </div>
              ) : (
                <div className="flex items-center justify-center h-[calc(100vh-180px)] text-gray-500">
                  No PDF available for this room
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              Select a room to view its PDF
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
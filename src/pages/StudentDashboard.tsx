import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { Loader2, FileText } from 'lucide-react';
import Navbar from '../components/Navbar';
import EmbeddedPdfViewer from '../components/EmbeddedPdfViewer';
import type { Database } from '../lib/database.types';

type Assignment = Database['public']['Tables']['student_room_assignments']['Row'] & {
  room: Database['public']['Tables']['rooms']['Row'] & {
    specialty?: {
      name: string;
    };
  };
};

export default function StudentDashboard() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Assignment | null>(null);
  const [pdfUrls, setPdfUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    fetchAssignments();
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

  const fetchAssignments = async () => {
    try {
      const { data, error } = await supabase
        .from('student_room_assignments')
        .select(`
          *,
          room:room_id (
            *,
            specialty:specialty_id (name)
          )
        `)
        .eq('student_id', user?.id)
        .in('status', ['assigned', 'in_progress'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAssignments(data || []);

      // Get signed URLs for all PDFs
      const urls: Record<string, string> = {};
      for (const assignment of data || []) {
        if (assignment.room.pdf_url) {
          const signedUrl = await getSignedUrl(assignment.room.pdf_url);
          if (signedUrl) {
            urls[assignment.room.pdf_url] = signedUrl;
          }
        }
      }
      setPdfUrls(urls);
    } catch (error) {
      console.error('Error fetching assignments:', error);
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
            {assignments.map((assignment) => (
              <button
                key={assignment.id}
                onClick={() => setSelectedRoom(assignment)}
                className={`w-full p-4 text-left hover:bg-gray-50 focus:outline-none ${
                  selectedRoom?.id === assignment.id ? 'bg-blue-50' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">
                      Room {assignment.room.room_number}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {assignment.room.specialty?.name || 'General Practice'}
                    </p>
                  </div>
                  {assignment.room.pdf_url && (
                    <FileText className="h-5 w-5 text-gray-400" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right column - PDF viewer */}
        <div className="flex-1 bg-white p-4">
          {selectedRoom ? (
            <div className="h-full">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Room {selectedRoom.room.room_number} - {selectedRoom.room.specialty?.name || 'General Practice'}
                </h2>
              </div>
              {selectedRoom.room.pdf_url && pdfUrls[selectedRoom.room.pdf_url] ? (
                <div className="h-[calc(100vh-180px)] border rounded-lg overflow-hidden">
                  <EmbeddedPdfViewer pdfUrl={pdfUrls[selectedRoom.room.pdf_url]} />
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
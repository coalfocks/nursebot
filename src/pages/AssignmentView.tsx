import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import Navbar from '../components/Navbar';
import { Loader2, ArrowLeft, Clock, ExternalLink } from 'lucide-react';
import { ChatInterface } from '../components/ChatInterface';
import { FeedbackSidebar } from '../components/FeedbackSidebar';
import type { Database } from '../lib/database.types';
import { fetchSpecialtiesForRoom } from '../lib/roomHelpers';
import { resolveAssignmentRoom } from '../lib/assignmentBaseline';

type Assignment = Database['public']['Tables']['student_room_assignments']['Row'] & {
  room: Database['public']['Tables']['rooms']['Row'] & {
    specialties?: Database['public']['Tables']['specialties']['Row'][];
  };
};

export default function AssignmentView() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [assignment, setAssignment] = useState<Assignment | null>(null);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    
    if (assignmentId) {
      fetchAssignment();
    }
  }, [assignmentId, user]);

  // Subscribe to assignment updates (for feedback generation)
  useEffect(() => {
    if (!assignmentId || !assignment) return;

    const channel = supabase
      .channel(`assignment:${assignmentId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'student_room_assignments',
          filter: `id=eq.${assignmentId}`,
        },
        (payload) => {
          console.log('Assignment updated:', payload);
          if (payload.new) {
            // Update assignment state with new data
            setAssignment((prev) =>
              prev ? { ...prev, ...(payload.new as Partial<Assignment>) } : prev
            );
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [assignmentId, assignment?.id]);

  const fetchAssignment = async () => {
    try {
      const { data, error } = await supabase
        .from('student_room_assignments')
        .select(`
          *,
          student:student_id (
            id,
            full_name,
            study_year
          ),
          room:room_id (
            *
          )
        `)
        .eq('id', assignmentId)
        .single();

      if (error) throw error;
      if (!data) throw new Error('Assignment not found');

      // Verify this assignment belongs to the current user
      if (data.student_id !== user?.id) {
        throw new Error('Unauthorized');
      }

      // Fetch specialties for the room
      const pinnedRoom = resolveAssignmentRoom(data.room, data.scenario_baseline);
      const roomWithSpecialties = {
        ...pinnedRoom,
        specialties: await fetchSpecialtiesForRoom(pinnedRoom),
      };

      const assignmentWithSpecialties = {
        ...data,
        room: roomWithSpecialties,
      };

      console.log('Fetched assignment data:', assignmentWithSpecialties);
      setAssignment(assignmentWithSpecialties);

      // If status is 'assigned', update it to 'in_progress'
      if (data.status === 'assigned') {
        const { error: updateError } = await supabase
          .from('student_room_assignments')
          .update({ status: 'in_progress' })
          .eq('id', assignmentId);

        if (updateError) throw updateError;
        setAssignment({ ...assignmentWithSpecialties, status: 'in_progress' });
      }

    } catch (error) {
      console.error('Error fetching assignment:', error);
      navigate('/assignments');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'assigned':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <Clock className="w-3 h-3 mr-1" />
            Assigned
          </span>
        );
      case 'in_progress':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            <Book className="w-3 h-3 mr-1" />
            In Progress
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle className="w-3 h-3 mr-1" />
            Completed
          </span>
        );
      case 'bedside':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
            <CheckCircle className="w-3 h-3 mr-1" />
            Bedside
          </span>
        );
      default:
        return null;
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

  if (!assignment) {
    return (
      <div className="min-h-screen bg-gray-100">
        <Navbar />
        <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          <div className="px-4 sm:px-0">
            <div className="text-center">
              <h2 className="text-lg font-medium text-gray-900">Assignment not found</h2>
              <p className="mt-1 text-sm text-gray-500">
                The assignment you're looking for doesn't exist or you don't have access to it.
              </p>
              <button
                onClick={() => navigate('/assignments')}
                className="mt-4 inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Assignments
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center">
              <button
                onClick={() => navigate('/assignments')}
                className="mr-4 p-2 text-gray-500 hover:text-gray-700"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <div className="flex items-center">
                  <h1 className="text-2xl font-bold text-gray-900 mr-3">
                    Room {assignment.room.room_number}
                  </h1>
                  {getStatusBadge(assignment.status)}
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  {assignment.room.specialties && assignment.room.specialties.length > 0
                    ? assignment.room.specialties.map(s => s.name).join(', ')
                    : 'General Practice'} - {assignment.room.difficulty_level || 'Standard'} difficulty
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white shadow rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">Nurse Chat</h2>
                  <button
                    type="button"
                    onClick={() => navigate(`/emr?assignmentId=${assignment.id}&roomId=${assignment.room.id}`)}
                    className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
                    title="Open EMR"
                  >
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Open EMR
                  </button>
                </div>
                <ChatInterface
                  assignmentId={assignment.id}
                  roomNumber={assignment.room.room_number}
                  roomId={assignment.room.id}
                  scenarioBaseline={assignment.scenario_baseline}
                  assignmentStatus={assignment.status}
                />
              </div>
            </div>

            <div className="space-y-4">
              {/* Show feedback sidebar when completed */}
              <FeedbackSidebar assignment={assignment} />
              
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 

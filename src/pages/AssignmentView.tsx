import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import Navbar from '../components/Navbar';
import AssignmentFeedback from '../components/AssignmentFeedback';
import { Loader2, ArrowLeft, Clock, Book, CheckCircle, FileText, AlertCircle, ExternalLink } from 'lucide-react';
import { ChatInterface } from '../components/ChatInterface';
import EmbeddedPdfViewer from '../components/EmbeddedPdfViewer';
import type { Database } from '../lib/database.types';
import { generateFeedback } from '../lib/feedbackService';

type Assignment = Database['public']['Tables']['student_room_assignments']['Row'] & {
  room: Database['public']['Tables']['rooms']['Row'] & {
    specialty?: {
      name: string;
    };
  };
};

export default function AssignmentView() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    
    if (assignmentId) {
      fetchAssignment();
    }
  }, [assignmentId, user]);

  const getSignedUrl = async (path: string) => {
    try {
      console.log('Original PDF URL:', path);
      
      // Extract just the filename from the full URL
      const filename = path.split('/').pop();
      console.log('Extracted filename:', filename);

      if (!filename) {
        console.error('No filename found in path');
        return null;
      }

      const { data, error } = await supabase.storage
        .from('room_pdfs')
        .createSignedUrl(filename, 3600); // URL valid for 1 hour

      if (error) {
        console.error('Error getting signed URL:', error);
        throw error;
      }
      console.log('Signed URL response:', data);
      return data?.signedUrl;
    } catch (error) {
      console.error('Error in getSignedUrl:', error);
      return null;
    }
  };

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
            id,
            room_number,
            specialty:specialty_id (
              name
            )
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

      console.log('Fetched assignment data:', data);
      setAssignment(data);

      // If status is 'assigned', update it to 'in_progress'
      if (data.status === 'assigned') {
        const { error: updateError } = await supabase
          .from('student_room_assignments')
          .update({ status: 'in_progress' })
          .eq('id', assignmentId);

        if (updateError) throw updateError;
        setAssignment({ ...data, status: 'in_progress' });
      }

      // Get signed URL for PDF if it exists
      if (data.room.pdf_url) {
        console.log('Found PDF URL in room data:', data.room.pdf_url);
        const signedUrl = await getSignedUrl(data.room.pdf_url);
        console.log('Generated signed URL:', signedUrl);
        if (signedUrl) {
          setPdfUrl(signedUrl);
        } else {
          console.log('Failed to generate signed URL');
        }
      } else {
        console.log('No PDF URL found in room data');
      }
    } catch (error) {
      console.error('Error fetching assignment:', error);
      navigate('/assignments');
    } finally {
      setLoading(false);
    }
  };

  const handleRetryFeedback = async () => {
    if (!assignmentId || processing) return;
    
    setProcessing(true);
    try {
      await generateFeedback(assignmentId);
      await fetchAssignment();
    } catch (error) {
      console.error('Error retrying feedback:', error);
    } finally {
      setProcessing(false);
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
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle className="w-3 h-3 mr-1" />
            Completed
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
                  {assignment.room.specialty?.name || 'General Practice'} - {assignment.room.difficulty_level || 'Standard'} difficulty
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
                    onClick={() => navigate('/emr')}
                    className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
                    title="Open EHR"
                  >
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Open EHR
                  </button>
                </div>
                <ChatInterface assignmentId={assignment.id} roomNumber={assignment.room.room_number} roomId={assignment.room.id} />
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-white shadow rounded-lg p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-gray-500" />
                  <h2 className="text-lg font-medium text-gray-900">Room Resources</h2>
                </div>
                {assignment.status === 'in_progress' && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                    <div className="flex items-center">
                      <AlertCircle className="w-5 h-5 text-red-400 mr-2" />
                      <span className="text-sm font-medium text-red-800">Urgent Response Needed</span>
                    </div>
                  </div>
                )}
                {assignment.due_date && (
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-gray-500" />
                    <div>
                      <p className="text-xs text-gray-500">Due Date</p>
                      <p className="text-sm font-medium text-gray-900">
                        {new Date(assignment.due_date).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-sm text-gray-600 mb-2">
                    Use the EHR to find your patient and place orders; the chat is for nurse interactions only.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate('/emr')}
                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Go to EHR
                  </button>
                </div>
                {pdfUrl ? (
                  <div className="h-[240px] border rounded-lg overflow-hidden">
                    <EmbeddedPdfViewer pdfUrl={pdfUrl} />
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No progress note provided for this room.</p>
                )}
                {(['completed', 'bedside'].includes(assignment.status) || assignment.nurse_feedback) && (
                  <AssignmentFeedback assignment={assignment} onRetryFeedback={handleRetryFeedback} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 

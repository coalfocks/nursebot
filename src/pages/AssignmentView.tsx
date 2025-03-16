import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import Navbar from '../components/Navbar';
import AssignmentFeedback from '../components/AssignmentFeedback';
import { Loader2, ArrowLeft, Clock, Book, CheckCircle, FileText } from 'lucide-react';
import { ChatInterface } from '../components/ChatInterface';
import PdfViewer from '../components/PdfViewer';
import type { Database } from '../lib/database.types';

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
  const [showPdfViewer, setShowPdfViewer] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    
    if (assignmentId) {
      fetchAssignment();
    }
  }, [assignmentId, user]);

  const fetchAssignment = async () => {
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
        .eq('id', assignmentId)
        .single();

      if (error) throw error;
      if (!data) throw new Error('Assignment not found');
      
      // Verify this assignment belongs to the current user
      if (data.student_id !== user?.id) {
        throw new Error('Unauthorized');
      }

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
            {/* Room Information */}
            <div className="lg:col-span-1">
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">Room Information</h2>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Objective</h3>
                    <p className="mt-1 text-sm text-gray-900">{assignment.room.objective}</p>
                  </div>
                  {assignment.room.initial_vitals && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Initial Vitals</h3>
                      <pre className="mt-1 text-sm text-gray-900 whitespace-pre-wrap font-sans">
                        {JSON.stringify(assignment.room.initial_vitals, null, 2)}
                      </pre>
                    </div>
                  )}
                  {assignment.due_date && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Due Date</h3>
                      <p className="mt-1 text-sm text-gray-900">{new Date(assignment.due_date).toLocaleDateString()}</p>
                    </div>
                  )}
                  {assignment.room.pdf_url && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Room Documents</h3>
                      <div className="mt-2">
                        <button
                          onClick={() => setShowPdfViewer(true)}
                          className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          View PDF Document
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Feedback Section */}
              {(assignment.status === 'completed' || assignment.nurse_feedback) && (
                <div className="mt-6">
                  <AssignmentFeedback 
                    assignment={assignment}
                    onRetryFeedback={fetchAssignment}
                  />
                </div>
              )}
            </div>

            {/* Chat Section */}
            <div className="lg:col-span-2">
              <ChatInterface roomNumber={assignment.room.room_number} />
            </div>
          </div>
        </div>
      </div>

      {/* PDF Viewer Modal */}
      {showPdfViewer && assignment?.room.pdf_url && (
        <PdfViewer 
          pdfUrl={assignment.room.pdf_url} 
          onClose={() => setShowPdfViewer(false)} 
        />
      )}
    </div>
  );
} 
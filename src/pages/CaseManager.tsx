import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import AdminLayout from '../components/admin/AdminLayout';
import { Loader2, User, Calendar, List, MessageSquare, FileText, CheckSquare, XCircle, ArrowLeft } from 'lucide-react';
import { hasAdminAccess, isSuperAdmin } from '../lib/roles';

interface CaseWithDetails {
  id: string;
  title: string;
  description: string;
  patient_history: string;
  initial_vitals: any;
  difficulty_level: string;
  expected_diagnosis: string;
  expected_treatment: string[];
  is_active: boolean;
  specialty: {
    name: string;
    description: string;
  };
}

interface CaseAssignment {
  id: string;
  status: 'assigned' | 'in_progress' | 'completed';
  due_date: string | null;
  created_at: string;
  updated_at: string;
  user: {
    id: string;
    full_name: string;
    study_year: number;
    specialization_interest: string | null;
  };
  submission?: {
    id: string;
    diagnosis: string;
    treatment_plan: string;
    notes: string;
    created_at: string;
  };
  feedback?: {
    id: string;
    feedback: string;
    grade: number | null;
    strengths: string[];
    areas_for_improvement: string[];
    created_at: string;
  };
  effective_date?: string | null;
}

export default function CaseManager() {
  const { caseId } = useParams<{ caseId: string }>();
  const { user, profile, activeSchoolId } = useAuthStore();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [caseDetails, setCaseDetails] = useState<CaseWithDetails | null>(null);
  const [assignments, setAssignments] = useState<CaseAssignment[]>([]);
  const [activeTab, setActiveTab] = useState<'details' | 'assignments'>('details');
  
  // Feedback form state
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>('');
  const [feedbackText, setFeedbackText] = useState('');
  const [grade, setGrade] = useState<string>('');
  const [strengths, setStrengths] = useState<string[]>(['']);
  const [areasForImprovement, setAreasForImprovement] = useState<string[]>(['']);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  const hasAdmin = hasAdminAccess(profile);
  const scopedSchoolId = isSuperAdmin(profile) ? activeSchoolId : profile?.school_id ?? null;

  useEffect(() => {
    if (!user || !hasAdmin) {
      navigate('/dashboard');
      return;
    }
    
    if (caseId) {
      fetchCaseData(caseId);
    }
  }, [caseId, user, hasAdmin, navigate]);

  const fetchCaseData = async (id: string) => {
    setLoading(true);
    try {
      await Promise.all([
        fetchCaseDetails(id),
        fetchCaseAssignments(id)
      ]);
    } catch (error) {
      console.error('Error fetching case data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCaseDetails = async (id: string) => {
    const { data, error } = await supabase
      .from('cases')
      .select(`
        *,
        specialty:specialty_id (
          name,
          description
        )
      `)
      .eq('id', id)
      .single();
    
    if (error) throw error;
    setCaseDetails(data);
  };

  const fetchCaseAssignments = async (id: string) => {
    let query = supabase
      .from('student_room_assignments')
      .select(`
        *,
        student:student_id (
          id,
          full_name,
          email,
          study_year
        ),
        room:room_id (
          *,
          specialty:specialty_id (name)
        )
      `)
      .eq('room_id', id)
      .order('created_at', { ascending: false });

    if (scopedSchoolId) {
      query = query.eq('school_id', scopedSchoolId);
    }

    const { data, error } = await query;
    
    if (error) throw error;
    setAssignments(data || []);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Not set';
    const date = new Date(dateString);
    const formattedDate = date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    return `${formattedDate} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'assigned':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            Assigned
          </span>
        );
      case 'in_progress':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            In Progress
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            Completed
          </span>
        );
      default:
        return null;
    }
  };

  const addStrengthField = () => {
    setStrengths([...strengths, '']);
  };

  const removeStrengthField = (index: number) => {
    const newStrengths = [...strengths];
    newStrengths.splice(index, 1);
    setStrengths(newStrengths);
  };

  const updateStrength = (index: number, value: string) => {
    const newStrengths = [...strengths];
    newStrengths[index] = value;
    setStrengths(newStrengths);
  };

  const addAreaForImprovementField = () => {
    setAreasForImprovement([...areasForImprovement, '']);
  };

  const removeAreaForImprovementField = (index: number) => {
    const newAreas = [...areasForImprovement];
    newAreas.splice(index, 1);
    setAreasForImprovement(newAreas);
  };

  const updateAreaForImprovement = (index: number, value: string) => {
    const newAreas = [...areasForImprovement];
    newAreas[index] = value;
    setAreasForImprovement(newAreas);
  };

  const handleProvideFeedback = (assignmentId: string) => {
    const assignment = assignments.find(a => a.id === assignmentId);
    if (assignment) {
      // Pre-fill form if feedback exists
      if (assignment.feedback) {
        setFeedbackText(assignment.feedback.feedback || '');
        setGrade(assignment.feedback.grade?.toString() || '');
        setStrengths(assignment.feedback.strengths?.length ? assignment.feedback.strengths : ['']);
        setAreasForImprovement(assignment.feedback.areas_for_improvement?.length ? assignment.feedback.areas_for_improvement : ['']);
      } else {
        // Reset form
        setFeedbackText('');
        setGrade('');
        setStrengths(['']);
        setAreasForImprovement(['']);
      }
      setSelectedAssignmentId(assignmentId);
      setShowFeedbackForm(true);
    }
  };

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackError('');
    
    if (!feedbackText.trim()) {
      setFeedbackError('Feedback text is required');
      return;
    }
    
    const filteredStrengths = strengths.filter(s => s.trim() !== '');
    const filteredAreas = areasForImprovement.filter(a => a.trim() !== '');
    const parsedGrade = grade ? parseInt(grade) : null;
    
    if (parsedGrade !== null && (parsedGrade < 0 || parsedGrade > 100)) {
      setFeedbackError('Grade must be between 0 and 100');
      return;
    }
    
    setIsSubmittingFeedback(true);
    
    try {
      const assignment = assignments.find(a => a.id === selectedAssignmentId);
      
      if (assignment?.feedback?.id) {
        // Update existing feedback
        const { error } = await supabase
          .from('case_feedback')
          .update({
            feedback: feedbackText,
            grade: parsedGrade,
            strengths: filteredStrengths,
            areas_for_improvement: filteredAreas,
            updated_at: new Date().toISOString(),
          })
          .eq('id', assignment.feedback.id);
        
        if (error) throw error;
      } else {
        // Create new feedback
        const { error } = await supabase
          .from('case_feedback')
          .insert([
            {
              case_assignment_id: selectedAssignmentId,
              feedback: feedbackText,
              grade: parsedGrade,
              strengths: filteredStrengths,
              areas_for_improvement: filteredAreas,
              reviewer_id: user!.id,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
          ]);
        
        if (error) throw error;
        
        // Update assignment status if not already completed
        const { error: updateError } = await supabase
          .from('student_room_assignments')
          .update({
            status: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', selectedAssignmentId)
          .eq('status', 'in_progress'); // Only update if in progress
        
        if (updateError) throw updateError;
      }
      
      // Refresh assignments
      if (caseId) {
        await fetchCaseAssignments(caseId);
      }
      
      setShowFeedbackForm(false);
    } catch (error: any) {
      console.error('Error submitting feedback:', error);
      setFeedbackError(error.message || 'Failed to submit feedback');
    } finally {
      setIsSubmittingFeedback(false);
    }
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

  if (!caseDetails) {
    return (
      <AdminLayout>
        <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          <div className="px-4 py-6 sm:px-0">
            <div className="bg-white shadow rounded-lg p-6">
              <p className="text-center text-gray-500">Case not found</p>
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => navigate('/admin-dashboard')}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-4 sm:px-0">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center">
              <button
                onClick={() => navigate('/admin-dashboard')}
                className="mr-4 p-2 text-gray-500 hover:text-gray-700"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="text-2xl font-bold text-gray-900">{caseDetails.title}</h1>
              {caseDetails.is_active ? (
                <span className="ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  Active
                </span>
              ) : (
                <span className="ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                  Inactive
                </span>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('details')}
                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'details'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <FileText className="w-4 h-4 inline mr-2" />
                Case Details
              </button>
              <button
                onClick={() => setActiveTab('assignments')}
                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'assignments'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <User className="w-4 h-4 inline mr-2" />
                Student Assignments ({assignments.length})
              </button>
            </nav>
          </div>

          {activeTab === 'details' && (
            <div className="bg-white shadow overflow-hidden rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Case Information</h3>
                    <dl className="space-y-4">
                      <div>
                        <dt className="text-sm font-medium text-gray-500">Specialty</dt>
                        <dd className="mt-1 text-sm text-gray-900">{caseDetails.specialty?.name}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-gray-500">Difficulty Level</dt>
                        <dd className="mt-1 text-sm text-gray-900">{caseDetails.difficulty_level}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-gray-500">Description</dt>
                        <dd className="mt-1 text-sm text-gray-900">{caseDetails.description}</dd>
                      </div>
                    </dl>
                  </div>
                  
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Clinical Details</h3>
                    <dl className="space-y-4">
                      <div>
                        <dt className="text-sm font-medium text-gray-500">Patient History</dt>
                        <dd className="mt-1 text-sm text-gray-900">{caseDetails.patient_history}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-medium text-gray-500">Initial Vitals</dt>
                        <dd className="mt-1 text-sm text-gray-900">
                          <pre className="whitespace-pre-wrap font-sans">
                            {JSON.stringify(caseDetails.initial_vitals, null, 2)}
                          </pre>
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
                
                <div className="mt-8 border-t border-gray-200 pt-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Expected Outcomes</h3>
                  <dl className="space-y-4">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Expected Diagnosis</dt>
                      <dd className="mt-1 text-sm text-gray-900">{caseDetails.expected_diagnosis}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Expected Treatment Plan</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        <ul className="list-disc pl-5 space-y-1">
                          {caseDetails.expected_treatment.map((treatment, index) => (
                            <li key={index} className="text-sm text-gray-900">{treatment}</li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'assignments' && (
            <>
              {showFeedbackForm ? (
                <div className="bg-white shadow overflow-hidden rounded-lg">
                  <div className="px-4 py-5 sm:p-6">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-medium text-gray-900">Provide Feedback</h3>
                      <button
                        onClick={() => setShowFeedbackForm(false)}
                        className="p-2 text-gray-500 hover:text-gray-700"
                      >
                        <XCircle className="w-5 h-5" />
                      </button>
                    </div>
                    
                    {feedbackError && (
                      <div className="mb-4 p-4 rounded-md bg-red-50 text-red-800">
                        {feedbackError}
                      </div>
                    )}
                    
                    <form onSubmit={handleSubmitFeedback}>
                      <div className="space-y-6">
                        <div>
                          <label htmlFor="feedbackText" className="block text-sm font-medium text-gray-700">
                            Feedback
                          </label>
                          <textarea
                            id="feedbackText"
                            value={feedbackText}
                            onChange={(e) => setFeedbackText(e.target.value)}
                            rows={4}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            placeholder="Provide detailed feedback on the student's performance..."
                          />
                        </div>
                        
                        <div>
                          <label htmlFor="grade" className="block text-sm font-medium text-gray-700">
                            Grade (0-100)
                          </label>
                          <input
                            type="number"
                            id="grade"
                            min="0"
                            max="100"
                            value={grade}
                            onChange={(e) => setGrade(e.target.value)}
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Strengths
                          </label>
                          {strengths.map((strength, index) => (
                            <div key={`strength-${index}`} className="flex items-center mb-2">
                              <input
                                type="text"
                                value={strength}
                                onChange={(e) => updateStrength(index, e.target.value)}
                                className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                placeholder="Add a strength..."
                              />
                              {strengths.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeStrengthField(index)}
                                  className="ml-2 p-2 text-red-500 hover:text-red-700"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={addStrengthField}
                            className="mt-1 text-sm text-blue-600 hover:text-blue-500"
                          >
                            + Add another strength
                          </button>
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Areas for Improvement
                          </label>
                          {areasForImprovement.map((area, index) => (
                            <div key={`area-${index}`} className="flex items-center mb-2">
                              <input
                                type="text"
                                value={area}
                                onChange={(e) => updateAreaForImprovement(index, e.target.value)}
                                className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                placeholder="Add an area for improvement..."
                              />
                              {areasForImprovement.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeAreaForImprovementField(index)}
                                  className="ml-2 p-2 text-red-500 hover:text-red-700"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={addAreaForImprovementField}
                            className="mt-1 text-sm text-blue-600 hover:text-blue-500"
                          >
                            + Add another area for improvement
                          </button>
                        </div>
                        
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => setShowFeedbackForm(false)}
                            className="mr-3 px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={isSubmittingFeedback}
                            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                          >
                            {isSubmittingFeedback ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Submitting...
                              </>
                            ) : (
                              <>
                                <CheckSquare className="w-4 h-4 mr-2" />
                                Submit Feedback
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                </div>
              ) : (
                <div className="bg-white shadow overflow-hidden rounded-lg">
                  {assignments.length === 0 ? (
                    <div className="px-4 py-5 sm:p-6 text-center">
                      <p className="text-gray-500">No students have been assigned to this case yet.</p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-gray-200">
                      {assignments.map((assignment) => (
                        <li key={assignment.id} className="p-6">
                          <div className="flex flex-col md:flex-row md:justify-between md:items-start">
                            <div className="flex-1">
                              <div className="flex items-center">
                                <h3 className="text-lg font-medium text-gray-900 mr-3">
                                  {assignment.user.full_name}
                                </h3>
                                {getStatusBadge(assignment.status)}
                              </div>
                              <p className="mt-1 text-sm text-gray-500">
                                Year {assignment.user.study_year} • {assignment.user.specialization_interest || 'No specialization'}
                              </p>
                              
                              <div className="mt-3 flex items-center text-sm text-gray-500 space-x-4">
                                <div className="flex items-center">
                                  <Calendar className="w-4 h-4 mr-1" />
                                  <span>Assigned: {formatDate(assignment.created_at)}</span>
                                </div>
                                {assignment.due_date && (
                                  <div className="flex items-center">
                                    <Calendar className="w-4 h-4 mr-1" />
                                    <span>Due: {formatDate(assignment.due_date)}</span>
                                  </div>
                                )}
                                {assignment.effective_date && (
                                  <div className="flex items-center">
                                    <Calendar className="w-4 h-4 mr-1" />
                                    <span>Effective: {formatDate(assignment.effective_date)}</span>
                                  </div>
                                )}
                              </div>
                              
                              {/* Submission details */}
                              {assignment.submission && (
                                <div className="mt-4 bg-gray-50 p-4 rounded-md">
                                  <h4 className="text-sm font-medium text-gray-900 flex items-center">
                                    <FileText className="w-4 h-4 mr-2" />
                                    Submission ({formatDate(assignment.submission.created_at)})
                                  </h4>
                                  <div className="mt-2 space-y-2">
                                    <div>
                                      <p className="text-xs font-medium text-gray-500">Diagnosis</p>
                                      <p className="text-sm text-gray-900">{assignment.submission.diagnosis}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs font-medium text-gray-500">Treatment Plan</p>
                                      <p className="text-sm text-gray-900">{assignment.submission.treatment_plan}</p>
                                    </div>
                                    {assignment.submission.notes && (
                                      <div>
                                        <p className="text-xs font-medium text-gray-500">Notes</p>
                                        <p className="text-sm text-gray-900">{assignment.submission.notes}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                              
                              {/* Feedback details */}
                              {assignment.feedback && (
                                <div className="mt-4 bg-blue-50 p-4 rounded-md">
                                  <h4 className="text-sm font-medium text-gray-900 flex items-center">
                                    <MessageSquare className="w-4 h-4 mr-2" />
                                    Feedback
                                    {assignment.feedback.grade && (
                                      <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-md">
                                        Grade: {assignment.feedback.grade}/100
                                      </span>
                                    )}
                                  </h4>
                                  <p className="mt-2 text-sm text-gray-700">{assignment.feedback.feedback}</p>
                                  
                                  {assignment.feedback.strengths && assignment.feedback.strengths.length > 0 && (
                                    <div className="mt-2">
                                      <p className="text-xs font-medium text-gray-700">Strengths:</p>
                                      <ul className="mt-1 text-sm text-gray-700 list-disc pl-5">
                                        {assignment.feedback.strengths.map((strength, idx) => (
                                          <li key={idx}>{strength}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  
                                  {assignment.feedback.areas_for_improvement && assignment.feedback.areas_for_improvement.length > 0 && (
                                    <div className="mt-2">
                                      <p className="text-xs font-medium text-gray-700">Areas for Improvement:</p>
                                      <ul className="mt-1 text-sm text-gray-700 list-disc pl-5">
                                        {assignment.feedback.areas_for_improvement.map((area, idx) => (
                                          <li key={idx}>{area}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            
                            <div className="mt-4 md:mt-0 md:ml-4">
                              {assignment.status === 'in_progress' && assignment.submission && !assignment.feedback && (
                                <button
                                  onClick={() => handleProvideFeedback(assignment.id)}
                                  className="inline-flex items-center px-3 py-2 border border-transparent rounded-md shadow-sm text-sm leading-4 font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                                >
                                  Provide Feedback
                                </button>
                              )}
                              
                              {assignment.feedback && (
                                <button
                                  onClick={() => handleProvideFeedback(assignment.id)}
                                  className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm leading-4 font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                                >
                                  Edit Feedback
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

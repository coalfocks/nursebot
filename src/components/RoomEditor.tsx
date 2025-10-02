import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Loader2, FileText, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { useAuthStore } from '../stores/authStore';
import { useSchools } from '../hooks/useSchools';
import { hasAdminAccess, isSuperAdmin } from '../lib/roles';

type Room = Database['public']['Tables']['rooms']['Row'];
type Specialty = Database['public']['Tables']['specialties']['Row'];

interface RoomEditorProps {
  room?: Room;
  onSave: () => void;
  onCancel: () => void;
}

export default function RoomEditor({ room, onSave, onCancel }: RoomEditorProps) {
  const { profile, activeSchoolId } = useAuthStore();
  const { schools } = useSchools();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  
  // Form state
  const [roomNumber, setRoomNumber] = useState(room?.room_number || '');
  const [role, setRole] = useState(room?.role || '');
  const [objective, setObjective] = useState(room?.objective || '');
  const [context, setContext] = useState(room?.context || '');
  const [style, setStyle] = useState(room?.style || '');
  
  // Advanced settings
  const [specialtyId, setSpecialtyId] = useState(room?.specialty_id || '');
  const [difficultyLevel, setDifficultyLevel] = useState<'beginner' | 'intermediate' | 'advanced' | null>(
    room?.difficulty_level || null
  );
  const [expectedDiagnosis, setExpectedDiagnosis] = useState(room?.expected_diagnosis || '');
  const [expectedTreatment, setExpectedTreatment] = useState<string[]>(room?.expected_treatment || []);
  const [isActive, setIsActive] = useState(room?.is_active ?? true);
  const scopedSchoolId = isSuperAdmin(profile)
    ? room?.school_id ?? activeSchoolId ?? null
    : profile?.school_id ?? room?.school_id ?? null;
  const [schoolId, setSchoolId] = useState<string>(scopedSchoolId ?? '');
  
  // PDF upload state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(room?.pdf_url || null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadSpecialties = async () => {
      try {
        let query = supabase
          .from('specialties')
          .select('*')
          .order('name');

        if (schoolId) {
          query = query.eq('school_id', schoolId);
        }

        const { data, error } = await query;

        if (error) {
          console.error('Error fetching specialties:', error);
          return;
        }

        if (isMounted) {
          setSpecialties(data || []);
        }
      } catch (err) {
        console.error('Error fetching specialties:', err);
      }
    };

    void loadSpecialties();

    return () => {
      isMounted = false;
    };
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId && scopedSchoolId) {
      setSchoolId(scopedSchoolId);
    }
  }, [scopedSchoolId, schoolId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const finalSchoolId = schoolId || scopedSchoolId;

      if (!finalSchoolId) {
        setError('Please select a school before saving this room.');
        return;
      }

      // Handle PDF upload if a new file is selected
      let finalPdfUrl = pdfUrl;
      
      if (pdfFile) {
        setIsUploading(true);
        
        // If there's an existing PDF, delete it first
        if (pdfUrl) {
          const oldPath = pdfUrl.split('/').pop();
          if (oldPath) {
            await supabase.storage.from('room_pdfs').remove([oldPath]);
          }
        }
        
        // Generate a unique filename
        const fileExt = pdfFile.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
        const filePath = `${fileName}`;
        
        // Upload the new file
        const { error: uploadError } = await supabase.storage
          .from('room_pdfs')
          .upload(filePath, pdfFile, {
            cacheControl: '3600',
            upsert: false,
          });
        
        if (uploadError) throw uploadError;
        
        // Get the public URL
        const { data: { publicUrl } } = supabase.storage
          .from('room_pdfs')
          .getPublicUrl(filePath);
        
        finalPdfUrl = publicUrl;
      }

      const roomData = {
        room_number: roomNumber,
        role,
        objective,
        context,
        style,
        specialty_id: specialtyId || null,
        difficulty_level: difficultyLevel,
        expected_diagnosis: expectedDiagnosis || null,
        expected_treatment: expectedTreatment.length > 0 ? expectedTreatment : null,
        is_active: isActive,
        pdf_url: finalPdfUrl,
        school_id: finalSchoolId,
      };

      if (room) {
        const { error } = await supabase
          .from('rooms')
          .update(roomData)
          .eq('id', room.id);
        
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('rooms')
          .insert([roomData]);
        
        if (error) throw error;
      }

      onSave();
    } catch (error) {
      console.error('Error saving room:', error);
      setError('Failed to save room. Please try again.');
    } finally {
      setIsLoading(false);
      setIsUploading(false);
    }
  };

  const handleTreatmentChange = (index: number, value: string) => {
    const newTreatments = [...expectedTreatment];
    newTreatments[index] = value;
    setExpectedTreatment(newTreatments);
  };

  const addTreatment = () => {
    setExpectedTreatment([...expectedTreatment, '']);
  };

  const removeTreatment = (index: number) => {
    setExpectedTreatment(expectedTreatment.filter((_, i) => i !== index));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setPdfFile(file);
      setError('');
    } else {
      setError('Please select a valid PDF file.');
    }
  };

  const handleRemovePdf = async () => {
    if (pdfUrl) {
      try {
        const path = pdfUrl.split('/').pop();
        if (path) {
          await supabase.storage.from('room_pdfs').remove([path]);
        }
        setPdfUrl(null);
        setPdfFile(null);
      } catch (error) {
        console.error('Error removing PDF:', error);
        setError('Failed to remove PDF. Please try again.');
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Information */}
      <div className="space-y-4">
        {hasAdminAccess(profile) && isSuperAdmin(profile) && (
          <div>
            <label htmlFor="school" className="block text-sm font-medium text-gray-700">
              School
            </label>
            <select
              id="school"
              value={schoolId}
              onChange={(e) => setSchoolId(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              required
            >
              <option value="" disabled>
                Select a school
              </option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {hasAdminAccess(profile) && !isSuperAdmin(profile) && (
          <div>
            <label className="block text-sm font-medium text-gray-700">School</label>
            <p className="mt-1 text-sm text-gray-500">
              This room belongs to your school assignment and cannot be changed.
            </p>
          </div>
        )}
        <div>
          <label htmlFor="roomNumber" className="block text-sm font-medium text-gray-700">
            Room Number
          </label>
          <input
            type="text"
            id="roomNumber"
            value={roomNumber}
            onChange={(e) => setRoomNumber(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            required
          />
        </div>

        <div>
          <label htmlFor="role" className="block text-sm font-medium text-gray-700">
            Role
          </label>
          <textarea
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            rows={2}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            required
          />
        </div>

        <div>
          <label htmlFor="objective" className="block text-sm font-medium text-gray-700">
            Objective
          </label>
          <textarea
            id="objective"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={2}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            required
          />
        </div>

        <div>
          <label htmlFor="context" className="block text-sm font-medium text-gray-700">
            Context
          </label>
          <textarea
            id="context"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={3}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            required
          />
        </div>

        <div>
          <label htmlFor="style" className="block text-sm font-medium text-gray-700">
            Style
          </label>
          <textarea
            id="style"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            rows={2}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            required
          />
        </div>
      </div>

      {/* PDF Upload Section */}
      <div className="space-y-4 border-t border-gray-200 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900">PDF Document</h3>
          <button
            type="button"
            onClick={() => document.getElementById('pdf-upload')?.click()}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 shadow-sm"
          >
            <FileText className="h-4 w-4 mr-2" />
            {pdfUrl ? 'Change PDF' : 'Upload PDF'}
          </button>
          <input
            id="pdf-upload"
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {pdfUrl && (
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center space-x-3">
              <FileText className="h-5 w-5 text-gray-400" />
              <span className="text-sm text-gray-900">Current PDF</span>
            </div>
            <div className="flex items-center space-x-4">
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                View PDF
              </a>
              <button
                type="button"
                onClick={handleRemovePdf}
                className="text-sm text-red-600 hover:text-red-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {pdfFile && (
          <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
            <div className="flex items-center space-x-3">
              <FileText className="h-5 w-5 text-blue-400" />
              <span className="text-sm text-blue-900">{pdfFile.name}</span>
            </div>
            <button
              type="button"
              onClick={() => setPdfFile(null)}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {isUploading && (
          <div className="flex items-center space-x-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span className="text-sm text-gray-500">Uploading PDF...</span>
          </div>
        )}
      </div>

      {/* Advanced Settings */}
      <div className="space-y-4 border-t border-gray-200 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900">Advanced Settings</h3>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
          >
            {showAdvanced ? (
              <ChevronUp className="h-4 w-4 mr-1" />
            ) : (
              <ChevronDown className="h-4 w-4 mr-1" />
            )}
            {showAdvanced ? 'Hide Advanced Settings' : 'Show Advanced Settings'}
          </button>
        </div>

        {showAdvanced && (
          <div className="space-y-4">
            <div>
              <label htmlFor="specialty" className="block text-sm font-medium text-gray-700">
                Specialty
              </label>
              <select
                id="specialty"
                value={specialtyId}
                onChange={(e) => setSpecialtyId(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              >
                <option value="">No specialty</option>
                {specialties.map((specialty) => (
                  <option key={specialty.id} value={specialty.id}>
                    {specialty.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="difficulty" className="block text-sm font-medium text-gray-700">
                Difficulty Level
              </label>
              <select
                id="difficulty"
                value={difficultyLevel || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setDifficultyLevel(value === '' ? null : value as 'beginner' | 'intermediate' | 'advanced');
                }}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              >
                <option value="">No difficulty set</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>

            <div>
              <label htmlFor="expectedDiagnosis" className="block text-sm font-medium text-gray-700">
                Expected Diagnosis
              </label>
              <textarea
                id="expectedDiagnosis"
                value={expectedDiagnosis}
                onChange={(e) => setExpectedDiagnosis(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                placeholder="Enter the expected diagnosis"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Expected Treatment Steps
              </label>
              <div className="space-y-2">
                {expectedTreatment.map((treatment, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      value={treatment}
                      onChange={(e) => handleTreatmentChange(index, e.target.value)}
                      className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                      placeholder={`Treatment step ${index + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeTreatment(index)}
                      className="px-2 py-1 text-sm text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addTreatment}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  + Add treatment step
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="isActive" className="ml-2 block text-sm text-gray-700">
                  Room is active
                </label>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Inactive rooms won't be available for assignments
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Room'
          )}
        </button>
      </div>
    </form>
  );
} 

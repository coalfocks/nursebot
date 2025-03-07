import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';

type Room = Database['public']['Tables']['rooms']['Row'];
type Specialty = Database['public']['Tables']['specialties']['Row'];

interface RoomEditorProps {
  room?: Room;
  onSave: () => void;
  onCancel: () => void;
}

export default function RoomEditor({ room, onSave, onCancel }: RoomEditorProps) {
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

  useEffect(() => {
    fetchSpecialties();
  }, []);

  const fetchSpecialties = async () => {
    const { data, error } = await supabase
      .from('specialties')
      .select('*')
      .order('name');
    
    if (error) {
      console.error('Error fetching specialties:', error);
      return;
    }
    
    setSpecialties(data || []);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
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
        completion_token: '<completed>',
        is_active: isActive,
      };

      if (room?.id) {
        // Update existing room
        const { error } = await supabase
          .from('rooms')
          .update(roomData)
          .eq('id', room.id);

        if (error) throw error;
      } else {
        // Create new room
        const { error } = await supabase
          .from('rooms')
          .insert([roomData]);

        if (error) throw error;
      }

      onSave();
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsLoading(false);
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4">
          <div className="flex">
            <div className="ml-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label htmlFor="roomNumber" className="block text-sm font-medium text-gray-700">
            Room Number *
          </label>
          <input
            type="text"
            id="roomNumber"
            required
            value={roomNumber}
            onChange={(e) => setRoomNumber(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="role" className="block text-sm font-medium text-gray-700">
            Role *
          </label>
          <input
            type="text"
            id="role"
            required
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="objective" className="block text-sm font-medium text-gray-700">
            Objective *
          </label>
          <textarea
            id="objective"
            required
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={3}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="context" className="block text-sm font-medium text-gray-700">
            Context *
          </label>
          <textarea
            id="context"
            required
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={3}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="style" className="block text-sm font-medium text-gray-700">
            Style *
          </label>
          <textarea
            id="style"
            required
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            rows={3}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>

        <div className="pt-4">
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
            Advanced Settings
          </button>
        </div>

        {showAdvanced && (
          <div className="space-y-4 pt-4 border-t border-gray-200">
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

      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex justify-center px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
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
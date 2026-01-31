import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { useAuthStore } from '../stores/authStore';
import { useSchools } from '../hooks/useSchools';
import { hasAdminAccess, isSuperAdmin } from '../lib/roles';
import { instantLabs, pendingLabs } from '../features/emr/lib/labCatalog';
import type { RoomOrdersConfig } from '../features/emr/lib/types';

type Room = Database['public']['Tables']['rooms']['Row'];
type Specialty = Database['public']['Tables']['specialties']['Row'];
type AdmissionLabEntry = {
  labName: string;
  note: string;
  value?: string;
  unit?: string;
  referenceRange?: string;
  status?: string;
};

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
  const [style, setStyle] = useState(room?.style || '');
  const [patientName, setPatientName] = useState('');
  const [nurseContext, setNurseContext] = useState(room?.nurse_context || room?.context || '');
  const parsedEmrContext = (() => {
    const raw = room?.emr_context;
    let contextText = raw || '';
    let admissionLabs: AdmissionLabEntry[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.context === 'string') {
            contextText = parsed.context;
          }
          const labs = (parsed as { admission?: { labs?: AdmissionLabEntry[] } })?.admission?.labs;
          if (Array.isArray(labs)) {
            admissionLabs = labs
              .filter((entry) => entry && (entry.labName || entry.note || entry.value))
              .map((entry) => ({
                labName: entry.labName || '',
                note: entry.note || '',
                value: entry.value ?? '',
                unit: entry.unit ?? '',
                referenceRange: entry.referenceRange ?? '',
                status: entry.status ?? '',
              }));
          }
        }
      } catch {
        // If not JSON, treat as plain text context
        contextText = raw;
      }
    }
    return { contextText, admissionLabs };
  })();
  const [emrContext, setEmrContext] = useState(parsedEmrContext.contextText);
  const admissionLabs = parsedEmrContext.admissionLabs;
  const [caseGoals, setCaseGoals] = useState(room?.case_goals || '');
  const [progressNote, setProgressNote] = useState(room?.progress_note || '');
  const [completionHint, setCompletionHint] = useState(room?.completion_hint || '');
  const [bedsideHint, setBedsideHint] = useState(room?.bedside_hint || '');
  const normalVitals = {
    temperature: 98.6,
    blood_pressure_systolic: 120,
    blood_pressure_diastolic: 80,
    heart_rate: 80,
    respiratory_rate: 16,
    oxygen_saturation: 98,
  };
  const vitalEntries = (() => {
    if (room?.initial_vitals && typeof room.initial_vitals === 'object') {
      return Object.entries(room.initial_vitals as Record<string, unknown>).map(([key, value]) => ({
        key,
        value: value === null || typeof value === 'undefined' ? '' : String(value),
      }));
    }
    return [];
  })();
  
  // Advanced settings
  const initialSpecialtyIds = (() => {
    const ids = new Set<string>();
    if (room?.specialty_id) ids.add(room.specialty_id);
    if (Array.isArray(room?.specialty_ids)) {
      room.specialty_ids.forEach((id) => {
        if (id) ids.add(id);
      });
    }
    return Array.from(ids);
  })();
  const [specialtyIds, setSpecialtyIds] = useState<string[]>(initialSpecialtyIds);
  const [difficultyLevel, setDifficultyLevel] = useState<'beginner' | 'intermediate' | 'advanced' | null>(
    room?.difficulty_level || null
  );
  const [expectedDiagnosis, setExpectedDiagnosis] = useState(room?.expected_diagnosis || '');
  const [expectedTreatment, setExpectedTreatment] = useState<string[]>(room?.expected_treatment || []);
  const buildDefaultOrdersConfig = (): RoomOrdersConfig => ({
    labs: [...instantLabs, ...pendingLabs].map((name) => ({
      name,
      type: instantLabs.includes(name) ? 'instant' : 'pending',
      statByDefault: instantLabs.includes(name),
    })),
    notes: '',
  });

  const initialOrdersConfig = (() => {
    const raw = room?.orders_config as RoomOrdersConfig | null | undefined;
    if (raw && Array.isArray(raw.labs)) {
      return { ...buildDefaultOrdersConfig(), ...raw, labs: buildDefaultOrdersConfig().labs };
    }
    return buildDefaultOrdersConfig();
  })();
  const [ordersConfig, setOrdersConfig] = useState<RoomOrdersConfig>(initialOrdersConfig);
  const [isActive, setIsActive] = useState(room?.is_active ?? true);
  const [continuesFrom, setContinuesFrom] = useState<string>(room?.continues_from ? String(room.continues_from) : '');
  const [roomOptions, setRoomOptions] = useState<Array<{ id: number; room_number: string }>>([]);
  const scopedSchoolId = isSuperAdmin(profile)
    ? room?.school_id ?? activeSchoolId ?? null
    : profile?.school_id ?? room?.school_id ?? null;
  const [schoolId, setSchoolId] = useState<string>(() => scopedSchoolId ?? '');
  // Check if room is available to all schools (empty array or all school IDs)
  const isAllSchools = (() => {
    if (!room?.available_school_ids) return false;
    if (room.available_school_ids.length === 0) return true;
    return false;
  })();

  const initialAvailableSchoolIds = (() => {
    const ids = new Set<string>();
    if (room?.school_id) ids.add(room.school_id);
    if (Array.isArray(room?.available_school_ids)) {
      room.available_school_ids.forEach((id) => {
        if (id) ids.add(id);
      });
    }
    if (scopedSchoolId) ids.add(scopedSchoolId);
    return Array.from(ids);
  })();
  const [availableSchoolIds, setAvailableSchoolIds] = useState<string[]>(initialAvailableSchoolIds);
  const [allSchoolsSelected, setAllSchoolsSelected] = useState(isAllSchools);
  const pdfUrl = room?.pdf_url ?? null;
  const buildInitialLabResults = (patientId: string, schoolId?: string | null) => {
    // Use consolidated baseline timestamp for all initial labs
    const baselineTimestamp = '2000-01-01T00:00:00.000Z';
    const baseFields = {
      patient_id: patientId,
      room_id: null, // Always null for consolidated baseline labs
      assignment_id: null,
      override_scope: 'baseline' as const, // Always baseline for consolidation
      school_id: schoolId ?? null,
      collection_time: baselineTimestamp,
      result_time: baselineTimestamp,
      ordered_by: 'EMR Auto',
    };
    return [
      {
        ...baseFields,
        test_name: 'Hemoglobin',
        value: 13.5,
        unit: 'g/dL',
        reference_range: '12.0-15.5',
        status: 'Normal',
      },
      {
        ...baseFields,
        test_name: 'White Blood Cell Count',
        value: 8.1,
        unit: 'K/uL',
        reference_range: '4.0-11.0',
        status: 'Normal',
      },
      {
        ...baseFields,
        test_name: 'Platelets',
        value: 245,
        unit: 'K/uL',
        reference_range: '150-400',
        status: 'Normal',
      },
      {
        ...baseFields,
        test_name: 'Sodium',
        value: 138,
        unit: 'mmol/L',
        reference_range: '135-145',
        status: 'Normal',
      },
      {
        ...baseFields,
        test_name: 'Potassium',
        value: 4.1,
        unit: 'mmol/L',
        reference_range: '3.5-5.1',
        status: 'Normal',
      },
      {
        ...baseFields,
        test_name: 'Creatinine',
        value: 1.0,
        unit: 'mg/dL',
        reference_range: '0.7-1.3',
        status: 'Normal',
      },
      {
        ...baseFields,
        test_name: 'Glucose',
        value: 95,
        unit: 'mg/dL',
        reference_range: '70-110',
        status: 'Normal',
      },
    ];
  };

  useEffect(() => {
    let isMounted = true;

    const loadSpecialties = async () => {
      if (!schoolId) return;

      try {
        const { data, error } = await supabase
          .from('specialties')
          .select('*')
          .or('school_id.is.null,school_id.eq.' + schoolId)
          .order('name');

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
    if (scopedSchoolId && scopedSchoolId !== schoolId) {
      setSchoolId(scopedSchoolId);
    }
  }, [scopedSchoolId, schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    setAvailableSchoolIds((prev) => (prev.includes(schoolId) ? prev : [...prev, schoolId]));
  }, [schoolId]);

  useEffect(() => {
    const fetchRooms = async () => {
      const { data, error } = await supabase.from('rooms').select('id, room_number').order('room_number');
      if (error) {
        console.error('Error fetching rooms list', error);
        return;
      }
      if (data) {
        setRoomOptions(
          data
            .filter((r) => !room || r.id !== room.id)
            .map((r) => ({ id: r.id, room_number: r.room_number })),
        );
      }
    };
    void fetchRooms();
  }, [room]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setIsLoading(true);
    setError('');

    try {
      const finalSchoolId = schoolId || scopedSchoolId;

      if (!finalSchoolId) {
        setError('Please select a school before saving this room.');
        setIsLoading(false);
        return;
      }
      const finalPdfUrl = pdfUrl;

      const initialVitals = vitalEntries.reduce<Record<string, unknown>>((acc, entry) => {
        const key = entry.key.trim();
        if (!key) return acc;
        const rawValue = entry.value.trim();
        if (!rawValue) return acc;
        const numericValue = Number(rawValue);
        acc[key] = Number.isNaN(numericValue) ? rawValue : numericValue;
        return acc;
      }, { ...normalVitals });

      const cleanedAdmissionLabs = admissionLabs
        .map((entry) => ({
          labName: entry.labName.trim(),
          note: entry.note.trim(),
          value: entry.value?.toString().trim() || undefined,
          unit: entry.unit?.trim() || undefined,
          referenceRange: entry.referenceRange?.trim() || undefined,
          status: entry.status?.trim() || undefined,
        }))
        .filter((entry) => entry.labName || entry.note || entry.value);

      const emrContextPayloadObject: Record<string, unknown> = {};
      if (cleanedAdmissionLabs.length > 0) {
        emrContextPayloadObject.admission = { labs: cleanedAdmissionLabs };
      }
      if (emrContext.trim()) {
        emrContextPayloadObject.context = emrContext.trim();
      }
      if (initialVitals) {
        emrContextPayloadObject.initial_vitals = initialVitals;
      }

      const emrContextPayload =
        Object.keys(emrContextPayloadObject).length > 0 ? JSON.stringify(emrContextPayloadObject) : null;

      // If "All Schools" is selected, preserve existing available_school_ids
      // Otherwise, merge the primary school ID with selected schools
      const normalizedSchoolIds = allSchoolsSelected
        ? (room?.available_school_ids ?? [])  // Preserve existing value when all schools selected
        : Array.from(new Set([...(availableSchoolIds ?? []), finalSchoolId].filter(Boolean)));

      const roomData = {
        room_number: roomNumber,
        role,
        objective,
        context: nurseContext,
        nurse_context: nurseContext,
        emr_context: emrContextPayload,
        style,
        specialty_id: specialtyIds[0] ?? null,
        specialty_ids: specialtyIds.length > 0 ? specialtyIds : null,
        difficulty_level: difficultyLevel,
        expected_diagnosis: expectedDiagnosis || null,
        expected_treatment: expectedTreatment.length > 0 ? expectedTreatment : null,
        case_goals: caseGoals || null,
        progress_note: progressNote || null,
        completion_hint: completionHint || null,
        bedside_hint: bedsideHint || null,
        orders_config: ordersConfig,
        is_active: isActive,
        pdf_url: finalPdfUrl,
        school_id: finalSchoolId,
        available_school_ids: normalizedSchoolIds.length > 0 ? normalizedSchoolIds : null,
        continues_from: continuesFrom ? Number.parseInt(continuesFrom, 10) : null,
      };

      if (room) {
        const { error } = await supabase
          .from('rooms')
          .update(roomData)
          .eq('id', room.id);
        
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase
          .from('rooms')
          .insert([roomData])
          .select()
          .single();
        
        if (error) throw error;

        if (patientName.trim()) {
          const [firstName, ...rest] = patientName.trim().split(' ');
          const lastName = rest.join(' ') || 'Patient';
          const mrn = `ROOM-${inserted.room_number}-${Date.now()}`;

          const patientPayload = {
            room_id: inserted.id,
            school_id: inserted.school_id ?? finalSchoolId,
            mrn,
            first_name: firstName || 'Patient',
            last_name: lastName,
            date_of_birth: '1990-01-01',
            gender: 'Other',
            admission_date: new Date().toISOString().slice(0, 10),
            service: null,
            attending_physician: null,
          };

          const { data: patientRecord, error: patientError } = await supabase
            .from('patients')
            .insert([patientPayload])
            .select()
            .single();
          if (patientError || !patientRecord) {
            console.error('Failed to create patient for room', patientError);
            setError('Room saved, but failed to create EMR patient. Please link manually in Room Management.');
          } else {
            await supabase.from('rooms').update({ patient_id: patientRecord.id }).eq('id', inserted.id);
            try {
              const initialLabs = buildInitialLabResults(
                patientRecord.id,
                patientRecord.school_id ?? finalSchoolId,
              );
              const { error: labError } = await supabase.from('lab_results').insert(initialLabs);
              if (labError) {
                console.error('Failed to seed initial labs', labError);
              }
            } catch (seedError) {
              console.error('Error seeding initial labs', seedError);
            }
          }
        }
      }

      onSave();
    } catch (error) {
      console.error('Error saving room:', error);
      setError('Failed to save room. Please try again.');
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
      {/* Basic Information */}
      <div className="space-y-4">
        {hasAdminAccess(profile) && isSuperAdmin(profile) && (
          <div className="space-y-3">
            <div>
              <label htmlFor="school" className="block text-sm font-medium text-gray-700">
                Primary school
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
            <div>
              <div className="flex items-center mb-2">
                <input
                  type="checkbox"
                  id="allSchools"
                  checked={allSchoolsSelected}
                  onChange={(e) => {
                    setAllSchoolsSelected(e.target.checked);
                    if (e.target.checked) {
                      setAvailableSchoolIds([]);
                    }
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="allSchools" className="ml-2 block text-sm font-medium text-gray-700">
                  Available to all schools
                </label>
              </div>
              {!allSchoolsSelected && (
                <>
                  <label htmlFor="availableSchools" className="block text-sm font-medium text-gray-700">
                    Available to specific schools
                  </label>
                  <select
                    id="availableSchools"
                    multiple
                    value={availableSchoolIds.filter((id) => id !== schoolId)}
                    onChange={(e) => {
                      const selected = Array.from(e.target.selectedOptions)
                        .map((option) => option.value)
                        .filter(Boolean);
                      setAvailableSchoolIds(
                        schoolId ? Array.from(new Set([schoolId, ...selected])) : selected,
                      );
                    }}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  >
                    {(schoolId ? schools.filter((school) => school.id !== schoolId) : schools).map((school) => (
                      <option key={school.id} value={school.id}>
                        {school.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">Primary school is always included.</p>
                </>
              )}
            </div>
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
          <label htmlFor="specialty" className="block text-sm font-medium text-gray-700">
            Specialties
          </label>
          <select
            id="specialty"
            multiple
            value={specialtyIds}
            onChange={(e) =>
              setSpecialtyIds(Array.from(e.target.selectedOptions).map((option) => option.value).filter(Boolean))
            }
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          >
            {specialties.map((specialty) => (
              <option key={specialty.id} value={specialty.id}>
                {specialty.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            {schoolId ? 'Select one or more specialties (Ctrl/Cmd+click to select multiple)' : 'Select a school first to load specialties'}
          </p>
        </div>

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
          <label htmlFor="continuesFrom" className="block text-sm font-medium text-gray-700">
            Continues from (optional)
          </label>
          <select
            id="continuesFrom"
            value={continuesFrom}
            onChange={(e) => setContinuesFrom(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          >
            <option value="">None</option>
            {roomOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                Room {opt.room_number}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">Use this to carry over labs/orders/vitals from a prior room.</p>
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
          <label htmlFor="nurseContext" className="block text-sm font-medium text-gray-700">
            Nurse Context
          </label>
          <textarea
            id="nurseContext"
            value={nurseContext}
            onChange={(e) => setNurseContext(e.target.value)}
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

        <div>
          <label htmlFor="patientName" className="block text-sm font-medium text-gray-700">
            Create new patient (optional)
          </label>
          <input
            type="text"
            id="patientName"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            placeholder="e.g., Alex Rivera"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            Leave blank to create the room without an EMR patient.
          </p>
        </div>

        <div>
          <label htmlFor="emrContext" className="block text-sm font-medium text-gray-700">
            EHR Context
          </label>
          <textarea
            id="emrContext"
            value={emrContext}
            onChange={(e) => setEmrContext(e.target.value)}
            rows={4}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            placeholder="Ongoing EMR rules or responses (e.g., “if WBC ordered, increase each run”)."
          />
        </div>

        <div>
          <label htmlFor="caseGoals" className="block text-sm font-medium text-gray-700">
            Goals of Case
          </label>
          <textarea
            id="caseGoals"
            value={caseGoals}
            onChange={(e) => setCaseGoals(e.target.value)}
            rows={2}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            placeholder="Key goals learners should hit"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="progressNote" className="block text-sm font-medium text-gray-700">
              Progress Note
            </label>
            <textarea
              id="progressNote"
              value={progressNote}
              onChange={(e) => setProgressNote(e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              placeholder="Preloaded progress note content"
            />
          </div>
          <div className="space-y-2">
            <div>
              <label htmlFor="completionHint" className="block text-sm font-medium text-gray-700">
                Completion Button Hint
              </label>
              <input
                type="text"
                id="completionHint"
                value={completionHint}
                onChange={(e) => setCompletionHint(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                placeholder="Guidance shown when completing"
              />
            </div>
            <div>
              <label htmlFor="bedsideHint" className="block text-sm font-medium text-gray-700">
                Go To Bedside Hint
              </label>
              <input
                type="text"
                id="bedsideHint"
                value={bedsideHint}
                onChange={(e) => setBedsideHint(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                placeholder="Guidance shown when going bedside"
              />
            </div>
          </div>
        </div>

      </div>

      {/* Orders & Labs configuration */}
      <div className="space-y-4 border-t border-gray-200 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900">Orders & Labs (EMR)</h3>
            <p className="text-sm text-gray-600">
              All labs are available. Instant labs will auto-generate results; pending labs will stay pending.
            </p>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Orders/Labs notes (optional)</label>
          <textarea
            rows={3}
            value={ordersConfig.notes || ''}
            onChange={(e) => setOrdersConfig((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder="Any overarching instructions for lab ordering in this room"
            className="mt-1 block w-full rounded-md border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>
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

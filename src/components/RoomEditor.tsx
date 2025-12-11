import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Loader2, FileText, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { useAuthStore } from '../stores/authStore';
import { useSchools } from '../hooks/useSchools';
import { hasAdminAccess, isSuperAdmin } from '../lib/roles';
import { instantLabs, pendingLabs } from '../features/emr/lib/labCatalog';
import type { RoomOrdersConfig } from '../features/emr/lib/types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

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
  const labOptions = [...new Set([...instantLabs, ...pendingLabs])];
  
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
      } catch (err) {
        // If not JSON, treat as plain text context
        contextText = raw;
      }
    }
    return { contextText, admissionLabs };
  })();
  const [emrContext, setEmrContext] = useState(parsedEmrContext.contextText);
  const [admissionLabs, setAdmissionLabs] = useState<AdmissionLabEntry[]>(parsedEmrContext.admissionLabs);
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
  const [vitalEntries, setVitalEntries] = useState<{ key: string; value: string }[]>(() => {
    if (room?.initial_vitals && typeof room.initial_vitals === 'object') {
      return Object.entries(room.initial_vitals as Record<string, unknown>).map(([key, value]) => ({
        key,
        value: value === null || typeof value === 'undefined' ? '' : String(value),
      }));
    }
    return [];
  });
  
  // Advanced settings
  const [specialtyId, setSpecialtyId] = useState(room?.specialty_id || '');
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
  const [schoolId, setSchoolId] = useState<string>(scopedSchoolId ?? '');
  const [patientSearch, setPatientSearch] = useState('');
  const debouncedPatientSearch = useDebouncedValue(patientSearch, 300);
  const [patientOptions, setPatientOptions] = useState<Database['public']['Tables']['patients']['Row'][]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(room?.patient_id ?? null);
  
  // PDF upload state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(room?.pdf_url || null);
  const [isUploading, setIsUploading] = useState(false);
  const buildInitialLabResults = (patientId: string, schoolId?: string | null, roomId?: number | null) => {
    const now = new Date().toISOString();
    const baseFields = {
      patient_id: patientId,
      room_id: roomId ?? null,
      assignment_id: null,
      override_scope: roomId ? 'room' : 'baseline' as const,
      school_id: schoolId ?? null,
      collection_time: now,
      result_time: now,
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

  useEffect(() => {
    const fetchPatients = async () => {
      try {
        let query = supabase
          .from('patients')
          .select('*')
          .limit(20)
          .order('last_name');

        if (scopedSchoolId) {
          query = query.eq('school_id', scopedSchoolId);
        }

        if (debouncedPatientSearch) {
          query = query.or(
            `last_name.ilike.%${debouncedPatientSearch}%,first_name.ilike.%${debouncedPatientSearch}%,mrn.ilike.%${debouncedPatientSearch}%`,
          );
        }

        const { data, error } = await query;
        if (error) throw error;
        setPatientOptions(data || []);
      } catch (err) {
        console.error('Failed to fetch patients', err);
      }
    };

    void fetchPatients();
  }, [debouncedPatientSearch, scopedSchoolId]);

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

      const roomData = {
        room_number: roomNumber,
        role,
        objective,
        context: nurseContext,
        nurse_context: nurseContext,
        emr_context: emrContextPayload,
        style,
        specialty_id: specialtyId || null,
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

        if (selectedPatientId) {
          await supabase.from('rooms').update({ patient_id: selectedPatientId }).eq('id', inserted.id);
          await supabase.from('patients').update({ room_id: inserted.id }).eq('id', selectedPatientId);
        } else if (patientName.trim()) {
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
                inserted.id,
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

  const handleVitalChange = (index: number, field: 'key' | 'value', value: string) => {
    setVitalEntries((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  };

  const addVitalEntry = () => {
    setVitalEntries((prev) => [...prev, { key: '', value: '' }]);
  };

  const removeVitalEntry = (index: number) => {
    setVitalEntries((prev) => prev.filter((_, i) => i !== index));
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="patientSelect" className="block text-sm font-medium text-gray-700">
              Link existing patient (optional)
            </label>
            <input
              id="patientSelect"
              type="text"
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              placeholder="Search by name or MRN"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
            {patientSearch && patientOptions.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded border border-gray-200 bg-white shadow">
                <ul className="divide-y divide-gray-100">
                  {patientOptions.map((p) => (
                    <li
                      key={p.id}
                      className={`px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 ${
                        selectedPatientId === p.id ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => {
                        setSelectedPatientId(p.id);
                        setPatientSearch(`${p.last_name}, ${p.first_name} (${p.mrn})`);
                      }}
                    >
                      <div className="font-medium">{p.last_name}, {p.first_name}</div>
                      <div className="text-xs text-gray-500">MRN: {p.mrn}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {selectedPatientId && (
              <p className="mt-1 text-xs text-green-600">Selected patient will be linked to this room.</p>
            )}
          </div>
          <div>
            <label htmlFor="patientName" className="block text-sm font-medium text-gray-700">
              Or create new patient (optional)
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
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">EHR Admission</label>
              <button
                type="button"
                onClick={() => setAdmissionLabs((prev) => [...prev, { labName: '', note: '' }])}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                + Add admission lab
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Pick admission labs and describe the expected baseline results for this room&apos;s patient.
            </p>
            {admissionLabs.length === 0 && (
              <p className="text-xs text-gray-400">No admission labs yet.</p>
            )}
            <div className="space-y-3">
              {admissionLabs.map((entry, index) => (
                <div key={index} className="rounded-md border border-gray-200 p-3 space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-700">Lab</label>
                      <input
                        type="text"
                        list="lab-options"
                        value={entry.labName}
                        onChange={(e) =>
                          setAdmissionLabs((prev) =>
                            prev.map((lab, i) => (i === index ? { ...lab, labName: e.target.value } : lab)),
                          )
                        }
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                        placeholder="Metabolic panel, CBC, etc."
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setAdmissionLabs((prev) => prev.filter((_, i) => i !== index))}
                      className="text-xs text-red-600 hover:text-red-800 px-2 pt-5"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Value</label>
                      <input
                        type="text"
                        value={entry.value ?? ''}
                        onChange={(e) =>
                          setAdmissionLabs((prev) =>
                            prev.map((lab, i) => (i === index ? { ...lab, value: e.target.value } : lab)),
                          )
                        }
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                        placeholder="e.g., 8.5"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Unit</label>
                      <input
                        type="text"
                        value={entry.unit ?? ''}
                        onChange={(e) =>
                          setAdmissionLabs((prev) =>
                            prev.map((lab, i) => (i === index ? { ...lab, unit: e.target.value } : lab)),
                          )
                        }
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                        placeholder="e.g., g/dL"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Status</label>
                      <input
                        type="text"
                        value={entry.status ?? ''}
                        onChange={(e) =>
                          setAdmissionLabs((prev) =>
                            prev.map((lab, i) => (i === index ? { ...lab, status: e.target.value } : lab)),
                          )
                        }
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                        placeholder="Normal / Abnormal / Critical"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Reference range</label>
                    <input
                      type="text"
                      value={entry.referenceRange ?? ''}
                      onChange={(e) =>
                        setAdmissionLabs((prev) =>
                          prev.map((lab, i) => (i === index ? { ...lab, referenceRange: e.target.value } : lab)),
                        )
                      }
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                      placeholder="e.g., 12.0-15.5"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Result context</label>
                    <textarea
                      value={entry.note}
                      onChange={(e) =>
                        setAdmissionLabs((prev) =>
                          prev.map((lab, i) => (i === index ? { ...lab, note: e.target.value } : lab)),
                        )
                      }
                      rows={2}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                      placeholder="All within normal limits except WBC is elevated..."
                    />
                  </div>
                </div>
              ))}
            </div>
            <datalist id="lab-options">
              {labOptions.map((lab) => (
                <option key={lab} value={lab} />
              ))}
            </datalist>
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-700">
              Recent Vitals (optional overrides)
            </label>
            <button
              type="button"
              onClick={addVitalEntry}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              + Add vital
            </button>
          </div>
          {vitalEntries.length === 0 && (
            <p className="text-xs text-gray-500">Defaults will be used unless you add custom values.</p>
          )}
          <div className="space-y-2">
            {vitalEntries.map((entry, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="text"
                  value={entry.key}
                  onChange={(e) => handleVitalChange(index, 'key', e.target.value)}
                  placeholder="e.g., temperature"
                  className="flex-1 rounded-md border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
                <input
                  type="text"
                  value={entry.value}
                  onChange={(e) => handleVitalChange(index, 'value', e.target.value)}
                  placeholder="98.6"
                  className="flex-1 rounded-md border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeVitalEntry(index)}
                  className="text-sm text-red-600 hover:text-red-800 px-2"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            We will merge your entries with normal defaults (temp 98.6, HR 80, RR 16, BP 120/80, O2 98%).
          </p>
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

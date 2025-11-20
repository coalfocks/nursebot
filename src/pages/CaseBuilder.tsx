import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2, Plus, Wand2, ClipboardCopy, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import AdminLayout from '../components/admin/AdminLayout';
import SchoolScopeSelector from '../components/admin/SchoolScopeSelector';
import { useAuthStore } from '../stores/authStore';
import type { Database } from '../lib/database.types';
import { hasAdminAccess, isSuperAdmin } from '../lib/roles';

type CaseBlueprint = Database['public']['Tables']['case_blueprints']['Row'];

type CaseFormState = {
  specialty: string;
  title: string;
  difficulty: CaseBlueprint['difficulty'];
  objectives: string;
  admittingHpi: string;
  hospitalDays: string;
  admitOrders: string;
  admissionVitals: string;
  admissionLabs: string;
  admissionExam: string;
  initialMessage: string;
  bedsideRequired: boolean;
  eventVitals: string;
  nurseExam: string;
  bedsideExam: string;
  typicalQuestions: string[];
  imagingAndOrders: string;
  harmfulActions: string[];
  progressNote: string;
};

const specialtyOptions = [
  'Internal Medicine',
  'OBGYN',
  'Surgery',
  'Pediatrics',
  'Psychiatry',
  'EM',
];

const difficultyLabels: Record<CaseBlueprint['difficulty'], string> = {
  easy: 'Easy / Short',
  intermediate: 'Intermediate',
  difficult: 'Difficult',
};

const initialForm: CaseFormState = {
  specialty: specialtyOptions[0],
  title: '',
  difficulty: 'easy',
  objectives: '',
  admittingHpi: '',
  hospitalDays: '',
  admitOrders: '',
  admissionVitals: '',
  admissionLabs: '',
  admissionExam: '',
  initialMessage: '',
  bedsideRequired: false,
  eventVitals: '',
  nurseExam: '',
  bedsideExam: '',
  typicalQuestions: [''],
  imagingAndOrders: '',
  harmfulActions: [''],
  progressNote: '',
};

export default function CaseBuilder() {
  const { user, profile, activeSchoolId } = useAuthStore();
  const hasAdmin = hasAdminAccess(profile);
  const scopedSchoolId = isSuperAdmin(profile) ? activeSchoolId : profile?.school_id ?? null;

  const [form, setForm] = useState<CaseFormState>(initialForm);
  const [blueprints, setBlueprints] = useState<CaseBlueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchBlueprints = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('case_blueprints')
        .select('*')
        .order('created_at', { ascending: false });

      if (scopedSchoolId) {
        query = query.eq('school_id', scopedSchoolId);
      }

      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      setBlueprints((data ?? []) as CaseBlueprint[]);
    } catch (err) {
      console.error('Failed to load case blueprints', err);
      setError('Unable to load case blueprints. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [scopedSchoolId]);

  useEffect(() => {
    if (!hasAdmin) return;
    void fetchBlueprints();
  }, [hasAdmin, fetchBlueprints]);

  const handleArrayChange = (key: 'typicalQuestions' | 'harmfulActions', index: number, value: string) => {
    setForm((prev) => {
      const updated = [...prev[key]];
      updated[index] = value;
      return { ...prev, [key]: updated };
    });
  };

  const addArrayItem = (key: 'typicalQuestions' | 'harmfulActions') => {
    setForm((prev) => ({ ...prev, [key]: [...prev[key], ''] }));
  };

  const removeArrayItem = (key: 'typicalQuestions' | 'harmfulActions', index: number) => {
    setForm((prev) => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));
  };

  const resetForm = () => {
    setForm((prev) => ({
      ...initialForm,
      specialty: prev.specialty,
      difficulty: prev.difficulty,
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !hasAdmin) return;
    setSaving(true);
    setError(null);

    try {
      if (!scopedSchoolId) {
        setError('Select a school before saving a case.');
        setSaving(false);
        return;
      }

      const parsedHospitalDays = form.hospitalDays ? parseInt(form.hospitalDays, 10) : null;
      const hospitalDays = Number.isNaN(parsedHospitalDays) ? null : parsedHospitalDays;

      const trimmedQuestions = form.typicalQuestions.map((q) => q.trim()).filter(Boolean);
      const trimmedHarmful = form.harmfulActions.map((q) => q.trim()).filter(Boolean);

      const payload = {
        title: form.title.trim(),
        specialty: form.specialty,
        difficulty: form.difficulty,
        objectives: form.objectives.trim(),
        admitting_hpi: form.admittingHpi.trim(),
        hospital_days: hospitalDays,
        admit_orders: form.admitOrders.trim() || null,
        admission_vitals: form.admissionVitals.trim() || null,
        admission_labs: form.admissionLabs.trim() || null,
        admission_exam: form.admissionExam.trim() || null,
        initial_message: form.initialMessage.trim() || null,
        bedside_required: form.bedsideRequired,
        event_vitals: form.eventVitals.trim() || null,
        nurse_exam: form.nurseExam.trim() || null,
        bedside_exam: form.bedsideExam.trim() || null,
        typical_questions: trimmedQuestions.length ? trimmedQuestions : null,
        imaging_and_orders: form.imagingAndOrders.trim() || null,
        harmful_actions: trimmedHarmful.length ? trimmedHarmful : null,
        progress_note: form.progressNote.trim() || null,
        created_by: user.id,
        school_id: scopedSchoolId,
      };

      const { data, error: insertError } = await supabase
        .from('case_blueprints')
        .insert(payload)
        .select()
        .single();

      if (insertError) throw insertError;

      setBlueprints((prev) => [data as CaseBlueprint, ...prev]);
      resetForm();
    } catch (err) {
      console.error('Failed to save case blueprint', err);
      setError('Unable to save this case. Please verify all required fields.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async (blueprint: CaseBlueprint) => {
    const lines = [
      `Case Title: ${blueprint.title}`,
      `Specialty: ${blueprint.specialty}`,
      `Difficulty: ${difficultyLabels[blueprint.difficulty]}`,
      `Objectives: ${blueprint.objectives}`,
      `Admitting HPI: ${blueprint.admitting_hpi}`,
      `Days in hospital: ${blueprint.hospital_days ?? '—'}`,
      `Admit Orders: ${blueprint.admit_orders ?? '—'}`,
      `Admission Vitals: ${blueprint.admission_vitals ?? '—'}`,
      `Admission Labs: ${blueprint.admission_labs ?? '—'}`,
      `Admission Physical Exam: ${blueprint.admission_exam ?? '—'}`,
      `Initial Message: ${blueprint.initial_message ?? '—'}`,
      `Bedside Required: ${blueprint.bedside_required ? 'Yes' : 'No'}`,
      `Event Vitals: ${blueprint.event_vitals ?? '—'}`,
      `Nurse Exam: ${blueprint.nurse_exam ?? '—'}`,
      `Bedside Exam: ${blueprint.bedside_exam ?? '—'}`,
      `Typical Questions: ${(blueprint.typical_questions ?? []).join('; ') || '—'}`,
      `Imaging / Orders: ${blueprint.imaging_and_orders ?? '—'}`,
      `Unnecessary / Harmful: ${(blueprint.harmful_actions ?? []).join('; ') || '—'}`,
      `Progress Note: ${blueprint.progress_note ?? '—'}`,
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedId(blueprint.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (err) {
      console.error('Failed to copy blueprint', err);
      setError('Copy failed. Please try again.');
    }
  };

  const easyCount = useMemo(
    () => blueprints.filter((b) => b.difficulty === 'easy').length,
    [blueprints]
  );
  const intermediateCount = useMemo(
    () => blueprints.filter((b) => b.difficulty === 'intermediate').length,
    [blueprints]
  );
  const difficultCount = useMemo(
    () => blueprints.filter((b) => b.difficulty === 'difficult').length,
    [blueprints]
  );

  if (!hasAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <AdminLayout>
      <div className="px-6 py-6 space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
              <Wand2 className="h-4 w-4" />
              Nurse Chat Case Builder
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Create admin-side nurse chat cases</h1>
            <p className="text-sm text-slate-600">
              Capture the full case recipe once, re-use it across rooms, and keep a consistent mix
              of bedside and messaging scenarios.
            </p>
          </div>
          <SchoolScopeSelector className="w-full md:w-60" label="School scope" />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mix</p>
            <p className="mt-1 text-sm text-slate-600">
              Aim for six easy, two intermediate, and two difficult cases per batch. Include at
              least two bedside-required encounters.
            </p>
            <div className="mt-3 flex gap-2 text-xs">
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                Easy: {easyCount}
              </span>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">
                Intermediate: {intermediateCount}
              </span>
              <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700">
                Difficult: {difficultCount}
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Timing</p>
            <p className="mt-1 text-sm text-slate-600">
              Easy cases should run 2–4 minutes with chart review. Intermediate and difficult cases
              typically run 5–10 minutes but carry deeper reasoning.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quality</p>
            <p className="mt-1 text-sm text-slate-600">
              Keep vitals, labs, and orders consistent. Use the progress note to briefly document
              the outcome to guide downstream grading.
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    New case
                  </p>
                  <h2 className="text-lg font-semibold text-slate-900">Case blueprint</h2>
                </div>
                {saving && <Loader2 className="h-5 w-5 animate-spin text-blue-600" />}
              </div>

              {error && (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-4 space-y-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Specialty</label>
                    <select
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      value={form.specialty}
                      onChange={(e) => setForm((prev) => ({ ...prev, specialty: e.target.value }))}
                    >
                      {specialtyOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium text-slate-700">Case title</label>
                    <input
                      type="text"
                      required
                      value={form.title}
                      onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Example: Fever and agitation after dialysis"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Difficulty</label>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                      {(['easy', 'intermediate', 'difficult'] as CaseBlueprint['difficulty'][]).map(
                        (value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setForm((prev) => ({ ...prev, difficulty: value }))}
                            className={`rounded-md border px-3 py-2 text-left transition ${
                              form.difficulty === value
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                            }`}
                          >
                            {difficultyLabels[value]}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Days in hospital</label>
                    <input
                      type="number"
                      min="0"
                      value={form.hospitalDays}
                      onChange={(e) => setForm((prev) => ({ ...prev, hospitalDays: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Example: 3"
                    />
                    <p className="mt-1 text-xs text-slate-500">Days before the incident occurred.</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Bedside required?</label>
                    <div className="mt-2 flex items-center gap-3 text-sm">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="bedside"
                          checked={form.bedsideRequired}
                          onChange={() => setForm((prev) => ({ ...prev, bedsideRequired: true }))}
                          className="text-blue-600"
                        />
                        <span>Yes</span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="bedside"
                          checked={!form.bedsideRequired}
                          onChange={() => setForm((prev) => ({ ...prev, bedsideRequired: false }))}
                          className="text-blue-600"
                        />
                        <span>No</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Objectives / goals</label>
                    <textarea
                      required
                      value={form.objectives}
                      onChange={(e) => setForm((prev) => ({ ...prev, objectives: e.target.value }))}
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="What do you expect the learner to surface or decide?"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Admitting HPI</label>
                    <textarea
                      required
                      value={form.admittingHpi}
                      onChange={(e) => setForm((prev) => ({ ...prev, admittingHpi: e.target.value }))}
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Include hospital course if relevant."
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Admission vitals</label>
                    <input
                      type="text"
                      value={form.admissionVitals}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, admissionVitals: e.target.value }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="BP 120/72, HR 113, RR 16, O2 97%, Temp 101.5°F"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Admission labs (pertinent)</label>
                    <input
                      type="text"
                      value={form.admissionLabs}
                      onChange={(e) => setForm((prev) => ({ ...prev, admissionLabs: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="WBC 22, Lactate 1.2, Cr 6.6"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Admission physical exam</label>
                    <textarea
                      value={form.admissionExam}
                      onChange={(e) => setForm((prev) => ({ ...prev, admissionExam: e.target.value }))}
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Pertinent findings only."
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Admit orders</label>
                    <textarea
                      value={form.admitOrders}
                      onChange={(e) => setForm((prev) => ({ ...prev, admitOrders: e.target.value }))}
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Restart home meds, antibiotics, etc."
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Initial message</label>
                    <textarea
                      value={form.initialMessage}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, initialMessage: e.target.value }))
                      }
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="How does the nurse open the chat?"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Vitals at event time</label>
                    <textarea
                      value={form.eventVitals}
                      onChange={(e) => setForm((prev) => ({ ...prev, eventVitals: e.target.value }))}
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="BP 120/72, HR 113..."
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Nurse physical exam</label>
                    <textarea
                      value={form.nurseExam}
                      onChange={(e) => setForm((prev) => ({ ...prev, nurseExam: e.target.value }))}
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Findings available without bedside trip."
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Bedside exam (if required)</label>
                    <textarea
                      value={form.bedsideExam}
                      onChange={(e) => setForm((prev) => ({ ...prev, bedsideExam: e.target.value }))}
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="What the learner sees when they go in person."
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Typical questions</label>
                    <div className="space-y-2">
                      {form.typicalQuestions.map((question, index) => (
                        <div key={`question-${index}`} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={question}
                            onChange={(e) =>
                              handleArrayChange('typicalQuestions', index, e.target.value)
                            }
                            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="What you expect the learner to ask"
                          />
                          {form.typicalQuestions.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeArrayItem('typicalQuestions', index)}
                              className="text-slate-400 hover:text-rose-600"
                              aria-label="Remove question"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addArrayItem('typicalQuestions')}
                        className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800"
                      >
                        <Plus className="h-4 w-4" /> Add question
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Imaging / orders + results</label>
                    <textarea
                      value={form.imagingAndOrders}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, imagingAndOrders: e.target.value }))
                      }
                      className="mt-1 h-28 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Orders to place and the answers they should see."
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Unnecessary / harmful moves</label>
                    <div className="space-y-2">
                      {form.harmfulActions.map((action, index) => (
                        <div key={`harmful-${index}`} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={action}
                            onChange={(e) => handleArrayChange('harmfulActions', index, e.target.value)}
                            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="Orders that are misguided or unsafe"
                          />
                          {form.harmfulActions.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeArrayItem('harmfulActions', index)}
                              className="text-slate-400 hover:text-rose-600"
                              aria-label="Remove harmful action"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addArrayItem('harmfulActions')}
                        className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800"
                      >
                        <Plus className="h-4 w-4" /> Add harmful action
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Progress note (3 sentences)</label>
                    <textarea
                      value={form.progressNote}
                      onChange={(e) => setForm((prev) => ({ ...prev, progressNote: e.target.value }))}
                      className="mt-1 h-28 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Short note summarizing what happened in the case."
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Clear draft
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save case
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Library
                  </p>
                  <h2 className="text-lg font-semibold text-slate-900">Saved blueprints</h2>
                </div>
                {loading && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
              </div>

              {blueprints.length === 0 && !loading ? (
                <p className="mt-4 text-sm text-slate-600">
                  No cases yet. Add a blueprint and it will appear here for reuse and copy/paste.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {blueprints.map((blueprint) => (
                    <div
                      key={blueprint.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">
                            {blueprint.specialty}
                          </p>
                          <h3 className="text-base font-semibold text-slate-900">
                            {blueprint.title}
                          </h3>
                          <p className="text-xs text-slate-500">
                            {difficultyLabels[blueprint.difficulty]} •{' '}
                            {blueprint.bedside_required ? 'Bedside required' : 'Chat only'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy(blueprint)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700"
                        >
                          {copiedId === blueprint.id ? (
                            <>
                              <CheckCircle className="h-4 w-4 text-emerald-600" />
                              Copied
                            </>
                          ) : (
                            <>
                              <ClipboardCopy className="h-4 w-4" />
                              Copy
                            </>
                          )}
                        </button>
                      </div>
                      <p className="mt-2 text-sm text-slate-700">
                        {blueprint.objectives}
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                        <div>
                          <span className="font-semibold text-slate-800">Event vitals:</span>{' '}
                          {blueprint.event_vitals ?? '—'}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Progress note:</span>{' '}
                          {blueprint.progress_note ?? '—'}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Orders:</span>{' '}
                          {blueprint.imaging_and_orders ?? '—'}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Harmful:</span>{' '}
                          {(blueprint.harmful_actions ?? []).join('; ') || '—'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

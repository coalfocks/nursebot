import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '../components/admin/AdminLayout';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { isSuperAdmin } from '../lib/roles';
import SchoolScopeSelector from '../components/admin/SchoolScopeSelector';
import type { Database } from '../lib/database.types';

type PatientRow = Database['public']['Tables']['patients']['Row'];

export default function AdminPatients() {
  const { profile, activeSchoolId } = useAuthStore();
  const scopedSchoolId = isSuperAdmin(profile) ? activeSchoolId : profile?.school_id ?? null;
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    mrn: '',
    dob: '',
    gender: 'Other',
    allergies: '',
  });
  const [error, setError] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const schoolIdForCreate = useMemo(() => scopedSchoolId ?? null, [scopedSchoolId]);

  useEffect(() => {
    void fetchPatients();
  }, [scopedSchoolId]);

  const fetchPatients = async () => {
    setLoading(true);
    try {
      let query = supabase.from('patients').select('*').is('deleted_at', null).order('last_name');
      if (scopedSchoolId) {
        query = query.eq('school_id', scopedSchoolId);
      }
      const { data, error: fetchError } = await query;
      if (fetchError) throw fetchError;
      setPatients(data ?? []);
    } catch (err) {
      console.error('Failed to load patients', err);
      setError('Failed to load patients.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim() || !form.mrn.trim() || !form.dob.trim()) {
      setError('Please fill all required fields.');
      return;
    }
    setError('');
    setIsSaving(true);
    try {
      const payload = {
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        mrn: form.mrn.trim(),
        date_of_birth: form.dob,
        gender: form.gender,
        allergies: form.allergies ? form.allergies.split(',').map((a) => a.trim()).filter(Boolean) : [],
        school_id: schoolIdForCreate,
        room_id: null,
        admission_date: null,
        service: null,
        attending_physician: null,
      };
      const { error: insertError } = await supabase.from('patients').insert([payload]);
      if (insertError) throw insertError;
      setForm({
        firstName: '',
        lastName: '',
        mrn: `MRN-${Date.now()}`,
        dob: '',
        gender: 'Other',
        allergies: '',
      });
      await fetchPatients();
    } catch (err) {
      console.error('Failed to create patient', err);
      setError('Failed to create patient.');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!form.mrn) {
      setForm((prev) => ({ ...prev, mrn: `MRN-${Date.now()}` }));
    }
  }, []);

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto py-8 px-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Patients</h1>
            <p className="text-sm text-slate-600">
              Create and manage EMR patients independent of rooms. Link them to rooms later as needed.
            </p>
          </div>
          {isSuperAdmin(profile) && <SchoolScopeSelector className="w-56" label="School scope" />}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-5 space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Create Patient</h2>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">First name</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                  value={form.firstName}
                  onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Last name</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                  value={form.lastName}
                  onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">MRN</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                  value={form.mrn}
                  onChange={(e) => setForm((prev) => ({ ...prev, mrn: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Date of birth</label>
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                  value={form.dob}
                  onChange={(e) => setForm((prev) => ({ ...prev, dob: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Gender</label>
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                  value={form.gender}
                  onChange={(e) => setForm((prev) => ({ ...prev, gender: e.target.value }))}
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Allergies (comma separated)</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                  value={form.allergies}
                  onChange={(e) => setForm((prev) => ({ ...prev, allergies: e.target.value }))}
                  placeholder="e.g., penicillin, latex"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Create patient'}
            </button>
          </form>

          <div className="bg-white shadow rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Patients</h2>
              <p className="text-sm text-slate-500">{patients.length} total</p>
            </div>
            {loading ? (
              <p className="text-sm text-slate-500">Loading patients...</p>
            ) : patients.length === 0 ? (
              <p className="text-sm text-slate-500">No patients found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Name</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">MRN</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">DOB</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">School</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {patients.map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 text-slate-900">
                          {p.last_name}, {p.first_name}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{p.mrn}</td>
                        <td className="px-3 py-2 text-slate-600">
                          {p.date_of_birth ? new Date(p.date_of_birth).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{p.school_id || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

import { useMemo } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { hasAdminAccess, isSchoolAdmin, isSuperAdmin } from '../../lib/roles';
import { useSchools } from '../../hooks/useSchools';

interface SchoolScopeSelectorProps {
  className?: string;
  label?: string;
}

export default function SchoolScopeSelector({ className = '', label = 'School' }: SchoolScopeSelectorProps) {
  const { profile, activeSchoolId, setActiveSchoolId } = useAuthStore();
  const { schools, loading } = useSchools();
  const adminAccess = hasAdminAccess(profile);
  const currentSchoolId = isSuperAdmin(profile) ? activeSchoolId : profile?.school_id ?? null;

  const selectedSchoolName = useMemo(() => {
    if (!currentSchoolId) return null;
    return schools.find((school) => school.id === currentSchoolId)?.name ?? null;
  }, [schools, currentSchoolId]);

  if (!adminAccess) {
    return null;
  }

  if (isSchoolAdmin(profile)) {
    return (
      <div className={`text-sm text-slate-600 ${className}`}>
        <span className="font-medium text-slate-900">{label}:</span>{' '}
        {loading ? 'Loading…' : selectedSchoolName ?? '—'}
      </div>
    );
  }

  return (
    <div className={className}>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <select
        value={currentSchoolId ?? 'all'}
        onChange={(event) => setActiveSchoolId(event.target.value === 'all' ? null : event.target.value)}
        disabled={loading}
        className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-50"
      >
        <option value="all">All schools</option>
        {schools.map((school) => (
          <option key={school.id} value={school.id}>
            {school.name}
          </option>
        ))}
      </select>
    </div>
  );
}

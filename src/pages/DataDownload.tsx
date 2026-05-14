import { Navigate } from 'react-router-dom';
import AdminLayout from '../components/admin/AdminLayout';
import ExportScoresCard from '../components/admin/ExportScoresCard';
import { useAuthStore } from '../stores/authStore';
import { isSuperAdmin } from '../lib/roles';

export default function DataDownload() {
  const { user, profile } = useAuthStore();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isSuperAdmin(profile)) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <AdminLayout>
      <div className="px-6 py-6 space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Superadmin</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Data Download</h1>
          <p className="mt-2 text-sm text-slate-600">
            Export anonymized assignment score data for analysis and reporting.
          </p>
        </section>

        <ExportScoresCard />
      </div>
    </AdminLayout>
  );
}

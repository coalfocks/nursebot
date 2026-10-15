import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, Plus, Search, ShieldAlert, UserX } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import { useAuthStore } from '../stores/authStore';
import { isSuperAdmin } from '../lib/roles';
import { supabase } from '../lib/supabase';

type School = { id: string; name: string; slug: string };
type ManagedUser = {
  auth: { id: string; email: string | null; emailConfirmedAt: string | null; lastSignInAt: string | null; createdAt: string; bannedUntil?: string | null } | null;
  profile: { id: string; email: string; full_name: string; role: string; school_id: string | null; created_at: string | null } | null;
};
type AuditEntry = { id: string; actor_user_id: string; target_user_id: string | null; email: string; action: string; school_id: string | null; role: string | null; created_at: string };

const invoke = async (body?: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke('admin-user-management', { body: body ?? { action: 'list' } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { users: ManagedUser[]; schools: School[]; audit: AuditEntry[] };
};

export default function AdminUsers() {
  const { profile } = useAuthStore();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({ email: '', full_name: '', role: 'school_admin', school_id: '' });

  const refresh = async () => {
    setLoading(true); setError(null);
    try {
      const data = await invoke(); setUsers(data.users); setSchools(data.schools); setAudit(data.audit);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load admin users.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const schoolMap = useMemo(() => new Map(schools.map((school) => [school.id, school.name])), [schools]);
  const schoolName = useCallback((id: string | null) => schoolMap.get(id ?? '') ?? (id ? 'Unknown school' : 'All schools'), [schoolMap]);
  const rows = useMemo(() => users.filter(({ auth, profile }) => {
    const term = search.trim().toLowerCase();
    return !term || [auth?.email, profile?.email, profile?.full_name, profile?.role, schoolName(profile?.school_id ?? null)].some((value) => value?.toLowerCase().includes(term));
  }), [users, search, schoolName]);

  const submitInvite = async () => {
    setSaving(true); setError(null); setNotice(null);
    try {
      await invoke({ action: 'invite', ...form });
      setNotice('Invitation sent. No password was created or displayed.'); setForm({ email: '', full_name: '', role: 'school_admin', school_id: '' }); setShowInvite(false); await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Invitation failed.'); }
    finally { setSaving(false); }
  };

  const updateUser = async (userId: string, action: 'disable' | 'enable') => {
    setSaving(true); setError(null); setNotice(null);
    try { await invoke({ action, user_id: userId }); setNotice(action === 'disable' ? 'Account disabled and sessions revoked.' : 'Account enabled.'); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Account update failed.'); }
    finally { setSaving(false); }
  };

  if (!isSuperAdmin(profile)) return <AdminLayout><div className="p-8"><ShieldAlert className="h-8 w-8 text-amber-600" /><h1 className="mt-3 text-xl font-semibold">Superadmin access required</h1></div></AdminLayout>;

  return <AdminLayout><div className="space-y-6 p-6">
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Superadmin only</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">Admin Users</h1><p className="mt-2 max-w-3xl text-sm text-slate-600">Invite and scope educator accounts by institution. Invitations use one-time email activation; reusable passwords are never created or shown here.</p></div><button onClick={() => setShowInvite(true)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white"><Plus className="h-4 w-4" />Invite user</button></div>
      <div className="mt-5 flex items-center gap-3"><div className="relative max-w-xl flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input aria-label="Search users" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search email, name, role, or school" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm" /></div><button onClick={() => void refresh()} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">Refresh</button></div>
      {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}{notice && <div role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold text-slate-900">Accounts</h2><p className="text-xs text-slate-500">Existing accounts, pending invitations, and disabled sessions are distinguished from one another.</p></div><span className="text-sm text-slate-500">{rows.length} shown</span></div>{loading ? <div className="p-10 text-center text-slate-600"><Loader2 className="mx-auto h-6 w-6 animate-spin" /><p className="mt-2">Loading authorized accounts…</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-3">User</th><th>Role / school</th><th>Status</th><th>Created</th><th className="text-right">Actions</th></tr></thead><tbody>{rows.map(({ auth, profile }) => { const disabled = Boolean(auth?.bannedUntil); const active = Boolean(auth?.emailConfirmedAt); const pending = !active && !disabled; return <tr key={auth?.id ?? profile?.id} className="border-b last:border-0"><td className="py-3"><div className="font-medium text-slate-900">{profile?.full_name ?? 'No profile'}</div><div className="text-xs text-slate-500">{auth?.email ?? profile?.email ?? 'No email'}</div></td><td><div className="capitalize">{profile?.role?.replace('_', ' ') ?? 'Unscoped'}</div><div className="text-xs text-slate-500">{schoolName(profile?.school_id ?? null)}</div></td><td>{disabled ? <span className="text-red-700">Disabled</span> : pending ? <span className="text-amber-700">Invitation pending</span> : <span className="text-emerald-700">Active</span>}</td><td className="text-xs text-slate-500">{auth?.createdAt ? new Date(auth.createdAt).toLocaleString() : '—'}</td><td className="text-right">{auth?.id && profile?.role !== 'super_admin' && <button disabled={saving} onClick={() => void updateUser(auth.id, disabled ? 'enable' : 'disable')} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 disabled:opacity-50">{disabled ? <CheckCircle2 className="h-3 w-3" /> : <UserX className="h-3 w-3" />}{disabled ? 'Enable' : 'Disable'}</button>}</td></tr>; })}</tbody></table></div>}</section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-900">Recent scope audit</h2><p className="mt-1 text-xs text-slate-500">Created-by, time, role, and institution scope are retained for account-management actions.</p><div className="mt-4 space-y-2">{audit.slice(0, 10).map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs"><span><strong>{entry.action.replace('_', ' ')}</strong> · {entry.email} · {entry.role ?? '—'} · {schoolName(entry.school_id)}</span><span className="text-slate-500">{new Date(entry.created_at).toLocaleString()}</span></div>)}</div></section>

    {showInvite && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div role="dialog" aria-modal="true" aria-labelledby="invite-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"><div className="flex items-start justify-between"><div><h2 id="invite-title" className="text-lg font-semibold">Invite educator/admin</h2><p className="mt-1 text-sm text-slate-600">The recipient sets their password through the one-time activation link.</p></div><KeyRound className="h-5 w-5 text-blue-600" /></div><div className="mt-5 space-y-3"><label className="block text-sm font-medium">Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label><label className="block text-sm font-medium">Full name<input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label><label className="block text-sm font-medium">Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"><option value="school_admin">School admin / educator</option><option value="student">Student</option></select></label><label className="block text-sm font-medium">Institution<select value={form.school_id} onChange={(event) => setForm({ ...form, school_id: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"><option value="">Select institution</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label><div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Confirm the email, role, and institution before sending. School admins can access records within their assigned school under current tenant policy.</div></div><div className="mt-6 flex justify-end gap-2"><button onClick={() => setShowInvite(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">Cancel</button><button disabled={saving || !form.email || !form.full_name || !form.school_id} onClick={() => void submitInvite()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Send one-time invite</button></div></div></div>}
  </div></AdminLayout>;
}

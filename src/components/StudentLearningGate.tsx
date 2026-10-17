import { ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Loader2, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { isStudent, isTestUser } from '../lib/roles';

export default function StudentLearningGate({ children }: { children: ReactNode }) {
  const { user, profile } = useAuthStore();
  const location = useLocation();
  const [state, setState] = useState<'loading' | 'allowed' | 'required' | 'error'>('loading');
  const [error, setError] = useState('');

  const learner = isStudent(profile) || isTestUser(profile);

  const check = async () => {
    if (!user || !learner) {
      setState('allowed');
      return;
    }
    setState('loading');
    setError('');
    const course = await supabase
      .from('walkthrough_courses')
      .select('id, version')
      .eq('status', 'published')
      .eq('is_mandatory', true)
      .in('audience', ['student', 'both'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (course.error) {
      setError(course.error.message);
      setState('error');
      return;
    }
    if (!course.data) {
      setState('allowed');
      return;
    }
    const enrollment = await supabase
      .from('walkthrough_enrollments')
      .select('completed_at')
      .eq('user_id', user.id)
      .eq('course_id', course.data.id)
      .eq('course_version', course.data.version)
      .maybeSingle();
    if (enrollment.error) {
      setError(enrollment.error.message);
      setState('error');
    } else {
      setState(enrollment.data?.completed_at ? 'allowed' : 'required');
    }
  };

  useEffect(() => { void check(); }, [user?.id, profile?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!learner || state === 'allowed') return <>{children}</>;
  if (state === 'required') {
    return <Navigate to="/learning-library" replace state={{ from: location.pathname }} />;
  }
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto mt-24 max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        {state === 'loading' ? <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" /> : <RefreshCw className="mx-auto h-8 w-8 text-red-600" />}
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Learning access is checking</h1>
        <p className="mt-2 text-sm text-slate-600">{state === 'loading' ? 'Checking required learning progress…' : error || 'We could not check your course progress.'}</p>
        {state === 'error' && <div className="mt-4 flex justify-center gap-3"><button type="button" onClick={() => void check()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white">Retry</button><Link to="/learning-library" className="rounded-md border px-4 py-2 text-sm font-medium text-slate-700">Open library</Link></div>}
      </div>
    </div>
  );
}

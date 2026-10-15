import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Film, Loader2, Lock, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import Navbar from '../components/Navbar';

type Video = Database['public']['Tables']['walkthrough_videos']['Row'];
type Course = Database['public']['Tables']['walkthrough_courses']['Row'];
type Item = Database['public']['Tables']['walkthrough_course_items']['Row'];
type Progress = Database['public']['Tables']['walkthrough_progress']['Row'];

export default function StudentWalkthroughVideos() {
  const { user } = useAuthStore();
  const [course, setCourse] = useState<Course | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [current, setCurrent] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [captionUrl, setCaptionUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!user) return;
    setLoading(true); setError('');
    // The library can expose a reviewed/preview course before it becomes a
    // required onboarding gate. StudentLearningGate intentionally checks
    // is_mandatory separately, so publishing a preview cannot lock cases.
    const courseResult = await supabase.from('walkthrough_courses').select('*').eq('status', 'published').in('audience', ['student', 'both']).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (courseResult.error) { setError(courseResult.error.message); setLoading(false); return; }
    if (!courseResult.data) { setCourse(null); setLoading(false); return; }
    const [itemResult, videoResult, enrollmentResult] = await Promise.all([
      supabase.from('walkthrough_course_items').select('*').eq('course_id', courseResult.data.id).eq('course_version', courseResult.data.version).order('position'),
      supabase.from('walkthrough_videos').select('*').in('audience', ['student', 'both']).eq('status', 'published'),
      supabase.from('walkthrough_enrollments').select('id').eq('user_id', user.id).eq('course_id', courseResult.data.id).eq('course_version', courseResult.data.version).maybeSingle(),
    ]);
    if (itemResult.error || videoResult.error || enrollmentResult.error) { setError(itemResult.error?.message || videoResult.error?.message || enrollmentResult.error?.message || 'Learning content could not be loaded.'); setLoading(false); return; }
    const itemRows = itemResult.data ?? [];
    const videoRows = videoResult.data ?? [];
    setCourse(courseResult.data); setItems(itemRows); setVideos(videoRows);
    if (enrollmentResult.data) {
      const progressResult = await supabase.from('walkthrough_progress').select('*').eq('enrollment_id', enrollmentResult.data.id);
      if (progressResult.error) setError(progressResult.error.message); else setProgress(progressResult.data ?? []);
    } else setProgress([]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const orderedVideos = useMemo(() => items.map((item) => videos.find((video) => video.id === item.video_id && video.version === item.video_version)).filter(Boolean) as Video[], [items, videos]);
  const requiredItems = useMemo(() => items.filter((item) => item.required), [items]);
  const requiredVideoIds = useMemo(() => new Set(requiredItems.map((item) => `${item.video_id}:${item.video_version}`)), [requiredItems]);
  const video = orderedVideos[current] ?? null;
  const completed = (entry: Video) => progress.some((row) => row.video_id === entry.id && row.video_version === entry.version && Boolean(row.completed_at));
  const completedCount = orderedVideos.filter((entry) => requiredVideoIds.has(`${entry.id}:${entry.version}`) && completed(entry)).length;
  const courseComplete = requiredItems.length > 0 && completedCount === requiredItems.length;

  useEffect(() => {
    let cancelled = false;
    setUrl(null); setCaptionUrl(null);
    if (!video) return undefined;
    void (async () => {
      const [media, captions] = await Promise.all([
        video.video_path ? supabase.storage.from('walkthrough_videos').createSignedUrl(video.video_path, 3600) : Promise.resolve({ data: null, error: null }),
        video.captions_path ? supabase.storage.from('walkthrough_videos').createSignedUrl(video.captions_path, 3600) : Promise.resolve({ data: null, error: null }),
      ]);
      if (!cancelled) { setUrl(media.data?.signedUrl ?? null); setCaptionUrl(captions.data?.signedUrl ?? null); }
    })();
    return () => { cancelled = true; };
  }, [video?.id, video?.version, video?.video_path, video?.captions_path]);

  const acknowledge = async () => {
    if (!user || !course || !video || saving || completed(video)) return;
    setSaving(true); setError('');
    const enrollment = await supabase.from('walkthrough_enrollments').upsert({ user_id: user.id, course_id: course.id, course_version: course.version, last_video_id: video.id, last_position_seconds: video.duration_seconds ?? 0 }, { onConflict: 'user_id,course_id,course_version' }).select().single();
    if (enrollment.error || !enrollment.data) { setError(enrollment.error?.message ?? 'Could not save course progress.'); setSaving(false); return; }
    const saved = await supabase.from('walkthrough_progress').upsert({ enrollment_id: enrollment.data.id, user_id: user.id, video_id: video.id, video_version: video.version, position_seconds: video.duration_seconds ?? 0, watched_intervals: [{ start: 0, end: video.duration_seconds ?? 0 }], completion_method: 'acknowledgment', completed_at: new Date().toISOString(), last_activity_at: new Date().toISOString() }, { onConflict: 'enrollment_id,video_id,video_version' }).select().single();
    if (saved.error) { setError(saved.error.message); setSaving(false); return; }
    const nextProgress = [...progress.filter((row) => !(row.video_id === video.id && row.video_version === video.version)), saved.data];
    setProgress(nextProgress);
    const completedRequired = orderedVideos.filter((entry) => requiredVideoIds.has(`${entry.id}:${entry.version}`) && nextProgress.some((row) => row.video_id === entry.id && row.video_version === entry.version && row.completed_at)).length;
    if (completedRequired >= requiredItems.length) await supabase.from('walkthrough_enrollments').update({ completed_at: new Date().toISOString(), last_video_id: video.id, last_position_seconds: video.duration_seconds ?? 0 }).eq('id', enrollment.data.id);
    setSaving(false);
    if (current < orderedVideos.length - 1) setCurrent((value) => value + 1);
  };

  if (loading) return <><Navbar /><div className="flex min-h-[70vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div></>;
  if (error) return <><Navbar /><main className="mx-auto max-w-2xl p-6"><div className="rounded-lg border border-red-200 bg-red-50 p-5"><h1 className="font-semibold text-red-900">Learning Library could not load</h1><p className="mt-2 text-sm text-red-800">{error}</p><button type="button" onClick={() => void load()} className="mt-4 inline-flex items-center rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white"><RefreshCw className="mr-2 h-4 w-4" />Retry</button></div></main></>;
  if (!course || orderedVideos.length === 0) return <><Navbar /><main className="mx-auto max-w-3xl p-6"><div className="rounded-lg border border-dashed bg-white p-10 text-center"><Film className="mx-auto h-10 w-10 text-blue-600" /><h1 className="mt-4 text-xl font-semibold">Learning Library</h1><p className="mt-2 text-sm text-slate-600">No student learning course is published yet. Your assigned cases remain available.</p><Link to="/dashboard" className="mt-5 inline-block text-sm font-semibold text-blue-700 underline">Continue to dashboard</Link></div></main></>;
  const currentItem = items.find((item) => item.video_id === video?.id && item.video_version === video?.version);
  const isRequired = Boolean(currentItem?.required);
  const progressTotal = requiredItems.length;
  return <><Navbar /><main className="min-h-[calc(100vh-4rem)] bg-slate-50 p-4 sm:p-6"><div className="mx-auto max-w-6xl space-y-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Student Learning Library</p><h1 className="mt-1 text-2xl font-bold text-slate-900">{course.title}</h1><p className="mt-1 text-sm text-slate-600">{course.description || 'Complete the required videos before opening assigned cases.'}</p></div><div className="text-sm font-medium text-slate-700">{completedCount} of {progressTotal} required complete</div></div><div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progressTotal ? (completedCount / progressTotal) * 100 : 0}%` }} /></div>{courseComplete && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><CheckCircle2 className="mr-2 inline h-5 w-5" />Required learning is complete. Assigned cases are unlocked. You can return here anytime for review.<Link to="/dashboard" className="ml-2 font-semibold underline">Open dashboard</Link></div>}{!courseComplete && course.is_mandatory === false && <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">This is an optional preview. It does not lock assigned cases.</div>}<div className="grid gap-6 lg:grid-cols-[260px_1fr]"><ol className="space-y-2" aria-label="Course videos">{orderedVideos.map((entry, index) => { const entryItem = items.find((item) => item.video_id === entry.id && item.video_version === entry.version); return <li key={`${entry.id}-${entry.version}`}><button type="button" onClick={() => setCurrent(index)} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm ${current === index ? 'border-blue-400 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700'}`}><span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold">{completed(entry) ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : index > current && entryItem?.required ? <Lock className="h-4 w-4 text-slate-400" /> : index + 1}</span><span className="flex-1">{entry.title}</span>{entryItem?.required ? <span className="text-[11px] font-semibold uppercase text-slate-500">Required</span> : <span className="text-[11px] font-semibold uppercase text-blue-600">Optional</span>}</button></li>; })}</ol><section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Video {current + 1} of {orderedVideos.length}{isRequired ? ' • Required' : ' • Optional example'}</p><h2 className="mt-1 text-xl font-semibold text-slate-900">{video.title}</h2><p className="mt-2 text-sm text-slate-600">{video.learning_objective || video.description || 'Review this workflow before beginning a case.'}</p></div><Film className="h-8 w-8 text-blue-600" aria-hidden="true" /></div>{url ? <video className="mt-5 w-full rounded-lg bg-black" controls playsInline src={url} aria-label={video.title}>{captionUrl && <track kind="captions" src={captionUrl} />}</video> : <div className="mt-5 rounded-lg bg-slate-100 p-10 text-center text-sm text-slate-600">Video playback is not ready. Review the transcript, then confirm when you understand.</div>}<div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4"><h3 className="font-medium text-slate-900">Transcript / captions</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{video.transcript || 'Transcript not available for this video.'}</p></div><p className="mt-4 text-xs text-slate-500">Opening a video does not complete it. Confirm only after you have viewed or reviewed the content.</p><div className="mt-5 flex flex-wrap justify-between gap-3"><button type="button" disabled={current === 0} onClick={() => setCurrent((value) => value - 1)} className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-40"><ChevronLeft className="mr-1 h-4 w-4" />Previous</button><button type="button" disabled={saving || completed(video)} onClick={() => void acknowledge()} className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Saving…' : completed(video) ? 'Completed' : 'I understand — mark complete'}<CheckCircle2 className="ml-2 h-4 w-4" /></button><button type="button" disabled={current >= orderedVideos.length - 1} onClick={() => setCurrent((value) => value + 1)} className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-40">Next<ChevronRight className="ml-1 h-4 w-4" /></button></div></section></div></div></main></>;
}

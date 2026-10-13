import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Film, Loader2, Lock, Plus, Search, Upload } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import { Button } from '../features/emr/components/ui/Button';
import { Input } from '../features/emr/components/ui/Input';
import { Textarea } from '../features/emr/components/ui/Textarea';
import { supabase } from '../lib/supabase';
import { isSuperAdmin } from '../lib/roles';
import { useAuthStore } from '../stores/authStore';
import type { Database } from '../lib/database.types';

type Video = Database['public']['Tables']['walkthrough_videos']['Row'];
type Course = Database['public']['Tables']['walkthrough_courses']['Row'];
type Item = Database['public']['Tables']['walkthrough_course_items']['Row'];
type Progress = Database['public']['Tables']['walkthrough_progress']['Row'];

const topics = ['First login and navigation', 'Inviting and managing students', 'Assigning cases', 'Learner activity and analytics', 'EMR and bedside workflow', 'Finding support'];

export default function AdminWalkthroughVideos() {
  const { user, profile } = useAuthStore();
  const superAdmin = isSuperAdmin(profile);
  const [videos, setVideos] = useState<Video[]>([]);
  const [course, setCourse] = useState<Course | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Video | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', topic: topics[0], transcript: '', file: null as File | null });
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    const [videoResult, courseResult] = await Promise.all([
      supabase.from('walkthrough_videos').select('*').order('topic').order('title'),
      supabase.from('walkthrough_courses').select('*').eq('status', 'published').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (videoResult.error) setError(videoResult.error.message);
    setVideos(videoResult.data ?? []);
    setCourse(courseResult.data ?? null);
    if (courseResult.data) {
      const itemResult = await supabase.from('walkthrough_course_items').select('*').eq('course_id', courseResult.data.id).eq('course_version', courseResult.data.version).order('position');
      setItems(itemResult.data ?? []);
    }
    if (user) {
      const progressResult = await supabase.from('walkthrough_progress').select('*').eq('user_id', user.id);
      setProgress(progressResult.data ?? []);
    }
    setLoading(false);
  };

  // The loader is recreated with the authenticated account; the effect is the account boundary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [user?.id]);

  const visibleVideos = useMemo(() => videos.filter((video) => `${video.title} ${video.description} ${video.topic}`.toLowerCase().includes(query.toLowerCase())), [videos, query]);
  const courseVideos = items.map((item) => videos.find((video) => video.id === item.video_id && video.version === item.video_version)).filter(Boolean) as Video[];
  const activeVideos = courseVideos.length ? courseVideos : visibleVideos;

  const openVideo = async (video: Video) => {
    setSelected(video);
    setSignedUrl(null);
    if (video.video_path) {
      const { data, error: signError } = await supabase.storage.from('walkthrough_videos').createSignedUrl(video.video_path, 3600);
      if (signError) setError(`Video playback could not be loaded: ${signError.message}`);
      setSignedUrl(data?.signedUrl ?? null);
    }
  };

  const uploadVideo = async () => {
    if (!user || !form.title.trim() || !form.file) return;
    setUploading(true); setError('');
    const id = crypto.randomUUID();
    const path = `${id}/${form.file.name}`;
    const upload = await supabase.storage.from('walkthrough_videos').upload(path, form.file, { upsert: false });
    if (upload.error) { setError(upload.error.message); setUploading(false); return; }
    const insert = await supabase.from('walkthrough_videos').insert({ id, title: form.title.trim(), description: form.description.trim(), topic: form.topic, transcript: form.transcript, video_path: path, status: 'draft', processing_status: 'ready', created_by: user.id }).select().single();
    if (insert.error) setError(insert.error.message); else { setShowUpload(false); setForm({ title: '', description: '', topic: topics[0], transcript: '', file: null }); await load(); }
    setUploading(false);
  };

  const createCourse = async () => {
    if (!user) return;
    const result = await supabase.from('walkthrough_courses').insert({ title: 'Nurse Althea Administrator Onboarding', description: 'Required administrator walkthroughs', status: 'draft', is_mandatory: false, created_by: user.id }).select().single();
    if (result.error) setError(result.error.message); else setCourse(result.data);
  };

  const togglePublish = async (video: Video) => {
    const nextStatus = video.status === 'published' ? 'draft' : 'published';
    const result = await supabase.from('walkthrough_videos').update({ status: nextStatus }).eq('id', video.id).eq('version', video.version).select().single();
    if (result.error) setError(result.error.message); else setVideos((previous) => previous.map((entry) => entry.id === video.id && entry.version === video.version ? result.data : entry));
  };

  const saveProgress = async (video: Video, currentTime: number, completed = false) => {
    if (!user || !course) return;
    const item = items.find((entry) => entry.video_id === video.id && entry.video_version === video.version);
    if (!item) return;
    const enrollment = await supabase.from('walkthrough_enrollments').upsert({ user_id: user.id, course_id: course.id, course_version: course.version, last_video_id: video.id, last_position_seconds: currentTime }, { onConflict: 'user_id,course_id,course_version' }).select().single();
    if (enrollment.error || !enrollment.data) return;
    await supabase.from('walkthrough_progress').upsert({ enrollment_id: enrollment.data.id, user_id: user.id, video_id: video.id, video_version: video.version, position_seconds: currentTime, watched_intervals: [{ start: 0, end: currentTime }], completed_at: completed ? new Date().toISOString() : null }, { onConflict: 'enrollment_id,video_id,video_version' });
    void load();
  };

  return <AdminLayout>
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-slate-900">Walkthrough Videos</h1><p className="mt-1 text-sm text-slate-600">Shared administrator training library. Students do not receive this content.</p></div>
        {superAdmin && <div className="flex gap-2"><Button variant="outline" onClick={() => void createCourse()}>Create course</Button><Button onClick={() => setShowUpload(true)}><Upload className="mr-2 h-4 w-4" />Upload video</Button></div>}
      </div>
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4"><div className="flex items-center gap-2 font-semibold text-blue-950"><Film className="h-5 w-5" />Continue onboarding</div><p className="mt-1 text-sm text-blue-900">{course ? `Complete the ${course.title} required steps in order.` : 'Training will appear here when the owner publishes the administrator course.'}</p><a className="mt-3 inline-block text-sm font-semibold text-blue-700 underline" href="/admin/onboarding">Open onboarding</a></div>
      <div className="flex items-center gap-3"><Search className="h-4 w-4 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search videos by title, topic, or description" /></div>
      {loading ? <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-blue-600" /></div> : activeVideos.length === 0 ? <div className="rounded-lg border border-dashed p-10 text-center text-sm text-slate-500">No published walkthrough videos yet. A Super Admin can upload the first draft.</div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{activeVideos.map((video) => { const done = progress.some((entry) => entry.video_id === video.id && entry.video_version === video.version && entry.completed_at); return <div key={`${video.id}-${video.version}`} className="overflow-hidden rounded-lg border bg-white text-left shadow-sm"><button type="button" onClick={() => void openVideo(video)} className="w-full text-left"><div className="flex h-32 items-center justify-center bg-slate-100 text-slate-400"><Film className="h-10 w-10" /></div><div className="space-y-2 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-blue-700">{video.topic}</div><h2 className="font-semibold text-slate-900">{video.title}</h2><p className="line-clamp-2 text-sm text-slate-600">{video.description || 'Administrator walkthrough'}</p><div className="flex items-center gap-2 text-xs text-slate-500">{done ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" />Completed</> : 'Not started'}{superAdmin && <span className="ml-auto rounded bg-slate-100 px-2 py-1">{video.status}</span>}</div></div></button>{superAdmin && <div className="border-t p-3"><Button size="sm" variant="outline" onClick={() => void togglePublish(video)}>{video.status === 'published' ? 'Return to draft' : 'Publish after review'}</Button></div>}</div>; })}</div>}
      {showUpload && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl"><h2 className="text-lg font-semibold">Upload walkthrough video</h2><p className="mt-1 text-sm text-slate-600">Accepted browser video formats are shown by your browser. New uploads remain draft until reviewed.</p><div className="mt-4 space-y-3"><Input placeholder="Title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /><Input placeholder="Short description" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /><select className="w-full rounded-md border px-3 py-2 text-sm" value={form.topic} onChange={(e) => setForm((p) => ({ ...p, topic: e.target.value }))}>{topics.map((topic) => <option key={topic}>{topic}</option>)}</select><Textarea rows={5} placeholder="Reviewed transcript" value={form.transcript} onChange={(e) => setForm((p) => ({ ...p, transcript: e.target.value }))} /><input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(e) => setForm((p) => ({ ...p, file: e.target.files?.[0] ?? null }))} /></div><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button><Button disabled={uploading || !form.title.trim() || !form.file} onClick={() => void uploadVideo()}>{uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Save draft</Button></div></div></div>}
      {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6"><div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">{selected.title}</h2><p className="text-sm text-slate-600">{selected.description}</p></div><button className="text-sm text-slate-500 underline" onClick={() => setSelected(null)}>Back to videos</button></div>{signedUrl ? <video ref={videoRef} className="mt-5 w-full rounded-lg bg-black" controls playsInline onTimeUpdate={(e) => { if (Math.floor(e.currentTime) % 10 === 0) void saveProgress(selected, e.currentTime); }} onPause={(e) => void saveProgress(selected, e.currentTime)} onEnded={(e) => void saveProgress(selected, e.currentTime, true)} src={signedUrl} /> : <div className="mt-5 rounded-lg bg-slate-100 p-10 text-center text-sm text-slate-600">Video is not ready for playback yet. Retry or contact support.</div>}<div className="mt-5"><h3 className="font-semibold">Transcript</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selected.transcript || 'Transcript pending review.'}</p></div></div></div>}
    </div>
  </AdminLayout>;
}

export function AdminOnboarding() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [current, setCurrent] = useState(0);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // The authenticated user is the tenant boundary for progress reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void (async () => { const c = await supabase.from('walkthrough_courses').select('*').eq('status', 'published').eq('is_mandatory', true).limit(1).maybeSingle(); setCourse(c.data); if (!c.data) return; const [i, v, p] = await Promise.all([supabase.from('walkthrough_course_items').select('*').eq('course_id', c.data.id).eq('course_version', c.data.version).order('position'), supabase.from('walkthrough_videos').select('*').eq('status', 'published'), user ? supabase.from('walkthrough_progress').select('*').eq('user_id', user.id) : Promise.resolve({ data: [] as Progress[] })]); setItems(i.data ?? []); setVideos(v.data ?? []); setProgress(p.data ?? []); })(); }, [user?.id]);
  const required = items.filter((item) => item.required); const video = videos.find((entry) => entry.id === required[current]?.video_id && entry.version === required[current]?.video_version); const done = video ? progress.some((entry) => entry.video_id === video.id && entry.video_version === video.version && entry.completed_at) : false;
  useEffect(() => { void (async () => { setSignedUrl(null); if (!video?.video_path) return; const result = await supabase.storage.from('walkthrough_videos').createSignedUrl(video.video_path, 3600); setSignedUrl(result.data?.signedUrl ?? null); })(); }, [video?.id, video?.version, video?.video_path]);
  const completeCurrent = async (positionSeconds: number) => {
    if (!user || !course || !video) return;
    setIsSaving(true);
    const enrollment = await supabase.from('walkthrough_enrollments').upsert({ user_id: user.id, course_id: course.id, course_version: course.version, last_video_id: video.id, last_position_seconds: positionSeconds }, { onConflict: 'user_id,course_id,course_version' }).select().single();
    if (enrollment.data) {
      await supabase.from('walkthrough_progress').upsert({ enrollment_id: enrollment.data.id, user_id: user.id, video_id: video.id, video_version: video.version, position_seconds: positionSeconds, watched_intervals: [{ start: 0, end: positionSeconds }], completed_at: new Date().toISOString() }, { onConflict: 'enrollment_id,video_id,video_version' });
      setProgress((previous) => [...previous.filter((entry) => !(entry.video_id === video.id && entry.video_version === video.version)), { id: crypto.randomUUID(), enrollment_id: enrollment.data.id, user_id: user.id, video_id: video.id, video_version: video.version, position_seconds: positionSeconds, watched_intervals: [{ start: 0, end: positionSeconds }], completed_at: new Date().toISOString(), last_activity_at: new Date().toISOString() }]);
    }
    setIsSaving(false);
  };
  if (!course || !video) return <AdminLayout><div className="p-8"><h1 className="text-2xl font-bold">Welcome to Nurse Althea</h1><p className="mt-2 text-slate-600">Onboarding is not available until the administrator course is published.</p></div></AdminLayout>;
  return <AdminLayout><div className="mx-auto max-w-6xl p-6"><div className="mb-6"><h1 className="text-2xl font-bold">Welcome to Nurse Althea</h1><p className="mt-1 text-sm text-slate-600">Step {current + 1} of {required.length} · {progress.filter((entry) => entry.completed_at).length} required videos completed</p><div className="mt-3 h-2 rounded bg-slate-200"><div className="h-2 rounded bg-blue-600" style={{ width: `${(current / Math.max(required.length, 1)) * 100}%` }} /></div></div><div className="grid gap-6 lg:grid-cols-[240px_1fr]"><ol className="space-y-2">{required.map((item, index) => <li key={item.id} className={`rounded-md p-3 text-sm ${index === current ? 'bg-blue-50 font-semibold text-blue-800' : index > current ? 'text-slate-400' : 'text-emerald-700'}`}>{index > current && <Lock className="mr-2 inline h-4 w-4" />}{index + 1}. {videos.find((entry) => entry.id === item.video_id)?.title ?? 'Video'}</li>)}</ol><div className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="text-xl font-semibold">{video.title}</h2><p className="mt-2 text-sm text-slate-600">{video.description}</p>{signedUrl ? <video className="mt-4 w-full rounded-lg bg-black" controls playsInline src={signedUrl} onTimeUpdate={(event) => { if (Math.floor(event.currentTime) % 10 === 0) void supabase.from('walkthrough_enrollments').update({ last_video_id: video.id, last_position_seconds: event.currentTime }).eq('user_id', user?.id ?? '').eq('course_id', course.id).eq('course_version', course.version); }} onEnded={(event) => void completeCurrent(event.currentTarget.duration || event.currentTarget.currentTime)} /> : <div className="mt-4 rounded bg-slate-100 p-8 text-center text-sm text-slate-600">This video is not ready for playback. Retry or contact support.</div>}<h3 className="mt-5 font-semibold">{video.title}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{video.transcript}</p><div className="mt-5 flex justify-end"><Button disabled={isSaving || !done} onClick={async () => { if (current === required.length - 1) { await supabase.from('walkthrough_enrollments').update({ completed_at: new Date().toISOString() }).eq('user_id', user?.id ?? '').eq('course_id', course.id).eq('course_version', course.version); navigate('/dashboard'); } else setCurrent((value) => value + 1); }}>{isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{current === required.length - 1 ? 'Onboarding complete' : 'Continue'}</Button></div></div></div></div></AdminLayout>;
}

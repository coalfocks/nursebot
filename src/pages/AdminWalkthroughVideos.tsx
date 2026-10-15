import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Film, Loader2, Lock, Plus, Search, Upload } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import { Button } from '../features/emr/components/ui/Button';
import { Input } from '../features/emr/components/ui/Input';
import { Textarea } from '../features/emr/components/ui/Textarea';
import { supabase } from '../lib/supabase';
import { isSuperAdmin } from '../lib/roles';
import { useAuthStore } from '../stores/authStore';
import type { Database } from '../lib/database.types';
import { displayWalkthroughTitle, getWalkthroughPublicationError, type WalkthroughAudience } from '../lib/walkthrough';

type Video = Database['public']['Tables']['walkthrough_videos']['Row'];
type Course = Database['public']['Tables']['walkthrough_courses']['Row'];
type Item = Database['public']['Tables']['walkthrough_course_items']['Row'];
type Progress = Database['public']['Tables']['walkthrough_progress']['Row'];

const topics = ['First login and navigation', 'Inviting and managing students', 'Assigning cases', 'Learner activity and analytics', 'EMR and bedside workflow', 'Finding support'];
const emptyForm = { title: '', description: '', learning_objective: '', topic: topics[0], audience: 'admin' as WalkthroughAudience, onboarding_eligible: true, transcript: '', file: null as File | null };
const audienceLabel: Record<WalkthroughAudience, string> = { admin: 'Administrators', student: 'Students', test_room: 'Test Room accounts', both: 'Administrators and students' };

export default function AdminWalkthroughVideos() {
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const superAdmin = isSuperAdmin(profile);
  const [videos, setVideos] = useState<Video[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [enrollments, setEnrollments] = useState<Array<Pick<Database['public']['Tables']['walkthrough_enrollments']['Row'], 'user_id' | 'course_id' | 'course_version' | 'completed_at' | 'updated_at'>>>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Video | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [editing, setEditing] = useState<Video | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true);
    const [videoResult, progressResult, enrollmentResult] = await Promise.all([
      supabase.from('walkthrough_videos').select('*').in('audience', ['admin', 'student', 'test_room', 'both']).order('topic').order('title'),
      user ? supabase.from('walkthrough_progress').select('*').eq('user_id', user.id) : Promise.resolve({ data: [] as Progress[] }),
      supabase.from('walkthrough_enrollments').select('user_id, course_id, course_version, completed_at, updated_at').order('updated_at', { ascending: false }).limit(200),
    ]);
    if (videoResult.error) setError(videoResult.error.message);
    setVideos(videoResult.data ?? []);
    setProgress(progressResult.data ?? []);
    setEnrollments(enrollmentResult.data ?? []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleVideos = useMemo(() => videos.filter((video) => `${video.title} ${video.description} ${video.topic}`.toLowerCase().includes(query.toLowerCase())), [videos, query]);

  const openVideo = async (video: Video) => {
    setSelected(video); setSignedUrl(null);
    if (!video.video_path) return;
    const result = await supabase.storage.from('walkthrough_videos').createSignedUrl(video.video_path, 3600);
    if (result.error) setError(`Video playback could not be loaded: ${result.error.message}`);
    setSignedUrl(result.data?.signedUrl ?? null);
  };

  const saveVideo = async () => {
    if (!user || !form.title.trim() || (editing ? false : !form.file)) return;
    setUploading(true); setError('');
    let videoPath = editing?.video_path ?? null;
    if (!editing && form.file) {
      videoPath = `${crypto.randomUUID()}/${form.file.name}`;
      const upload = await supabase.storage.from('walkthrough_videos').upload(videoPath, form.file, { upsert: false });
      if (upload.error) { setError(upload.error.message); setUploading(false); return; }
    }
    const payload = { title: form.title.trim(), description: form.description.trim(), learning_objective: form.learning_objective.trim(), topic: form.topic, audience: form.audience, onboarding_eligible: form.onboarding_eligible, transcript: form.transcript, video_path: videoPath, processing_status: editing?.processing_status ?? 'ready' };
    const result = editing
      ? await supabase.from('walkthrough_videos').update(payload).eq('id', editing.id).eq('version', editing.version).select().single()
      : await supabase.from('walkthrough_videos').insert({ ...payload, status: 'draft', created_by: user.id }).select().single();
    if (result.error) setError(result.error.message);
    else { setShowUpload(false); setEditing(null); setForm(emptyForm); await load(); }
    setUploading(false);
  };

  const togglePublish = async (video: Video) => {
    setError('');
    if (video.status !== 'published') {
      const unsafe = getWalkthroughPublicationError(video.transcript);
      if (unsafe) { setError(unsafe); return; }
    }
    const result = await supabase.from('walkthrough_videos').update({ status: video.status === 'published' ? 'draft' : 'published' }).eq('id', video.id).eq('version', video.version).select().single();
    if (result.error) setError(result.error.message); else setVideos((previous) => previous.map((entry) => entry.id === video.id && entry.version === video.version ? result.data : entry));
  };

  const startEdit = (video: Video) => { setEditing(video); setForm({ title: video.title, description: video.description, learning_objective: video.learning_objective, topic: video.topic, audience: video.audience, onboarding_eligible: video.onboarding_eligible, transcript: video.transcript, file: null }); };

  return <AdminLayout><div className="mx-auto max-w-7xl space-y-6 p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold text-slate-900">Administrator walkthrough videos</h1><p className="mt-1 text-sm text-slate-600">Admin-facing content is managed separately from the student learning library.</p></div>{superAdmin && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => navigate('/admin/walkthrough-courses/new')}>Create course</Button><Button onClick={() => { setEditing(null); setForm(emptyForm); setShowUpload(true); }}><Upload className="mr-2 h-4 w-4" />Upload video</Button></div>}</div>
    {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    <div className="flex flex-wrap items-center gap-3"><Search className="h-4 w-4 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search administrator videos" /></div>
    {loading ? <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-blue-600" /></div> : visibleVideos.length === 0 ? <div className="rounded-lg border border-dashed p-10 text-center text-sm text-slate-500">No administrator videos are available yet.</div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleVideos.map((video) => { const done = progress.some((entry) => entry.video_id === video.id && entry.video_version === video.version && entry.completed_at); return <div key={`${video.id}-${video.version}`} className="overflow-hidden rounded-lg border bg-white shadow-sm"><button type="button" onClick={() => void openVideo(video)} className="w-full text-left"><div className="flex h-32 items-center justify-center bg-slate-100 text-slate-400"><Film className="h-10 w-10" /></div><div className="space-y-2 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-blue-700">{video.topic}</div><h2 className="font-semibold text-slate-900">{displayWalkthroughTitle(video.title)}</h2><p className="line-clamp-2 text-sm text-slate-600">{video.description || 'Administrator walkthrough'}</p><div className="flex items-center gap-2 text-xs text-slate-500">{done ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" />Completed</> : 'Not started'}{superAdmin && <span className="ml-auto rounded bg-slate-100 px-2 py-1">{video.status} · {audienceLabel[video.audience]}</span>}</div></div></button>{superAdmin && <div className="flex gap-2 border-t p-3"><Button size="sm" variant="outline" onClick={() => startEdit(video)}>Edit</Button><Button size="sm" variant="outline" onClick={() => void togglePublish(video)}>{video.status === 'published' ? 'Return to draft' : 'Publish after review'}</Button></div>}</div>; })}</div>}
    <section className="rounded-lg border bg-white p-5"><h2 className="font-semibold text-slate-900">Learner course completion</h2><p className="mt-1 text-sm text-slate-600">Completion metadata only; no student chat or case data is exposed here.</p>{enrollments.length === 0 ? <p className="mt-4 text-sm text-slate-500">No learner course enrollments have been recorded.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-2">Learner ID</th><th>Course</th><th>Status</th><th>Updated</th></tr></thead><tbody>{enrollments.map((entry) => <tr key={`${entry.user_id}-${entry.course_id}-${entry.course_version}`} className="border-b last:border-0"><td className="py-2 font-mono text-xs">{entry.user_id}</td><td>{entry.course_id} v{entry.course_version}</td><td>{entry.completed_at ? <span className="text-emerald-700">Complete</span> : <span className="text-amber-700">In progress</span>}</td><td>{new Date(entry.updated_at).toLocaleString()}</td></tr>)}</tbody></table></div>}</section>
    {(showUpload || editing) && <VideoForm form={form} setForm={setForm} editing={editing} uploading={uploading} onCancel={() => { setShowUpload(false); setEditing(null); }} onSave={() => void saveVideo()} />}
    {selected && <VideoPlayer video={selected} signedUrl={signedUrl} onClose={() => setSelected(null)} />}
  </div></AdminLayout>;
}

function VideoForm({ form, setForm, editing, uploading, onCancel, onSave }: { form: typeof emptyForm; setForm: (value: typeof emptyForm) => void; editing: Video | null; uploading: boolean; onCancel: () => void; onSave: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl"><h2 className="text-lg font-semibold">{editing ? 'Edit walkthrough video' : 'Upload walkthrough video'}</h2><div className="mt-4 space-y-3"><Input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /><Input placeholder="Concise learning objective" value={form.learning_objective} onChange={(e) => setForm({ ...form, learning_objective: e.target.value })} /><Input placeholder="Short description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /><select className="w-full rounded-md border px-3 py-2 text-sm" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })}>{topics.map((topic) => <option key={topic}>{topic}</option>)}</select><select className="w-full rounded-md border px-3 py-2 text-sm" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as WalkthroughAudience })}><option value="admin">Administrators</option><option value="student">Students</option><option value="both">Administrators and students</option></select>{(form.audience === 'student' || form.audience === 'both') && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.onboarding_eligible} onChange={(e) => setForm({ ...form, onboarding_eligible: e.target.checked })} /> Eligible for required student onboarding (uncheck for optional reference, such as sign-in help)</label>}<Textarea rows={6} placeholder="Reviewed transcript" value={form.transcript} onChange={(e) => setForm({ ...form, transcript: e.target.value })} />{!editing && <input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })} />}</div><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={uploading || !form.title.trim() || (!editing && !form.file)} onClick={onSave}>{uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}{editing ? 'Save changes' : 'Save draft'}</Button></div></div></div>;
}

function VideoPlayer({ video, signedUrl, onClose }: { video: Video; signedUrl: string | null; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6"><div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">{video.title}</h2><p className="text-sm text-slate-600">{video.description}</p></div><button className="text-sm text-slate-500 underline" onClick={onClose}>Back to videos</button></div>{signedUrl ? <video className="mt-5 w-full rounded-lg bg-black" controls playsInline src={signedUrl} /> : <div className="mt-5 rounded-lg bg-slate-100 p-10 text-center text-sm text-slate-600">Video is not ready for playback yet.</div>}<div className="mt-5"><h3 className="font-semibold">Transcript</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{video.transcript || 'Transcript pending review.'}</p></div></div></div>;
}

export function CourseEditor() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuthStore();
  const [course, setCourse] = useState<Partial<Course>>({ title: '', description: '', audience: 'admin', is_mandatory: false, status: 'draft', version: 1 });
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(courseId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { void (async () => { const videoResult = await supabase.from('walkthrough_videos').select('*').in('audience', ['admin', 'student', 'test_room', 'both']).eq('status', 'published').order('title'); setVideos(videoResult.data ?? []); if (!courseId) { setLoading(false); return; } const courseResult = await supabase.from('walkthrough_courses').select('*').eq('id', courseId).single(); const itemResult = await supabase.from('walkthrough_course_items').select('*').eq('course_id', courseId).eq('course_version', courseResult.data?.version ?? 1).order('position'); if (courseResult.error) setError(courseResult.error.message); else setCourse(courseResult.data); setSelectedIds((itemResult.data ?? []).sort((a, b) => a.position - b.position).map((item) => item.video_id)); setLoading(false); })(); }, [courseId]);
  const orderedVideos = selectedIds.map((id) => videos.find((video) => video.id === id)).filter(Boolean) as Video[];
  const addVideo = (id: string) => { if (id && !selectedIds.includes(id)) setSelectedIds([...selectedIds, id]); };
  const move = (index: number, direction: -1 | 1) => { const next = [...selectedIds]; const target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; setSelectedIds(next); };
  const save = async (publish: boolean) => {
    if (!user || !course.title?.trim()) return;
    setSaving(true); setError('');
    if (publish && selectedIds.length === 0) { setError('Add at least one published administrator video before publishing this course.'); setSaving(false); return; }
    if (publish && course.audience === 'student' && orderedVideos.some((video) => !video.onboarding_eligible)) { setError('Student onboarding cannot include optional reference videos. Mark sign-in help and other references as optional, or remove them from this course.'); setSaving(false); return; }
    if (publish && course.audience === 'test_room' && orderedVideos.some((video) => video.audience !== 'test_room')) { setError('Test Room courses may include only Test Room videos.'); setSaving(false); return; }
    if (publish && orderedVideos.some((video) => getWalkthroughPublicationError(video.transcript))) { setError('This course contains a video with unsafe shared-password advice. Review the video transcript before publishing.'); setSaving(false); return; }
    const result = course.id ? await supabase.from('walkthrough_courses').update({ title: course.title.trim(), description: course.description?.trim() ?? '', audience: course.audience ?? 'admin', is_mandatory: Boolean(course.is_mandatory), status: 'draft' }).eq('id', course.id).eq('version', course.version ?? 1).select().single() : await supabase.from('walkthrough_courses').insert({ title: course.title.trim(), description: course.description?.trim() ?? '', audience: course.audience ?? 'admin', is_mandatory: Boolean(course.is_mandatory), status: 'draft', created_by: user.id }).select().single();
    if (result.error || !result.data) { setError(result.error?.message ?? 'Course could not be saved.'); setSaving(false); return; }
    const saved = result.data;
    const deleteResult = await supabase.from('walkthrough_course_items').delete().eq('course_id', saved.id).eq('course_version', saved.version);
    if (deleteResult.error) { setError(deleteResult.error.message); setSaving(false); return; }
    const itemResult = selectedIds.length ? await supabase.from('walkthrough_course_items').insert(selectedIds.map((videoId, position) => ({ course_id: saved.id, course_version: saved.version, video_id: videoId, video_version: videos.find((video) => video.id === videoId)?.version ?? 1, position, required: true }))) : { error: null };
    if (itemResult.error) setError(itemResult.error.message);
    else if (publish) { const published = await supabase.from('walkthrough_courses').update({ status: 'published' }).eq('id', saved.id).eq('version', saved.version); if (published.error) setError(published.error.message); else navigate('/admin/walkthrough-videos'); }
    else setCourse(saved);
    setSaving(false);
  };
  if (!isSuperAdmin(profile)) return <AdminLayout><div className="p-8">You do not have permission to edit courses.</div></AdminLayout>;
  if (loading) return <AdminLayout><div className="flex justify-center p-16"><Loader2 className="h-7 w-7 animate-spin text-blue-600" /></div></AdminLayout>;
  return <AdminLayout><div className="mx-auto max-w-4xl space-y-6 p-6"><div><Link className="text-sm text-blue-700 underline" to="/admin/walkthrough-videos">← Back to videos</Link><h1 className="mt-3 text-2xl font-bold">{course.id ? 'Edit course' : 'Create course'}</h1><p className="mt-1 text-sm text-slate-600">Choose and reorder published videos. Student mandatory courses gate assigned cases until each video is acknowledged.</p></div>{error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}<section className="space-y-3 rounded-lg border bg-white p-5"><Input placeholder="Course title" value={course.title ?? ''} onChange={(e) => setCourse({ ...course, title: e.target.value })} /><Textarea rows={4} placeholder="Course description" value={course.description ?? ''} onChange={(e) => setCourse({ ...course, description: e.target.value })} /><select className="w-full rounded-md border px-3 py-2 text-sm" value={course.audience ?? 'admin'} onChange={(e) => setCourse({ ...course, audience: e.target.value as Course['audience'] })}><option value="admin">Administrator onboarding</option><option value="student">Student Learning Library</option><option value="test_room">Test Room accounts</option><option value="both">Both administrator and student audiences</option></select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(course.is_mandatory)} onChange={(e) => setCourse({ ...course, is_mandatory: e.target.checked })} /> Make this the mandatory course for the selected audience</label></section><section className="rounded-lg border bg-white p-5"><h2 className="font-semibold">Course videos</h2><select className="mt-3 w-full rounded-md border px-3 py-2 text-sm" value="" onChange={(e) => addVideo(e.target.value)}><option value="">Add a published compatible video…</option>{videos.filter((video) => !selectedIds.includes(video.id) && (course.audience === 'admin' ? ['admin', 'both'].includes(video.audience) : course.audience === 'student' ? ['student', 'both'].includes(video.audience) && video.onboarding_eligible : course.audience === 'test_room' ? video.audience === 'test_room' : video.audience === 'both' ? video.audience === 'both' : false)).map((video) => <option key={`${video.id}-${video.version}`} value={video.id}>{video.title}</option>)}</select>{orderedVideos.length === 0 ? <p className="mt-4 rounded-md border border-dashed p-6 text-center text-sm text-slate-500">No videos selected yet.</p> : <ol className="mt-4 space-y-2">{orderedVideos.map((video, index) => <li key={video.id} className="flex items-center gap-3 rounded-md border p-3"><span className="w-6 text-sm text-slate-500">{index + 1}</span><span className="flex-1 text-sm font-medium">{video.title}<span className="block text-xs text-slate-500">{video.learning_objective || video.description}</span></span><Button size="sm" variant="outline" onClick={() => move(index, -1)}>Up</Button><Button size="sm" variant="outline" onClick={() => move(index, 1)}>Down</Button><Button size="sm" variant="outline" onClick={() => setSelectedIds(selectedIds.filter((id) => id !== video.id))}>Remove</Button></li>)}</ol>}</section><div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={() => void save(false)}>Save draft</Button><Button disabled={saving || !course.title?.trim()} onClick={() => void save(true)}>Publish course</Button></div></div></AdminLayout>;
}

export function AdminOnboarding() {
  const { user } = useAuthStore();
  const [course, setCourse] = useState<Course | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [current, setCurrent] = useState(0);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { void (async () => { const c = await supabase.from('walkthrough_courses').select('*').eq('status', 'published').eq('is_mandatory', true).in('audience', ['admin', 'both']).order('updated_at', { ascending: false }).limit(1).maybeSingle(); setCourse(c.data); if (!c.data) return; const [i, v, p] = await Promise.all([supabase.from('walkthrough_course_items').select('*').eq('course_id', c.data.id).eq('course_version', c.data.version).order('position'), supabase.from('walkthrough_videos').select('*').in('audience', ['admin', 'both']).eq('status', 'published'), user ? supabase.from('walkthrough_progress').select('*').eq('user_id', user.id) : Promise.resolve({ data: [] as Progress[] })]); setItems(i.data ?? []); setVideos(v.data ?? []); setProgress(p.data ?? []); })(); }, [user]);
  const required = items.filter((item) => item.required); const video = videos.find((entry) => entry.id === required[current]?.video_id && entry.version === required[current]?.video_version); const done = video ? progress.some((entry) => entry.video_id === video.id && entry.video_version === video.version && entry.completed_at) : false;
  useEffect(() => { void (async () => { setSignedUrl(null); if (!video?.video_path) return; const result = await supabase.storage.from('walkthrough_videos').createSignedUrl(video.video_path, 3600); setSignedUrl(result.data?.signedUrl ?? null); })(); }, [video?.id, video?.version, video?.video_path]);
  const complete = async (seconds: number) => { if (!user || !course || !video) return; setSaving(true); const enrollment = await supabase.from('walkthrough_enrollments').upsert({ user_id: user.id, course_id: course.id, course_version: course.version, last_video_id: video.id, last_position_seconds: seconds }, { onConflict: 'user_id,course_id,course_version' }).select().single(); if (enrollment.data) { await supabase.from('walkthrough_progress').upsert({ enrollment_id: enrollment.data.id, user_id: user.id, video_id: video.id, video_version: video.version, position_seconds: seconds, watched_intervals: [{ start: 0, end: seconds }], completed_at: new Date().toISOString() }, { onConflict: 'enrollment_id,video_id,video_version' }); setProgress((old) => [...old.filter((entry) => !(entry.video_id === video.id && entry.video_version === video.version)), { id: crypto.randomUUID(), enrollment_id: enrollment.data.id, user_id: user.id, video_id: video.id, video_version: video.version, position_seconds: seconds, watched_intervals: [{ start: 0, end: seconds }], completed_at: new Date().toISOString(), last_activity_at: new Date().toISOString() }]); } setSaving(false); };
  if (!course || !video) return <AdminLayout><div className="mx-auto max-w-2xl p-8"><h1 className="text-2xl font-bold">Welcome to Nurse Althea</h1><p className="mt-2 text-slate-600">There is no published mandatory administrator onboarding course yet.</p><Link className="mt-4 inline-block text-sm font-semibold text-blue-700 underline" to="/admin/walkthrough-courses/new">Open course editor</Link></div></AdminLayout>;
  return <AdminLayout><div className="mx-auto max-w-6xl p-6"><div className="mb-6"><h1 className="text-2xl font-bold">Welcome to Nurse Althea</h1><p className="mt-1 text-sm text-slate-600">Step {current + 1} of {required.length}</p></div><div className="grid gap-6 lg:grid-cols-[240px_1fr]"><ol className="space-y-2">{required.map((item, index) => <li key={item.id} className={`rounded-md p-3 text-sm ${index === current ? 'bg-blue-50 font-semibold text-blue-800' : index > current ? 'text-slate-400' : 'text-emerald-700'}`}>{index > current && <Lock className="mr-2 inline h-4 w-4" />}{index + 1}. {videos.find((entry) => entry.id === item.video_id)?.title ?? 'Video'}</li>)}</ol><div className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="text-xl font-semibold">{video.title}</h2><p className="mt-2 text-sm text-slate-600">{video.description}</p>{signedUrl ? <video className="mt-4 w-full rounded-lg bg-black" controls playsInline src={signedUrl} onEnded={(event) => void complete(event.currentTarget.duration || event.currentTarget.currentTime)} /> : <div className="mt-4 rounded bg-slate-100 p-8 text-center text-sm text-slate-600">This video is not ready for playback.</div>}<p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-slate-700">{video.transcript}</p><div className="mt-5 flex justify-end"><Button disabled={saving || !done} onClick={() => { if (current < required.length - 1) setCurrent((value) => value + 1); }}>{current === required.length - 1 ? 'Onboarding complete' : 'Continue'}</Button></div></div></div></div></AdminLayout>;
}

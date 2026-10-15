import { useEffect, useState } from 'react';
import { Film, Loader2 } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';

type Video = Database['public']['Tables']['walkthrough_videos']['Row'];

export default function StudentWalkthroughVideos() {
  const { user } = useAuthStore();
  const [videos, setVideos] = useState<Video[]>([]);
  const [selected, setSelected] = useState<Video | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { void (async () => { const result = await supabase.from('walkthrough_videos').select('*').in('audience', ['student', 'both']).eq('status', 'published').order('topic').order('title'); if (result.error) setError(result.error.message); setVideos(result.data ?? []); setLoading(false); })(); }, [user?.id]);
  const open = async (video: Video) => { setSelected(video); setUrl(null); if (!video.video_path) return; const result = await supabase.storage.from('walkthrough_videos').createSignedUrl(video.video_path, 3600); if (result.error) setError(result.error.message); setUrl(result.data?.signedUrl ?? null); };
  return <main className="min-h-screen bg-slate-50 p-6"><div className="mx-auto max-w-6xl space-y-6"><div><h1 className="text-2xl font-bold text-slate-900">Student learning library</h1><p className="mt-1 text-sm text-slate-600">Watch published walkthroughs for your learner workflow.</p></div>{error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}{loading ? <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-blue-600" /></div> : videos.length === 0 ? <div className="rounded-lg border border-dashed bg-white p-10 text-center text-sm text-slate-600">No student walkthroughs have been published yet. Check back after your instructor publishes learning content.</div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{videos.map((video) => <button key={`${video.id}-${video.version}`} type="button" onClick={() => void open(video)} className="rounded-lg border bg-white p-5 text-left shadow-sm hover:border-blue-300"><Film className="h-8 w-8 text-blue-600" /><div className="mt-4 text-xs font-semibold uppercase tracking-wide text-blue-700">{video.topic}</div><h2 className="mt-1 font-semibold text-slate-900">{video.title}</h2><p className="mt-2 text-sm text-slate-600">{video.description}</p></button>)}</div>}{selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6"><div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">{selected.title}</h2><p className="text-sm text-slate-600">{selected.description}</p></div><button className="text-sm text-slate-500 underline" onClick={() => setSelected(null)}>Close</button></div>{url ? <video className="mt-5 w-full rounded-lg bg-black" controls playsInline src={url} /> : <div className="mt-5 rounded-lg bg-slate-100 p-10 text-center text-sm text-slate-600">Video playback is not ready.</div>}<p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selected.transcript}</p></div></div>}</div></main>;
}

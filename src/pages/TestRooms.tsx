import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2, Play, RefreshCw } from 'lucide-react';
import Navbar from '../components/Navbar';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { isTestUser } from '../lib/roles';
import type { Database } from '../lib/database.types';

type Room = Database['public']['Tables']['rooms']['Row'] & {
  specialty?: {
    name: string | null;
  } | null;
};

type AssignmentSummary = Pick<
  Database['public']['Tables']['student_room_assignments']['Row'],
  'id' | 'room_id' | 'status' | 'created_at'
>;

export default function TestRooms() {
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [assignmentsByRoom, setAssignmentsByRoom] = useState<Map<number, AssignmentSummary>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingRoomId, setOpeningRoomId] = useState<number | null>(null);
  const [resettingRoomIds, setResettingRoomIds] = useState<Set<number>>(new Set());

  const canAccess = useMemo(() => isTestUser(profile), [profile]);

  useEffect(() => {
    if (!user) return;
    if (!canAccess) {
      navigate('/dashboard');
      return;
    }

    let isMounted = true;

    const loadRooms = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: roomsError } = await supabase
          .from('rooms')
          .select('*, specialty:specialty_id (name)')
          .order('room_number');

        if (roomsError) throw roomsError;
        if (isMounted) {
          setRooms((data ?? []) as Room[]);
        }
      } catch (err) {
        console.error('Failed to load rooms', err);
        if (isMounted) {
          setError('Unable to load rooms.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    const loadAssignments = async () => {
      if (!user) return;
      try {
        const { data, error: assignmentsError } = await supabase
          .from('student_room_assignments')
          .select('id, room_id, status, created_at')
          .eq('student_id', user.id)
          .order('created_at', { ascending: false });

        if (assignmentsError) throw assignmentsError;

        if (isMounted) {
          const nextMap = new Map<number, AssignmentSummary>();
          (data ?? []).forEach((assignment) => {
            if (!nextMap.has(assignment.room_id)) {
              nextMap.set(assignment.room_id, assignment as AssignmentSummary);
            }
          });
          setAssignmentsByRoom(nextMap);
        }
      } catch (err) {
        console.error('Failed to load test assignments', err);
        if (isMounted) {
          setError('Unable to load existing test sessions.');
        }
      }
    };

    void loadRooms();
    void loadAssignments();

    return () => {
      isMounted = false;
    };
  }, [user, canAccess, navigate]);

  const ensureTestAssignment = async (roomId: number) => {
    if (!user) return null;
    const existing = assignmentsByRoom.get(roomId);
    if (existing) return existing;

    const { data, error: insertError } = await supabase
      .from('student_room_assignments')
      .insert({
        student_id: user.id,
        room_id: roomId,
        assigned_by: user.id,
        status: 'assigned',
        school_id: profile?.school_id ?? undefined,
      })
      .select('id, room_id, status, created_at')
      .maybeSingle();

    if (insertError || !data) {
      console.error('Failed to create test assignment', insertError);
      setError('Unable to start a test session for this room.');
      return null;
    }

    const nextMap = new Map(assignmentsByRoom);
    nextMap.set(roomId, data as AssignmentSummary);
    setAssignmentsByRoom(nextMap);
    return data as AssignmentSummary;
  };

  const handleOpenRoom = async (roomId: number) => {
    setOpeningRoomId(roomId);
    setError(null);
    try {
      const assignment = await ensureTestAssignment(roomId);
      if (assignment) {
        navigate(`/assignment/${assignment.id}`);
      }
    } finally {
      setOpeningRoomId(null);
    }
  };

  const handleResetRoom = async (roomId: number) => {
    const assignment = assignmentsByRoom.get(roomId);
    if (!assignment) return;
    if (!user) {
      setError('You must be signed in to reset a test session.');
      return;
    }
    if (!window.confirm('Reset this room? This clears labs, orders, vitals, notes, imaging, and chat for your test session.')) {
      return;
    }

    const now = new Date().toISOString();
    setResettingRoomIds((prev) => new Set(prev).add(roomId));
    setError(null);

    try {
      const results = await Promise.all([
        supabase.from('lab_results').delete().eq('assignment_id', assignment.id),
        supabase.from('medical_orders').delete().eq('assignment_id', assignment.id),
        supabase.from('vital_signs').delete().eq('assignment_id', assignment.id),
        supabase.from('clinical_notes').delete().eq('assignment_id', assignment.id),
        supabase.from('imaging_studies').delete().eq('assignment_id', assignment.id),
        supabase.from('chat_messages').delete().eq('assignment_id', assignment.id),
      ]);

      const firstError = results.find((result) => result.error);
      if (firstError?.error) {
        console.error('Failed to reset test session', firstError.error);
        setError('Reset failed. Please try again.');
      }

      const { error: deleteError } = await supabase
        .from('student_room_assignments')
        .delete()
        .eq('id', assignment.id);

      if (deleteError) {
        console.error('Failed to remove old test session', deleteError);
        setError('Reset failed. Please try again.');
        return;
      }

      const { data: newAssignment, error: insertError } = await supabase
        .from('student_room_assignments')
        .insert({
          student_id: user.id,
          room_id: roomId,
          assigned_by: user.id,
          status: 'assigned',
          school_id: profile?.school_id ?? undefined,
        })
        .select('id, room_id, status, created_at')
        .maybeSingle();

      if (insertError || !newAssignment) {
        console.error('Failed to create fresh test session', insertError);
        setError('Reset succeeded, but a fresh session could not be created.');
        setAssignmentsByRoom((prev) => {
          const next = new Map(prev);
          next.delete(roomId);
          return next;
        });
        return;
      }

      setAssignmentsByRoom((prev) => {
        const next = new Map(prev);
        next.set(roomId, newAssignment as AssignmentSummary);
        return next;
      });
    } catch (err) {
      console.error('Failed to reset test session', err);
      setError('Reset failed. Please try again.');
    } finally {
      setResettingRoomIds((prev) => {
        const next = new Set(prev);
        next.delete(roomId);
        return next;
      });
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Test Rooms</h1>
          <p className="mt-2 text-sm text-gray-600">
            Launch a sandbox session for any room without needing an admin assignment. Reset clears all data for your
            test session only.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : rooms.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
            No rooms available yet.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {rooms.map((room) => {
              const assignment = assignmentsByRoom.get(room.id);
              const isOpening = openingRoomId === room.id;
              const isResetting = resettingRoomIds.has(room.id);
              return (
                <div key={room.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Room {room.room_number}</h2>
                      <p className="mt-1 text-sm text-gray-500">
                        {room.specialty?.name || 'General Practice'}
                        {room.difficulty_level ? ` • ${room.difficulty_level}` : ''}
                      </p>
                    </div>
                    {assignment ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        Session ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        New
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenRoom(room.id)}
                      className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isOpening}
                    >
                      {isOpening ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="mr-2 h-4 w-4" />
                      )}
                      {assignment ? 'Continue session' : 'Start session'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResetRoom(room.id)}
                      className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!assignment || isResetting}
                    >
                      {isResetting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      Reset session
                    </button>
                    {!assignment && (
                      <span className="inline-flex items-center text-xs text-gray-400">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        Start a session to enable reset
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

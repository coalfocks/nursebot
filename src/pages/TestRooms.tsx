import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2, Play, RefreshCw } from 'lucide-react';
import Navbar from '../components/Navbar';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { isTestUser } from '../lib/roles';
import type { Database } from '../lib/database.types';
import { fetchSpecialtiesForRoom } from '../lib/roomHelpers';
import { testUserAssignmentInsert, type AssignmentCreateRow } from '../lib/assignmentCreation';

type RpcError = { code?: string; message?: string; details?: string; hint?: string };
type RpcResult = { data: unknown; error: RpcError | null };
const callGeneratedRpc = (name: string, args: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (rpcName: string, rpcArgs: Record<string, unknown>) => Promise<RpcResult> }).rpc(name, args);

type EligibilityResponse = { caseVersion?: unknown; source?: unknown; packetRevision?: unknown; eventCount?: unknown };
type ReadinessResponse = { ready?: unknown; available?: unknown; schemaVersion?: unknown; immutableAssignmentSnapshots?: unknown };
type ReadinessDiagnostic = {
  checkedAt: string;
  eligibility:
    | { kind: 'rpc-error'; error: RpcError }
    | { kind: 'empty-case-version'; response: EligibilityResponse | null }
    | { kind: 'case-version'; caseVersion: string; response: EligibilityResponse };
  readiness?:
    | { kind: 'rpc-error'; error: RpcError }
    | { kind: 'not-ready'; response: ReadinessResponse | null }
    | { kind: 'ready'; response: ReadinessResponse };
};

const rpcErrorText = (error: RpcError) =>
  [error.code && `code ${error.code}`, error.message && `message ${error.message}`, error.details && `details ${error.details}`, error.hint && `hint ${error.hint}`]
    .filter(Boolean)
    .join(' — ') || 'No error code or message returned.';

const inspectRoomReadiness = async (roomId: number): Promise<ReadinessDiagnostic> => {
  const { data: eligibility, error: eligibilityError } = await callGeneratedRpc('get_mar_eligible_case_version', { p_room_id: roomId });
  if (eligibilityError) {
    return { checkedAt: new Date().toISOString(), eligibility: { kind: 'rpc-error', error: eligibilityError } };
  }

  const eligibilityResponse = (eligibility as EligibilityResponse | null) ?? null;
  const caseVersion = typeof eligibilityResponse?.caseVersion === 'string' ? eligibilityResponse.caseVersion.trim() : '';
  if (!caseVersion) {
    return { checkedAt: new Date().toISOString(), eligibility: { kind: 'empty-case-version', response: eligibilityResponse } };
  }

  const { data: readiness, error: readinessError } = await callGeneratedRpc('get_manual_mar_readiness', {});
  if (readinessError) {
    return {
      checkedAt: new Date().toISOString(),
      eligibility: { kind: 'case-version', caseVersion, response: eligibilityResponse },
      readiness: { kind: 'rpc-error', error: readinessError },
    };
  }

  const readinessResponse = (readiness as ReadinessResponse | null) ?? null;
  if (!readinessResponse?.ready || readinessResponse.available === false) {
    return {
      checkedAt: new Date().toISOString(),
      eligibility: { kind: 'case-version', caseVersion, response: eligibilityResponse },
      readiness: { kind: 'not-ready', response: readinessResponse },
    };
  }

  return {
    checkedAt: new Date().toISOString(),
    eligibility: { kind: 'case-version', caseVersion, response: eligibilityResponse },
    readiness: { kind: 'ready', response: readinessResponse },
  };
};

const diagnosticSummary = (roomId: number, diagnostic: ReadinessDiagnostic) => {
  if (diagnostic.eligibility.kind === 'rpc-error') {
    return `Room ${roomId} eligibility RPC failed: ${rpcErrorText(diagnostic.eligibility.error)}`;
  }
  if (diagnostic.eligibility.kind === 'empty-case-version') {
    return `Room ${roomId} eligibility returned an empty caseVersion (successful RPC response, not an RPC error).`;
  }
  if (!diagnostic.readiness || diagnostic.readiness.kind === 'ready') return null;
  if (diagnostic.readiness.kind === 'rpc-error') {
    return `Room ${roomId} MAR readiness RPC failed: ${rpcErrorText(diagnostic.readiness.error)}`;
  }
  return `Room ${roomId} MAR snapshot readiness returned not ready.`;
};

type Room = Database['public']['Tables']['rooms']['Row'] & {
  specialties?: Database['public']['Tables']['specialties']['Row'][];
};

type AssignmentSummary = Pick<
  Database['public']['Tables']['student_room_assignments']['Row'],
  'id' | 'room_id' | 'status' | 'created_at'
> & { case_key_version?: string | null; is_sandbox?: boolean };

export default function TestRooms() {
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [assignmentsByRoom, setAssignmentsByRoom] = useState<Map<number, AssignmentSummary>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingRoomId, setOpeningRoomId] = useState<number | null>(null);
  const [resettingRoomIds, setResettingRoomIds] = useState<Set<number>>(new Set());
  const [readinessByRoom, setReadinessByRoom] = useState<Map<number, ReadinessDiagnostic>>(new Map());
  const [checkingRoomId, setCheckingRoomId] = useState<number | null>(null);

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
          .select('*')
          .order('room_number');

        if (roomsError) throw roomsError;

        // Fetch specialties for each room
        const roomsWithSpecialties = await Promise.all(
          (data ?? []).map(async (room) => ({
            ...room,
            specialties: await fetchSpecialtiesForRoom(room),
          }))
        );

        if (isMounted) {
          setRooms(roomsWithSpecialties as Room[]);
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
          .select('id, room_id, status, created_at, case_key_version, is_sandbox')
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

  const ensureTestAssignment = async (roomId: number, forceNew = false) => {
    if (!user) return null;
    const existing = assignmentsByRoom.get(roomId);
    if (!forceNew && existing?.case_key_version) return existing;

    const diagnostic = await inspectRoomReadiness(roomId);
    setReadinessByRoom((prev) => new Map(prev).set(roomId, diagnostic));
    const caseVersion = diagnostic.eligibility.kind === 'case-version' ? diagnostic.eligibility.caseVersion : null;
    const readinessError = diagnosticSummary(roomId, diagnostic);
    if (!caseVersion || readinessError) {
      setError(readinessError ?? `Room ${roomId} is not eligible for a test session.`);
      return null;
    }

    const assignment: AssignmentCreateRow = {
      id: crypto.randomUUID(), student_id: user.id, room_id: roomId, assigned_by: user.id, status: 'assigned',
      effective_date: new Date().toISOString(), window_start: new Date().toISOString(), window_end: null,
      school_id: profile.school_id, case_key_version: caseVersion,
    };

    const { data, error: insertError } = await supabase
      .from('student_room_assignments')
      .insert(testUserAssignmentInsert(assignment))
      .select('id, room_id, status, created_at, case_key_version, is_sandbox')
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

  const handleCheckReadiness = async (roomId: number) => {
    setCheckingRoomId(roomId);
    setError(null);
    try {
      const diagnostic = await inspectRoomReadiness(roomId);
      setReadinessByRoom((prev) => new Map(prev).set(roomId, diagnostic));
      const summary = diagnosticSummary(roomId, diagnostic);
      if (summary) setError(summary);
    } finally {
      setCheckingRoomId(null);
    }
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

  const handleStartFreshRoom = async (roomId: number) => {
    setOpeningRoomId(roomId);
    setError(null);
    try {
      const assignment = await ensureTestAssignment(roomId, true);
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

      setAssignmentsByRoom((prev) => {
        const next = new Map(prev);
        next.delete(roomId);
        return next;
      });
      const newAssignment = await ensureTestAssignment(roomId);

      if (!newAssignment) {
        console.error('Failed to create fresh test session');
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
              const isChecking = checkingRoomId === room.id;
              const readiness = readinessByRoom.get(room.id);
              return (
                <div key={room.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Room {room.room_number}</h2>
                      <p className="mt-1 text-sm text-gray-500">
                        {room.specialties && room.specialties.length > 0
                          ? room.specialties.map(s => s.name).join(', ')
                          : 'General Practice'}
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
                    <button
                      type="button"
                      onClick={() => handleStartFreshRoom(room.id)}
                      className="inline-flex items-center rounded-md border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isOpening}
                      title="Creates a new immutable attempt and leaves this session's history unchanged"
                    >
                      Start fresh (preserve history)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCheckReadiness(room.id)}
                      className="inline-flex items-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isChecking || isOpening}
                    >
                      {isChecking ? 'Checking…' : 'Check MAR readiness'}
                    </button>
                    {!assignment && (
                      <span className="inline-flex items-center text-xs text-gray-400">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        Start a session to enable reset
                      </span>
                    )}
                  </div>
                  {readiness && (
                    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                      <p className="font-semibold">Read-only eligibility diagnostic</p>
                      {readiness.eligibility.kind === 'rpc-error' && (
                        <p className="mt-1">Eligibility RPC error: {rpcErrorText(readiness.eligibility.error)}</p>
                      )}
                      {readiness.eligibility.kind === 'empty-case-version' && (
                        <p className="mt-1">Eligibility RPC succeeded, but returned an empty caseVersion.</p>
                      )}
                      {readiness.eligibility.kind === 'case-version' && (
                        <p className="mt-1">Eligible caseVersion: <code>{readiness.eligibility.caseVersion}</code> (source: {String(readiness.eligibility.response.source ?? 'unknown')})</p>
                      )}
                      {readiness.readiness?.kind === 'rpc-error' && (
                        <p className="mt-1">Readiness RPC error: {rpcErrorText(readiness.readiness.error)}</p>
                      )}
                      {readiness.readiness?.kind === 'not-ready' && (
                        <p className="mt-1">Snapshot readiness response: not ready ({JSON.stringify(readiness.readiness.response)}).</p>
                      )}
                      {readiness.readiness?.kind === 'ready' && <p className="mt-1">Snapshot/readiness RPC: ready.</p>}
                      <p className="mt-1 text-slate-500">Checked {readiness.checkedAt}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

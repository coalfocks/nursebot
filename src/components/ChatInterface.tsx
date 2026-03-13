import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, User2, Wand2, ExternalLink, Stethoscope, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { generateInitialPrompt } from '../lib/openai';
import { emrApi } from '../features/emr/lib/api';
import type { ImagingStudy, LabResult, MedicalOrder, VitalSigns } from '../features/emr/lib/types';
import {
  getCompletionHintLabel,
  parseCompletionHints,
  parseCompletionHintViews,
  recordCompletionHintView,
  type CompletionHintKey,
  type CompletionHintViews,
} from '../lib/completionHints';
import {
  buildTimelineEntries,
  type AssignmentTimelineRow,
  type ChatMessage,
  type TimelineEntry,
} from './chatTimeline';

const ASSISTANT_RESPONSE_DELAY = {
  min: 600,
  max: 1800
};

interface ChatFunctionResponse {
  message: string;
  chatMessage: ChatMessage;
}

const getMessageKey = (message: ChatMessage) => {
  if (message.id !== null && message.id !== undefined) {
    return String(message.id);
  }
  return `${message.assignment_id}-${message.created_at}`;
};

const getTimelineTimestampLabel = (timestamp: string) => {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const getTimelineMarkerLabel = (kind: TimelineEntry['kind']) => {
  switch (kind) {
    case 'message':
      return 'Msg';
    case 'order':
      return 'Ord';
    case 'labs':
      return 'Lab';
    case 'vital':
      return 'Vit';
    case 'imaging':
      return 'Img';
    case 'completion':
      return 'End';
    case 'progress-note':
      return 'Note';
    default:
      return 'Evt';
  }
};

const getTimelineMarkerClassName = (kind: TimelineEntry['kind']) => {
  switch (kind) {
    case 'message':
      return 'border-slate-300 bg-white text-slate-600';
    case 'order':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    case 'labs':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'vital':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'imaging':
      return 'border-violet-200 bg-violet-50 text-violet-700';
    case 'completion':
      return 'border-green-200 bg-green-50 text-green-700';
    case 'progress-note':
      return 'border-amber-200 bg-amber-100 text-amber-800';
    default:
      return 'border-slate-300 bg-white text-slate-600';
  }
};

const formatMetric = (label: string, value?: string | number | null) => {
  if (value === undefined || value === null || value === '') return null;
  return `${label} ${value}`;
};

const getOrderSummary = (order: MedicalOrder) => {
  const details = [order.dose, order.route, order.frequency].filter(Boolean).join(' • ');
  return details || order.instructions || 'No additional order details';
};

const getLabSummary = (lab: LabResult) => {
  if (lab.status === 'Pending') {
    return `${lab.testName}: pending`;
  }
  const unit = lab.unit ? ` ${lab.unit}` : '';
  const value = lab.value === '' || lab.value === null || lab.value === undefined ? 'resulted' : `${lab.value}${unit}`;
  return `${lab.testName}: ${value}`;
};

const getVitalSummary = (vital: VitalSigns) =>
  [
    formatMetric('T', vital.temperature),
    vital.bloodPressureSystolic && vital.bloodPressureDiastolic
      ? `BP ${vital.bloodPressureSystolic}/${vital.bloodPressureDiastolic}`
      : null,
    formatMetric('HR', vital.heartRate),
    formatMetric('RR', vital.respiratoryRate),
    vital.oxygenSaturation !== undefined && vital.oxygenSaturation !== null ? `SpO2 ${vital.oxygenSaturation}%` : null,
    vital.pain !== undefined && vital.pain !== null ? `Pain ${vital.pain}/10` : null,
  ].filter(Boolean) as string[];

interface ChatInterfaceProps {
  assignmentId: string;
  roomNumber: string;
  roomId?: number;
  assignmentStatus?: string;
}

export function ChatInterface({ assignmentId, roomNumber, roomId, assignmentStatus }: ChatInterfaceProps) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [status, setStatus] = useState(assignmentStatus);
  const [isAssistantTyping, setIsAssistantTyping] = useState(false);
  const [patientLink, setPatientLink] = useState<{ patientId: string; roomId?: number } | null>(null);
  const [isLoadingPatient, setIsLoadingPatient] = useState(false);
  const [showCompletionConfirm, setShowCompletionConfirm] = useState(false);
  const [bedsideHint, setBedsideHint] = useState<string | null>(null);
  const [completionHints, setCompletionHints] = useState<CompletionHints>({
    assessmentHint: '',
    diagnosisDifferentiatorHint: '',
    planHint: '',
  });
  const [showBedsideHint, setShowBedsideHint] = useState(false);
  const [showQualtrics, setShowQualtrics] = useState(false);
  const [refreshAfterQualtrics, setRefreshAfterQualtrics] = useState(false);
  const [progressNoteDraft, setProgressNoteDraft] = useState('');
  const [isSavingProgressNote, setIsSavingProgressNote] = useState(false);
  const [completionHintViews, setCompletionHintViews] = useState<CompletionHintViews>({});
  const [expandedCompletionHints, setExpandedCompletionHints] = useState<Partial<Record<CompletionHintKey, boolean>>>({});
  const [assignmentTimeline, setAssignmentTimeline] = useState<AssignmentTimelineRow | null>(null);
  const [orders, setOrders] = useState<MedicalOrder[]>([]);
  const [labs, setLabs] = useState<LabResult[]>([]);
  const [vitals, setVitals] = useState<VitalSigns[]>([]);
  const [imagingStudies, setImagingStudies] = useState<ImagingStudy[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initializingRef = useRef(false);
  const initializedRef = useRef(false);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const timelineSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const messageIdsRef = useRef<Set<string>>(new Set());
  const pendingAssistantMessagesRef = useRef<Set<string>>(new Set());
  const messageTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const messagesRef = useRef<ChatMessage[]>([]);
  const timelineEntries = buildTimelineEntries(
    messages,
    orders,
    labs,
    vitals,
    imagingStudies,
    assignmentTimeline,
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const queueMessageForDisplay = useCallback(
    (message: ChatMessage, options: { simulateDelay?: boolean } = {}) => {
      const messageKey = getMessageKey(message);

      if (
        messageIdsRef.current.has(messageKey) ||
        messageTimeoutsRef.current.has(messageKey)
      ) {
        return;
      }

      const addMessageToState = () => {
        messageTimeoutsRef.current.delete(messageKey);
        messageIdsRef.current.add(messageKey);
        setMessages(prev => {
          if (prev.some(existing => getMessageKey(existing) === messageKey)) {
            return prev;
          }

          const nextMessages = [...prev, message];
          nextMessages.sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          messagesRef.current = nextMessages;
          return nextMessages;
        });

        if (
          pendingAssistantMessagesRef.current.delete(messageKey) &&
          pendingAssistantMessagesRef.current.size === 0
        ) {
          setIsAssistantTyping(false);
        }
      };

      const shouldSimulateDelay =
        message.role === 'assistant' && options.simulateDelay !== false;

      if (shouldSimulateDelay) {
        pendingAssistantMessagesRef.current.add(messageKey);
        setIsAssistantTyping(true);

        const delay =
          Math.floor(
            Math.random() *
              (ASSISTANT_RESPONSE_DELAY.max - ASSISTANT_RESPONSE_DELAY.min + 1)
          ) + ASSISTANT_RESPONSE_DELAY.min;

        const timeoutId = setTimeout(() => {
          addMessageToState();
        }, delay);

        messageTimeoutsRef.current.set(messageKey, timeoutId);
        return;
      }

      addMessageToState();
    },
    []
  );

  const fetchMessages = useCallback(async () => {
    if (!assignmentId) return;

    try {
      console.log('Fetching messages');
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('assignment_id', assignmentId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      if (data && data.length > 0) {
        console.log(`Found ${data.length} messages`);
        setMessages(data);
        messagesRef.current = data;
        messageIdsRef.current = new Set(data.map(message => getMessageKey(message)));
        messageTimeoutsRef.current.forEach(timeoutId => {
          clearTimeout(timeoutId);
        });
        messageTimeoutsRef.current.clear();
        pendingAssistantMessagesRef.current.clear();
        setIsAssistantTyping(false);
      } else {
        console.log('No messages found');
        messagesRef.current = [];
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  }, [assignmentId]);

  

  const loadTimelineData = useCallback(
    async (patientId?: string | null) => {
      if (!assignmentId) return;

      try {
        const assignmentPromise = supabase
          .from('student_room_assignments')
          .select('status, student_progress_note, completed_at, completion_hint_views')
          .eq('id', assignmentId)
          .maybeSingle();

        const [assignmentResult, nextOrders, nextLabs, nextVitals, nextImaging] = await Promise.all([
          assignmentPromise,
          patientId ? emrApi.listOrders(patientId, assignmentId, roomId ?? null) : Promise.resolve([]),
          patientId ? emrApi.listLabResults(patientId, assignmentId, roomId ?? null) : Promise.resolve([]),
          patientId ? emrApi.listVitals(patientId, assignmentId, roomId ?? null) : Promise.resolve([]),
          patientId ? emrApi.listImagingStudies(patientId, assignmentId, roomId ?? null) : Promise.resolve([]),
        ]);

        if (assignmentResult.error) {
          throw assignmentResult.error;
        }

        setAssignmentTimeline((assignmentResult.data ?? null) as AssignmentTimelineRow | null);
        setCompletionHintViews(parseCompletionHintViews(assignmentResult.data?.completion_hint_views ?? {}));
        setStatus(assignmentResult.data?.status ?? assignmentStatus);
        setOrders(nextOrders);
        setLabs(nextLabs);
        setVitals(nextVitals);
        setImagingStudies(nextImaging);
      } catch (error) {
        console.error('Error loading assignment timeline', error);
      }
    },
    [assignmentId, assignmentStatus, roomId],
  );

  useEffect(() => {
    scrollToBottom();
  }, [timelineEntries.length]);

  useEffect(() => {
    if (isAssistantTyping) {
      scrollToBottom();
    }
  }, [isAssistantTyping]);

  useEffect(() => {
    const timeouts = messageTimeoutsRef.current;
    const pendingMessages = pendingAssistantMessagesRef.current;

    return () => {
      timeouts.forEach(timeoutId => {
        clearTimeout(timeoutId);
      });
      timeouts.clear();
      pendingMessages.clear();
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    if (!roomId) {
      setPatientLink(null);
      return;
    }

    setIsLoadingPatient(true);
    void (async () => {
      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('bedside_hint, completion_hint')
        .eq('id', roomId)
        .maybeSingle();
      if (roomError) {
        console.error('Error loading room hints', roomError);
      }
      if (isActive) {
        setBedsideHint(roomData?.bedside_hint ?? null);
        setCompletionHints(parseCompletionHints(roomData?.completion_hint ?? null));
      }

      const patient = await emrApi.getPatientByRoomId(roomId);
      if (!isActive) return;
      setPatientLink(patient ? { patientId: patient.id, roomId } : null);
      setIsLoadingPatient(false);
    })();

    return () => {
      isActive = false;
    };
  }, [roomId]);

  useEffect(() => {
    void loadTimelineData(patientLink?.patientId ?? null);
  }, [loadTimelineData, patientLink?.patientId]);

  useEffect(() => {
    if (!assignmentId) return;

    const channel = supabase.channel(`assignment_timeline_${assignmentId}_${patientLink?.patientId ?? 'none'}`);

    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'student_room_assignments',
        filter: `id=eq.${assignmentId}`,
      },
      () => {
        void loadTimelineData(patientLink?.patientId ?? null);
      },
    );

    if (patientLink?.patientId) {
      const patientFilter = `patient_id=eq.${patientLink.patientId}`;
      (['medical_orders', 'lab_results', 'vital_signs', 'imaging_studies'] as const).forEach((table) => {
        channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table,
            filter: patientFilter,
          },
          () => {
            void loadTimelineData(patientLink.patientId);
          },
        );
      });
    }

    channel.subscribe();
    timelineSubscriptionRef.current = channel;

    return () => {
      if (timelineSubscriptionRef.current) {
        timelineSubscriptionRef.current.unsubscribe();
        timelineSubscriptionRef.current = null;
      }
    };
  }, [assignmentId, loadTimelineData, patientLink?.patientId]);

  const initializeChat = useCallback(async () => {
    if (!assignmentId || initializingRef.current) return;
    initializingRef.current = true;
    
    try {
      console.log('Starting chat initialization');
      
      await fetchMessages();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (messagesRef.current.length > 0) {
        console.log('Messages already exist, skipping initial prompt');
        initializedRef.current = true;
        return;
      }
      
      const { data: existingMessages, error: checkError } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('assignment_id', assignmentId)
        .order('created_at', { ascending: true });
      
      if (checkError) throw checkError;
      
      if (existingMessages && existingMessages.length > 0) {
        console.log('Found messages in database, updating state');
        setMessages(existingMessages);
        messagesRef.current = existingMessages;
        messageIdsRef.current = new Set(
          existingMessages.map(existing => getMessageKey(existing))
        );
        initializedRef.current = true;
        return;
      }
      
      console.log('No messages found, generating initial prompt');
      
      const systemPrompt = await generateInitialPrompt(roomNumber);
      if (!systemPrompt) {
        throw new Error('Failed to generate initial prompt');
      }

      setIsLoading(true);
      try {
        const { data: aiResponse, error: aiError } = await supabase.functions.invoke<ChatFunctionResponse>('chat', {
          body: { 
            assignmentId,
            messages: [
              { role: 'system', content: systemPrompt }
            ]
          }
        });

        if (aiError) throw aiError;
        if (!aiResponse?.chatMessage) {
          throw new Error('Assistant response missing chat message');
        }
        
        queueMessageForDisplay(aiResponse.chatMessage);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (messagesRef.current.length === 0 && messageTimeoutsRef.current.size === 0) {
          await fetchMessages();
        }
      } catch (error) {
        console.error('Error initializing chat:', error);
      } finally {
        setIsLoading(false);
      }
      
      initializedRef.current = true;
    } catch (error) {
      console.error('Error in chat initialization:', error);
    } finally {
      initializingRef.current = false;
    }
  }, [assignmentId, fetchMessages, queueMessageForDisplay, roomNumber]);

  // Set up subscription when component mounts
  useEffect(() => {
    if (assignmentId) {
      const subscription = supabase
        .channel(`chat_messages_${assignmentId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `assignment_id=eq.${assignmentId}`
          },
          (payload) => {
            console.log('New message received via subscription', payload);
            const newMessage = payload.new as ChatMessage;
            const shouldDelay =
              newMessage.role === 'assistant' &&
              newMessage.content !== '<completed>' &&
              !newMessage.triggered_completion;
            queueMessageForDisplay(newMessage, { simulateDelay: shouldDelay });
          }
        )
        .subscribe();
      
      subscriptionRef.current = subscription;
      
      if (!initializedRef.current && !initializingRef.current) {
        initializeChat();
      }
      
      return () => {
        console.log('Cleaning up subscription');
        if (subscriptionRef.current) {
          subscriptionRef.current.unsubscribe();
        }
        initializedRef.current = false;
      };
    }
  }, [assignmentId, queueMessageForDisplay, initializeChat]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !assignmentId || status === 'completed') return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);

    try {
      // Insert the student's message
      const { data: insertedStudentMessage, error: insertError } = await supabase
        .from('chat_messages')
        .insert([
          {
            assignment_id: assignmentId,
            role: 'student',
            content: userMessage
          }
        ])
        .select();

      if (insertError) throw insertError;
      
      // Manually add the student message to state
      if (insertedStudentMessage && insertedStudentMessage.length > 0) {
        queueMessageForDisplay(insertedStudentMessage[0], { simulateDelay: false });
      }

      // Get the system prompt for context
      const systemPrompt = await generateInitialPrompt(roomNumber);
      if (!systemPrompt) {
        throw new Error('Failed to generate system prompt');
      }

      // Get AI response with full context including system prompt
      const { data: aiResponse, error: aiError } = await supabase.functions.invoke<ChatFunctionResponse>('chat', {
        body: { 
          assignmentId,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messagesRef.current.map(m => ({
              role: m.role === 'student' ? 'user' : 'assistant',
              content: m.content
            })),
            { role: 'user', content: userMessage }
          ]
        }
      });

      if (aiError) throw aiError;
      if (!aiResponse?.chatMessage) {
        throw new Error('Assistant response missing chat message');
      }
      
      queueMessageForDisplay(aiResponse.chatMessage);
    } catch (error) {
      console.error('Error in chat:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const completeAssignment = async () => {
    if (!assignmentId || isCompleting || isSavingProgressNote) return;

    const progressNote = progressNoteDraft.trim();
    if (!progressNote) return;
    const completedAt = new Date().toISOString();

    setIsCompleting(true);
    setIsSavingProgressNote(true);
    try {
      // First, add a completion message
      const { data: completionResponse, error: completionError } = await supabase.functions.invoke<ChatFunctionResponse>('chat', {
        body: {
          assignmentId,
          contentOverride: '<completed>',
          triggeredCompletion: true
        }
      });
      
      if (completionError) throw completionError;
      if (!completionResponse?.chatMessage) {
        throw new Error('Assistant completion message missing from response');
      }
      
      queueMessageForDisplay(completionResponse.chatMessage, { simulateDelay: false });
      
      // Update the assignment status
      const { error: updateError } = await supabase
        .from('student_room_assignments')
        .update({
          status: 'completed',
          feedback_status: 'pending',
          completed_at: completedAt,
          student_progress_note: progressNote,
          diagnosis: null,
          treatment_plan: null,
          feedback_error: null,
        })
        .eq('id', assignmentId);

      if (updateError) throw updateError;

      setStatus('completed');
      setAssignmentTimeline({
        status: 'completed',
        student_progress_note: progressNote,
        completed_at: completedAt,
        completion_hint_views: completionHintViews,
      });
      
      // Trigger feedback generation
      const { error: feedbackError } = await supabase.functions.invoke('generate-feedback', {
        body: { assignmentId }
      });
      
      if (feedbackError) throw feedbackError;

      setShowCompletionConfirm(false);
      setProgressNoteDraft('');
      setRefreshAfterQualtrics(true);
      setShowQualtrics(true);
    } catch (error) {
      console.error('Error completing assignment:', error);
      alert('Error completing assignment. Please try again.');
    } finally {
      setIsCompleting(false);
      setIsSavingProgressNote(false);
    }
  };

  const closeCompletionConfirm = () => {
    setExpandedCompletionHints({});
    setShowCompletionConfirm(false);
  };

  const toggleCompletionHint = async (key: CompletionHintKey) => {
    const nextExpanded = !expandedCompletionHints[key];
    setExpandedCompletionHints((prev) => ({
      ...prev,
      [key]: nextExpanded,
    }));

    if (!assignmentId || completionHintViews[key]?.viewedAt) return;

    const viewedAt = new Date().toISOString();
    const nextViews = recordCompletionHintView(completionHintViews, key, viewedAt);
    setCompletionHintViews(nextViews);
    setAssignmentTimeline((prev) =>
      prev
        ? {
            ...prev,
            completion_hint_views: nextViews,
          }
        : prev,
    );

    const { error } = await supabase
      .from('student_room_assignments')
      .update({
        completion_hint_views: nextViews,
      })
      .eq('id', assignmentId);

    if (error) {
      console.error('Error recording completion hint view:', error);
    }
  };

  const handleGoToEmr = () => {
    if (!patientLink && !roomId) return;
    const params = new URLSearchParams();
    if (patientLink?.patientId) {
      params.set('patientId', patientLink.patientId);
    }
    if (roomId) {
      params.set('roomId', String(roomId));
    }
    if (assignmentId) {
      params.set('assignmentId', assignmentId);
    }
    navigate(`/emr${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const handleBedsideContinue = async () => {
    if (!assignmentId || isCompleting) return;
    setIsCompleting(true);
    try {
      const { error: updateError } = await supabase
        .from('student_room_assignments')
        .update({
          status: 'bedside',
        })
        .eq('id', assignmentId);
      if (updateError) throw updateError;
      alert('Bedside visit recorded.');
    } catch (error) {
      console.error('Error starting bedside assessment:', error);
      alert('Error recording bedside visit. Please try again.');
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-16rem)] bg-white shadow rounded-lg">
      <div className="p-4 bg-blue-600 text-white rounded-t-lg flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Room {roomNumber} - Patient Assessment</h2>
          {roomId && (
            <span className="px-2 py-1 rounded bg-white/15 text-xs">
              {patientLink ? 'EMR linked' : isLoadingPatient ? 'Loading EMR...' : 'No EMR patient yet'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowBedsideHint(true);
              void handleBedsideContinue();
            }}
            className="flex items-center px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-sm font-medium transition-colors disabled:opacity-50"
            title={bedsideHint ? 'View bedside hint' : 'Go to bedside'}
          >
            <Stethoscope className="w-4 h-4 mr-1" />
            Go to Bedside
          </button>
          <button
            onClick={handleGoToEmr}
            disabled={isLoadingPatient || (!patientLink && !roomId)}
            className="flex items-center px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-sm font-medium transition-colors disabled:opacity-50"
            title={patientLink ? 'Open EMR for this room' : 'Open EMR to review patients'}
          >
            {isLoadingPatient ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <ExternalLink className="w-4 h-4 mr-1" />
            )}
            Open EMR
          </button>
          <button
            onClick={() => {
              setExpandedCompletionHints({});
              setShowCompletionConfirm(true);
            }}
            disabled={isCompleting || status === 'completed'}
            className="flex items-center px-3 py-1 bg-green-500 hover:bg-green-600 rounded text-sm font-medium transition-colors disabled:opacity-50"
            title="Complete assignment"
          >
            {isCompleting ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Wand2 className="w-4 h-4 mr-1" />
            )}
            Complete
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-50/70 px-5 py-6">
        <div className="mx-auto max-w-4xl">
          {timelineEntries.filter(e => e.kind === 'message').length === 0 && !isLoading && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 px-4 py-8 text-center text-sm text-slate-500">
              Chat messages will appear here.
            </div>
          )}

          <div className="relative space-y-4">
            {timelineEntries.filter(entry => entry.kind === 'message').map((entry) => (
              <div key={entry.id} className="relative">
                {entry.kind === 'message' && (
                  <div
                    className={`rounded-2xl border px-4 py-3 shadow-sm ${
                      entry.message.role === 'student'
                        ? 'border-blue-200 bg-blue-50 text-slate-900'
                        : 'border-slate-200 bg-white text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                      <User2 className="h-3.5 w-3.5" />
                      <span>{entry.message.role === 'student' ? 'You' : 'Nurse'}</span>
                      <span className="normal-case tracking-normal text-slate-400">
                        {getTimelineTimestampLabel(entry.timestamp)}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{entry.message.content}</p>
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                Loading...
              </div>
            )}

            {isAssistantTyping && !isLoading && (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                Nurse is typing...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t">
        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading || isCompleting || status === 'completed'}
          />
          <button
            type="submit"
            disabled={isLoading || isCompleting || status === 'completed'}
            className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>

      {showCompletionConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl space-y-4">
            <h3 className="text-lg font-semibold">Finish this case?</h3>
            <div className="space-y-2 text-sm text-gray-600">
              <p>Write a concise progress note before finishing the case.</p>
              <p>Hints are available if you need them, but they stay hidden until you choose to reveal one.</p>
            </div>
            {(['assessmentHint', 'diagnosisDifferentiatorHint', 'planHint'] as const).some(
              (key) => completionHints[key].trim(),
            ) && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                  <Lightbulb className="h-4 w-4" />
                  Optional completion hints
                </div>
                <div className="space-y-2">
                  {(['assessmentHint', 'diagnosisDifferentiatorHint', 'planHint'] as const)
                    .filter((key) => completionHints[key].trim())
                    .map((key) => (
                      <div key={key} className="rounded-md border border-amber-200 bg-white">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-amber-900"
                          onClick={() => {
                            void toggleCompletionHint(key);
                          }}
                        >
                          <span>
                            {expandedCompletionHints[key] ? 'Hide' : 'Show'} {getCompletionHintLabel(key).toLowerCase()}
                            {completionHintViews[key]?.viewedAt ? ' • viewed' : ''}
                          </span>
                          {expandedCompletionHints[key] ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                        {expandedCompletionHints[key] && (
                          <div className="border-t border-amber-100 px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap">
                            {completionHints[key]}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}
            {Object.values(completionHintViews).some((view) => Boolean(view?.viewedAt)) && (
              <p className="text-xs text-amber-700">
                Revealed hints are recorded and included in the case evaluation.
              </p>
            )}
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-800">Progress Note</p>
              <p className="text-sm text-gray-600">
                Include your assessment, working diagnosis, supporting findings, and plan in the note.
              </p>
              <textarea
                className="w-full min-h-[220px] rounded-md border border-gray-300 px-3 py-2 text-sm"
                value={progressNoteDraft}
                onChange={(e) => setProgressNoteDraft(e.target.value)}
                placeholder="Write your progress note..."
              />
            </div>
            <div className="space-y-2">
              <button
                className="w-full inline-flex items-center justify-center rounded-md bg-green-600 text-white px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                onClick={() => {
                  void completeAssignment();
                }}
                disabled={
                  isCompleting ||
                  isSavingProgressNote ||
                  !progressNoteDraft.trim()
                }
              >
                {isCompleting || isSavingProgressNote ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Complete case
              </button>
              <button
                className="w-full inline-flex items-center justify-center rounded-md border border-transparent bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                onClick={closeCompletionConfirm}
              >
                Back to case
              </button>
            </div>
          </div>
        </div>
      )}

      {showBedsideHint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold">Bedside Hint</h3>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">
              {bedsideHint || 'No bedside hint available.'}
            </p>
            <div className="space-y-2">
              <button
                className="w-full inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => setShowBedsideHint(false)}
              >
                Back to case
              </button>
            </div>
          </div>
        </div>
      )}

      {showQualtrics && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <h3 className="text-base font-semibold">Case Reflection</h3>
              <button
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  setShowQualtrics(false);
                  if (refreshAfterQualtrics) {
                    setRefreshAfterQualtrics(false);
                    navigate(0);
                  }
                }}
              >
                Close
              </button>
            </div>
            <div className="h-[75vh] w-full">
              <iframe
                title="Case Reflection Survey"
                src="https://blueq.co1.qualtrics.com/jfe/form/SV_7VZqjp5mYkwvJm6"
                className="h-full w-full"
                allow="fullscreen"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, User2, CheckCircle, Wand2, ExternalLink, Stethoscope } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import type { Database } from '../lib/database.types';
import { generateInitialPrompt } from '../lib/openai';
import { emrApi } from '../features/emr/lib/api';
import { useAuthStore } from '../stores/authStore';

const ASSISTANT_RESPONSE_DELAY = {
  min: 600,
  max: 1800
};

type ChatMessage = Database['public']['Tables']['chat_messages']['Row'];
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

interface ChatInterfaceProps {
  assignmentId: string;
  roomNumber: string;
  roomId?: number;
}

export function ChatInterface({ assignmentId, roomNumber, roomId }: ChatInterfaceProps) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isAssistantTyping, setIsAssistantTyping] = useState(false);
  const [patientLink, setPatientLink] = useState<{ patientId: string; roomId?: number } | null>(null);
  const [isLoadingPatient, setIsLoadingPatient] = useState(false);
  const [showCompletionConfirm, setShowCompletionConfirm] = useState(false);
  const [bedsideHint, setBedsideHint] = useState<string | null>(null);
  const [completionHint, setCompletionHint] = useState<string | null>(null);
  const [showBedsideHint, setShowBedsideHint] = useState(false);
  const [showProgressNote, setShowProgressNote] = useState(false);
  const [progressNoteDraft, setProgressNoteDraft] = useState('');
  const [isSavingProgressNote, setIsSavingProgressNote] = useState(false);
  const { profile } = useAuthStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initializingRef = useRef(false);
  const initializedRef = useRef(false);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const messageIdsRef = useRef<Set<string>>(new Set());
  const pendingAssistantMessagesRef = useRef<Set<string>>(new Set());
  const messageTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const messagesRef = useRef<ChatMessage[]>([]);

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

  

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
        setCompletionHint(roomData?.completion_hint ?? null);
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
    if (!input.trim() || isLoading || !assignmentId) return;

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
    if (!assignmentId || isCompleting) return;
    
    setIsCompleting(true);
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
          completed_at: new Date().toISOString(),
        })
        .eq('id', assignmentId);
      
      if (updateError) throw updateError;
      
      // Trigger feedback generation
      const { error: feedbackError } = await supabase.functions.invoke('generate-feedback', {
        body: { assignmentId }
      });
      
      if (feedbackError) throw feedbackError;
      
      setShowProgressNote(true);
    } catch (error) {
      console.error('Error completing assignment:', error);
      alert('Error completing assignment. Please try again.');
    } finally {
      setIsCompleting(false);
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit'
    });
  };

  const handleSaveProgressNote = async () => {
    if (!patientLink?.patientId || !roomId || !assignmentId) return;
    const content = progressNoteDraft.trim();
    if (!content) return;
    setIsSavingProgressNote(true);
    try {
      const author = profile?.full_name?.trim() || profile?.email?.trim() || 'Student';
      const note = {
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
        patientId: patientLink.patientId,
        assignmentId,
        roomId,
        overrideScope: 'assignment' as const,
        type: 'Progress' as const,
        title: `Progress Note - ${new Date().toLocaleDateString()}`,
        content,
        author,
        timestamp: new Date().toISOString(),
        signed: false,
      };
      await emrApi.addClinicalNote(note);
      setShowProgressNote(false);
      setProgressNoteDraft('');
      alert('Progress note saved. Feedback is being generated.');
      navigate(0);
    } catch (error) {
      console.error('Error saving progress note', error);
      alert('Error saving progress note. Please try again.');
    } finally {
      setIsSavingProgressNote(false);
    }
  };

  const handleBedsideContinue = async () => {
    if (!assignmentId || isCompleting) return;
    setIsCompleting(true);
    try {
      const { error: updateError } = await supabase
        .from('student_room_assignments')
        .update({
          status: 'bedside',
          feedback_status: 'pending',
          completed_at: new Date().toISOString(),
        })
        .eq('id', assignmentId);
      if (updateError) throw updateError;

      const { error: feedbackError } = await supabase.functions.invoke('generate-feedback', {
        body: { assignmentId },
      });
      if (feedbackError) throw feedbackError;

      alert('Bedside assessment started. Feedback is being generated.');
      navigate(0);
    } catch (error) {
      console.error('Error starting bedside assessment:', error);
      alert('Error starting bedside assessment. Please try again.');
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
            onClick={() => setShowBedsideHint(true)}
            disabled={!bedsideHint}
            className="flex items-center px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-sm font-medium transition-colors disabled:opacity-50"
            title={bedsideHint ? 'View bedside hint' : 'No bedside hint available'}
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
            onClick={() => setShowCompletionConfirm(true)}
            disabled={isCompleting}
            className="flex items-center px-3 py-1 bg-green-500 hover:bg-green-600 rounded text-sm font-medium transition-colors disabled:opacity-50"
            title="Complete assignment and generate feedback"
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

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => {
          if (message.content === '<completed>' && message.role === 'assistant') {
            return (
              <div key={message.id} className="w-full flex justify-center my-2">
                <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs flex items-center">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Assignment completed
                </div>
              </div>
            );
          }

          return (
            <div
              key={message.id}
              className={`flex ${message.role === 'student' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] p-4 rounded-lg ${
                  message.role === 'student'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                <div className="flex items-center mb-1">
                  <User2 className="w-4 h-4 mr-2" />
                  <span className="text-xs font-medium">
                    {message.role === 'student' ? 'You' : 'Nurse'}
                  </span>
                  <span className="text-xs ml-2 opacity-75">
                    {formatDate(message.created_at)}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              </div>
            </div>
          );
        })}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 p-4 rounded-lg">
              <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
            </div>
          </div>
        )}
        {isAssistantTyping && !isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-4 py-3 rounded-lg flex items-center space-x-2">
              <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
              <span className="text-sm text-gray-600">Nurse is typing...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t">
        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading || isCompleting}
          />
          <button
            type="submit"
            disabled={isLoading || isCompleting}
            className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>

      {showCompletionConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold">Finish this case?</h3>
            <p className="text-sm text-gray-600">
              {completionHint || 'Review the completion steps before finishing the case.'}
            </p>
            <div className="space-y-2">
              <button
                className="w-full inline-flex items-center justify-center rounded-md bg-green-600 text-white px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                onClick={() => {
                  setShowCompletionConfirm(false);
                  void completeAssignment();
                }}
                disabled={isCompleting}
              >
                {isCompleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Complete case
              </button>
              <button
                className="w-full inline-flex items-center justify-center rounded-md border border-transparent bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                onClick={() => setShowCompletionConfirm(false)}
              >
                Cancel
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
                className="w-full inline-flex items-center justify-center rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                onClick={() => {
                  setShowBedsideHint(false);
                  void handleBedsideContinue();
                }}
                disabled={isCompleting}
              >
                {isCompleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Continue to Bedside
              </button>
              <button
                className="w-full inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => setShowBedsideHint(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showProgressNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl space-y-4">
            <h3 className="text-lg font-semibold">Progress Note</h3>
            <p className="text-sm text-gray-600">
              Add a brief progress note to finalize this case.
            </p>
            <textarea
              className="w-full min-h-[200px] rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Write your progress note..."
              value={progressNoteDraft}
              onChange={(e) => setProgressNoteDraft(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => setShowProgressNote(false)}
                disabled={isSavingProgressNote}
              >
                Close
              </button>
              <button
                className="inline-flex items-center justify-center rounded-md bg-green-600 text-white px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                onClick={() => void handleSaveProgressNote()}
                disabled={isSavingProgressNote || !progressNoteDraft.trim() || !patientLink?.patientId}
              >
                {isSavingProgressNote ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save Progress Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

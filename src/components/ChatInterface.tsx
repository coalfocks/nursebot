import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, User2, CheckCircle, Wand2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useParams, useNavigate } from 'react-router-dom';
import type { Database } from '../lib/database.types';
import { generateInitialPrompt } from '../lib/openai';
import EmbeddedPdfViewer from './EmbeddedPdfViewer';

const ASSISTANT_RESPONSE_DELAY = {
  min: 600,
  max: 1800
};

type ChatMessage = Database['public']['Tables']['chat_messages']['Row'];

const getMessageKey = (message: ChatMessage) => {
  if (message.id !== null && message.id !== undefined) {
    return String(message.id);
  }
  return `${message.assignment_id}-${message.created_at}`;
};

interface ChatInterfaceProps {
  roomNumber: string;
  pdfUrl?: string | null;
}

export function ChatInterface({ roomNumber, pdfUrl }: ChatInterfaceProps) {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isAssistantTyping, setIsAssistantTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initializingRef = useRef(false);
  const initializedRef = useRef(false);
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const messageIdsRef = useRef<Set<string>>(new Set());
  const pendingAssistantMessagesRef = useRef<Set<string>>(new Set());
  const messageTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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

  // Set up subscription when component mounts
  useEffect(() => {
    if (assignmentId) {
      // Set up subscription
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
      
      // Initialize chat
      if (!initializedRef.current && !initializingRef.current) {
        initializeChat();
      }
      
      // Cleanup function
      return () => {
        console.log('Cleaning up subscription');
        if (subscriptionRef.current) {
          subscriptionRef.current.unsubscribe();
        }
        initializedRef.current = false;
      };
    }
  }, [assignmentId, queueMessageForDisplay]);

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

  const initializeChat = async () => {
    // Set initializing flag to prevent concurrent initialization
    if (initializingRef.current) return;
    initializingRef.current = true;
    
    try {
      console.log('Starting chat initialization');
      
      // Fetch existing messages
      await fetchMessages();
      
      // Wait a moment to ensure any messages have been loaded
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Check if we have messages after fetching
      if (messages.length > 0) {
        console.log('Messages already exist, skipping initial prompt');
        initializedRef.current = true;
        return;
      }
      
      // Double-check directly from the database if there are any messages
      const { data: existingMessages, error: checkError } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('assignment_id', assignmentId)
        .order('created_at', { ascending: true });
      
      if (checkError) throw checkError;
      
      // If messages exist in the database but not in our state, update state and return
      if (existingMessages && existingMessages.length > 0) {
        console.log('Found messages in database, updating state');
        setMessages(existingMessages);
        messageIdsRef.current = new Set(
          existingMessages.map(existing => getMessageKey(existing))
        );
        initializedRef.current = true;
        return;
      }
      
      console.log('No messages found, generating initial prompt');
      
      // Generate the system prompt using the dedicated function
      const systemPrompt = await generateInitialPrompt(roomNumber);
      if (!systemPrompt) {
        throw new Error('Failed to generate initial prompt');
      }

      // Get the initial response from OpenAI
      setIsLoading(true);
      try {
        const { data: aiResponse, error: aiError } = await supabase.functions.invoke('chat', {
          body: { 
            messages: [
              { role: 'system', content: systemPrompt }
            ]
          }
        });

        if (aiError) throw aiError;

        // Insert the AI's response as the first message
        const { data: insertedMessage, error: insertError } = await supabase
          .from('chat_messages')
          .insert([
            {
              assignment_id: assignmentId,
              role: 'assistant',
              content: aiResponse.message
            }
          ])
          .select();

        if (insertError) throw insertError;
        
        // Manually add the message to state to ensure it appears immediately
        if (insertedMessage && insertedMessage.length > 0) {
          queueMessageForDisplay(insertedMessage[0]);
        }
        
        // Wait a moment for the subscription to pick up the new message
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // If the subscription didn't update our state, fetch messages again
        if (messages.length === 0 && messageTimeoutsRef.current.size === 0) {
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
  };

  const fetchMessages = async () => {
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
        messageIdsRef.current = new Set(data.map(message => getMessageKey(message)));
        messageTimeoutsRef.current.forEach(timeoutId => {
          clearTimeout(timeoutId);
        });
        messageTimeoutsRef.current.clear();
        pendingAssistantMessagesRef.current.clear();
        setIsAssistantTyping(false);
      } else {
        console.log('No messages found');
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

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
      const { data: aiResponse, error: aiError } = await supabase.functions.invoke('chat', {
        body: { 
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map(m => ({
              role: m.role === 'student' ? 'user' : 'assistant',
              content: m.content
            })),
            { role: 'user', content: userMessage }
          ]
        }
      });

      if (aiError) throw aiError;

      // Insert the AI's response
      const { data: insertedAssistantMessage, error: assistantError } = await supabase
        .from('chat_messages')
        .insert([
          {
            assignment_id: assignmentId,
            role: 'assistant',
            content: aiResponse.message
          }
        ])
        .select();

      if (assistantError) throw assistantError;
      
      // Manually add the assistant message to state
      if (insertedAssistantMessage && insertedAssistantMessage.length > 0) {
        queueMessageForDisplay(insertedAssistantMessage[0]);
      }
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
      const { data: completionMessage, error: messageError } = await supabase
        .from('chat_messages')
        .insert([
          {
            assignment_id: assignmentId,
            role: 'assistant',
            content: '<completed>',
            triggered_completion: true
          }
        ])
        .select();
      
      if (messageError) throw messageError;
      
      // Add the completion message to the state
      if (completionMessage && completionMessage.length > 0) {
        queueMessageForDisplay(completionMessage[0], { simulateDelay: false });
      }
      
      // Update the assignment status
      const { error: updateError } = await supabase
        .from('student_room_assignments')
        .update({ 
          status: 'completed',
          feedback_status: 'pending'
        })
        .eq('id', assignmentId);
      
      if (updateError) throw updateError;
      
      // Trigger feedback generation
      const { error: feedbackError } = await supabase.functions.invoke('generate-feedback', {
        body: { assignmentId }
      });
      
      if (feedbackError) throw feedbackError;
      
      // Show success message
      alert('Assignment completed! Feedback is being generated.');
      
      // Refresh the page to show the feedback section
      navigate(0);
    } catch (error) {
      console.error('Error completing assignment:', error);
      alert('Error completing assignment. Please try again.');
    } finally {
      setIsCompleting(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit'
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-16rem)] bg-white shadow rounded-lg">
      <div className="p-4 bg-blue-600 text-white rounded-t-lg flex justify-between items-center">
        <h2 className="text-lg font-semibold">Room {roomNumber} - Patient Assessment</h2>
        <button
          onClick={completeAssignment}
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
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => {
          // Special handling for completion message
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
          
          // Regular chat messages
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
    </div>
  );
}

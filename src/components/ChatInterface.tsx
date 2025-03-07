import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, User2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useParams } from 'react-router-dom';
import type { Database } from '../lib/database.types';

type ChatMessage = Database['public']['Tables']['chat_messages']['Row'];

interface ChatInterfaceProps {
  roomNumber: string;
}

export function ChatInterface({ roomNumber }: ChatInterfaceProps) {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (assignmentId) {
      fetchMessages();
      subscribeToMessages();
    }
  }, [assignmentId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchMessages = async () => {
    if (!assignmentId) return;

    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('assignment_id', assignmentId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const subscribeToMessages = () => {
    if (!assignmentId) return;

    const subscription = supabase
      .channel('chat_messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `assignment_id=eq.${assignmentId}`
        },
        (payload) => {
          const newMessage = payload.new as ChatMessage;
          setMessages(prev => [...prev, newMessage]);
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !assignmentId) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);

    try {
      // Insert the student's message
      const { error: insertError } = await supabase
        .from('chat_messages')
        .insert([
          {
            assignment_id: assignmentId,
            role: 'student',
            content: userMessage
          }
        ]);

      if (insertError) throw insertError;

      // Get AI response
      const { data: aiResponse, error: aiError } = await supabase.functions.invoke('chat', {
        body: { 
          messages: [
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
      const { error: assistantError } = await supabase
        .from('chat_messages')
        .insert([
          {
            assignment_id: assignmentId,
            role: 'assistant',
            content: aiResponse.message
          }
        ]);

      if (assistantError) throw assistantError;
    } catch (error) {
      console.error('Error in chat:', error);
    } finally {
      setIsLoading(false);
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
      <div className="p-4 bg-blue-600 text-white rounded-t-lg">
        <h2 className="text-lg font-semibold">Room {roomNumber} - Patient Assessment</h2>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
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
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 p-4 rounded-lg">
              <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
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
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
}
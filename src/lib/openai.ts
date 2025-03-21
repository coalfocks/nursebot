import { supabase } from './supabase';

export interface ChatMessage {
  role: 'system' | 'assistant' | 'user';
  content: string;
}

interface RoomConfig {
  role: string;
  objective: string;
  context: string;
  style: string;
}

async function getRoomConfig(roomNumber: string): Promise<RoomConfig | null> {
  const { data, error } = await supabase
    .from('rooms')
    .select('role, objective, context, style')
    .eq('room_number', roomNumber)
    .single();

  if (error) {
    console.error('Error fetching room config:', error);
    return null;
  }

  return data;
}

export const generateInitialPrompt = async (roomNumber: string) => {
  const room = await getRoomConfig(roomNumber);
  if (!room) return null;

  return `You are a professional nurse in a hospital. ${room.role}

Your communication style should be ${room.style}

Context: ${room.context}

Objective: ${room.objective}

Remember:
1. Be concise and professional
2. Don't suggest treatments
3. Ask the doctor for specific orders when needed
4. Only provide information when asked
5. Stay in character as a nurse at all times
6. When the matter is resolved, or you have nothing more to say, end the conversation with the doctor by saying "Thank you, doctor." and including the <completed> token.

Current situation: You need to page the doctor about this patient. Start by explaining the situation briefly and professionally.`;
};

export const getChatCompletion = async (messages: ChatMessage[]) => {
  try {
    const { data, error } = await supabase.functions.invoke('chat', {
      body: { messages }
    });

    if (error) throw error;
    return data.message;
  } catch (error) {
    console.error('Error getting chat completion:', error);
    throw error;
  }
}

import { supabase } from './supabase';

// This service will call a Supabase Edge Function to send SMS
// We'll implement the Edge Function separately

interface AssignmentWithRoom {
  student_id: string;
  room: {
    room_number: string;
  };
}

/**
 * Send an SMS notification to a user
 * @param userId The user ID to send the notification to
 * @param message The message to send
 * @returns A promise that resolves when the notification is sent
 */
export async function sendSmsNotification(userId: string, message: string): Promise<boolean> {
  try {
    // Check if the user has consented to SMS notifications
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('phone_number, sms_consent')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      console.error('Error fetching user profile:', profileError);
      return false;
    }

    // Don't send SMS if the user hasn't consented or doesn't have a phone number
    if (!profile.sms_consent || !profile.phone_number) {
      console.log(`User ${userId} has not consented to SMS notifications or has no phone number`);
      return false;
    }

    // Call the Supabase Edge Function to send the SMS
    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: { userId, message }
    });

    if (error) {
      console.error('Error sending SMS notification:', error);
      return false;
    }

    return data?.success || false;
  } catch (error) {
    console.error('Error sending SMS notification:', error);
    return false;
  }
}

/**
 * Send an SMS notification when a case assignment becomes effective
 * @param assignmentId The ID of the assignment that became effective
 * @returns A promise that resolves when the notification is sent
 */
export async function sendAssignmentEffectiveNotification(assignmentId: string): Promise<boolean> {
  try {
    // Get the assignment details including the student ID
    const { data, error: assignmentError } = await supabase
      .from('student_room_assignments')
      .select(`
        student_id,
        room:room_id (
          room_number
        )
      `)
      .eq('id', assignmentId)
      .single();

    const assignment = data as AssignmentWithRoom | null;

    if (assignmentError || !assignment) {
      console.error('Error fetching assignment details:', assignmentError);
      return false;
    }

    // Get the student's profile to check if they have a phone number and have consented
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('phone_number, sms_consent')
      .eq('id', assignment.student_id)
      .single();

    if (profileError || !profile) {
      console.error('Error fetching student profile:', profileError);
      return false;
    }

    // Don't send SMS if the user hasn't consented or doesn't have a phone number
    if (!profile.sms_consent || !profile.phone_number) {
      console.log(`Student ${assignment.student_id} has not consented to SMS notifications or has no phone number`);
      return false;
    }

    // Send the notification
    const message = `You have a message waiting for you from a nurse in Room ${assignment.room.room_number}.`;
    return await sendSmsNotification(assignment.student_id, message);
  } catch (error) {
    console.error('Error sending assignment effective notification:', error);
    return false;
  }
} 
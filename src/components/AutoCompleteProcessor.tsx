import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { sendAssignmentEffectiveNotification } from '../lib/twilioService';

const POLLING_INTERVAL = 60000; // Check every minute

export default function AutoCompleteProcessor() {
  const { user } = useAuthStore();
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // Only run if user is logged in
    if (!user) return;

    // Initial check
    checkAssignmentsToComplete();
    checkNewlyEffectiveAssignments();

    // Set up periodic checking
    timerRef.current = setInterval(() => {
      checkAssignmentsToComplete();
      checkNewlyEffectiveAssignments();
    }, POLLING_INTERVAL);

    // Cleanup
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [user]);

  const checkAssignmentsToComplete = async () => {
    try {
      // Get current time
      const now = new Date();
      
      // Find assignments that have been effective for more than 1 hour
      const { data, error } = await supabase
        .from('student_room_assignments')
        .select('id')
        .in('status', ['assigned', 'in_progress'])
        .not('effective_date', 'is', null)
        .lte('effective_date', new Date(now.getTime() - 60 * 60 * 1000).toISOString());
      
      if (error) {
        console.error('Error checking assignments to auto-complete:', error);
        return;
      }

      // Mark each assignment as complete
      for (const assignment of data || []) {
        await markAssignmentComplete(assignment.id);
      }
    } catch (error) {
      console.error('Error in auto-complete process:', error);
    }
  };

  const checkNewlyEffectiveAssignments = async () => {
    try {
      // Get current time
      const now = new Date();
      
      // Find assignments that have just become effective (within the last minute)
      // but haven't been marked as notified yet
      const { data, error } = await supabase
        .from('student_room_assignments')
        .select('id')
        .in('status', ['assigned', 'in_progress'])
        .not('effective_date', 'is', null)
        .lte('effective_date', now.toISOString())
        .gt('effective_date', new Date(now.getTime() - POLLING_INTERVAL).toISOString())
        .is('notification_sent', null);
      
      if (error) {
        console.error('Error checking newly effective assignments:', error);
        return;
      }

      // Send notification for each newly effective assignment
      for (const assignment of data || []) {
        await sendNotificationForAssignment(assignment.id);
      }
    } catch (error) {
      console.error('Error in notification process:', error);
    }
  };

  const markAssignmentComplete = async (assignmentId: string) => {
    try {
      const { error } = await supabase
        .from('student_room_assignments')
        .update({
          status: 'completed',
          updated_at: new Date().toISOString(),
          feedback_status: 'pending'
        })
        .eq('id', assignmentId);
      
      if (error) {
        console.error(`Error marking assignment ${assignmentId} as complete:`, error);
      } else {
        console.log(`Auto-completed assignment ${assignmentId}`);
      }
    } catch (error) {
      console.error(`Error marking assignment ${assignmentId} as complete:`, error);
    }
  };

  const sendNotificationForAssignment = async (assignmentId: string) => {
    try {
      // Send the notification
      const success = await sendAssignmentEffectiveNotification(assignmentId);
      
      // Update the assignment to mark notification as sent
      const { error } = await supabase
        .from('student_room_assignments')
        .update({
          notification_sent: success,
          notification_sent_at: new Date().toISOString()
        })
        .eq('id', assignmentId);
      
      if (error) {
        console.error(`Error updating notification status for assignment ${assignmentId}:`, error);
      } else if (success) {
        console.log(`Sent notification for assignment ${assignmentId}`);
      } else {
        console.warn(`Failed to send notification for assignment ${assignmentId}`);
      }
    } catch (error) {
      console.error(`Error sending notification for assignment ${assignmentId}:`, error);
    }
  };

  // This is a background component, it doesn't render anything
  return null;
} 
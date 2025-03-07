import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { checkPendingFeedback } from '../lib/feedbackService';

const POLLING_INTERVAL = 30000; // Check every 30 seconds

export default function FeedbackProcessor() {
  const { profile } = useAuthStore();
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // Only run for admin users
    if (!profile?.is_admin) return;

    // Initial check
    checkPendingFeedback();

    // Set up periodic checking
    timerRef.current = setInterval(() => {
      checkPendingFeedback();
    }, POLLING_INTERVAL);

    // Cleanup
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [profile]);

  // This is a background component, it doesn't render anything
  return null;
} 
import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { checkPendingFeedback } from '../lib/feedbackService';
import { feedbackProcessorConfig, type FeedbackProcessorConfig } from '../lib/feedbackProcessorConfig';
import { hasAdminAccess } from '../lib/roles';

const POLLING_INTERVAL = 30000; // Check every 30 seconds

type Props = { config?: FeedbackProcessorConfig };

// Background auto-runner. Opt-in only: does nothing unless VITE_FEEDBACK_PROCESSOR_ENABLED === 'true'.
export default function FeedbackProcessor({ config = feedbackProcessorConfig }: Props) {
  const { profile } = useAuthStore();

  useEffect(() => {
    if (!config.enabled) return;
    // Only run for admin users
    if (!hasAdminAccess(profile)) return;

    const run = () => { void checkPendingFeedback({ assignmentIds: config.assignmentIds }); };

    // Initial check, then periodic checks
    run();
    const timer = setInterval(run, POLLING_INTERVAL);

    return () => clearInterval(timer);
  }, [profile, config]);

  // This is a background component, it doesn't render anything
  return null;
}

export function isFeedbackEligibleStatus(status: string | null | undefined): boolean {
  return status === 'completed';
}

export type WalkthroughAudience = 'admin' | 'student' | 'test_room' | 'both';

export const unsafeWalkthroughPasswordAdvice = /same\s+(?:initial|default|shared)\s+password|shared\s+password|all\s+students|password\s+for\s+all\s+students|one\s+password\s+for\s+everyone/i;

export function getWalkthroughPublicationError(transcript: string): string | null {
  return unsafeWalkthroughPasswordAdvice.test(transcript)
    ? 'This video cannot be published until shared-password instructions are removed. Each user must activate the account and set an individual password.'
    : null;
}

export function canAudienceAccess(audience: string, role: string | null | undefined): boolean {
  if (role === 'super_admin') return true;
  if (role === 'school_admin') return audience === 'admin' || audience === 'both';
  if (role === 'student') return audience === 'student' || audience === 'both';
  if (role === 'test_user') return audience === 'test_room';
  return false;
}

/** Display titles are presentation text; course position and video IDs remain authoritative. */
export function displayWalkthroughTitle(title: string): string {
  return title.replace(/^\s*\d+\s*(?:\||[.):\-])\s*/, '').trim() || title.trim();
}

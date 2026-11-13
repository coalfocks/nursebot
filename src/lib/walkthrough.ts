export type WalkthroughAudience = 'admin' | 'student' | 'test_room' | 'both';
export type OrganizerAudience = 'test_room' | 'admin' | 'student';

export const organizerAudiences: OrganizerAudience[] = ['test_room', 'admin', 'student'];

/** Convert the compatibility audience field to normalized course memberships. */
export function legacyAudienceCourses(audience: WalkthroughAudience): OrganizerAudience[] {
  if (audience === 'both') return ['admin', 'student'];
  return audience === 'admin' || audience === 'student' || audience === 'test_room' ? [audience] : [];
}

export function moveWalkthroughVideo(videoIds: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  if (index < 0 || index >= videoIds.length || target < 0 || target >= videoIds.length) return videoIds;
  const next = [...videoIds];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function addWalkthroughVideo(videoIds: string[], videoId: string): string[] {
  return videoId && !videoIds.includes(videoId) ? [...videoIds, videoId] : videoIds;
}

export function visibleWalkthroughAudiences(role: string | null | undefined): WalkthroughAudience[] {
  return role === 'test_user' ? ['test_room'] : ['student', 'both'];
}

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

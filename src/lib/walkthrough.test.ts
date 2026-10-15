import { describe, expect, it } from 'vitest';
import { canAudienceAccess, displayWalkthroughTitle, getWalkthroughPublicationError } from './walkthrough';

describe('walkthrough audience and publication safety', () => {
  it('allows only the intended role audience', () => {
    expect(canAudienceAccess('admin', 'school_admin')).toBe(true);
    expect(canAudienceAccess('admin', 'student')).toBe(false);
    expect(canAudienceAccess('student', 'student')).toBe(true);
    expect(canAudienceAccess('student', 'school_admin')).toBe(false);
    expect(canAudienceAccess('both', 'student')).toBe(true);
    expect(canAudienceAccess('both', 'school_admin')).toBe(true);
    expect(canAudienceAccess('student', 'super_admin')).toBe(true);
    expect(canAudienceAccess('test_room', 'test_user')).toBe(true);
    expect(canAudienceAccess('test_room', 'student')).toBe(false);
    expect(canAudienceAccess('test_room', 'school_admin')).toBe(false);
  });

  it('strips display-only numeric prefixes without changing the source title contract', () => {
    expect(displayWalkthroughTitle('02 | Getting an Account')).toBe('Getting an Account');
    expect(displayWalkthroughTitle('204 - Full case walkthrough')).toBe('Full case walkthrough');
    expect(displayWalkthroughTitle('Getting an Account')).toBe('Getting an Account');
  });

  it('blocks shared-password advice before publication', () => {
    expect(getWalkthroughPublicationError('Each student should use the same initial password.')).toContain('cannot be published');
    expect(getWalkthroughPublicationError('Use the secure individual activation link and choose a unique password.')).toBeNull();
  });
});

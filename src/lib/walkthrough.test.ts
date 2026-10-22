import { describe, expect, it } from 'vitest';
import { canAudienceAccess, displayWalkthroughTitle, getMissingWalkthroughItems, getWalkthroughPublicationError, isWalkthroughAudienceCompatible, visibleWalkthroughAudiences } from './walkthrough';

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

  it('uses the Test Room audience for test accounts and never mixes it with student media', () => {
    expect(visibleWalkthroughAudiences('test_user')).toEqual(['test_room']);
    expect(visibleWalkthroughAudiences('student')).toEqual(['student', 'both']);
    expect(visibleWalkthroughAudiences('school_admin')).toEqual(['student', 'both']);
  });

  it('keeps a student-role account out of Test Room content', () => {
    expect(visibleWalkthroughAudiences('student')).not.toContain('test_room');
    expect(canAudienceAccess('test_room', 'student')).toBe(false);
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

describe('walkthrough content contracts', () => {
  it('reports every missing or wrong-version pinned item without dropping the available positive control', () => {
    const items = [
      { video_id: 'available', video_version: 2 },
      { video_id: 'missing', video_version: 1 },
      { video_id: 'available', video_version: 1 },
    ];
    expect(getMissingWalkthroughItems(items, [{ id: 'available', version: 2 }])).toEqual(items.slice(1));
  });

  it.each([
    ['admin', 'admin', true], ['admin', 'both', true], ['admin', 'student', false],
    ['student', 'student', true], ['student', 'both', true], ['student', 'test_room', false],
    ['test_room', 'test_room', true], ['test_room', 'student', false],
    ['both', 'both', true], ['both', 'admin', false],
  ] as const)('checks %s course against %s video as %s', (course, video, expected) => {
    expect(isWalkthroughAudienceCompatible(course, video)).toBe(expected);
  });
});

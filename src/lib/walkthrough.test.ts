import { describe, expect, it } from 'vitest';
import { addWalkthroughVideo, canAudienceAccess, displayWalkthroughTitle, getWalkthroughPublicationError, legacyAudienceCourses, moveWalkthroughVideo, visibleWalkthroughAudiences } from './walkthrough';

describe('walkthrough audience and publication safety', () => {
  it('supports one video in multiple role courses without duplicating its ID', () => {
    expect(legacyAudienceCourses('both')).toEqual(['admin', 'student']);
    expect(legacyAudienceCourses('test_room')).toEqual(['test_room']);
    expect(legacyAudienceCourses('admin')).toEqual(['admin']);
    expect(legacyAudienceCourses('student')).toEqual(['student']);
    const adminCourse = addWalkthroughVideo(['video-a'], 'shared-video');
    const studentCourse = addWalkthroughVideo(['video-b'], 'shared-video');
    const testRoomCourse = addWalkthroughVideo([], 'shared-video');
    expect(adminCourse).toContain('shared-video');
    expect(studentCourse).toContain('shared-video');
    expect(testRoomCourse).toContain('shared-video');
    expect(addWalkthroughVideo(adminCourse, 'shared-video')).toEqual(adminCourse);
  });

  it('moves ordered course video IDs while preserving edges and unrelated entries', () => {
    expect(moveWalkthroughVideo(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveWalkthroughVideo(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveWalkthroughVideo(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveWalkthroughVideo(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

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

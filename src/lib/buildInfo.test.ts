import { describe, expect, it } from 'vitest';
import { buildInfo } from './buildInfo';

describe('buildInfo', () => {
  it('always exposes non-empty release metadata for the About view', () => {
    expect(buildInfo.identifier).toBeTruthy();
    expect(buildInfo.deploymentTimestamp).toBeTruthy();
  });
});


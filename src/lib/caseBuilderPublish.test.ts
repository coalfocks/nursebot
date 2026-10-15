import { describe, expect, it } from 'vitest';
import {
  buildDeterministicMrn,
  buildDeterministicPatientId,
  buildLearnerEmrContext,
  getStructuredPatientIdentity,
  REQUIRED_GENERATED_SECTIONS,
  validateGeneratedCasePackage,
} from './caseBuilderPublish';

const completePackage = Object.fromEntries(
  REQUIRED_GENERATED_SECTIONS.map((section) => [section, {}]),
);
completePackage.patient = { demographics: { dateOfBirth: '2000-01-01' } };
completePackage.bedside = { patientChatEnabled: false };

describe('case builder publish helpers', () => {
  it('requires every generated section with a stable code and field path', () => {
    const value = { ...completePackage };
    delete value.orders;

    expect(validateGeneratedCasePackage(value)).toEqual({
      ok: false,
      issue: {
        code: 'CASE_PACKAGE_SECTION_REQUIRED',
        path: 'generation_package.orders',
        message: 'Generate the orders section before publishing.',
      },
    });
  });

  it('accepts a package containing all required section objects', () => {
    expect(validateGeneratedCasePackage(completePackage).ok).toBe(true);
  });

  it('rejects a generated package that cannot create a linked EMR patient', () => {
    const value = { ...completePackage, patient: {} };
    expect(validateGeneratedCasePackage(value)).toMatchObject({
      ok: false,
      issue: { code: 'CASE_PATIENT_IDENTITY_REQUIRED' },
    });
  });

  it('rejects enabled bedside chat without a patient prompt', () => {
    const value = { ...completePackage, bedside: { patientChatEnabled: true } };
    expect(validateGeneratedCasePackage(value)).toMatchObject({
      ok: false,
      issue: { code: 'CASE_BEDSIDE_PROMPT_REQUIRED' },
    });
  });

  it('allowlists learner EMR fields and excludes evaluator and conversation content', () => {
    const context = buildLearnerEmrContext({
      ...completePackage,
      patient: { demographics: 'Authored demographics', secret: 'exclude' },
      emr: { hAndP: 'Authored H&P', feedbackRubric: ['exclude'] },
      event: { trigger: 'Authored event', unsafeActions: ['exclude'] },
      orders: {
        admissionOrders: ['Authored order'],
        gatedResults: ['Authored gated result'],
        expectedOrders: ['evaluation only'],
        harmfulOrUnnecessary: ['evaluation only'],
      },
      nurse_chat: { protectedFacts: ['not EMR context'] },
      evaluation: { goals: ['hidden'], modelProgressNote: 'hidden' },
    }, 'blueprint-id', '2026-10-14T18:00:00.000Z');

    expect(context).toEqual({
      source: 'case-builder-v2',
      blueprintId: 'blueprint-id',
      generatedAt: '2026-10-14T18:00:00.000Z',
      patient: { demographics: 'Authored demographics' },
      emr: { hAndP: 'Authored H&P' },
      event: { trigger: 'Authored event' },
      orders: {
        admissionOrders: ['Authored order'],
        gatedResults: ['Authored gated result'],
      },
    });
    expect(JSON.stringify(context)).not.toMatch(/evaluation|nurse_chat|expectedOrders|harmfulOrUnnecessary|secret/);
  });

  it('uses only structured identity fields and never parses demographic prose', () => {
    expect(getStructuredPatientIdentity({
      demographics: 'Ada Lovelace, female, born 1815-12-10',
    })).toEqual({ firstName: null, lastName: null, dateOfBirth: null, gender: null });

    expect(getStructuredPatientIdentity({
      demographics: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        dateOfBirth: '1815-12-10',
        gender: 'Female',
      },
    })).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '1815-12-10',
      gender: 'Female',
    });
  });

  it('derives a stable MRN from school, blueprint, and room', () => {
    const first = buildDeterministicMrn('school-id', 'blueprint-id', ' 12 A ');
    const second = buildDeterministicMrn('school-id', 'blueprint-id', '12 A');

    expect(first).toBe('CB-school-id-blueprint-id-12%20A');
    expect(second).toBe(first);
  });

  it('derives one stable patient ID for concurrent publishes of the same target', async () => {
    const first = await buildDeterministicPatientId('school-id', 'blueprint-id', '12 A');
    const second = await buildDeterministicPatientId('school-id', 'blueprint-id', '12 A');

    expect(second).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

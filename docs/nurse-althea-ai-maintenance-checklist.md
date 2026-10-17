# Nurse Althea AI case-maintenance checklist

Use this checklist when completing or repairing an authored simulation case. This is an
authoring workflow, not a learner workflow. Never write directly to production tables
without an authenticated, scoped maintenance operation.

## Rules for every change

- Identify the immutable school, room, patient, scenario-baseline, and assignment/session IDs.
- Read the current record and record version before proposing a change.
- State whether each value came from an authored workup, a source note, an educator instruction,
  or a generated proposal.
- Keep clinical occurrence, collection/performance, result, release, and learner-availability
  times separate.
- Use American clinical conventions: °F with explicit conversion, mg/mcg/mL, mg/kg/dose,
  mg/kg/day, PO/IV/IM/SQ/SL and full route names.
- Preserve intentional omissions, missed doses, risky regimens, ambiguity, and authored difficulty.
- Never invent a measurement, blood group, treatment response, administration, or future result.
- Do not use a display name to identify a patient or chart.
- Do not change learner assignments, scores, analytics, or another room as a side effect.

## Required maintenance operation

Every request must contain:

~~~json
{
  "operation": "dry_run | commit | rollback",
  "idempotencyKey": "unique-stable-retry-key",
  "target": {
    "type": "room | patient | lab | vital | imaging | note | order | baseline",
    "id": "immutable-record-id"
  },
  "expectedVersion": 1,
  "patch": {}
}
~~~

Before commit:

- Read and validate the target school and authorization scope.
- Reject stale expectedVersion.
- Reject unsupported fields and wrong target types.
- Produce a before/after diff.
- Report dependent records and affected learner sessions.
- Report authored-content conflicts or unsupported clinical assertions.

After commit:

- Return committed record ID, new version, idempotency key, and exact changed fields.
- Read the record back.
- Confirm unrelated fields and records are unchanged.
- Preserve an audit entry with actor, source, before/after, provenance, and timestamp.
- Use rollback by supersession or restore; do not destroy historical references.

## Case completion workflow

- [ ] Read the current room, patient, baseline, assignments, notes, labs, vitals, imaging,
      orders, and continuation links.
- [ ] Confirm the intended chart by immutable patient ID and MRN.
- [ ] Compare the current case against the authored workup.
- [ ] Separate admission/history from learner-triggered events.
- [ ] Add authored historical results only when supported by the workup.
- [ ] Keep future findings unavailable until their release condition.
- [ ] Confirm each medication is prescribed separately from administered.
- [ ] Confirm each treatment response requires administration and reassessment.
- [ ] Preserve intentional missing medications and missed/held/omitted doses.
- [ ] Preview the patient conversation prompt and remove clinician-only facts.
- [ ] Validate nurse, patient, EMR, and evaluator context separately.
- [ ] Run dry-run validation before commit.
- [ ] Commit with an idempotency key.
- [ ] Read back and export the changed records.

## Allowed clinical authoring changes

- [ ] Admission vitals/labs/notes from an authored workup.
- [ ] Historical imaging reports and metadata from an authored workup.
- [ ] Baseline medications and written orders from the case source.
- [ ] Patient background, symptoms, history, preferences, and communication limits.
- [ ] Scenario-relative times with a readable preview.
- [ ] Explicit result release and treatment prerequisites.
- [ ] Structured medication formulations, routes, doses, schedules, holds, and PRN limits.
- [ ] Versioned obstetric baselines and continuation mappings.
- [ ] Corrected values with provenance and a prior-version history.

## Prohibited automatic changes

- [ ] Do not prescribe or administer medication merely because it appears in a workup.
- [ ] Do not turn an order into a performed test or treatment response.
- [ ] Do not release a future result because the chart was opened.
- [ ] Do not overwrite an admission sample with an event sample.
- [ ] Do not merge legitimate serial specimens.
- [ ] Do not infer omitted room 206 antibiotics, room 209 antiemetic, ED 20 insulin,
      ED 24 furosemide, or L&D 04 A analgesia.
- [ ] Do not change obstetric difficulty labels or non-obstetric difficulty distribution.
- [ ] Do not reveal diagnosis, answer keys, scoring, hints, or unreleased results to learners.

## Product/catalog checks

- [x] Buspirone is searchable with the Buspar alias.
- [x] Clozapine is searchable with a stable product identifier.
- [x] Prazosin is searchable with a stable product identifier.
- [x] Divalproex sodium ER is explicitly extended-release and distinct from immediate-release.
- [ ] Validate production catalog seed/version after deployment.
- [ ] Validate heparin infusion and subcutaneous prophylaxis products.
- [ ] Use custom medication only with an explicit review flag and preserved instructions.

## Verification package required from the AI

- [ ] List changed records and immutable IDs.
- [ ] List source/provenance for every changed clinical value.
- [ ] Include before/after diff.
- [ ] Include expected and committed versions.
- [ ] Include release-time and treatment-prerequisite effects.
- [ ] Include learner-visible versus educator-only effects.
- [ ] Include unchanged intentional omissions.
- [ ] Include tests run and read-back results.
- [ ] Include rollback/supersession instructions.
- [ ] List unresolved conflicts instead of guessing.

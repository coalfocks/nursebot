# Nursebot implementation map

Snapshot date: 2026-10-02. This map is based on the current branch and a read-only production inventory.

## Current authored source

The live `case_blueprints` table is empty. The 60 authored cases currently live in `rooms`, linked to 60 `patients`; room metadata and the patient-linked EMR rows are therefore the migration source. Four rooms use `continues_from` to model configured continuations. The authored distribution is 34 beginner, 14 intermediate, and 12 advanced across three school scopes.

The preservation snapshot is [2026-10-02-authored-room-cases.json](snapshots/2026-10-02-authored-room-cases.json). It contains rooms, linked patients, specialties/schools, and non-assignment clinical notes, labs, vitals, orders, and imaging. Learner assignments and chats are intentionally excluded.

## Read/write paths

| Domain | Storage | Main reads | Main writes |
| --- | --- | --- | --- |
| Patient identity | `patients`, `rooms.patient_id` | `src/features/emr/lib/api.ts`, `EmrDashboard.tsx`, `PatientSidebar.tsx` | `AdminPatients.tsx`, `RoomEditor.tsx`, `RoomManagement.tsx`, `CaseBuilder.tsx` |
| Notes | `clinical_notes` | `emr/lib/api.ts`, `ClinicalNotes.tsx` | `ClinicalNotes.tsx`, `CaseBuilder.tsx`, student completion flow |
| Labs | `lab_results` | `emr/lib/api.ts`, `LabResults.tsx`, `EmrDashboard.tsx` | `OrderEntry.tsx`, `OrdersManagement.tsx`, `CaseBuilder.tsx`, `lab-results` function |
| Vitals | `vital_signs` | `emr/lib/api.ts`, `VitalSigns.tsx`, `EmrDashboard.tsx` | `VitalSigns.tsx`, `vitals-generator` function, room/case setup |
| Orders | `medical_orders` | `emr/lib/api.ts`, `OrdersManagement.tsx` | `OrderEntry.tsx`, `OrdersManagement.tsx`, assignment flow |
| Imaging | `imaging_studies` | `emr/lib/api.ts`, `ImagingStudies.tsx`, `EmrDashboard.tsx` | `ImagingStudies.tsx`, `CaseBuilder.tsx`, `imaging-results` function |
| Learner session | `student_room_assignments`, `chat_messages`, assignment-scoped EMR rows | `AssignmentView.tsx`, `ChatInterface.tsx`, `EmrDashboard.tsx` | student order/chat/completion flows and test-session reset |
| Case authoring | `rooms`; `case_blueprints` is currently empty in production | `RoomEditor.tsx`, `CaseBuilder.tsx` | those same admin screens and `generate-case-package` |

## Scope model currently present

EMR rows use `override_scope` values `baseline`, `room`, or `assignment`, plus `room_id` and/or `assignment_id`. `src/features/emr/lib/scope.ts` now provides the shared display filter. It must remain a read/display projection: values at each scope are retained, and selecting a narrower scope must not mutate the baseline or room record.

## Dependency order

1. Patient/encounter identity guards and stale-response tests.
2. Atomic, version-aware create/update paths and visible save states.
3. Room 401 lab persistence reproduction and recovery fixture.
4. Canonical medication-order projection across orders, overview, MAR, and student chart.
5. Scenario baseline versus learner-session separation.
6. Typed lab results, explicit clinical time/administration transitions, and context-package isolation.
7. Editors/import/export, evaluation improvements, regression manifest, and accessibility surfaces.

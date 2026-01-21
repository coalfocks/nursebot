# PRD: EHR Notes/Labs UX + Admin Room & Assignment Enhancements

## Summary
Improve EHR clarity (room name display, note deletion, lab run consolidation), enable progress note editing/sign-off flow, and expand admin tooling (multi-select specialties, room access by school, bulk user creation, and advanced case assignment scheduling).

## Task List

### EHR
- [x] Show room name in the EHR patient list (not room number).
- [x] If a room has no name, fall back to room number (or show “Unnamed Room”) and log a warning in admin UI.
- [x] Allow superadmins to delete any clinical note (all types: H&P, Progress, Consult, Discharge, Nurse).
- [x] Consolidate all superadmin baseline/room-creation labs into a single run column.
- [x] Ensure labs generated during case assignments show as new runs.
- [x] Allow students to open/edit progress notes from the EHR after completion.
- [x] Disable chat input once a case is completed while keeping EHR accessible.
- [x] Sign/submit progress note to trigger feedback generation.
- [x] Lock signed notes as read-only.

### Admin: Rooms & Specialties
- [x] Fix specialties list loading in room create/edit.
- [x] Allow multi-select specialties per room.
- [x] Add Family Medicine to specialties.
- [x] Add room school access multi-select (independent of ownership).
- [x] Add “All Schools” option for room access.
- [x] Ensure admin room lists respect multi-school access rules.

### Admin: Bulk User Creation
- [x] Add Admin UI CSV upload for bulk user creation (one school at a time).
- [x] Require CSV columns: school, name, email, password, specialty.
- [x] Skip duplicate users by email and report skipped entries.
- [x] Provide a summary report of created vs skipped users.

### Admin: Case Assignment
- [x] Allow selection by rooms or specialties.
- [x] If selecting specialties, allow multi-select rooms under those specialties.
- [x] Allow assignment targeting by school, specialty, or specific students.
- [x] Support absolute start/end time window for assignments.
- [x] Stagger assignment delivery with 5–10 minute padding (no simultaneous starts).
- [x] Require specified room order for assignments (unless an existing order model is used).
- [x] Generate N x M assignments when selecting schools/students and rooms.
- [x] Assign cases to each student in specified order with randomized offsets.
- [x] Ensure effective/due dates fall within the window.

## Data / Model Notes
- Add or use a room display name field to support “room name” in the EHR.
- Introduce a lab run grouping mechanism (e.g., run_id or shared timestamp) for baseline/room-creation runs.
- Persist multi-select specialties and multi-school access on rooms.

## Open Questions
- Should room name be a new field (rooms.name) or reuse an existing field?
- For assignment scheduling, should due date always equal the end of the window, or be per-case based on spacing?
- For bulk user creation: role defaults (student vs admin) — confirm default role.

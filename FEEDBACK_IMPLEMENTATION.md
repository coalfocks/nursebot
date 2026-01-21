# Feedback Implementation Notes

This file tracks each feedback item, current status, and any clarifications needed.

Legend:
- Done: implemented in code.
- Needs clarification: requirements or target UI/data are not precise enough to change safely.
- Needs schema/backend: requires new tables, storage, edge functions, or DB migrations.

## 1. EHR / Sandbox Builder (Admin & Overview Templates)
- Remove default "ad labs baseline" from overview sandbox template.
  - Needs clarification: no matching string found in UI; only auto-seeded labs in `src/components/RoomEditor.tsx`.
- Fix room number propagation when editing patient baseline (Admin/CHR view).
  - Needs clarification: admin patient list uses `patients` table in `src/features/emr/lib/api.ts`; student view uses room join.
  - Confirm whether room number should live on `rooms.room_number`, `patients.room_id`, or `patients.service`.
- Remove invalid "admitted date" field shown in Admin view.
  - Needs clarification: field renders in `src/features/emr/components/PatientSidebar.tsx` for all users.
  - Confirm admin-only removal or remove everywhere.
- Remove Attending field from Admin view.
  - Needs clarification: shown in `src/pages/EmrDashboard.tsx` and `src/features/emr/components/PatientSidebar.tsx`.
  - Confirm admin-only removal or remove everywhere.
- Ensure Admin view mirrors student-facing data; prevent placeholder/auto-generated metadata.
  - Needs clarification: likely touches room seeding + baseline edit flows in `src/components/RoomEditor.tsx` and `src/pages/EmrDashboard.tsx`.

## 2. Notes System Enhancements
- Dedicated Nurse Note, timestamped, accessible during chat, reviewable after completion.
  - Needs clarification: `clinical_notes` supports free-form note_type; confirm whether to store as `note_type = 'Nurse'`.
  - Confirm where to launch note entry (chat panel vs separate modal) and where to show on completed cases.

## 3. Laboratory Results Organization
- Serum lactate category fix.
  - Done: route lactate to Chemistry/Electrolytes in `src/features/emr/components/LabResults.tsx`.
- Enforce consistent lab taxonomy.
  - Needs clarification: current taxonomy only affects UI grouping; confirm if you want a centralized mapping in `labCatalog`/`aiLabGenerator`.

## 4. Imaging Module (Major Priority Area)
- Imaging containers, uploads, annotations, imaging orders, AI reads, Imaging Studies section.
  - Done: added imaging studies table + API/UI + admin uploads, imaging orders, and AI read generation.
  - Added migration `supabase/migrations/20251201000006_add_imaging_studies.sql`.
  - Added Edge Function `supabase/functions/imaging-results/index.ts` (requires `OPENAI_API_KEY`).
  - Added imaging UI in `src/features/emr/components/ImagingStudies.tsx` and wired into `src/pages/EmrDashboard.tsx`.
  - Added imaging order items in `src/features/emr/lib/ordersData.ts`.
  - Storage bucket created via migration `supabase/migrations/20251201000007_create_imaging_bucket.sql`.

## 5. Orders System Expansion
- Consult, nursing, general orders + search entry.
  - Needs clarification: `medical_orders.category` is free-form, but order lists are curated in `src/features/emr/lib/ordersData.ts`.
  - Provide the initial order list and preferred categories.
- Separate Labs/Meds/Imaging/Other in UI.
  - Needs clarification: define grouping and desired UI layout in `src/features/emr/components/OrdersManagement.tsx`.

## 6. Rooms Tab Cleanup & Functionality
- Remove "Existing patient" under Edit Rooms.
  - Done: removed link-existing-patient UI in `src/components/RoomEditor.tsx`.
- Remove "Each admission" tab.
  - Done: removed EHR Admission UI in `src/components/RoomEditor.tsx`.
- Remove "Recent vitals" tab.
  - Done: removed Recent Vitals UI in `src/components/RoomEditor.tsx`.
- Remove "PDF document" tab.
  - Done: removed PDF upload UI in `src/components/RoomEditor.tsx`.
- Fix inability to delete rooms.
  - Needs clarification: delete likely blocked by FK constraints (`student_room_assignments`, `medical_orders`, etc.).
  - Confirm whether we should cascade delete dependent data or block deletion with a warning.

## 7. Patient Portal / Nurse Connect
- Remove Dashboard from Nurse Connect.
  - Done: removed dashboard links from `src/components/Navbar.tsx`.
  - Needs clarification: admin sidebar still shows "Overview" (`src/components/admin/AdminSidebar.tsx`).
- Update selectable schools list.
  - Needs schema/backend: schools come from DB (`supabase/migrations/20250206000000_multi_school_support.sql`).
  - Provide whether to replace/rename existing rows or add new ones.

## 8. Signup & User Profiling
- Replace "Specialized Interest" with Case Designation; use for case tailoring.
  - Needs schema/backend: requires new profile field (or repurpose `specialization_interest`) and downstream logic.
  - Confirm where to capture (register vs profile) and how to map to case selection/prompting.

## 9. Secure Chat (Highest Educational Impact)
- "Go to Bedside" button reveals room hint.
  - Needs clarification: room hints exist as `rooms.bedside_hint`; confirm display UX in chat.
- Two-step Complete button -> show hint -> unlock Progress Note.
  - Needs clarification: define unlock behavior and where progress note is stored (clinical_notes vs assignment field).
- Progress Note entry in-platform.
  - Needs clarification: confirm note schema, required fields, and when to prompt.
- Qualtrics link after note submission.
  - Needs clarification: confirm storage for survey URLs and desired modal layout.

## 10. Completed Chats Page
- Remove Professionalism tab.
  - Done: removed Professionalism section in `src/components/AssignmentFeedback.tsx`.
- Show submitted Progress Note on completed page.
  - Needs clarification: depends on progress note storage location + field name.

## 11. Cross-Cutting Quality Improvements
- Remove unused/redundant tabs across platform.
  - Needs clarification: enumerate exact tabs and target pages.
- Maintain consistent terminology.
  - Needs clarification: provide preferred labels for Admin/Student/Nurse views.

## 12. Roadmap-Ready Themes
- Documentation only.
  - Needs clarification: confirm where to capture (e.g., `ARCHITECTURE.md` vs separate roadmap doc).

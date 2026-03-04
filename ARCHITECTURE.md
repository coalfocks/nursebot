# Nursebot / EMR Simulation – Architectural Overview

## High-Level
- Vite + React + TypeScript front-end (`src/`), Tailwind for styling.
- Supabase provides auth, Postgres, storage, and Edge Functions.
- Domain: EMR simulation with patients, rooms, assignments, labs, vitals, orders, and a nurse chat.
- No automated tests; linting via `npm run lint`.

## Key Domains & Data Flow
- **Patients/Rooms**
  - Patients link to rooms; room carries scenario metadata (nurse/EMR context, expected diagnosis/treatment, goals, difficulty, progress note, completion hints, orders config).
  - `src/features/emr/lib/api.ts` wraps Supabase CRUD and scope filtering (baseline/room/assignment) for patients, notes, labs, vitals, orders.
  - `PatientSidebar` + `EmrDashboard` render patient list and tabs (overview, vitals, notes, labs, orders).
- **Assignments (students)**
  - `student_room_assignments` drive student views.
  - `AssignmentView.tsx` embeds EHR tabs (non-admin) alongside nurse chatbot; scopes labs/orders to assignment + room; refresh tokens keep Labs in sync.
  - `StudentDashboard.tsx` lists assignments/rooms; PDF viewers for case docs.
- **Orders & Labs**
  - UI: `OrderEntry` to place orders; `OrdersManagement` lists active/all orders.
  - STAT labs and manual “Generate AI Labs” call Supabase Edge Function `lab-results` with rich context (patient, room, assignment, clinical notes, vitals, prior labs, current orders, room EMR/nurse context, expected diagnosis/treatment, goals, difficulty, objective, progress note, completion hint). Results are saved to `lab_results`; Labs tab refreshes. Fallback to local generator only on error.
  - Lab templates mapped from order names (`resolveLabTemplates` in `aiLabGenerator.ts`) to select appropriate tests.
  - Pending/non-STAT labs are not auto-generated.
- **Medications**
  - Order picker pulls from `ordersData.ts` which now merges a CSV-driven set of ~360 meds (`generatedMedicationOrders.ts`) with the legacy 5 meds; deduped by name. Med entries carry routes, frequencies, default dose text, and renal/hepatic notes as instructions.
- **Vitals**
  - UI: `VitalSignsComponent`.
  - “Generate” calls Supabase Edge Function `vitals-generator` with the same rich context; saves to `vital_signs`. Fallback to local generator only on error.
  - Superadmins can optionally clamp generated vitals with min/max per parameter; superadmin saves are baseline (no assignment/room). Student views pull baseline + room/assignment-scoped rows via `emrApi.listVitals`.
- **Custom Overview & Images**
  - Custom overview sections on the dashboard support text/image; images now render larger and include a size slider per section (200–900px max height).
- **Clinical Notes**
  - `ClinicalNotes` fetch/add notes scoped by room/assignment/baseline; stored in `clinical_notes`.

## AI / Edge Functions
- **lab-results** (`supabase/functions/lab-results`): OpenAI-backed lab generation; supports batch tests with context; returns JSON labs. Used by STAT labs and manual AI labs.
- **vitals-generator** (`supabase/functions/vitals-generator`): OpenAI-backed vitals generation; returns JSON array of vitals.
- **chat** (`supabase/functions/chat`): Nurse chatbot backend used by `ChatInterface`.
- **superadmin-report** (`supabase/functions/superadmin-report`): Curated operations wrapper that verifies `profiles.role = 'super_admin'` before returning cross-school summary/report data plus assignment evaluation rows joined with student/assigned-by profiles.
- Local generators (`aiLabGenerator.ts`) remain as fallbacks only.

## Chatbot
- `components/ChatInterface.tsx` subscribes to `chat_messages` by assignment. Generates initial prompt from room role/style/context (`lib/openai.ts`) and calls `chat` Edge Function for completions. Links to patient by roomId when available.

## Room Configuration
- `RoomEditor.tsx` (admin) manages room metadata: role/style, nurse context, EMR context (`emr_context`), expected diagnosis/treatment, goals, difficulty, objectives, progress note, completion hints, orders config, PDFs. Seeds initial labs/vitals when linking/creating patient (legacy).

## Scope & Persistence Rules
- Baseline (super admin) orders/labs/vitals save without assignmentId; roomId as applicable.
- Room-config orders/labs scoped to that room.
- Student assignment orders/labs/vitals scoped to that assignmentId + roomId; do not leak to other rooms/assignments.
- Student completion progress notes are stored in `clinical_notes` with `override_scope = 'assignment'` and the current `assignment_id`; they must not be saved as baseline/room-scoped notes.
- Test users create self-serve room sessions (assignment-scoped) for sandboxing; reset clears assignment-scoped labs, orders, vitals, notes, imaging, and chat for that user.
- Context sent to AI includes patient info, room/assignment ids, clinical notes, vitals, prior labs, current orders, and room metadata (emr_context, nurse_context, expected diagnosis/treatment, goals, difficulty, objective, progress note, completion hint).
- Room creation seeds initial labs; vitals seeding is still manual (via baseline edits/AI). If you need initial vitals at room creation, add an insert into `vital_signs` using `emr_context.initial_vitals`.

## Commands
- Dev: `npm run dev`
- Lint: `npm run lint`
- Build: `npm run build`
- Preview: `npm run preview`
- Supabase functions (serve): `npx supabase functions serve <name>`
- Supabase functions (deploy): `npx supabase functions deploy lab-results vitals-generator chat ...`

## Front-End Structure
- `src/pages/` routes (EmrDashboard, AssignmentView, StudentDashboard, admin screens).
- `src/pages/SuperAdminPortal.tsx` is a non-advertised route (`/superadmin/portal`) that consumes `superadmin-report`; route and backend both enforce superadmin-only access.
- `src/features/emr/components/` EMR UI (Orders, Labs, Vitals, Notes, PatientSidebar, UI primitives).
- `src/features/emr/lib/` API wrapper, types, local generators, orders data.
- Global styles: `src/index.css` (medical-grid layout, scroll behavior).

## Notable UX/Layouts
- EMR grid: sidebar scrolls independently; main content scrolls.
- Student AssignmentView: side-by-side nurse chat + EHR tabs (no admin controls).
- Labs tab auto-refreshes after STAT orders and manual AI generation.

## Environment & Secrets
- Front-end env: `.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, etc.).
- Edge Functions: `OPENAI_API_KEY` required; set via `supabase secrets set`.
- Service scripts: `SUPABASE_SERVICE_ROLE_KEY` as needed.

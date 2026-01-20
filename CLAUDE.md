# Repository Guidelines

## Project Structure & Module Organization
Client code sits in `src/`: `components/` houses reusable UI, `pages/` maps to routes, `stores/` exposes Zustand state, and `lib/` holds Supabase helpers. Static assets live in `public/`, while the Vite build writes to `dist/` (do not commit). Supabase Edge Functions and migrations reside under `supabase/`, and operational utilities like `scripts/regenerate-feedback.ts` depend on Supabase service credentials.

## Build, Test & Development Commands
- `npm install` – install Node dependencies and the bundled Supabase CLI.
- `npm run dev` – start Vite; pair with `supabase start` when you need local database + functions.
- `npm run build` – emit the production bundle into `dist/`.
- `npm run preview` – serve the build for smoke checks.
- `npm run lint` – execute ESLint across the TypeScript sources.
- `npx supabase functions serve chat` – hot-reload the `chat` Edge Function (swap the directory name as needed).
- `node scripts/regenerate-feedback.ts` – rerun feedback jobs against Supabase; requires service role credentials.

## Coding Style & Naming Conventions
Stick to TypeScript React function components with two-space indentation, single quotes, and semicolons. Use `PascalCase` for component files and exported hooks, `camelCase` for utilities and Zustand stores. Keep business logic in `stores/` or `lib/`, leaving JSX primarily declarative, and group Tailwind classes by purpose for readability. Run `npm run lint` before pushing and resolve every warning.

## Testing & QA
There is no automated suite yet, so document the manual flows you exercised in each PR. Validate affected dashboards via `npm run dev`, paying special attention to assignment feedback and room management workflows. For backend logic, run `npx supabase functions serve <name>` and probe endpoints with `curl` or `httpie` using realistic payloads. If you add automated coverage, co-locate `*.test.tsx` files with the code under test and wire them up with Vitest.

## Commit & Pull Request Guidelines
History mixes conventional commits such as `feat(assessments): add rerun button` with free-form messages—default to the conventional form, keep subjects imperative, and split unrelated work. Pull requests must outline the problem, solution, and verification steps; attach UI captures for visual changes and reference migration IDs or issue links when relevant.

## Supabase & Environment Secrets
Front-end environment variables belong in `.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and any AI provider keys. Edge Functions require additional secrets like `OPENAI_API_KEY`; configure them through `supabase secrets set KEY=value`. Maintenance scripts also need `SUPABASE_SERVICE_ROLE_KEY`. Never commit secrets or sample data.

## Coordination & Context for LLMs
- Start by skimming `ARCHITECTURE.md` for current domain notes (EMR scope rules, AI functions, CSV-driven med orders, vitals clamping, image sizing).
- When touching EMR data flows, keep scope semantics intact: baseline (no assignment/room), room-scoped, and assignment-scoped reads/writes go through `emrApi`.
- Medication orders are sourced from the CSV-backed list (`generatedMedicationOrders.ts`); do not regress to the legacy 5-meds list.
- Superadmin vitals saves are baseline-only; avoid sending invalid `room_id` values (no `0`). Student views pull baseline + room/assignment rows.
- Custom overview images support user-resizable heights; preserve the slider UX.
- If you add migrations or seed data (e.g., initial vitals on room creation), document the behavior in `ARCHITECTURE.md`.

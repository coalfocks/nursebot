#!/usr/bin/env bash
set -euo pipefail

: "${STUDENT_LIBRARY_DISPOSABLE:?Set STUDENT_LIBRARY_DISPOSABLE=1}"
[[ "$STUDENT_LIBRARY_DISPOSABLE" == 1 ]] || { echo 'Refusing without disposable opt-in' >&2; exit 2; }
command -v docker >/dev/null || { echo 'docker required' >&2; exit 2; }
PORT="${STUDENT_LIBRARY_PGPORT:-54343}"
NAME="student-library-repair-${PORT}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${STUDENT_LIBRARY_TRANSCRIPT:-$ROOT/docs/reviews/2026-10-22-student-library-repair.transcript.txt}"
created_by_this_run=0
cleanup() { if [[ "$created_by_this_run" == 1 ]]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
[[ ! "$(docker ps -a --format '{{.Names}}' | grep -Fx "$NAME" || true)" ]] || { echo "refusing occupied disposable container $NAME" >&2; exit 2; }

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=student-library-local postgres:15.3 >/dev/null
created_by_this_run=1
for _ in {1..60}; do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
{
  echo 'STUDENT LIBRARY VERSIONED REPAIR TRANSCRIPT'
  echo "UTC $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
create extension if not exists pgcrypto;
create table public.walkthrough_videos (id uuid primary key, version integer not null, title text not null, description text not null default '', learning_objective text not null default '', topic text not null, audience text not null, onboarding_eligible boolean not null default false, thumbnail_path text, video_path text, duration_seconds integer, captions_path text, transcript text not null default '', status text not null, processing_status text not null, created_by uuid);
create table public.walkthrough_courses (id uuid primary key, version integer not null, title text not null, description text not null default '', audience text not null, status text not null, is_mandatory boolean not null, created_by uuid, updated_at timestamptz default now());
create table public.walkthrough_course_items (id uuid default gen_random_uuid(), course_id uuid not null, course_version integer not null, video_id uuid not null, video_version integer not null, position integer not null, required boolean not null);
create table public.walkthrough_enrollments (id uuid primary key, user_id uuid not null, course_id uuid not null, course_version integer not null);
create table public.walkthrough_progress (id uuid primary key, enrollment_id uuid not null, user_id uuid not null, video_id uuid not null, video_version integer not null);
insert into public.walkthrough_videos(id,version,title,topic,audience,video_path,status,processing_status) values
('8d70f650-bfad-40d8-b52e-bf39f549db62',1,'Getting an Account','workflow','test_room','m1','published','ready'),
('623d49a5-3400-4d32-9a84-3a82b536841c',1,'Opening a case','workflow','test_room','m2','published','ready'),
('a25d3424-afdf-42a4-b8e3-ea8652c78e2e',1,'Conversations','workflow','test_room','m3','published','ready'),
('1a004bd9-a257-4fd5-a285-f72ddd501e78',1,'EMR','workflow','test_room','m4','published','ready'),
('06216dc8-3420-49c3-a10c-dee8455a47db',1,'Feedback','workflow','test_room','m5','published','ready'),
('4580468f-2aec-4fff-9444-6a7ed50ddc9e',1,'Full case','workflow','test_room','m6','published','ready');
insert into public.walkthrough_courses values ('4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71',1,'Student Learning Library Preview','optional','student','published',false,null,now());
insert into public.walkthrough_course_items(course_id,course_version,video_id,video_version,position,required) select '4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71',1,id,1,row_number() over(),true from public.walkthrough_videos;
insert into public.walkthrough_enrollments values ('c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71',1);
insert into public.walkthrough_progress values ('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','8d70f650-bfad-40d8-b52e-bf39f549db62',1);
SQL
  docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 < "$ROOT/supabase/migrations/20261022063000_student_library_versioned_content_repair.sql"
  READBACK="$(docker exec -i "$NAME" psql -U postgres -At -v ON_ERROR_STOP=1 <<'SQL'
select (select count(*) from public.walkthrough_course_items where course_id='4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71') || '|' ||
       (select count(*) from public.walkthrough_course_items where course_id='b7a4bb2d-4b01-4b01-8f7e-000000001001') || '|' ||
       (select count(*) from public.walkthrough_videos where audience='test_room') || '|' ||
       (select count(*) from public.walkthrough_videos where audience='student') || '|' ||
       (select count(*) from public.walkthrough_enrollments) || '|' ||
       (select count(*) from public.walkthrough_progress) || '|' ||
       (select is_mandatory::text from public.walkthrough_courses where id='b7a4bb2d-4b01-4b01-8f7e-000000001001');
SQL
)"
  printf 'raw_readback=%q\n' "$READBACK"
  [[ "$READBACK" == '6|6|6|6|1|1|false' ]] || { echo "content repair readback failed: $READBACK" >&2; exit 1; }
  echo "readback=$READBACK (old items|new items|Test Room videos|student videos|enrollments|progress|new mandatory)"
  echo 'PASS: atomic versioned repair preserved old v1/progress and created six student-playable records in a separate optional course.'
} 2>&1 | tee "$OUT"

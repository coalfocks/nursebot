-- Predicate-shape coverage only. Run in a disposable Postgres
-- database only. It creates temporary tables and rolls them back; it does not
-- inspect or modify production rows. The exact-schema/function runner is
-- scripts/qa/run-materialize-hospital-timeline-isolated.sh.
begin;

create temp table clinical_notes (
  room_id integer,
  timeline_entry_id text,
  deleted_at timestamptz,
  note_type text
);
create temp table lab_results (like clinical_notes);
create temp table vital_signs (like clinical_notes);
create temp table imaging_studies (like clinical_notes);

create unique index clinical_notes_room_timeline_entry_uidx
  on clinical_notes (room_id, timeline_entry_id)
  where room_id is not null and timeline_entry_id is not null and deleted_at is null;
create unique index lab_results_room_timeline_entry_uidx
  on lab_results (room_id, timeline_entry_id)
  where room_id is not null and timeline_entry_id is not null and deleted_at is null;
create unique index vital_signs_room_timeline_entry_uidx
  on vital_signs (room_id, timeline_entry_id)
  where room_id is not null and timeline_entry_id is not null and deleted_at is null;
create unique index imaging_studies_room_timeline_entry_uidx
  on imaging_studies (room_id, timeline_entry_id)
  where room_id is not null and timeline_entry_id is not null and deleted_at is null;

do $$
begin
  begin
    insert into clinical_notes values (118, 'note-1', null, 'H&P')
      on conflict (room_id, timeline_entry_id)
      where timeline_entry_id is not null and deleted_at is null
      do update set note_type = excluded.note_type;
    raise exception 'stale conflict target unexpectedly succeeded';
  exception when SQLSTATE '42P10' then
    -- Expected: the stale target cannot infer the production partial index.
    null;
  end;

  insert into clinical_notes values (118, 'note-1', null, 'H&P')
    on conflict (room_id, timeline_entry_id)
    where room_id is not null and timeline_entry_id is not null and deleted_at is null
    do update set note_type = excluded.note_type;
  insert into lab_results values (118, 'lab-1', null, 'lab');
  insert into vital_signs values (118, 'vital-1', null, 'vital');
  insert into imaging_studies values (118, 'image-1', null, 'imaging');

  -- Replaying all four provenance keys must update, not duplicate.
  insert into clinical_notes values (118, 'note-1', null, 'H&P updated')
    on conflict (room_id, timeline_entry_id)
    where room_id is not null and timeline_entry_id is not null and deleted_at is null
    do update set note_type = excluded.note_type;
  insert into lab_results values (118, 'lab-1', null, 'lab updated')
    on conflict (room_id, timeline_entry_id)
    where room_id is not null and timeline_entry_id is not null and deleted_at is null
    do update set note_type = excluded.note_type;
  insert into vital_signs values (118, 'vital-1', null, 'vital updated')
    on conflict (room_id, timeline_entry_id)
    where room_id is not null and timeline_entry_id is not null and deleted_at is null
    do update set note_type = excluded.note_type;
  insert into imaging_studies values (118, 'image-1', null, 'imaging updated')
    on conflict (room_id, timeline_entry_id)
    where room_id is not null and timeline_entry_id is not null and deleted_at is null
    do update set note_type = excluded.note_type;

  if (select count(*) from clinical_notes) <> 1
    or (select count(*) from lab_results) <> 1
    or (select count(*) from vital_signs) <> 1
    or (select count(*) from imaging_studies) <> 1 then
    raise exception 'provenance replay duplicated rows';
  end if;
  if (select note_type from clinical_notes) <> 'H&P updated'
    or (select note_type from lab_results) <> 'lab updated'
    or (select note_type from vital_signs) <> 'vital updated'
    or (select note_type from imaging_studies) <> 'imaging updated' then
    raise exception 'provenance replay did not update each row type';
  end if;
end
$$;

rollback;

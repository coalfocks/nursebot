insert into storage.buckets (id, name, public)
values ('imaging_studies', 'imaging_studies', true)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public;

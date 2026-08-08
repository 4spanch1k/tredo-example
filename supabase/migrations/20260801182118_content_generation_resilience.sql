alter table public.content_queue
  add column if not exists text_fingerprint text,
  add column if not exists is_duplicate boolean not null default false;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create or replace function private.set_content_fingerprint()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.text_fingerprint := md5(
    regexp_replace(lower(trim(new.text)), '[[:space:]]+', ' ', 'g')
  );
  return new;
end;
$$;

revoke all on function private.set_content_fingerprint()
from public, anon, authenticated;

drop trigger if exists set_content_fingerprint on public.content_queue;
create trigger set_content_fingerprint
before insert or update of text on public.content_queue
for each row execute function private.set_content_fingerprint();

update public.content_queue
set text_fingerprint = md5(
  regexp_replace(lower(trim(text)), '[[:space:]]+', ' ', 'g')
)
where text_fingerprint is null;

-- These are the seven confirmed duplicate copies. Two earlier copies are
-- marked because their later twins already have replies in Threads.
update public.content_queue
set is_duplicate = true,
    last_error = 'Exact duplicate identified; Threads deletion requires app permission'
where id in (
  'b448adca-eaf2-4dc4-b1fc-1a3f953067ce',
  '1425a388-139c-4fbb-aa38-75c7d4fc0b68',
  'f3ff4842-af63-449f-b796-02cc5e365307',
  'f7fb535c-dbba-498e-a20f-37a92dee1c21',
  '080f4bff-5e74-4acf-8a0f-52b101e4a4af',
  '046fddd7-fe0b-4609-94d4-1d8bf5086a9e',
  'ea63df4b-ffa1-46f0-8e1d-4dcf33279857'
);

alter table public.content_queue
  alter column text_fingerprint set not null;

create unique index if not exists uq_content_queue_live_text_fingerprint
  on public.content_queue (text_fingerprint)
  where status in ('scheduled', 'publishing', 'published')
    and is_duplicate = false;

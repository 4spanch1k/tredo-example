-- Threads Lead Bot — Supabase schema
-- Apply this file once in the Supabase SQL Editor.

-- Keep future objects in public private by default. Supabase projects have a postgres
-- owner role; the conditional keeps this file usable in a plain local PostgreSQL too.
do $defaults$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'postgres') then
    execute 'alter default privileges for role postgres in schema public '
      'revoke select, insert, update, delete on tables from anon, authenticated';
    execute 'alter default privileges for role postgres in schema public '
      'revoke execute on functions from public, anon, authenticated';
  end if;
end;
$defaults$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table if not exists public.content_queue (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  media_url text,
  origin text not null default 'manual',
  generation_key text,
  text_fingerprint text,
  is_duplicate boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed', 'dead_letter')),
  scheduled_at timestamptz not null default now(),
  container_id text,
  threads_post_id text,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  next_retry_at timestamptz,
  processing_started_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.content_queue
  add column if not exists origin text not null default 'manual',
  add column if not exists generation_key text,
  add column if not exists text_fingerprint text,
  add column if not exists is_duplicate boolean not null default false;

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

create unique index if not exists uq_content_queue_live_text_fingerprint
  on public.content_queue (text_fingerprint)
  where status in ('scheduled', 'publishing', 'published')
    and is_duplicate = false;

do $constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.content_queue'::regclass
      and conname = 'content_queue_origin_check'
  ) then
    alter table public.content_queue
      add constraint content_queue_origin_check
      check (origin in ('manual', 'ai_generated'));
  end if;
end;
$constraints$;

create index if not exists idx_content_queue_ready
  on public.content_queue (status, scheduled_at, next_retry_at);

create unique index if not exists uq_content_queue_generation_key
  on public.content_queue (generation_key);

create table if not exists public.content_profiles (
  id uuid primary key default gen_random_uuid(),
  business_context text not null
    check (char_length(trim(business_context)) between 100 and 20000),
  target_audience text not null
    check (char_length(trim(target_audience)) between 20 and 5000),
  tone_of_voice text not null
    check (char_length(trim(tone_of_voice)) between 10 and 2000),
  publish_times_utc time without time zone[] not null
    default array['12:00'::time without time zone],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint content_profiles_publish_times_check
    check (cardinality(publish_times_utc) between 1 and 12)
);

create unique index if not exists uq_content_profiles_single_active
  on public.content_profiles (is_active)
  where is_active = true;

create table if not exists public.interactions (
  id uuid primary key default gen_random_uuid(),
  source_item_id text not null unique,
  source text not null check (source in ('own_reply', 'keyword_search')),
  event_type text not null,
  post_id text,
  username text,
  comment_text text not null,
  intent text check (intent in ('lead', 'engagement', 'spam')),
  signals jsonb not null default '[]'::jsonb check (jsonb_typeof(signals) = 'array'),
  risk_flags jsonb not null default '[]'::jsonb check (jsonb_typeof(risk_flags) = 'array'),
  confidence_level text check (confidence_level in ('low', 'medium', 'high')),
  bot_reply_text text,
  is_lead boolean not null default false,
  reply_sent boolean not null default false,
  notification_sent boolean not null default false,
  status text not null default 'received'
    check (status in ('received', 'processing', 'classified', 'actioned', 'failed', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  next_retry_at timestamptz,
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_interactions_ready
  on public.interactions (status, next_retry_at, created_at);

create index if not exists idx_interactions_is_lead
  on public.interactions (is_lead)
  where is_lead = true;

alter table public.content_queue enable row level security;
alter table public.content_profiles enable row level security;
alter table public.interactions enable row level security;

-- All application access is server-to-server via service_role. There are intentionally
-- no anon/authenticated RLS policies.
revoke all on table public.content_queue from anon, authenticated;
revoke all on table public.content_profiles from anon, authenticated;
revoke all on table public.interactions from anon, authenticated;
revoke all on table public.content_queue from service_role;
revoke all on table public.content_profiles from service_role;
revoke all on table public.interactions from service_role;
grant usage on schema public to service_role;
grant select, insert, update on table public.content_queue to service_role;
grant select, insert, update on table public.content_profiles to service_role;
grant select, insert, update on table public.interactions to service_role;

create or replace function public.claim_interactions(
  batch_size integer default 10,
  max_attempts integer default 5,
  stale_lock_minutes integer default 10
)
returns setof public.interactions
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.interactions as i
  set status = 'dead_letter',
      last_error = coalesce(i.last_error, 'Processing lease expired after maximum attempts'),
      processing_started_at = null,
      next_retry_at = null
  where i.status = 'processing'
    and i.attempts >= greatest(max_attempts, 1)
    and i.processing_started_at < now() - make_interval(mins => greatest(stale_lock_minutes, 1));

  return query
  with candidates as materialized (
    select i.id
    from public.interactions as i
    where
      (i.status = 'received' and i.attempts < greatest(max_attempts, 1))
      or (
        i.status = 'failed'
        and i.next_retry_at <= now()
        and i.attempts < greatest(max_attempts, 1)
      )
      or (
        i.status = 'processing'
        and i.processing_started_at < now() - make_interval(mins => greatest(stale_lock_minutes, 1))
        and i.attempts < greatest(max_attempts, 1)
      )
    order by i.created_at
    limit greatest(1, least(batch_size, 100))
    for update skip locked
  )
  update public.interactions as i
  set status = 'processing',
      attempts = i.attempts + 1,
      processing_started_at = now(),
      next_retry_at = null
  from candidates
  where i.id = candidates.id
  returning i.*;
end;
$$;

create or replace function public.claim_due_content(
  batch_size integer default 5,
  max_attempts integer default 5,
  stale_lock_minutes integer default 15
)
returns setof public.content_queue
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.content_queue as c
  set status = 'dead_letter',
      last_error = coalesce(c.last_error, 'Publishing lease expired after maximum attempts'),
      processing_started_at = null,
      next_retry_at = null
  where c.status = 'publishing'
    and c.attempts >= greatest(max_attempts, 1)
    and c.processing_started_at < now() - make_interval(mins => greatest(stale_lock_minutes, 1));

  return query
  with candidates as materialized (
    select c.id
    from public.content_queue as c
    where
      (
        c.status = 'scheduled'
        and c.scheduled_at <= now()
        and c.attempts < greatest(max_attempts, 1)
      )
      or (
        c.status = 'failed'
        and c.next_retry_at <= now()
        and c.attempts < greatest(max_attempts, 1)
      )
      or (
        c.status = 'publishing'
        and c.processing_started_at < now() - make_interval(mins => greatest(stale_lock_minutes, 1))
        and c.attempts < greatest(max_attempts, 1)
      )
    order by c.scheduled_at
    limit greatest(1, least(batch_size, 50))
    for update skip locked
  )
  update public.content_queue as c
  set status = 'publishing',
      attempts = c.attempts + 1,
      processing_started_at = now(),
      next_retry_at = null
  from candidates
  where c.id = candidates.id
  returning c.*;
end;
$$;

create or replace function public.mark_interaction_failed(
  p_id uuid,
  p_error text,
  p_max_attempts integer default 5
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  select i.attempts
  into v_attempts
  from public.interactions as i
  where i.id = p_id
  for update;

  if not found then
    raise exception 'Interaction % not found', p_id;
  end if;

  if v_attempts >= greatest(p_max_attempts, 1) then
    update public.interactions
    set status = 'dead_letter',
        last_error = p_error,
        processing_started_at = null,
        next_retry_at = null
    where id = p_id;
  else
    update public.interactions
    set status = 'failed',
        last_error = p_error,
        processing_started_at = null,
        next_retry_at = now() + make_interval(secs => power(2, least(v_attempts, 20)) * 60)
    where id = p_id;
  end if;
end;
$$;

create or replace function public.mark_content_failed(
  p_id uuid,
  p_error text,
  p_max_attempts integer default 5
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  select c.attempts
  into v_attempts
  from public.content_queue as c
  where c.id = p_id
  for update;

  if not found then
    raise exception 'Content item % not found', p_id;
  end if;

  if v_attempts >= greatest(p_max_attempts, 1) then
    update public.content_queue
    set status = 'dead_letter',
        last_error = p_error,
        processing_started_at = null,
        next_retry_at = null
    where id = p_id;
  else
    update public.content_queue
    set status = 'failed',
        last_error = p_error,
        processing_started_at = null,
        next_retry_at = now() + make_interval(secs => power(2, least(v_attempts, 20)) * 60)
    where id = p_id;
  end if;
end;
$$;

revoke all on function public.claim_interactions(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_due_content(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.mark_interaction_failed(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.mark_content_failed(uuid, text, integer) from public, anon, authenticated;

grant execute on function public.claim_interactions(integer, integer, integer) to service_role;
grant execute on function public.claim_due_content(integer, integer, integer) to service_role;
grant execute on function public.mark_interaction_failed(uuid, text, integer) to service_role;
grant execute on function public.mark_content_failed(uuid, text, integer) to service_role;

create table if not exists public.it_news_items (
  id uuid primary key default gen_random_uuid(),
  source_name text not null check (char_length(trim(source_name)) between 2 and 120),
  source_url text not null check (source_url ~ '^https?://'),
  title text not null check (char_length(trim(title)) between 8 and 240),
  url text not null check (url ~ '^https?://'),
  summary text not null default '',
  published_at timestamptz,
  status text not null default 'new'
    check (status in ('new', 'processing', 'used', 'skipped')),
  fetched_at timestamptz not null default now(),
  processing_started_at timestamptz,
  used_at timestamptz
);

create unique index if not exists uq_it_news_items_source_url_url
  on public.it_news_items (source_url, url);
create index if not exists idx_it_news_items_ready
  on public.it_news_items (status, published_at, fetched_at);

alter table public.it_news_items enable row level security;
revoke all on table public.it_news_items from anon, authenticated, service_role;
grant select, insert, update on table public.it_news_items to service_role;

create or replace function public.claim_fresh_news_item()
returns setof public.it_news_items
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.it_news_items
  set status = 'new', processing_started_at = null
  where status = 'processing'
    and processing_started_at < now() - interval '30 minutes';

  return query
  with candidates as materialized (
    select n.id
    from public.it_news_items as n
    where n.status = 'new'
      and (n.published_at is null or n.published_at >= now() - interval '14 days')
    order by n.published_at desc nulls last, n.fetched_at desc
    limit 1
    for update skip locked
  )
  update public.it_news_items as n
  set status = 'processing', processing_started_at = now()
  from candidates
  where n.id = candidates.id
  returning n.*;
end;
$$;

create or replace function public.mark_news_item_used(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.it_news_items
  set status = 'used', processing_started_at = null, used_at = now()
  where id = p_id and status = 'processing';
end;
$$;

create or replace function public.release_news_item(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.it_news_items
  set status = 'new', processing_started_at = null
  where id = p_id and status = 'processing';
end;
$$;

revoke all on function public.claim_fresh_news_item() from public, anon, authenticated;
revoke all on function public.mark_news_item_used(uuid) from public, anon, authenticated;
revoke all on function public.release_news_item(uuid) from public, anon, authenticated;
grant execute on function public.claim_fresh_news_item() to service_role;
grant execute on function public.mark_news_item_used(uuid) to service_role;
grant execute on function public.release_news_item(uuid) to service_role;

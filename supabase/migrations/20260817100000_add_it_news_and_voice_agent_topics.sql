begin;

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

update public.content_profiles
set
  business_context = business_context || $profile$

Редакционная карта расширена: кроме сайтов, приложений и автоматизации обсуждаем голосовых AI-агентов и их реальные сбои в звонках — перебивания, потерю контекста, паузы, акценты, уверенные ошибки и момент передачи человеку. Также обсуждаем ChatGPT, Claude, другие AI-инструменты, общую IT-практику и новости только по подтверждённому материалу из it_news_items.

Посты про IT-новости не пересказывают заголовок и не выдумывают факты. Они переводят подтверждённое изменение в один практический вопрос: что изменилось в работе, что нужно проверить или где голосовой агент может ошибиться. Без исходного материала используется общий вопрос о практике, а не заявление о свежем событии.
  $profile$,
  target_audience = target_audience || E'\n\nВ аудиторию входят также разработчики, владельцы продуктов, команды поддержки и предприниматели, которые используют AI-инструменты, автоматизацию и голосовые каналы.'
where is_active = true;

update public.content_profiles
set tone_of_voice = tone_of_voice || E'\n\nДля ответов на комментарии разрешены продолжение мысли, конкретный пример, спокойное возражение, уточнение границы и лёгкая шутка. Не задавай вопрос в каждом ответе и не начинай каждый ответ с благодарности или согласия. Сохраняй связь с последней репликой и не выдумывай неизвестные факты.'
where is_active = true;

-- The topic plan changes the meaning of future slots. Retire only unpublished
-- generated items so the next generator run can refill them with new angles.
update public.content_queue
set status = 'failed',
    generation_key = null,
    next_retry_at = null,
    processing_started_at = null,
    last_error = 'Retired after voice-agent and IT topic expansion'
where origin = 'ai_generated'
  and status = 'scheduled'
  and scheduled_at > now();

commit;

begin;

-- Keep the twelve two-hour publication slots aligned with the generator's
-- fixed local schedule: news at 12:00 and 18:00, promotion at 20:00 Almaty.
update public.content_profiles
set publish_times_utc = array[
  '01:00'::time without time zone,
  '03:00'::time without time zone,
  '05:00'::time without time zone,
  '07:00'::time without time zone,
  '09:00'::time without time zone,
  '11:00'::time without time zone,
  '13:00'::time without time zone,
  '15:00'::time without time zone,
  '17:00'::time without time zone,
  '19:00'::time without time zone,
  '21:00'::time without time zone,
  '23:00'::time without time zone
]
where is_active = true;

-- Existing future rows were generated under the old random topic assignment.
-- Retire only unpublished AI rows so the generator can refill the same slots
-- with the fixed news and daily-promotion rules. Published and manual content
-- remains unchanged.
update public.content_queue
set status = 'failed',
    generation_key = null,
    next_retry_at = null,
    processing_started_at = null,
    last_error = 'Retired after fixed news and daily promotion schedule'
where origin = 'ai_generated'
  and status in ('draft', 'scheduled')
  and scheduled_at > now();

commit;

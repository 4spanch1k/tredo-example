-- Future generated copy was created before the semantic-cohesion guard existed.
-- Preserve it as drafts for audit, clear only its scheduling key, and let the
-- current generator create replacements. Published and manually queued content
-- are intentionally untouched.
update public.content_queue
set status = 'draft',
    generation_key = null,
    processing_started_at = null,
    next_retry_at = null
where origin = 'ai_generated'
  and status = 'scheduled'
  and scheduled_at > now();

select private.invoke_edge_function('content-generator');

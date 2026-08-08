update public.content_queue
set status = 'failed',
    generation_key = null,
    next_retry_at = null,
    processing_started_at = null,
    last_error = 'Retired semantically repeated fallback during recovery'
where id in (
  '3759de93-e848-466c-b2a1-ff79debcf7f2',
  '91155253-fc80-4e65-8c9c-cd544ed2dc9b',
  '4a1e7071-34b0-4d72-9bb3-746fd62d008b'
)
  and status = 'scheduled';

select private.invoke_edge_function('content-generator');

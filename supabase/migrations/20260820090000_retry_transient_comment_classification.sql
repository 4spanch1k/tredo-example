-- Retry comments that were incorrectly finalized while the configured Groq
-- model was unavailable. Keep notification_sent intact so operators do not
-- receive the same alert again when the comment is successfully retried.
UPDATE public.interactions
SET
  intent = NULL,
  signals = '[]'::jsonb,
  risk_flags = '[]'::jsonb,
  confidence_level = NULL,
  bot_reply_text = NULL,
  status = 'received',
  attempts = 0,
  last_error = NULL,
  next_retry_at = NULL,
  processing_started_at = NULL,
  processed_at = NULL
WHERE source = 'own_reply'
  AND reply_sent = false
  AND status = 'actioned'
  AND risk_flags @> '["model_unavailable"]'::jsonb;

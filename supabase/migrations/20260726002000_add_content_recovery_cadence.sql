-- Publication times still come from content_queue. Frequent no-op checks make
-- generation gaps and retryable Threads failures recover without waiting for
-- the next two-hour publishing slot.
do $reschedule$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname in ('threads-content-generator', 'threads-content-poster')
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'threads-content-generator',
    '*/15 * * * *',
    'select private.invoke_edge_function(''content-generator'')'
  );

  perform cron.schedule(
    'threads-content-poster',
    '*/5 * * * *',
    'select private.invoke_edge_function(''content-poster'')'
  );
end
$reschedule$;

-- Refill the nearest missing slots now. The poster recovery job will pick up
-- the first due row on its next five-minute tick.
select private.invoke_edge_function('content-generator');

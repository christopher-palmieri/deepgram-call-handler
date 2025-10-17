-- Archive old completed/failed calls function
-- Date: 2025-10-17
-- Purpose: Automatically mark completed/failed calls as inactive after 30 days of no updates

-- Create function to archive old calls
CREATE OR REPLACE FUNCTION archive_old_calls()
RETURNS TABLE(
  archived_count INT,
  archived_ids UUID[]
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_archived_count INT;
  v_archived_ids UUID[];
BEGIN
  -- Archive calls that are completed or failed and haven't been updated in 30 days
  WITH archived AS (
    UPDATE pending_calls
    SET
      is_active = false,
      updated_at = NOW()
    WHERE
      workflow_state IN ('completed', 'failed')
      AND updated_at < NOW() - INTERVAL '30 days'
      AND is_active = true
    RETURNING id
  )
  SELECT
    COUNT(*)::INT,
    ARRAY_AGG(id)
  INTO v_archived_count, v_archived_ids
  FROM archived;

  -- Log the archival
  RAISE NOTICE 'Archived % calls: %', v_archived_count, v_archived_ids;

  -- Return results
  RETURN QUERY SELECT v_archived_count, v_archived_ids;
END;
$$;

-- Add helpful comment
COMMENT ON FUNCTION archive_old_calls() IS
  'Archives completed/failed calls that have not been updated in 30 days by setting is_active=false. Returns count and IDs of archived calls.';

-- Example usage:
-- SELECT * FROM archive_old_calls();

-- To set up automated archiving with pg_cron (run daily at 2 AM):
-- SELECT cron.schedule(
--   'archive-old-calls',
--   '0 2 * * *',  -- Every day at 2 AM UTC
--   $$SELECT archive_old_calls();$$
-- );

-- To check the cron job:
-- SELECT * FROM cron.job WHERE jobname = 'archive-old-calls';

-- To unschedule the job:
-- SELECT cron.unschedule('archive-old-calls');

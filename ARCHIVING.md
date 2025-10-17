# Call Archiving System

## Overview
The call archiving system automatically marks old completed/failed calls as inactive after 30 days of no updates. This keeps the dashboard clean and performant while preserving historical data.

## Database Schema

### `is_active` Column
- **Type**: `BOOLEAN`
- **Default**: `true`
- **Purpose**: Indicates whether a call record is active or archived
- **Location**: `pending_calls` table

```sql
ALTER TABLE pending_calls
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_pending_calls_is_active
ON pending_calls(is_active)
WHERE is_active = true;
```

## Archiving Rules

Calls are marked as inactive (`is_active = false`) when:
1. `workflow_state` is `'completed'` OR `'failed'`
2. AND `updated_at` is older than 30 days
3. AND `is_active` is currently `true`

## Archive Function

### `archive_old_calls()`
Location: `migrations/20251017-archive-old-calls-function.sql`

**Purpose**: Archives old completed/failed calls by setting `is_active = false`

**Returns**:
- `archived_count`: Number of calls archived
- `archived_ids`: Array of UUIDs of archived calls

**Example Usage**:
```sql
-- Run manually
SELECT * FROM archive_old_calls();

-- Example output:
-- archived_count | archived_ids
-- --------------|------------------------------------------
-- 15            | {uuid1, uuid2, uuid3, ...}
```

## Automated Archiving with pg_cron

### Setup

Run this in your Supabase SQL Editor to schedule daily archiving:

```sql
-- Schedule archiving to run daily at 2 AM UTC
SELECT cron.schedule(
  'archive-old-calls',
  '0 2 * * *',  -- Every day at 2 AM UTC
  $$SELECT archive_old_calls();$$
);
```

### Management

**Check if cron job exists**:
```sql
SELECT
  jobid,
  jobname,
  schedule,
  active,
  command
FROM cron.job
WHERE jobname = 'archive-old-calls';
```

**Disable the cron job** (keep it but don't run):
```sql
UPDATE cron.job
SET active = false
WHERE jobname = 'archive-old-calls';
```

**Enable the cron job**:
```sql
UPDATE cron.job
SET active = true
WHERE jobname = 'archive-old-calls';
```

**Delete the cron job**:
```sql
SELECT cron.unschedule('archive-old-calls');
```

**View cron job run history**:
```sql
SELECT
  jobid,
  runid,
  job_pid,
  database,
  username,
  command,
  status,
  return_message,
  start_time,
  end_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'archive-old-calls')
ORDER BY start_time DESC
LIMIT 10;
```

## Dashboard Integration

### Archive Filter
The dashboard includes an "Archive" filter with three states:
- **Active Only** (default): Shows only active calls
- **Inactive Only**: Shows only archived calls
- **Both**: Shows all calls

### How it works:
1. Filter selection is saved to localStorage
2. When changed, data is reloaded from database with appropriate filter
3. Filter state persists across sessions
4. Can be included in saved filter presets

## Manual Operations

### Archive specific calls
```sql
-- Archive a specific call
UPDATE pending_calls
SET is_active = false, updated_at = NOW()
WHERE id = 'YOUR_CALL_ID';

-- Archive multiple calls
UPDATE pending_calls
SET is_active = false, updated_at = NOW()
WHERE id IN ('call_id_1', 'call_id_2', 'call_id_3');
```

### Un-archive calls
```sql
-- Restore a specific call
UPDATE pending_calls
SET is_active = true, updated_at = NOW()
WHERE id = 'YOUR_CALL_ID';

-- Restore all calls from a specific date range
UPDATE pending_calls
SET is_active = true, updated_at = NOW()
WHERE created_at BETWEEN '2025-01-01' AND '2025-01-31'
AND is_active = false;
```

### Check archiving candidates
```sql
-- Preview calls that would be archived
SELECT
  id,
  employee_name,
  clinic_name,
  workflow_state,
  updated_at,
  AGE(NOW(), updated_at) as time_since_update
FROM pending_calls
WHERE
  workflow_state IN ('completed', 'failed')
  AND updated_at < NOW() - INTERVAL '30 days'
  AND is_active = true
ORDER BY updated_at ASC;
```

### Statistics
```sql
-- Count active vs inactive calls
SELECT
  is_active,
  workflow_state,
  COUNT(*) as count
FROM pending_calls
GROUP BY is_active, workflow_state
ORDER BY is_active DESC, workflow_state;

-- Archiving rate by month
SELECT
  DATE_TRUNC('month', updated_at) as month,
  COUNT(*) FILTER (WHERE is_active = false) as archived,
  COUNT(*) FILTER (WHERE is_active = true) as active,
  COUNT(*) as total
FROM pending_calls
WHERE workflow_state IN ('completed', 'failed')
GROUP BY DATE_TRUNC('month', updated_at)
ORDER BY month DESC
LIMIT 12;
```

## Performance Considerations

### Index Usage
The `idx_pending_calls_is_active` partial index is used for queries filtering by `is_active = true`, improving dashboard load times.

```sql
-- Check index usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE indexname = 'idx_pending_calls_is_active';
```

### Query Performance
```sql
-- Explain query plan for active calls
EXPLAIN ANALYZE
SELECT * FROM pending_calls
WHERE is_active = true
ORDER BY created_at DESC
LIMIT 50;
```

## Backup and Recovery

### Before bulk archiving
```sql
-- Create a backup of current is_active states
CREATE TABLE pending_calls_is_active_backup AS
SELECT id, is_active, updated_at
FROM pending_calls;

-- Restore from backup if needed
UPDATE pending_calls pc
SET
  is_active = backup.is_active,
  updated_at = backup.updated_at
FROM pending_calls_is_active_backup backup
WHERE pc.id = backup.id;

-- Drop backup when no longer needed
DROP TABLE pending_calls_is_active_backup;
```

## Monitoring

### Create a monitoring query
```sql
-- Daily archiving summary
SELECT
  CURRENT_DATE as report_date,
  COUNT(*) FILTER (WHERE is_active = false AND updated_at >= CURRENT_DATE - INTERVAL '1 day') as archived_today,
  COUNT(*) FILTER (WHERE is_active = true) as currently_active,
  COUNT(*) FILTER (WHERE is_active = false) as total_archived,
  COUNT(*) as total_calls
FROM pending_calls;
```

## Troubleshooting

### Cron job not running
```sql
-- Check if pg_cron extension is installed
SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- Check cron job configuration
SELECT * FROM cron.job WHERE jobname = 'archive-old-calls';

-- Check for errors in recent runs
SELECT *
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'archive-old-calls')
  AND status = 'failed'
ORDER BY start_time DESC
LIMIT 5;
```

### Function not working
```sql
-- Test function exists
SELECT proname, prosrc
FROM pg_proc
WHERE proname = 'archive_old_calls';

-- Test function manually
SELECT * FROM archive_old_calls();
```

### No calls being archived
```sql
-- Check if there are eligible calls
SELECT COUNT(*)
FROM pending_calls
WHERE
  workflow_state IN ('completed', 'failed')
  AND updated_at < NOW() - INTERVAL '30 days'
  AND is_active = true;

-- Check updated_at timestamps
SELECT
  workflow_state,
  MIN(updated_at) as oldest,
  MAX(updated_at) as newest,
  COUNT(*) as count
FROM pending_calls
WHERE workflow_state IN ('completed', 'failed')
  AND is_active = true
GROUP BY workflow_state;
```

## Best Practices

1. **Schedule during low-traffic hours**: Run archiving at 2 AM to minimize impact
2. **Monitor the first few runs**: Check `cron.job_run_details` to ensure it's working
3. **Test in staging first**: Run `archive_old_calls()` manually to preview results
4. **Keep backups**: Consider periodic backups before enabling automated archiving
5. **Review archived data**: Periodically check archived calls to ensure nothing important is hidden
6. **Adjust retention period**: If 30 days is too short/long, modify the INTERVAL in the function

## Migration Checklist

- [ ] Add `is_active` column to `pending_calls` table
- [ ] Create index on `is_active`
- [ ] Mark existing old calls as inactive (initial archiving)
- [ ] Create `archive_old_calls()` function
- [ ] Test function manually: `SELECT * FROM archive_old_calls();`
- [ ] Verify dashboard filter works with active/inactive calls
- [ ] Schedule pg_cron job for daily archiving
- [ ] Monitor first few automated runs
- [ ] Document any custom retention policies for team

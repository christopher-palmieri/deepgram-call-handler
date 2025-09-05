-- Force enable realtime for specific tables
-- Date: 2025-01-05

-- Method 1: Using ALTER PUBLICATION (if it exists)
DO $$ 
BEGIN
    -- Check if publication exists
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        -- Remove all tables first
        ALTER PUBLICATION supabase_realtime SET (publish = 'insert, update, delete');
        ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS pending_calls;
        ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS call_sessions;
        ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS ivr_events;
        ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS call_classifications;
        
        -- Add them back
        ALTER PUBLICATION supabase_realtime ADD TABLE pending_calls;
        ALTER PUBLICATION supabase_realtime ADD TABLE call_sessions;
        ALTER PUBLICATION supabase_realtime ADD TABLE ivr_events;
        ALTER PUBLICATION supabase_realtime ADD TABLE call_classifications;
    ELSE
        -- Create new publication with our tables
        CREATE PUBLICATION supabase_realtime FOR TABLE 
            pending_calls,
            call_sessions,
            ivr_events,
            call_classifications
        WITH (publish = 'insert, update, delete');
    END IF;
END $$;

-- Method 2: Direct replica identity setting (required for realtime)
ALTER TABLE pending_calls REPLICA IDENTITY FULL;
ALTER TABLE call_sessions REPLICA IDENTITY FULL;
ALTER TABLE ivr_events REPLICA IDENTITY FULL;
ALTER TABLE call_classifications REPLICA IDENTITY FULL;

-- Verify the publication includes our tables
SELECT 
    schemaname,
    tablename,
    pubname
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
AND schemaname = 'public'
ORDER BY tablename;

-- Check replica identity
SELECT 
    c.relname AS table_name,
    CASE c.relreplident
        WHEN 'd' THEN 'default'
        WHEN 'n' THEN 'nothing'
        WHEN 'f' THEN 'full'
        WHEN 'i' THEN 'index'
    END AS replica_identity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
AND c.relname IN ('pending_calls', 'call_sessions', 'ivr_events', 'call_classifications')
AND c.relkind = 'r';

-- Final check: Ensure RLS doesn't block realtime
ALTER TABLE pending_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivr_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_classifications ENABLE ROW LEVEL SECURITY;

-- Ensure authenticated users can receive realtime events
DROP POLICY IF EXISTS "Enable realtime for authenticated" ON pending_calls;
CREATE POLICY "Enable realtime for authenticated" ON pending_calls
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable realtime for authenticated" ON call_sessions;
CREATE POLICY "Enable realtime for authenticated" ON call_sessions
    FOR SELECT USING (true);

-- Show final status
SELECT 'Realtime should now be working. Test by updating a record in pending_calls.' as status;
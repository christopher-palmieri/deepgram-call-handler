-- Safely enable realtime for specific tables
-- Date: 2025-01-05
-- This does NOT drop any tables - it only manages the realtime publication

-- Step 1: Set REPLICA IDENTITY FULL (required for realtime to track changes)
-- This tells PostgreSQL to include all columns in the replication stream
ALTER TABLE pending_calls REPLICA IDENTITY FULL;
ALTER TABLE call_sessions REPLICA IDENTITY FULL;
ALTER TABLE ivr_events REPLICA IDENTITY FULL;
ALTER TABLE call_classifications REPLICA IDENTITY FULL;

-- Step 2: Check if tables are already in the publication
SELECT 
    'Current tables in realtime publication:' as info,
    schemaname,
    tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
AND schemaname = 'public';

-- Step 3: Add tables to the publication if they're not already there
-- This is the safe approach - only adds, doesn't remove
DO $$ 
BEGIN
    -- Check and add pending_calls
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'pending_calls'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE pending_calls;
        RAISE NOTICE 'Added pending_calls to realtime publication';
    ELSE
        RAISE NOTICE 'pending_calls already in realtime publication';
    END IF;

    -- Check and add call_sessions
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'call_sessions'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE call_sessions;
        RAISE NOTICE 'Added call_sessions to realtime publication';
    ELSE
        RAISE NOTICE 'call_sessions already in realtime publication';
    END IF;

    -- Check and add ivr_events
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'ivr_events'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE ivr_events;
        RAISE NOTICE 'Added ivr_events to realtime publication';
    ELSE
        RAISE NOTICE 'ivr_events already in realtime publication';
    END IF;

    -- Check and add call_classifications
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'call_classifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE call_classifications;
        RAISE NOTICE 'Added call_classifications to realtime publication';
    ELSE
        RAISE NOTICE 'call_classifications already in realtime publication';
    END IF;
END $$;

-- Step 4: Verify the configuration
SELECT 
    'Tables now in realtime publication:' as info,
    schemaname,
    tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
AND schemaname = 'public'
AND tablename IN ('pending_calls', 'call_sessions', 'ivr_events', 'call_classifications');

-- Step 5: Check replica identity is set correctly
SELECT 
    'Replica identity status:' as info,
    c.relname AS table_name,
    CASE c.relreplident
        WHEN 'd' THEN 'default (not good for realtime)'
        WHEN 'n' THEN 'nothing (not good for realtime)'
        WHEN 'f' THEN 'full (perfect for realtime!)'
        WHEN 'i' THEN 'index'
    END AS replica_identity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
AND c.relname IN ('pending_calls', 'call_sessions', 'ivr_events', 'call_classifications')
AND c.relkind = 'r';

-- Step 6: Final message
SELECT 'Realtime configuration complete. Tables are NOT dropped - only their realtime settings were updated.' as status;
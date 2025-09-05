-- Enable Realtime for tables
-- This ensures real-time subscriptions work properly

-- First, ensure the realtime publication exists
-- This creates it if it doesn't exist, or does nothing if it already exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

-- Add tables to the realtime publication
-- This enables real-time updates for these tables
ALTER PUBLICATION supabase_realtime ADD TABLE pending_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE call_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE ivr_events;
ALTER PUBLICATION supabase_realtime ADD TABLE call_classifications;

-- Verify realtime is enabled (this is just for checking)
SELECT 
    schemaname,
    tablename,
    'Enabled' as realtime_status
FROM 
    pg_publication_tables 
WHERE 
    pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename IN ('pending_calls', 'call_sessions', 'ivr_events', 'call_classifications');
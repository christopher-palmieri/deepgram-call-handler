-- Test and fix real-time functionality
-- Date: 2025-01-05

-- 1. First check if realtime publication exists and what tables are in it
SELECT 
    pubname,
    schemaname,
    tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime';

-- 2. Drop and recreate the publication to ensure it's set up correctly
DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime FOR ALL TABLES;

-- 3. Verify tables are now in the publication
SELECT 
    pubname,
    schemaname,
    tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
AND schemaname = 'public'
AND tablename IN ('pending_calls', 'call_sessions', 'ivr_events', 'call_classifications');

-- 4. Check current RLS policies
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename = 'pending_calls'
ORDER BY policyname;

-- 5. Ensure the authenticated policy exists and is correct
DROP POLICY IF EXISTS "Authenticated users can read pending_calls" ON pending_calls;

CREATE POLICY "Authenticated users can read pending_calls" 
ON pending_calls 
FOR SELECT 
TO authenticated
USING (true);  -- Simplified to just 'true' for testing

-- 6. Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON pending_calls TO authenticated;
GRANT SELECT ON call_sessions TO authenticated;
GRANT SELECT ON ivr_events TO authenticated;
GRANT SELECT ON call_classifications TO authenticated;

-- 7. Verify permissions
SELECT 
    grantee, 
    table_schema, 
    table_name, 
    privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
AND table_name = 'pending_calls'
AND grantee IN ('authenticated', 'anon')
ORDER BY grantee, privilege_type;
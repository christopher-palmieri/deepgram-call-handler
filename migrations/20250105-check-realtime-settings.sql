-- Comprehensive check of all realtime-related settings
-- Date: 2025-01-05

-- 1. Check if realtime extension is installed
SELECT 
    'Checking extensions:' as check_type,
    extname,
    extversion
FROM pg_extension 
WHERE extname IN ('pg_net', 'pgsodium', 'pg_graphql', 'pg_stat_statements', 'pgcrypto', 'pgjwt', 'uuid-ossp');

-- 2. Check publication exists and its properties
SELECT 
    'Publication details:' as check_type,
    pubname,
    puballtables,
    pubinsert,
    pubupdate,
    pubdelete
FROM pg_publication
WHERE pubname = 'supabase_realtime';

-- 3. Check what tables are in the publication
SELECT 
    'Tables in publication:' as check_type,
    schemaname,
    tablename,
    pubname
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY schemaname, tablename;

-- 4. Check replica identity for our tables
SELECT 
    'Replica identity:' as check_type,
    n.nspname as schema,
    c.relname as table_name,
    CASE c.relreplident
        WHEN 'd' THEN 'DEFAULT (won''t work for updates without primary key)'
        WHEN 'n' THEN 'NOTHING (won''t work for realtime)'
        WHEN 'f' THEN 'FULL (perfect for realtime)'
        WHEN 'i' THEN 'INDEX'
    END as replica_identity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
AND c.relname IN ('pending_calls', 'call_sessions', 'ivr_events', 'call_classifications')
AND c.relkind = 'r';

-- 5. Check RLS policies on pending_calls
SELECT 
    'RLS Policies on pending_calls:' as check_type,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'pending_calls';

-- 6. Check if RLS is enabled
SELECT 
    'RLS enabled status:' as check_type,
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('pending_calls', 'call_sessions', 'ivr_events', 'call_classifications');

-- 7. Check database parameters that might affect realtime
SELECT 
    'Database parameters:' as check_type,
    name,
    setting
FROM pg_settings
WHERE name IN ('wal_level', 'max_replication_slots', 'max_wal_senders', 'shared_preload_libraries')
ORDER BY name;

-- 8. Check if there are any active replication slots
SELECT 
    'Replication slots:' as check_type,
    slot_name,
    plugin,
    slot_type,
    active
FROM pg_replication_slots;

-- 9. Final status
SELECT 
    'Summary:' as status,
    'If tables are in publication with FULL replica identity and RLS policies allow SELECT for authenticated users, realtime should work. Check Supabase dashboard Settings > API > Realtime is enabled.' as message;
-- Supabase Row Level Security (RLS) Policies
-- This script enables RLS on all tables and creates policies that:
-- 1. Block ALL anonymous access (users not logged in)
-- 2. Allow authenticated users to READ all data
-- 3. Backend services using service_role_key bypass these policies entirely

-- ============================================
-- STEP 1: Enable RLS on all tables
-- ============================================
-- Once enabled, these tables will deny all access by default
-- until we create policies below

ALTER TABLE pending_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivr_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_classifications ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 2: Create READ policies for authenticated users
-- ============================================
-- These policies allow any logged-in user to read data
-- auth.uid() IS NOT NULL means the user is authenticated

-- Policy for pending_calls table
CREATE POLICY "Authenticated users can read pending_calls" 
ON pending_calls 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

-- Policy for call_sessions table
CREATE POLICY "Authenticated users can read call_sessions" 
ON call_sessions 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

-- Policy for ivr_events table
CREATE POLICY "Authenticated users can read ivr_events" 
ON ivr_events 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

-- Policy for call_classifications table
CREATE POLICY "Authenticated users can read call_classifications" 
ON call_classifications 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

-- ============================================
-- IMPORTANT NOTES:
-- ============================================
-- 1. We're NOT creating INSERT/UPDATE/DELETE policies for the anon key
--    This means frontend users cannot modify data (good for security)
--
-- 2. Backend services using service_role_key are NOT affected
--    They bypass RLS entirely and maintain full access
--
-- 3. To verify RLS is working:
--    - Try accessing /api/config in an incognito window (should fail)
--    - Log in and try again (should work)
--
-- 4. To check current RLS status in Supabase:
--    SELECT tablename, rowsecurity 
--    FROM pg_tables 
--    WHERE schemaname = 'public';
--
-- 5. To view existing policies:
--    SELECT * FROM pg_policies WHERE schemaname = 'public';
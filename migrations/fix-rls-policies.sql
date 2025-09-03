-- ============================================
-- FIX RLS POLICIES - REMOVE PUBLIC ACCESS
-- ============================================
-- This script removes the insecure "Allow public read access" policies
-- and replaces them with secure authenticated-only policies

-- ============================================
-- STEP 1: DROP ALL EXISTING PUBLIC ACCESS POLICIES
-- ============================================
-- These policies with "using (true)" allow ANYONE to read data
-- They must be removed immediately!

DROP POLICY IF EXISTS "Allow public read access" ON pending_calls;
DROP POLICY IF EXISTS "Allow public read access" ON call_sessions;
DROP POLICY IF EXISTS "Allow public read access" ON ivr_events;
DROP POLICY IF EXISTS "Allow public read access" ON call_classifications;

-- Also drop any other permissive public policies (common variations)
DROP POLICY IF EXISTS "Enable read access for all users" ON pending_calls;
DROP POLICY IF EXISTS "Enable read access for all users" ON call_sessions;
DROP POLICY IF EXISTS "Enable read access for all users" ON ivr_events;
DROP POLICY IF EXISTS "Enable read access for all users" ON call_classifications;

DROP POLICY IF EXISTS "Public read access" ON pending_calls;
DROP POLICY IF EXISTS "Public read access" ON call_sessions;
DROP POLICY IF EXISTS "Public read access" ON ivr_events;
DROP POLICY IF EXISTS "Public read access" ON call_classifications;

-- ============================================
-- STEP 2: DROP OUR PREVIOUS POLICIES (if they exist)
-- ============================================
-- Clean slate approach - remove and recreate

DROP POLICY IF EXISTS "Authenticated users can read pending_calls" ON pending_calls;
DROP POLICY IF EXISTS "Authenticated users can read call_sessions" ON call_sessions;
DROP POLICY IF EXISTS "Authenticated users can read ivr_events" ON ivr_events;
DROP POLICY IF EXISTS "Authenticated users can read call_classifications" ON call_classifications;

-- ============================================
-- STEP 3: CREATE SECURE AUTHENTICATED-ONLY POLICIES
-- ============================================
-- These policies ONLY allow logged-in users to read data
-- auth.uid() IS NOT NULL ensures user must be authenticated

CREATE POLICY "Authenticated users can read pending_calls" 
ON pending_calls 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read call_sessions" 
ON call_sessions 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read ivr_events" 
ON ivr_events 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read call_classifications" 
ON call_classifications 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

-- ============================================
-- STEP 4: ENSURE RLS IS ENABLED
-- ============================================
-- Make sure RLS is actually turned on for all tables

ALTER TABLE pending_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ivr_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_classifications ENABLE ROW LEVEL SECURITY;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Run these after applying the above to confirm it worked:

-- Check that RLS is enabled:
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('pending_calls', 'call_sessions', 'ivr_events', 'call_classifications');

-- Check that only authenticated policies exist:
SELECT tablename, policyname, qual 
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename IN ('pending_calls', 'call_sessions', 'ivr_events', 'call_classifications');

-- Expected result: Should only show policies with "(auth.uid() IS NOT NULL)" in the qual column
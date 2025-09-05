-- Fix RLS policy for authenticated users
-- The policy should be TO authenticated, not TO public

-- Drop the existing incorrect policy
DROP POLICY IF EXISTS "Authenticated users can read pending_calls" ON pending_calls;

-- Create the correct policy for authenticated users
CREATE POLICY "Authenticated users can read pending_calls" 
ON pending_calls 
FOR SELECT 
TO authenticated
USING (auth.uid() IS NOT NULL);

-- Also ensure the same for other tables
DROP POLICY IF EXISTS "Authenticated users can read call_sessions" ON call_sessions;
CREATE POLICY "Authenticated users can read call_sessions" 
ON call_sessions 
FOR SELECT 
TO authenticated
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can read ivr_events" ON ivr_events;
CREATE POLICY "Authenticated users can read ivr_events" 
ON ivr_events 
FOR SELECT 
TO authenticated
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can read call_classifications" ON call_classifications;
CREATE POLICY "Authenticated users can read call_classifications" 
ON call_classifications 
FOR SELECT 
TO authenticated
USING (auth.uid() IS NOT NULL);

-- Verify the policies are correct
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
AND tablename IN ('pending_calls', 'call_sessions', 'ivr_events', 'call_classifications')
ORDER BY tablename, policyname;
-- Add INSERT and UPDATE RLS policies for authenticated users
-- This allows the New Pending Call form and other frontend operations to work

-- ============================================
-- PENDING_CALLS - INSERT Policy
-- ============================================
-- Allow authenticated users to create new pending calls

DROP POLICY IF EXISTS "Authenticated users can insert pending_calls" ON pending_calls;
CREATE POLICY "Authenticated users can insert pending_calls"
ON pending_calls
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- PENDING_CALLS - UPDATE Policy
-- ============================================
-- Allow authenticated users to update pending calls

DROP POLICY IF EXISTS "Authenticated users can update pending_calls" ON pending_calls;
CREATE POLICY "Authenticated users can update pending_calls"
ON pending_calls
FOR UPDATE
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- CALL_CLASSIFICATIONS - INSERT Policy
-- ============================================
-- Allow authenticated users to create call classifications

DROP POLICY IF EXISTS "Authenticated users can insert call_classifications" ON call_classifications;
CREATE POLICY "Authenticated users can insert call_classifications"
ON call_classifications
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- CALL_CLASSIFICATIONS - UPDATE Policy
-- ============================================
-- Allow authenticated users to update call classifications

DROP POLICY IF EXISTS "Authenticated users can update call_classifications" ON call_classifications;
CREATE POLICY "Authenticated users can update call_classifications"
ON call_classifications
FOR UPDATE
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- Verify the policies were created
-- ============================================
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('pending_calls', 'call_classifications')
ORDER BY tablename, cmd, policyname;

# RLS Policy Review & Status

## Current RLS Configuration

### Tables with RLS Enabled
1. ✅ `pending_calls`
2. ✅ `call_sessions`
3. ✅ `ivr_events`
4. ✅ `call_classifications`

---

## Current Policies by Table

### 1. `pending_calls`

| Operation | Policy Name | Roles | Status |
|-----------|-------------|-------|--------|
| SELECT | Authenticated users can read pending_calls | authenticated | ✅ Active |
| INSERT | Authenticated users can insert pending_calls | authenticated | ✅ Active |
| UPDATE | Authenticated users can update pending_calls | authenticated | ✅ Active |
| DELETE | None | - | ⚠️ No DELETE policy |

**Frontend Operations:**
- ✅ SELECT: Dashboard loads all pending calls
- ✅ INSERT: New Pending Call form creates rows
- ✅ UPDATE: Archive/unarchive functionality, status updates
- ❌ DELETE: Not used in frontend

**Recommendation:** ✅ **Good as-is** - No DELETE policy needed since frontend doesn't delete rows.

---

### 2. `call_sessions`

| Operation | Policy Name | Roles | Status |
|-----------|-------------|-------|--------|
| SELECT | Authenticated users can read call_sessions | authenticated | ✅ Active |
| INSERT | None | - | ⚠️ No INSERT policy |
| UPDATE | None | - | ⚠️ No UPDATE policy |
| DELETE | None | - | ⚠️ No DELETE policy |

**Frontend Operations:**
- ✅ SELECT: Dashboard loads call sessions for display
- ❌ INSERT: Backend only (via service_role_key)
- ❌ UPDATE: Backend only (via service_role_key)
- ❌ DELETE: Not used

**Recommendation:** ✅ **Good as-is** - Frontend only reads, backend handles writes.

---

### 3. `ivr_events`

| Operation | Policy Name | Roles | Status |
|-----------|-------------|-------|--------|
| SELECT | Authenticated users can read ivr_events | authenticated | ✅ Active |
| INSERT | None | - | ⚠️ No INSERT policy |
| UPDATE | None | - | ⚠️ No UPDATE policy |
| DELETE | None | - | ⚠️ No DELETE policy |

**Frontend Operations:**
- ✅ SELECT: Monitor page displays IVR events
- ❌ INSERT: Backend only (via service_role_key)
- ❌ UPDATE: Not used
- ❌ DELETE: Not used

**Recommendation:** ✅ **Good as-is** - Frontend only reads, backend handles writes.

---

### 4. `call_classifications`

| Operation | Policy Name | Roles | Status |
|-----------|-------------|-------|--------|
| SELECT | Authenticated users can read call_classifications | authenticated | ✅ Active |
| INSERT | Authenticated users can insert call_classifications | authenticated | ✅ Active |
| UPDATE | Authenticated users can update call_classifications | authenticated | ✅ Active |
| DELETE | None | - | ⚠️ No DELETE policy |

**Frontend Operations:**
- ✅ SELECT: Dashboard loads classifications for display
- ✅ INSERT: Classification modal creates new classifications
- ✅ UPDATE: Classification modal edits existing classifications
- ❌ DELETE: Not used in frontend

**Recommendation:** ✅ **Good as-is** - No DELETE policy needed since frontend doesn't delete rows.

---

## Security Assessment

### ✅ Strengths

1. **No Anonymous Access**
   - All tables require authentication (`auth.uid() IS NOT NULL`)
   - Anonymous users cannot read or write any data

2. **Appropriate Permissions**
   - Frontend has INSERT/UPDATE only where needed (pending_calls, call_classifications)
   - Read-only access to call_sessions and ivr_events (appropriate since backend manages these)

3. **Backend Unaffected**
   - Service role key bypasses RLS entirely
   - All webhook endpoints and edge functions work normally

4. **No DELETE Policies**
   - Good security practice - prevents accidental data deletion from frontend
   - Backend can still delete using service_role_key if needed

### ⚠️ Potential Improvements

1. **Consider Row-Level Ownership (Future)**
   - Current: All authenticated users can see/edit all rows
   - Future: Add user_id column and restrict users to their own data
   - Example: `USING (created_by = auth.uid())`

2. **Add Role-Based Access (Future)**
   - Current: All authenticated users have same permissions
   - Future: Differentiate between admin and regular users
   - Example: Only admins can update classifications

3. **Add Audit Logging (Future)**
   - Track who created/modified rows
   - Add `created_by`, `updated_by` columns
   - Automatically populate using `auth.uid()`

---

## Migration History

| Date | File | Description |
|------|------|-------------|
| Initial | `supabase-rls-policies.sql` | Enabled RLS, added SELECT policies |
| Later | `fix-rls-policies.sql` | Removed public access, secured SELECT policies |
| 2025-01-05 | `20250105-fix-rls-authenticated-policy.sql` | Fixed TO authenticated clause |
| 2025-10-24 | `20251024-add-insert-update-rls-policies.sql` | Added INSERT/UPDATE for pending_calls & call_classifications |

---

## Verification Queries

Run these in Supabase SQL Editor to verify current state:

### 1. Check RLS is Enabled
```sql
SELECT
    tablename,
    rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('pending_calls', 'call_sessions', 'ivr_events', 'call_classifications')
ORDER BY tablename;
```

**Expected:** All should show `rowsecurity = true`

---

### 2. View All Policies
```sql
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles::text[] AS roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('pending_calls', 'call_sessions', 'ivr_events', 'call_classifications')
ORDER BY tablename, cmd, policyname;
```

**Expected Policies:**
- pending_calls: SELECT, INSERT, UPDATE (all TO authenticated)
- call_sessions: SELECT (TO authenticated)
- ivr_events: SELECT (TO authenticated)
- call_classifications: SELECT, INSERT, UPDATE (all TO authenticated)

---

### 3. Test Anonymous Access is Blocked
```sql
-- Switch to anon role
SET ROLE anon;

-- Try to query data (should fail or return empty)
SELECT COUNT(*) FROM pending_calls;

-- Reset to authenticated
RESET ROLE;
```

**Expected:** No rows returned or permission denied

---

## Recommendations

### ✅ Current State: SECURE & APPROPRIATE

Your RLS policies are well-configured for your current needs:

1. ✅ **Authentication Required** - All access requires login
2. ✅ **Appropriate Permissions** - Frontend has only what it needs
3. ✅ **Backend Unaffected** - Service role key bypasses RLS
4. ✅ **No DELETE Risk** - Frontend cannot delete data

### 🔮 Future Enhancements (Optional)

Consider these as your system grows:

1. **User-Specific Data Isolation**
   ```sql
   -- Add to pending_calls
   ALTER TABLE pending_calls ADD COLUMN created_by UUID REFERENCES auth.users(id);

   -- Update policies to restrict access
   CREATE POLICY "Users see only their calls"
   ON pending_calls FOR SELECT
   TO authenticated
   USING (created_by = auth.uid() OR auth.jwt() ->> 'role' = 'admin');
   ```

2. **Role-Based Access Control**
   ```sql
   -- Admin-only update policy
   CREATE POLICY "Only admins can update classifications"
   ON call_classifications FOR UPDATE
   TO authenticated
   USING (auth.jwt() ->> 'role' = 'admin')
   WITH CHECK (auth.jwt() ->> 'role' = 'admin');
   ```

3. **Audit Trail**
   ```sql
   -- Add audit columns
   ALTER TABLE pending_calls
   ADD COLUMN created_by UUID REFERENCES auth.users(id),
   ADD COLUMN updated_by UUID REFERENCES auth.users(id);

   -- Use triggers to auto-populate
   CREATE TRIGGER set_created_by
   BEFORE INSERT ON pending_calls
   FOR EACH ROW EXECUTE FUNCTION set_created_by();
   ```

---

## Summary

**Overall Security Rating: ✅ GOOD**

Your RLS policies are:
- ✅ Secure (no anonymous access)
- ✅ Appropriate (right permissions for each table)
- ✅ Maintainable (clear naming, well-documented)
- ✅ Production-ready (no critical gaps)

**No immediate changes needed.** Consider the future enhancements only if you need user-specific data isolation or role-based access control.

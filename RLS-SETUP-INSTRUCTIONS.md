# Row Level Security (RLS) Setup Instructions

## Overview
This will enable Row Level Security to prevent anonymous users from accessing your database while allowing authenticated users to read data.

## How to Apply the RLS Policies

### Option 1: Supabase Dashboard (Recommended)
1. Go to your Supabase Dashboard
2. Navigate to **SQL Editor** (in the left sidebar)
3. Click **New Query**
4. Copy the entire contents of `supabase-rls-policies.sql`
5. Paste it into the SQL editor
6. Click **Run** (or press Ctrl/Cmd + Enter)
7. You should see success messages for each ALTER TABLE and CREATE POLICY command

### Option 2: Supabase CLI
```bash
# If you have Supabase CLI installed
supabase db push --file supabase-rls-policies.sql
```

## What This Does

### Before RLS (Current State - INSECURE):
- ❌ Anyone with your URL can read all data without logging in
- ❌ Database is completely exposed through the anon key

### After RLS (SECURE):
- ✅ Anonymous users cannot read any data
- ✅ Logged-in users can read (but not modify) data
- ✅ Backend services continue working normally

## Testing After Implementation

### 1. Test Anonymous Access is Blocked
```bash
# Open an incognito/private browser window
# Navigate to your app
# Open DevTools Console and run:
fetch('/api/config')
  .then(r => r.json())
  .then(config => {
    // Try to query the database without auth
    const supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    return supabase.from('pending_calls').select('*');
  })
  .then(result => console.log('Result:', result));

# Expected: Should return empty data or error
```

### 2. Test Authenticated Access Works
1. Log in to your application normally
2. Navigate to dashboard or monitor pages
3. Verify that data loads correctly
4. Check browser console for any errors

### 3. Test Backend Services Still Work
1. Trigger a webhook from Twilio/Vapi
2. Check that data is still being inserted
3. Verify monitor updates are working

## Rollback (If Needed)

If something breaks, you can temporarily disable RLS:

```sql
-- Disable RLS (returns to current insecure state)
ALTER TABLE pending_calls DISABLE ROW LEVEL SECURITY;
ALTER TABLE call_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE ivr_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE call_classifications DISABLE ROW LEVEL SECURITY;
```

## Important Notes

1. **Backend services are NOT affected** - They use service_role_key which bypasses RLS
2. **This is a read-only setup** - Frontend can read but not write data
3. **MFA/Auth still works** - Supabase auth tables have their own RLS policies

## Future Improvements

Once this basic RLS is working, consider:
1. User-specific policies (users only see their own data)
2. Role-based access (admin vs regular users)
3. Moving database queries to backend API endpoints
4. Removing the `/api/config` endpoint entirely

## Questions?

- RLS Documentation: https://supabase.com/docs/guides/auth/row-level-security
- Test in development first if possible
- Monitor your application logs after deployment
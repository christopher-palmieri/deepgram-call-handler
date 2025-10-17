# Reset Call Feature - Deployment Guide

## Overview
The reset call feature allows users to retry failed or completed calls from the monitor UI. This feature resets the call back to initial state while optionally preserving the IVR classification.

## Implementation Complete ✅

### Files Created/Modified:
1. ✅ `supabase-functions/reset-call.ts` - Edge function
2. ✅ `public/monitor.html` - UI button and modal
3. ✅ `public/scripts/call-monitor.js` - JavaScript handlers

## Deployment Steps

### 1. Deploy Edge Function to Supabase

```bash
# Navigate to project directory
cd /workspaces/deepgram-call-handler

# Deploy the reset-call edge function
supabase functions deploy reset-call

# Verify deployment
supabase functions list
```

**Expected Output:**
```
┌─────────────┬────────────────────────────────────────────┬─────────┬──────────────────────┐
│ NAME        │ URL                                        │ VERSION │ CREATED AT           │
├─────────────┼────────────────────────────────────────────┼─────────┼──────────────────────┤
│ reset-call  │ https://YOUR_PROJECT.supabase.co/...       │ 1       │ 2025-10-17 19:XX:XX │
└─────────────┴────────────────────────────────────────────┴─────────┴──────────────────────┘
```

### 2. Verify Edge Function Configuration

The edge function requires these environment variables (automatically provided by Supabase):
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for database access

These are configured automatically in the Supabase dashboard under **Settings > Edge Functions**.

### 3. Deploy Frontend Changes

The UI changes are already in the codebase:
- Monitor page button: `public/monitor.html:81`
- Confirmation modal: `public/monitor.html:161-193`
- JavaScript functions: `public/scripts/call-monitor.js:2066-2157`

If you're using a static hosting service, deploy the updated files:

```bash
# For GitHub Pages, Netlify, Vercel, etc.
git add .
git commit -m "Add reset call functionality with edge function"
git push origin main
```

## Testing Guide

### Test Case 1: Reset Call with Classification Kept (Default)

**Prerequisites:**
- A completed or failed call in the database
- User logged into the monitor page

**Steps:**
1. Open monitor page: `http://localhost:3000/monitor.html`
2. Dashboard will show call session(s)
3. If call details are visible, you'll see "Reset & Retry Call" button
4. Click the "Reset & Retry Call" button
5. Modal should open showing:
   - Employee name
   - Clinic name
   - List of actions to be performed
   - Checkbox "Also clear classification" (unchecked)
6. Click "Reset & Retry" button
7. Button should show loading state: "⏳ Resetting..."
8. Success message should appear
9. Modal should close
10. Call details should reload showing updated state

**Expected Database Changes:**
```sql
-- Query to verify changes
SELECT
    id,
    workflow_state,     -- Should be 'new'
    is_active,          -- Should be true
    call_status,        -- Should be 'pending'
    retry_count,        -- Should be 0
    classification_id,  -- Should be preserved (not null if was classified)
    summary,            -- Should be null
    success_evaluation, -- Should be null
    last_error,         -- Should be null
    last_attempt_at     -- Should be null
FROM pending_calls
WHERE id = 'YOUR_CALL_ID';
```

**Expected Results:**
- ✅ `workflow_state` = `'new'`
- ✅ `is_active` = `true`
- ✅ `call_status` = `'pending'`
- ✅ `retry_count` = `0`
- ✅ `classification_id` = (preserved - same as before)
- ✅ `summary` = `null`
- ✅ `success_evaluation` = `null`
- ✅ `structured_data` = `null`
- ✅ `last_error` = `null`
- ✅ `last_attempt_at` = `null`
- ✅ `vapi_call_id` = `null`
- ✅ `triggered` = `false`

### Test Case 2: Reset Call with Classification Cleared

**Steps:**
1. Open monitor page
2. Click "Reset & Retry Call" button
3. Modal opens
4. **Check the checkbox** "Also clear classification"
5. Click "Reset & Retry" button
6. Success message appears
7. Modal closes
8. Call details reload

**Expected Database Changes:**
All same as Test Case 1, PLUS:
- ✅ `classification_id` = `null`
- ✅ `classification_type` = `null`
- ✅ `classification_checked_at` = `null`
- ✅ `classification_lookup_at` = `null`

### Test Case 3: Scheduler Picks Up Reset Call

**Prerequisites:**
- Call successfully reset in Test Case 1 or 2
- Scheduler is running (`node deepgram-listener.js`)

**Steps:**
1. Monitor scheduler logs
2. Wait for next scheduler cycle (every 30 seconds)
3. Scheduler should pick up the reset call

**Expected Scheduler Behavior:**
```
Processing call for [Employee Name] - [Clinic Name]
Checking classification for [Employee Name] - [Clinic Name]...
[If classification exists] Found classification: [clinic_id]
[If no classification] Triggering pre-classification call...
```

**Verification:**
```sql
-- Check that call progressed to next state
SELECT
    id,
    workflow_state,
    last_attempt_at,
    triggered
FROM pending_calls
WHERE id = 'YOUR_CALL_ID';
```

Expected after scheduler runs:
- `workflow_state` should progress from `'new'` to appropriate next state
- `last_attempt_at` should be updated
- If classification exists: call should trigger
- If no classification: pre-classification should trigger

### Test Case 4: Error Handling

**Test 4a: Not Authenticated**
1. Log out of monitor page
2. Try to access reset button
3. Should show error: "Not authenticated"

**Test 4b: Invalid Call ID**
1. Manually call edge function with invalid ID:
```javascript
fetch(`${config.supabaseUrl}/functions/v1/reset-call`, {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({ callId: 'invalid-id' })
})
```
2. Should return error: "Call not found" (404)

**Test 4c: Network Error**
1. Disable network
2. Try to reset call
3. Should show error: "Failed to reset call: [error message]"
4. Button should re-enable after error

## Edge Function API Reference

### Endpoint
```
POST https://YOUR_PROJECT.supabase.co/functions/v1/reset-call
```

### Headers
```
Authorization: Bearer {access_token}
Content-Type: application/json
```

### Request Body
```json
{
  "callId": "uuid-of-pending-call",
  "keepClassification": true  // optional, defaults to true
}
```

### Response (Success)
```json
{
  "success": true,
  "message": "Call reset successfully for John Doe - ABC Clinic",
  "data": {
    "id": "uuid-of-pending-call",
    "workflow_state": "new",
    "call_status": "pending",
    "classification_id": "uuid-or-null",
    "employee_name": "John Doe",
    "clinic_name": "ABC Clinic"
  }
}
```

### Response (Error)
```json
{
  "error": "Error message"
}
```

### Status Codes
- `200` - Success
- `400` - Bad request (missing callId)
- `401` - Unauthorized (missing/invalid auth token)
- `404` - Call not found
- `500` - Internal server error

## Manual Testing with curl

```bash
# Get your access token from browser console:
# supabase.auth.getSession().then(d => console.log(d.data.session.access_token))

export TOKEN="your-access-token-here"
export SUPABASE_URL="https://your-project.supabase.co"
export CALL_ID="uuid-of-call-to-reset"

# Test 1: Reset with classification kept (default)
curl -X POST \
  "${SUPABASE_URL}/functions/v1/reset-call" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"callId\": \"${CALL_ID}\"}"

# Test 2: Reset with classification cleared
curl -X POST \
  "${SUPABASE_URL}/functions/v1/reset-call" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"callId\": \"${CALL_ID}\", \"keepClassification\": false}"
```

## Monitoring and Debugging

### View Edge Function Logs
```bash
# View real-time logs
supabase functions logs reset-call --follow

# View recent logs
supabase functions logs reset-call --limit 100
```

### Check Database Updates
```sql
-- View recent resets
SELECT
    id,
    employee_name,
    clinic_name,
    workflow_state,
    retry_count,
    classification_id,
    updated_at
FROM pending_calls
WHERE updated_at > NOW() - INTERVAL '1 hour'
    AND workflow_state = 'new'
    AND retry_count = 0
ORDER BY updated_at DESC;
```

### Browser Console Debugging
Open browser DevTools console and monitor:
```javascript
// Check if functions are loaded
console.log(window.showResetCallModal);
console.log(window.confirmResetCall);

// Test edge function directly
const { data: { session } } = await supabase.auth.getSession();
const response = await fetch(`${config.supabaseUrl}/functions/v1/reset-call`, {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        callId: 'YOUR_CALL_ID',
        keepClassification: true
    })
});
console.log(await response.json());
```

## Troubleshooting

### Issue: "Function not found" error
**Solution:** Deploy the edge function:
```bash
supabase functions deploy reset-call
```

### Issue: "Not authenticated" error
**Solution:**
1. Ensure user is logged in
2. Check that session token is valid
3. Verify Authorization header is correctly set

### Issue: Modal doesn't open
**Solution:**
1. Check browser console for JavaScript errors
2. Verify `call-monitor.js` is loaded
3. Check that `currentPendingCall` is set:
```javascript
console.log(currentPendingCall);
```

### Issue: Reset succeeds but call not picked up by scheduler
**Solution:**
1. Verify scheduler is running: `pm2 list` or check process
2. Check scheduler logs for errors
3. Verify `workflow_state = 'new'` and `is_active = true`
4. Check `next_action_at` is in the past

### Issue: Classification cleared even with checkbox unchecked
**Solution:**
1. Check edge function logs
2. Verify `keepClassification` parameter is being sent correctly
3. Test edge function directly with curl to isolate UI vs backend issue

## Security Considerations

1. **Authentication Required**: Edge function verifies user authentication via Bearer token
2. **Authorization**: Uses service role key to update database (bypasses RLS)
3. **Input Validation**: Validates `callId` parameter exists
4. **CORS Enabled**: Allows requests from any origin (adjust if needed for production)

### Recommended Production Security Enhancements

```typescript
// Add user authorization check (example)
const { data: userProfile } = await supabase
  .from('user_profiles')
  .select('role')
  .eq('user_id', user.id)
  .single();

if (userProfile.role !== 'admin' && userProfile.role !== 'manager') {
  return new Response(
    JSON.stringify({ error: 'Insufficient permissions' }),
    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
```

## Next Steps

After successful deployment and testing:

1. ✅ Monitor edge function usage and performance
2. ✅ Add reset action to audit log (future enhancement)
3. ✅ Consider adding bulk reset functionality (future enhancement)
4. ✅ Add reset count tracking to prevent abuse (future enhancement)
5. ✅ Consider adding "Reset History" view (future enhancement)

## Related Documentation

- [ARCHIVING.md](./ARCHIVING.md) - Call archiving system documentation
- [classification-readme.md](./classification-readme.md) - IVR classification system
- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)

## Support

If you encounter issues:
1. Check edge function logs: `supabase functions logs reset-call`
2. Check browser console for JavaScript errors
3. Verify database schema matches expected structure
4. Test edge function directly with curl to isolate issues

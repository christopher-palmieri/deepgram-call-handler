# Next Steps for System Refinement

## Priority 1: Core Functionality Improvements

### 1. IVR_then_human Cleanup
**Current Issue**: The `ivr_then_human` classification type exists but may not be fully implemented in all workflows.

**Tasks**:
- [ ] Review how `ivr_then_human` is handled differently from `ivr_only`
- [ ] Determine if both types should follow the same workflow (likely yes)
- [ ] Update classification logic if needed to merge handling
- [ ] Test with real clinics that have "Press 1 to continue" then transfer to human
- [ ] Document the specific behavior expected for this type

**Code Locations**:
- `modules/classifiers/openai-classifier.js` - Classification logic
- `server_deepgram.js` - storeFinalClassification function
- `api/twilio/preclassify-twiml.js` - IVR action generation

### 2. Test More Use Cases
**Goal**: Ensure system handles edge cases gracefully

**Test Scenarios**:
- [ ] Clinic with multiple menu levels (nested IVR)
- [ ] Clinic that requires speech input instead of DTMF
- [ ] Direct to voicemail scenarios
- [ ] Busy signals and network failures
- [ ] Long hold times before human answers
- [ ] Clinics with callback systems
- [ ] International phone numbers
- [ ] After-hours messages

**Testing Approach**:
1. Create test pending_calls for each scenario
2. Set workflow_state to 'new'
3. Monitor progression through states
4. Document any failures or unexpected behaviors
5. Add handling for discovered edge cases

## Priority 2: Security Hardening

### 3. Secure RLS (Row Level Security) for Each Table

**Current State**: Tables likely using service role key without RLS

**Implementation Plan**:

#### pending_calls Table
```sql
-- Enable RLS
ALTER TABLE pending_calls ENABLE ROW LEVEL SECURITY;

-- Policy for service role (full access)
CREATE POLICY "Service role full access" ON pending_calls
FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Policy for authenticated users (read their own org's calls)
CREATE POLICY "Users see own org calls" ON pending_calls
FOR SELECT USING (
  auth.uid() IN (
    SELECT user_id FROM org_users 
    WHERE org_id = pending_calls.org_id
  )
);
```

#### call_sessions Table
```sql
ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON call_sessions
FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Users see related sessions" ON call_sessions
FOR SELECT USING (
  pending_call_id IN (
    SELECT id FROM pending_calls 
    WHERE -- user has access to pending_call
  )
);
```

#### call_classifications Table
```sql
ALTER TABLE call_classifications ENABLE ROW LEVEL SECURITY;

-- Classifications are shared across org
CREATE POLICY "Service role full access" ON call_classifications
FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Read all classifications" ON call_classifications
FOR SELECT USING (true);  -- All users can benefit from classifications

CREATE POLICY "Service creates classifications" ON call_classifications
FOR INSERT WITH CHECK (auth.jwt() ->> 'role' = 'service_role');
```

#### ivr_events Table
```sql
ALTER TABLE ivr_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON ivr_events
FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
```

**Testing RLS**:
- [ ] Create test user accounts
- [ ] Verify users can only see appropriate data
- [ ] Test service role maintains full access
- [ ] Ensure edge functions still work with RLS enabled

## Priority 3: Database Cleanup

### 4. Remove Unnecessary Table Columns

**Audit Columns for Removal**:

#### pending_calls Table
Potentially unused columns:
- [ ] `classification_type` (duplicated by classification_id reference)
- [ ] `classification_checked_at` (use classification_lookup_at)
- [ ] `vapi_call_id` (might be in call_sessions instead)
- [ ] Review if all workflow_metadata fields are being used

#### call_sessions Table  
Potentially unused columns:
- [ ] `websocket_mode`
- [ ] `conference_id`, `conference_created`, `conference_sid` (if not using conference mode)
- [ ] `vapi_*` fields if tracked elsewhere
- [ ] Various `*_at` timestamps that duplicate created_at/updated_at

**Approach**:
1. Query each column to see if data exists
2. Check code references for each column
3. Create migration to drop unused columns
4. Consider creating archive table for historical data

```sql
-- Check column usage
SELECT 
  'pending_calls' as table_name,
  'classification_type' as column_name,
  COUNT(*) FILTER (WHERE classification_type IS NOT NULL) as non_null_count,
  COUNT(*) as total_rows
FROM pending_calls
UNION ALL
-- Repeat for each column to audit
```

## Priority 4: Code Cleanup

### 5. Move Unused Scripts (Both Repos)

**Vercel Repository** (`api/twilio/`):
Review and archive:
- [ ] Old TwiML handlers (deepgram-handler.js, deepgram-twiml.js, etc.)
- [ ] Test endpoints (direct-vapi-test.js, debug-conference.js)
- [ ] Unused conference-related endpoints
- [ ] Alternative implementation attempts

**Railway Repository** (`modules/`):
Review and archive:
- [ ] Unused sink managers
- [ ] Alternative classification approaches
- [ ] Test configurations
- [ ] Deprecated database loggers

**Organization Structure**:
```
/archive
  /2025-01-legacy
    /twilio-endpoints
    /websocket-modules
  /test-implementations
  /deprecated-features
```

### 6. Move Unused Edge Functions in Supabase

**Current Edge Functions**:
- [ ] Identify all deployed functions: `supabase functions list`
- [ ] Document which are active vs. test functions
- [ ] Archive unused function code
- [ ] Delete test functions from Supabase

**Suggested Approach**:
```bash
# List all functions
supabase functions list

# Download function code before deletion
supabase functions download function-name

# Delete unused function
supabase functions delete function-name
```

## Priority 5: Future Enhancements

### 7. Performance Optimizations
- [ ] Implement connection pooling for database
- [ ] Add Redis caching for classifications
- [ ] Optimize Deepgram configuration for faster classification
- [ ] Consider moving to streaming TwiML for lower latency

### 8. Monitoring & Alerting
- [ ] Set up error alerting for failed calls
- [ ] Create dashboard for success rates by clinic
- [ ] Monitor classification accuracy
- [ ] Track retry success rates
- [ ] Alert on stuck workflow states

### 9. Feature Additions
- [ ] Support for SMS fallback
- [ ] Email notifications for No Show results  
- [ ] Bulk upload for pending calls
- [ ] Classification override interface
- [ ] Manual retry trigger UI
- [ ] Analytics dashboard

### 10. Documentation
- [ ] API documentation for all endpoints
- [ ] Deployment guide for new environments
- [ ] Troubleshooting guide
- [ ] Video walkthrough of system
- [ ] Architecture decision records (ADRs)

## Implementation Timeline

**Week 1**: 
- IVR_then_human cleanup
- Begin testing additional use cases

**Week 2**:
- Implement RLS policies
- Test security with multiple user roles

**Week 3**:
- Database column audit and cleanup
- Archive unused code

**Week 4**:
- Performance optimizations
- Documentation updates

**Ongoing**:
- Monitor system performance
- Gather feedback from production usage
- Iterate on classification accuracy

# Call Scheduler Implementation Guide

## Overview
This guide details the step-by-step implementation of an automated call scheduler for the pre-classification system. The scheduler will automatically trigger calls based on workflow states, handling both classification calls and task execution calls.

## Architecture Summary
- **Scheduler Edge Function**: Orchestrates call scheduling based on workflow states
- **Modified Pre-Classify Function**: Accepts dynamic pending_call_id instead of hardcoded
- **Database Changes**: New columns for workflow state management
- **pg_cron**: Triggers scheduler every X minutes

---

## Step 1: Database Schema Updates

### 1.1 Add Workflow Columns to pending_calls

Run these SQL commands in your Supabase SQL editor:

```sql
-- Add workflow state management columns
ALTER TABLE pending_calls 
ADD COLUMN workflow_state TEXT DEFAULT 'new',
ADD COLUMN classification_lookup_at TIMESTAMPTZ,
ADD COLUMN retry_count INT DEFAULT 0,
ADD COLUMN max_retries INT DEFAULT 3,
ADD COLUMN next_action_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN last_error TEXT,
ADD COLUMN workflow_metadata JSONB DEFAULT '{}';

-- Add index for efficient scheduling queries
CREATE INDEX idx_pending_calls_scheduler 
ON pending_calls(next_action_at, workflow_state) 
WHERE workflow_state NOT IN ('completed', 'failed');

-- Add check constraint for valid workflow states
ALTER TABLE pending_calls 
ADD CONSTRAINT valid_workflow_state CHECK (
  workflow_state IN (
    'new',
    'checking_classification',
    'needs_classification',
    'classifying',
    'classification_pending',
    'ready_to_call',
    'calling',
    'retry_pending',
    'completed',
    'failed',
    'classification_failed'
  )
);
```

### 1.2 Enable Required Extensions

In Supabase Dashboard → Database → Extensions, enable:
- `pg_cron` - For scheduled jobs
- `http` - For making HTTP calls from cron

---

## Step 2: Modify Existing pre-classify-call Function

### 2.1 Update to Accept Dynamic ID

Replace the hardcoded ID with request parameter handling:

**File**: `supabase/functions/pre-classify-call/index.ts`

```typescript
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    // Parse request body for pending_call_id
    const { pending_call_id } = await req.json();
    
    if (!pending_call_id) {
      throw new Error("pending_call_id is required");
    }

    const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH = Deno.env.get("TWILIO_AUTH_TOKEN");
    const FROM_NUMBER = Deno.env.get("TWILIO_NUMBER");
    const TWIML_URL = Deno.env.get("TWIML_URL_PRECLASSIFY");
    
    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'), 
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );
    
    // Fetch the pending call details
    const { data: pendingCall, error: pendingError } = await supabase
      .from('pending_calls')
      .select('*')
      .eq('id', pending_call_id)
      .single();
      
    if (pendingError || !pendingCall) {
      throw new Error(`Pending call not found: ${pending_call_id}`);
    }
    
    // Update workflow state to prevent duplicate calls
    const { error: updateError } = await supabase
      .from('pending_calls')
      .update({
        workflow_state: pendingCall.classification_id ? 'calling' : 'classifying',
        last_attempt_at: new Date().toISOString()
      })
      .eq('id', pending_call_id)
      .eq('workflow_state', pendingCall.workflow_state); // Optimistic locking
      
    if (updateError) {
      throw new Error('Failed to update workflow state - call may be in progress');
    }
    
    // Rest of your existing code remains the same...
    console.log(`📋 Found pending call:`, pendingCall);
    console.log(`📞 Calling clinic: ${pendingCall.clinic_name} at ${pendingCall.phone}`);
    
    // Continue with existing classification lookup and call logic...
    
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: { "Content-Type": "application/json" },
      status: 500
    });
  }
});
```

---

## Step 3: Create the Scheduler Edge Function

### 3.1 Create New Edge Function

Create a new directory and file:
```
supabase/functions/scheduler/index.ts
```

### 3.2 Scheduler Implementation

```typescript
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH_SIZE = 10; // Process 10 calls at a time
const CLASSIFICATION_WAIT_TIME = 30; // Seconds to wait after IVR classification

serve(async (req) => {
  try {
    console.log(`[SCHEDULER] Run started at ${new Date().toISOString()}`);
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );
    
    // Find pending calls that need action
    const { data: pendingCalls, error: queryError } = await supabase
      .from('pending_calls')
      .select('*')
      .lte('next_action_at', new Date().toISOString())
      .in('workflow_state', [
        'new',
        'checking_classification',
        'needs_classification',
        'classification_pending',
        'ready_to_call',
        'retry_pending'
      ])
      .order('next_action_at', { ascending: true })
      .limit(BATCH_SIZE);
      
    if (queryError) {
      throw new Error(`Query failed: ${queryError.message}`);
    }
    
    console.log(`[SCHEDULER] Found ${pendingCalls?.length || 0} calls to process`);
    
    const results = [];
    
    for (const pendingCall of pendingCalls || []) {
      try {
        const result = await processCall(pendingCall, supabase);
        results.push({ id: pendingCall.id, ...result });
      } catch (err) {
        console.error(`[SCHEDULER] Error processing ${pendingCall.id}:`, err);
        results.push({ 
          id: pendingCall.id, 
          status: 'error', 
          error: err.message 
        });
      }
    }
    
    return new Response(JSON.stringify({
      processed: results.length,
      results
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200
    });
    
  } catch (error) {
    console.error("[SCHEDULER] Fatal error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: { "Content-Type": "application/json" },
      status: 500
    });
  }
});

async function processCall(pendingCall: any, supabase: any) {
  console.log(`[SCHEDULER] Processing ${pendingCall.id} in state: ${pendingCall.workflow_state}`);
  
  switch (pendingCall.workflow_state) {
    case 'new':
      return await handleNewCall(pendingCall, supabase);
      
    case 'checking_classification':
      return await checkClassification(pendingCall, supabase);
      
    case 'needs_classification':
      return await triggerClassificationCall(pendingCall, supabase);
      
    case 'classification_pending':
      return await handleClassificationPending(pendingCall, supabase);
      
    case 'ready_to_call':
      return await triggerTaskCall(pendingCall, supabase);
      
    case 'retry_pending':
      return await handleRetryPending(pendingCall, supabase);
      
    default:
      return { status: 'skipped', reason: 'Unknown state' };
  }
}

async function handleNewCall(pendingCall: any, supabase: any) {
  // Update to checking_classification
  await supabase
    .from('pending_calls')
    .update({
      workflow_state: 'checking_classification',
      classification_lookup_at: new Date().toISOString()
    })
    .eq('id', pendingCall.id);
    
  // Look up classification
  const { data: classification } = await supabase
    .from('call_classifications')
    .select('*')
    .eq('phone_number', pendingCall.phone)
    .eq('is_active', true)
    .gte('classification_expires_at', new Date().toISOString())
    .single();
    
  if (classification) {
    // Classification found
    await supabase
      .from('pending_calls')
      .update({
        classification_id: classification.id,
        workflow_state: 'ready_to_call',
        next_action_at: new Date().toISOString()
      })
      .eq('id', pendingCall.id);
      
    return { status: 'classification_found', classification_type: classification.classification_type };
  } else {
    // No classification
    await supabase
      .from('pending_calls')
      .update({
        workflow_state: 'needs_classification',
        next_action_at: new Date().toISOString()
      })
      .eq('id', pendingCall.id);
      
    return { status: 'needs_classification' };
  }
}

async function triggerClassificationCall(pendingCall: any, supabase: any) {
  // Call the pre-classify-call function
  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/pre-classify-call`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pending_call_id: pendingCall.id
      })
    }
  );
  
  if (response.ok) {
    // Don't update state here - let the call completion handle it
    return { status: 'classification_call_triggered' };
  } else {
    const error = await response.text();
    throw new Error(`Failed to trigger call: ${error}`);
  }
}

async function handleClassificationPending(pendingCall: any, supabase: any) {
  // Check if enough time has passed since classification
  const classifiedAt = new Date(pendingCall.ivr_classified_at || pendingCall.updated_at);
  const waitTime = CLASSIFICATION_WAIT_TIME * 1000; // Convert to milliseconds
  const now = new Date();
  
  if (now.getTime() - classifiedAt.getTime() >= waitTime) {
    // Enough time has passed, ready for task call
    await supabase
      .from('pending_calls')
      .update({
        workflow_state: 'ready_to_call',
        next_action_at: new Date().toISOString()
      })
      .eq('id', pendingCall.id);
      
    return { status: 'ready_for_task_call' };
  } else {
    // Still waiting
    const nextAction = new Date(classifiedAt.getTime() + waitTime);
    await supabase
      .from('pending_calls')
      .update({
        next_action_at: nextAction.toISOString()
      })
      .eq('id', pendingCall.id);
      
    return { status: 'still_waiting', next_action_at: nextAction };
  }
}

async function triggerTaskCall(pendingCall: any, supabase: any) {
  // Trigger the actual task call
  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/pre-classify-call`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pending_call_id: pendingCall.id
      })
    }
  );
  
  if (response.ok) {
    return { status: 'task_call_triggered' };
  } else {
    const error = await response.text();
    throw new Error(`Failed to trigger task call: ${error}`);
  }
}

async function handleRetryPending(pendingCall: any, supabase: any) {
  // Check if it's time to retry
  if (pendingCall.retry_count < pendingCall.max_retries) {
    await supabase
      .from('pending_calls')
      .update({
        workflow_state: 'ready_to_call',
        retry_count: pendingCall.retry_count + 1,
        next_action_at: new Date().toISOString()
      })
      .eq('id', pendingCall.id);
      
    return { status: 'retry_scheduled', retry_count: pendingCall.retry_count + 1 };
  } else {
    // Max retries exceeded
    await supabase
      .from('pending_calls')
      .update({
        workflow_state: 'failed',
        last_error: 'Max retries exceeded'
      })
      .eq('id', pendingCall.id);
      
    return { status: 'max_retries_exceeded' };
  }
}

async function checkClassification(pendingCall: any, supabase: any) {
  // Re-check classification status
  return await handleNewCall(pendingCall, supabase);
}
```

---

## Step 4: Update WebSocket Server for State Management

### 4.1 Modify storeFinalClassification in server_deepgram.js

Add workflow state updates when classification is stored:

```javascript
// In storeFinalClassification function, after successful classification storage:

// Update pending call workflow state
if (session.pending_call_id) {
  if (session.ivr_detection_state === 'human') {
    // Human call - might already be completed
    await supabase
      .from('pending_calls')
      .update({
        workflow_state: 'calling',
        classification_id: existing?.id || newClassificationId
      })
      .eq('id', session.pending_call_id);
  } else if (session.ivr_detection_state === 'ivr_only' || 
             session.ivr_detection_state === 'ivr_then_human') {
    // IVR call - need second call
    await supabase
      .from('pending_calls')
      .update({
        workflow_state: 'classification_pending',
        classification_id: existing?.id || newClassificationId,
        next_action_at: new Date(Date.now() + 30000).toISOString(), // 30 seconds
        workflow_metadata: {
          classification_completed_at: new Date().toISOString(),
          classification_type: session.ivr_detection_state
        }
      })
      .eq('id', session.pending_call_id);
  }
}
```

### 4.2 Update VAPI post_call.js

Add workflow state updates when VAPI completes:

```javascript
// In post_call.js, after successful update:

// Update workflow state based on result
const workflowState = successEvaluation ? 'completed' : 'retry_pending';
const nextActionAt = successEvaluation 
  ? null 
  : new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min retry

await supabase
  .from('pending_calls')
  .update({
    workflow_state: workflowState,
    next_action_at: nextActionAt
  })
  .eq('id', id);
```

---

## Step 5: Deploy Edge Functions

### 5.1 Deploy the Modified pre-classify-call Function

```bash
supabase functions deploy pre-classify-call
```

### 5.2 Deploy the New Scheduler Function

```bash
supabase functions deploy scheduler
```

---

## Step 6: Set Up pg_cron Schedule

### 6.1 Create the Cron Job

Run in Supabase SQL editor:

```sql
-- Create cron job to run every 5 minutes
SELECT cron.schedule(
  'call-scheduler',
  '*/5 * * * *',  -- Every 5 minutes
  $$
  SELECT http.post(
    current_setting('app.settings.supabase_url') || '/functions/v1/scheduler',
    headers => jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body => '{}'::jsonb,
    timeout_milliseconds => 55000  -- 55 second timeout
  );
  $$
);

-- Verify the job was created
SELECT * FROM cron.job WHERE jobname = 'call-scheduler';
```

### 6.2 Monitor Cron Execution

```sql
-- View recent cron job runs
SELECT * FROM cron.job_run_details 
WHERE jobname = 'call-scheduler' 
ORDER BY start_time DESC 
LIMIT 20;

-- Check for errors
SELECT * FROM cron.job_run_details 
WHERE jobname = 'call-scheduler' 
  AND status != 'succeeded'
ORDER BY start_time DESC;
```

---

## Step 7: Testing

### 7.1 Create Test Pending Call

```sql
-- Insert a test pending call
INSERT INTO pending_calls (
  id,
  exam_id,
  employee_name,
  employee_dob,
  phone,
  clinic_name,
  appointment_time,
  workflow_state,
  next_action_at
) VALUES (
  gen_random_uuid(),
  'TEST-001',
  'Test Patient',
  '1990-01-01',
  '+1234567890',  -- Use a real test number
  'Test Clinic',
  NOW() + INTERVAL '1 day',
  'new',
  NOW()
);
```

### 7.2 Manually Trigger Scheduler

```bash
# Test the scheduler function directly
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/scheduler \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json"
```

### 7.3 Monitor Progress

```sql
-- Watch workflow state changes
SELECT 
  id,
  employee_name,
  workflow_state,
  retry_count,
  next_action_at,
  last_error,
  updated_at
FROM pending_calls
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY updated_at DESC;

-- Check call sessions
SELECT 
  cs.*,
  pc.workflow_state
FROM call_sessions cs
JOIN pending_calls pc ON cs.pending_call_id = pc.id
WHERE cs.created_at > NOW() - INTERVAL '1 hour'
ORDER BY cs.created_at DESC;
```

---

## Step 8: Production Considerations

### 8.1 Adjust Timing

For production, consider:
- Cron frequency: `*/15 * * * *` (every 15 minutes)
- Batch size: Increase to 20-50
- Retry delays: Exponential backoff
- Business hours checks

### 8.2 Add Monitoring

```sql
-- Create monitoring view
CREATE VIEW scheduler_dashboard AS
SELECT 
  workflow_state,
  COUNT(*) as count,
  MIN(next_action_at) as next_action,
  AVG(retry_count) as avg_retries
FROM pending_calls
WHERE workflow_state NOT IN ('completed', 'failed')
GROUP BY workflow_state;

-- Alert on stuck calls
SELECT * FROM pending_calls
WHERE workflow_state NOT IN ('completed', 'failed')
  AND updated_at < NOW() - INTERVAL '1 hour';
```

### 8.3 Error Handling

Add dead letter queue for failed calls:

```sql
-- Add column for permanent failures
ALTER TABLE pending_calls 
ADD COLUMN failed_at TIMESTAMPTZ,
ADD COLUMN failure_reason TEXT;

-- Query for manual review
SELECT * FROM pending_calls
WHERE workflow_state = 'failed'
  OR retry_count >= max_retries
ORDER BY failed_at DESC;
```

---

## Workflow State Diagram

```
NEW 
 ├─→ CHECKING_CLASSIFICATION
 │    ├─→ NEEDS_CLASSIFICATION
 │    │    └─→ CLASSIFYING
 │    │         ├─→ CLASSIFICATION_PENDING (IVR)
 │    │         │    └─→ READY_TO_CALL
 │    │         └─→ COMPLETED (Human)
 │    └─→ READY_TO_CALL (Has Classification)
 │         └─→ CALLING
 │              ├─→ COMPLETED ✓
 │              └─→ RETRY_PENDING
 │                   └─→ READY_TO_CALL
 └─→ FAILED ✗
```

---

## Troubleshooting

### Common Issues

1. **Scheduler not running**
   - Check cron job: `SELECT * FROM cron.job;`
   - Check execution logs: `SELECT * FROM cron.job_run_details;`
   - Verify extensions enabled: pg_cron and http

2. **Calls not triggering**
   - Check workflow states: `SELECT workflow_state, COUNT(*) FROM pending_calls GROUP BY 1;`
   - Verify next_action_at times
   - Check edge function logs in Supabase dashboard

3. **State stuck**
   - Look for calls in 'classifying' or 'calling' > 10 minutes
   - Reset stuck states: `UPDATE pending_calls SET workflow_state = 'retry_pending' WHERE ...`

4. **Classification not found**
   - Verify phone number format matches
   - Check classification expiration dates
   - Ensure is_active = true

---

## Summary

This implementation provides:
1. Automatic call scheduling based on workflow states
2. Proper handling of two-call scenarios for IVR systems  
3. Retry logic with configurable limits
4. Clear audit trail of all state changes
5. Scalable architecture using Supabase infrastructure

The system will automatically process pending calls every 5 minutes, handling both classification and task execution calls appropriately.

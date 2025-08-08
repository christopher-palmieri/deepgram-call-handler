# Pre-Classification Call System with Automated Scheduler

## Overview
This system pre-classifies clinic phone systems (human vs IVR vs IVR-then-human) and caches the results for 30 days, enabling instant routing for subsequent calls. The system uses intelligent call handling to minimize wasted time on IVR systems during classification, with a fully automated scheduler that orchestrates the entire workflow.

**Core Concept**: Make a test call to each clinic once, learn how their phone system works, cache that knowledge for 30 days, then use it for all future calls to save time and improve reliability.

## System Components

### 1. **Edge Functions** (Supabase)
- `pre-classify-call-07-21-2025`: Initiates calls with dynamic pending_call_id support
- `scheduler`: Orchestrates workflow states and triggers calls every 5 minutes

### 2. **API Endpoints** (Vercel)
- `api/twilio/preclassify-twiml.js`: Routes calls based on classification (TwiML webhook)
- `api/twilio/get-pending-call.js`: Provides call data to VAPI (secured with shared secret)
- `api/vapi/post_call.js`: Receives call results from VAPI and updates workflow states

### 3. **WebSocket Server** (Railway)
- `server_deepgram.js`: Real-time call classification, IVR navigation, and workflow state management
- Modules:
  - `ivr-navigator.js`: OpenAI-powered IVR menu navigation
  - `fast-classifier.js`: Pattern matching for instant classification
  - `openai-classifier.js`: AI classification for complex cases
  - `supabase-logger.js`: Stores classifications and manages call state

### 4. **Automated Scheduler** (pg_cron)
- Runs every 5 minutes via pg_cron
- Processes pending calls through workflow states
- Handles retries with exponential backoff
- Manages two-call flow for IVR systems

## Benefits
- ⚡ **Speed**: Reduce call connection time from ~10s to ~5s
- 💰 **Cost**: One classification per clinic per month instead of every call
- 🎯 **Reliability**: Predictable routing behavior with automated retries
- 📊 **Scalability**: Handle high call volumes with batch processing
- 🤖 **Automation**: Fully automated workflow from classification to completion
- 🔄 **Self-Healing**: Automatic retries for failed connections

## Workflow States

The system uses workflow states to track each pending call through its lifecycle:

### Core Workflow States

| State | Description | Next Action | Triggered By |
|-------|-------------|-------------|--------------|
| `pending` | Call is parked/paused for testing | None - ignored by scheduler | Manual testing mode |
| `new` | Brand new call, not yet processed | Check for existing classification | Initial creation |
| `checking_classification` | Looking up existing classification | Move to needs_classification or ready_to_call | Scheduler |
| `needs_classification` | No classification found, needs to classify | Trigger classification call | No classification exists |
| `classifying` | Classification call in progress | Wait for WebSocket to detect type | Edge function |
| `classification_pending` | IVR detected, waiting before task call | Wait 30s, then trigger task call | WebSocket (IVR detected) |
| `ready_to_call` | Classification known, ready for task call | Trigger task call immediately | Classification found/completed |
| `calling` | Task call in progress with VAPI | Wait for VAPI to complete | Edge function |
| `retry_pending` | Call failed, waiting to retry | Retry after delay (5/15/30 min) | VAPI "Unable to connect" |
| `completed` | Call successfully completed | None - terminal state | VAPI "Sending Records" or "No Show" |
| `failed` | Max retries exceeded | None - terminal state | After 3 failed attempts |

### State Transition Flows

#### Scenario 1: New Call with Existing Classification
```
new → checking_classification → ready_to_call → calling → completed
```

#### Scenario 2: New Call Requiring Classification (IVR)
```
new → checking_classification → needs_classification → classifying → classification_pending → ready_to_call → calling → completed
```

#### Scenario 3: New Call with Human Answer
```
new → checking_classification → needs_classification → classifying → calling → completed
```

#### Scenario 4: Failed Call with Retry
```
calling → retry_pending → ready_to_call → calling → completed
```

## Architecture Flow

### 1. SCHEDULER ORCHESTRATION (pg_cron every 5 minutes)
```
├─> Find pending calls needing action (next_action_at <= NOW)
├─> Process by workflow_state:
│   ├─> new → Check classification
│   ├─> classification_pending → Trigger task call
│   ├─> ready_to_call → Trigger task call
│   └─> retry_pending → Retry if under max_retries
└─> Update states and next_action_at times
```

### 2. CALL INITIATION (Edge Function)
```
├─> Receive pending_call_id from scheduler
├─> Fetch pending call details from Supabase
├─> Check for existing classification
├─> Create call session
├─> Update workflow state (classifying or calling)
├─> Pass parameters to TwiML handler via URL
└─> Initiate Twilio call
```

### 3. CALL ROUTING (TwiML Handler)
```
├─> Retrieve session and classification data
├─> Build SIP headers with pending call info
├─> Route based on classification:
│   ├─> Human → Direct VAPI connection
│   ├─> IVR → Execute stored actions with timing → VAPI
│   └─> Unknown → Dual stream (VAPI + WebSocket)
└─> Pass employee data in SIP headers
```

### 4. CLASSIFICATION PROCESS (WebSocket Server)
```
├─> Connect to Deepgram for transcription
├─> Fast pattern matching for instant detection
├─> OpenAI classification after 3 seconds
├─> Store classification state in session
├─> Update pending_call workflow state:
│   ├─> Human → calling (VAPI continues)
│   ├─> IVR → classification_pending (wait for task call)
├─> For IVR: Navigate and log first action with timing
├─> Auto-terminate classification call after IVR action
└─> Store final classification when call ends
```

### 5. VAPI INTEGRATION & COMPLETION
```
├─> VAPI receives call with pending_call_id
├─> Fetches full call data via API endpoint
├─> Conducts conversation with clinic
├─> Posts results back with success evaluation:
│   ├─> "Sending Records" → completed
│   ├─> "No Show" → completed
│   └─> "Unable to connect" → retry_pending
└─> Updates workflow state accordingly
```

## Database Schema

### 1. pending_calls Table (with Workflow Management)
```sql
CREATE TABLE pending_calls (
  -- Core fields
  id UUID PRIMARY KEY,
  exam_id TEXT,
  employee_name TEXT,
  employee_dob DATE,
  client_name TEXT,
  phone TEXT,
  clinic_name TEXT,
  appointment_time TIMESTAMPTZ,
  
  -- Workflow management (NEW)
  workflow_state TEXT DEFAULT 'new',
  classification_id UUID REFERENCES call_classifications(id),
  classification_lookup_at TIMESTAMPTZ,
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  next_action_at TIMESTAMPTZ DEFAULT NOW(),
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  workflow_metadata JSONB DEFAULT '{}',
  
  -- Call results
  call_status TEXT,
  trigger_attempted_at TIMESTAMPTZ,
  trigger_response JSONB,
  summary TEXT,
  success_evaluation TEXT,  -- "Sending Records", "No Show", "Unable to connect"
  structured_data JSONB,
  
  -- Failure tracking (NEW)
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. call_sessions Table
```sql
CREATE TABLE call_sessions (
  id UUID PRIMARY KEY,
  call_id TEXT UNIQUE,               -- Twilio Call SID
  pending_call_id UUID REFERENCES pending_calls(id),  -- Link to pending call
  clinic_phone TEXT,
  clinic_name TEXT,                  -- Added for session tracking
  classification_id UUID REFERENCES call_classifications(id),
  call_status TEXT,
  ivr_detection_state TEXT,          -- human, ivr_only, ivr_then_human
  ivr_classified_at TIMESTAMPTZ,
  ivr_detection_latency_ms INT4,
  ivr_confidence_score FLOAT8,
  stream_started BOOLEAN DEFAULT false,
  twilio_call_sid TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. call_classifications Table
```sql
CREATE TABLE call_classifications (
  id UUID PRIMARY KEY,
  phone_number TEXT NOT NULL,
  clinic_name TEXT,
  classification_type TEXT,          -- 'human', 'ivr_only', 'ivr_then_human'
  classification_confidence FLOAT8,
  ivr_actions JSONB,                -- Array of navigation actions with timing
  classification_duration_ms INT4,
  pre_call_sid TEXT,
  classification_expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  is_active BOOLEAN DEFAULT true,
  last_verified_at TIMESTAMPTZ,
  verification_count INT4 DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- Example ivr_actions structure with timing:
-- [
--   {
--     "action_type": "dtmf",
--     "action_value": "3",
--     "timing_ms": 17000  -- Press 3 after 17 seconds
--   }
-- ]
```

## Key Environment Variables

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-key
SUPABASE_ANON_KEY=your-anon-key

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_NUMBER=+1234567890
TWIML_URL_PRECLASSIFY=https://your-app.vercel.app/api/twilio/preclassify-twiml

# VAPI
VAPI_SIP_ADDRESS=sip:assistant@vapi.ai
VAPI_SHARED_SECRET=your-shared-secret
VAPI_SECRET_TOKEN=your-vapi-token

# Railway WebSocket
DEEPGRAM_WS_URL=wss://your-app.railway.app
DEEPGRAM_API_KEY=your-deepgram-key

# OpenAI
OPENAI_API_KEY=your-openai-key
```

## Automated Scheduler Setup

### 1. Create the pg_cron Job
```sql
-- Schedule to run every 5 minutes
SELECT cron.schedule(
  'call-scheduler',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/scheduler',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

### 2. Scheduler Logic
The scheduler processes calls based on their workflow state:
- Batches up to 10 calls per run
- Checks `next_action_at` timestamps
- Handles state transitions
- Manages retry logic with exponential backoff

## How It Works - Complete Flow

### First Call to a Clinic (No Classification)

1. **Scheduler** finds pending call in `'new'` state
2. **Scheduler** checks for existing classification → None found
3. **Scheduler** triggers classification call via edge function
4. **WebSocket Server** classifies in real-time:
   - If human: Let VAPI continue → `'completed'`
   - If IVR: Capture action, end call → `'classification_pending'`
5. **Scheduler** (next run) finds `'classification_pending'` call
6. **Scheduler** triggers task call with stored IVR actions
7. **VAPI** handles conversation → Updates to `'completed'`

### Subsequent Calls (With Classification)

1. **Scheduler** finds pending call in `'new'` state
2. **Scheduler** checks for classification → Found!
3. **Scheduler** moves to `'ready_to_call'`
4. **Scheduler** triggers task call immediately
5. **TwiML Handler** uses cached IVR navigation
6. **VAPI** handles conversation → Updates to `'completed'`

## IVR Navigation Intelligence

### Navigation Rules
The system uses OpenAI to intelligently navigate IVR menus:

**GOOD Keywords** (will navigate):
- Front Desk / Reception / Scheduling
- General inquiries / Patient care
- Operator / Main office

**AVOIDED Keywords** (will wait):
- Billing / Pharmacy / Lab results
- Department-specific options
- Medical records

### Action Timing
IVR actions are stored with precise timing and replayed exactly:
```json
{
  "action_type": "dtmf",
  "action_value": "3",
  "timing_ms": 17000  // Wait 17 seconds, then press 3
}
```

## Monitoring & Operations

### Check Scheduler Status
```sql
-- View scheduler dashboard
SELECT * FROM scheduler_dashboard;

-- Recent cron runs
SELECT * FROM cron.job_run_details 
WHERE jobname = 'call-scheduler' 
ORDER BY start_time DESC LIMIT 10;

-- Active workflow states
SELECT workflow_state, COUNT(*) 
FROM pending_calls
WHERE workflow_state NOT IN ('pending', 'completed', 'failed')
GROUP BY workflow_state;
```

### Manage Calls
```sql
-- Park all active calls (for testing)
UPDATE pending_calls 
SET workflow_state = 'pending'
WHERE workflow_state NOT IN ('completed', 'failed', 'pending');

-- Activate specific call
UPDATE pending_calls 
SET workflow_state = 'new'
WHERE id = 'YOUR_CALL_ID';

-- Force retry of failed calls
UPDATE pending_calls 
SET workflow_state = 'retry_pending', 
    retry_count = 0,
    next_action_at = NOW()
WHERE workflow_state = 'failed';
```

### Control Scheduler
```sql
-- Pause scheduler
UPDATE cron.job SET active = false WHERE jobname = 'call-scheduler';

-- Resume scheduler
UPDATE cron.job SET active = true WHERE jobname = 'call-scheduler';

-- Manual run
SELECT net.http_post(
  url := 'https://YOUR_PROJECT.supabase.co/functions/v1/scheduler',
  headers := jsonb_build_object(
    'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
    'Content-Type', 'application/json'
  ),
  body := '{}'::jsonb
);
```

## Performance & Optimization

### Timing Configuration
- **Scheduler frequency**: Every 5 minutes (adjustable)
- **Classification wait**: 30 seconds before task call
- **Retry delays**: 5, 15, 30 minutes (exponential backoff)
- **Max retries**: 3 attempts (configurable per call)
- **Classification cache**: 30 days

### Efficiency Features
- Batch processing (10 calls per scheduler run)
- Connection reuse (30-second WebSocket cache)
- Automatic call termination for IVR classification
- Parallel processing within batches

## Success Evaluation Types

The system handles three VAPI evaluation outcomes:

1. **"Sending Records"** - Success! Clinic is sending the requested records
   - Sets `workflow_state = 'completed'`
   - No retries needed

2. **"No Show"** - Employee didn't attend appointment
   - Sets `workflow_state = 'completed'`
   - Terminal state, no retries

3. **"Unable to connect"** - Failed to reach clinic representative
   - Sets `workflow_state = 'retry_pending'`
   - Automatic retry after 30 minutes
   - Up to 3 retry attempts

## Security Considerations

1. **API Authentication**: 
   - VAPI endpoint requires shared secret
   - Supabase uses service role key
   - Edge functions use no-verify-jwt for internal calls
   
2. **Data Privacy**:
   - Employee PII passed via secure SIP headers
   - Phone numbers stored for classification only
   - All data transmitted over secure WebSocket/HTTPS

3. **Rate Limiting**:
   - Scheduler batch size limits prevent abuse
   - 30-day classification cache reduces API calls
   - Exponential backoff prevents retry storms

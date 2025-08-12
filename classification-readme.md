# Pre-Classification Call System with Automated Scheduler

## Overview
This system pre-classifies clinic phone systems (human vs IVR vs IVR-then-human) and caches the results for 30 days, enabling instant routing for subsequent calls. The system uses intelligent call handling to minimize wasted time on IVR systems during classification, with a fully automated scheduler that orchestrates the entire workflow. Voicemail detection prevents false classifications and triggers appropriate retries.

**Core Concept**: Make a test call to each clinic once, learn how their phone system works (excluding temporary states like voicemail), cache that knowledge for 30 days, then use it for all future calls to save time and improve reliability.

## System Components

### 1. **Edge Functions** (Supabase)
- `pre-classify-call-07-21-2025`: Initiates calls with dynamic pending_call_id support
- `scheduler`: Orchestrates workflow states and triggers calls every minute

### 2. **API Endpoints** (Vercel)
- `api/twilio/preclassify-twiml.js`: Routes calls based on classification (TwiML webhook)
- `api/twilio/get-pending-call.js`: Provides call data to VAPI (secured with shared secret)
- `api/vapi/post_call.js`: Receives call results from VAPI and updates both pending_calls and call_sessions

### 3. **WebSocket Server** (Railway)
- `server_deepgram.js`: Real-time call classification, IVR navigation, transfer timing, and workflow state management
- Modules:
  - `ivr-navigator.js`: OpenAI-powered IVR menu navigation
  - `fast-classifier.js`: Pattern matching for instant classification (including voicemail detection)
  - `openai-classifier.js`: AI classification for complex cases
  - `supabase-logger.js`: Stores classifications and manages call state

### 4. **Automated Scheduler** (pg_cron)
- Runs every minute via pg_cron
- Processes pending calls through workflow states
- Handles retries with exponential backoff
- Manages two-call flow for IVR systems
- Special handling for voicemail encounters

## Benefits
- ⚡ **Speed**: Reduce call connection time from ~10s to ~5s
- 💰 **Cost**: One classification per clinic per month instead of every call
- 🎯 **Reliability**: Predictable routing behavior with automated retries
- 📊 **Scalability**: Handle high call volumes with batch processing
- 🤖 **Automation**: Fully automated workflow from classification to completion
- 🔄 **Self-Healing**: Automatic retries for failed connections and voicemail
- 📧 **Smart Detection**: Voicemail detection prevents false IVR classifications

## Classification Types

### Persistent Classifications (Cached for 30 Days)
These represent the actual phone system type of the clinic:

1. **`human`** - Direct human answer
   - Receptionist or staff member answers directly
   - No automated system or menu
   - VAPI connects immediately

2. **`ivr_only`** - Pure IVR system
   - Automated menu system throughout
   - Requires DTMF or speech navigation
   - Actions and timing are recorded and replayed

3. **`ivr_then_human`** - IVR greeting then transfer
   - Starts with automated message (hours, location, etc.)
   - Then transfers to human ("connecting you now")
   - Transfer timing is captured and used for VAPI connection

### Temporary States (Not Cached)
These are transient conditions that don't represent the clinic's actual phone system:

1. **`voicemail`** - Voicemail system detected
   - "Please leave a message"
   - "Is not available"
   - Does NOT create a classification record
   - Triggers retry in 1 hour
   - Call ends immediately to save costs

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
| `retry_pending` | Call failed, waiting to retry | Retry after delay (5/15/30/60 min) | VAPI failure or voicemail |
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

#### Scenario 4: Voicemail Encounter
```
new → checking_classification → needs_classification → classifying → retry_pending → ready_to_call → calling → completed
```
*Note: Voicemail detection doesn't store a classification, allowing fresh classification on retry*

#### Scenario 5: Failed Call with Retry
```
calling → retry_pending → ready_to_call → calling → completed
```

## Architecture Flow

### 1. SCHEDULER ORCHESTRATION (pg_cron every minute)
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
│   ├─> IVR_then_human → Pause for transfer timing → VAPI
│   └─> Unknown → Dual stream (VAPI + WebSocket)
└─> Pass employee data in SIP headers
```

### 4. CLASSIFICATION PROCESS (WebSocket Server)
```
├─> Connect to Deepgram for transcription
├─> Fast pattern matching for instant detection
│   ├─> Voicemail patterns → End call, set retry_pending
│   ├─> Human patterns → Let VAPI continue
│   └─> IVR patterns → Navigate and capture actions
├─> OpenAI classification after 3 seconds
├─> Store classification state in session
├─> Update pending_call workflow state
├─> For IVR: Navigate and log actions with timing
├─> For IVR_then_human: Capture transfer timing
├─> For Voicemail: Skip classification storage
├─> Auto-terminate classification calls after capturing needed data
└─> Store final classification when call ends (except voicemail)
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
├─> Updates workflow state in pending_calls
└─> Stores complete history in call_sessions
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
  
  -- Workflow management
  workflow_state TEXT DEFAULT 'new',
  classification_id UUID REFERENCES call_classifications(id),
  classification_lookup_at TIMESTAMPTZ,
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  next_action_at TIMESTAMPTZ DEFAULT NOW(),
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  workflow_metadata JSONB DEFAULT '{}',  -- Latest state only
  
  -- Call results (overwritten with each attempt)
  call_status TEXT,
  trigger_attempted_at TIMESTAMPTZ,
  trigger_response JSONB,
  summary TEXT,
  success_evaluation TEXT,
  structured_data JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. call_sessions Table (with Complete History)
```sql
CREATE TABLE call_sessions (
  id UUID PRIMARY KEY,
  call_id TEXT UNIQUE,               -- Twilio Call SID
  pending_call_id UUID REFERENCES pending_calls(id),
  clinic_phone TEXT,
  clinic_name TEXT,
  classification_id UUID REFERENCES call_classifications(id),
  call_status TEXT,                  -- active, completed, voicemail
  ivr_detection_state TEXT,          -- human, ivr_only, ivr_then_human, voicemail
  ivr_classified_at TIMESTAMPTZ,
  ivr_detection_latency_ms INT4,
  ivr_confidence_score FLOAT8,
  stream_started BOOLEAN DEFAULT false,
  workflow_metadata JSONB DEFAULT '{}',  -- Complete history preserved
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. call_classifications Table (Never Stores Voicemail)
```sql
CREATE TABLE call_classifications (
  id UUID PRIMARY KEY,
  phone_number TEXT NOT NULL,
  clinic_name TEXT,
  classification_type TEXT,          -- 'human', 'ivr_only', 'ivr_then_human' ONLY
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
```

## Voicemail Handling

### Detection Patterns
The system detects voicemail through pattern matching:
- "Please leave a message"
- "Leave a message after the tone"
- "Is not available"
- "Cannot take your call"
- "Currently unavailable"
- "Record your message"
- "Voicemail box"

### Handling Process
1. **Detection** - Fast classifier identifies voicemail patterns
2. **No Classification** - Voicemail is NOT stored as a classification
3. **Call Termination** - Call ends immediately to save costs
4. **Metadata Logging** - Logged in call_sessions for tracking
5. **Retry Scheduling** - Set to retry_pending with 1-hour delay
6. **Fresh Classification** - Next attempt will classify fresh (no cached result)

### Why Not Cache Voicemail?
- Voicemail is a temporary state, not a phone system type
- Same clinic might have human answer during business hours
- Prevents false IVR classifications
- Allows system to adapt to different times of day

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

### Transfer Timing (ivr_then_human)
For IVR systems that transfer to humans:
```json
{
  "action_type": "transfer",
  "action_value": "connect_vapi",
  "timing_ms": 15000  // Connect VAPI at 15 seconds when human picks up
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

-- Voicemail encounters
SELECT call_id, clinic_phone, workflow_metadata->>'voicemail_detected_at'
FROM call_sessions
WHERE workflow_metadata->>'voicemail_detected' = 'true'
ORDER BY created_at DESC;
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

-- Reset test call for repeated testing
UPDATE pending_calls 
SET 
  call_status = 'pending',
  workflow_state = 'new',
  next_action_at = NOW(),
  classification_id = NULL,
  retry_count = 0,
  summary = NULL,
  success_evaluation = NULL,
  structured_data = NULL,
  workflow_metadata = '{}'::jsonb
WHERE id = 'YOUR_TEST_CALL_ID';
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
- **Scheduler frequency**: Every minute
- **Classification wait**: 30 seconds before task call
- **Retry delays**: 
  - Unable to connect: 5, 15, 30 minutes (exponential)
  - Voicemail: 60 minutes
- **Max retries**: 3 attempts (configurable per call)
- **Classification cache**: 30 days

### Efficiency Features
- Batch processing (10 calls per scheduler run)
- Connection reuse (30-second WebSocket cache)
- Automatic call termination for IVR/voicemail classification
- Parallel processing within batches
- Cost savings through voicemail detection

## Success Evaluation Types

The system handles four distinct outcomes:

1. **"Sending Records"** - Success! Clinic is sending the requested records
   - Sets `workflow_state = 'completed'`
   - No retries needed
   - Logged to both pending_calls and call_sessions

2. **"No Show"** - Employee didn't attend appointment
   - Sets `workflow_state = 'completed'`
   - Terminal state, no retries
   - Logged to both pending_calls and call_sessions

3. **"Unable to connect"** - Failed to reach clinic representative
   - Sets `workflow_state = 'retry_pending'`
   - Automatic retry after 30 minutes
   - Up to 3 retry attempts

4. **Voicemail Detected** - Reached voicemail system
   - Sets `workflow_state = 'retry_pending'`
   - NO classification stored
   - Retry after 60 minutes
   - Fresh classification on next attempt

## Metadata Storage Strategy

### pending_calls.workflow_metadata
- **Purpose**: Current state and latest attempt info
- **Behavior**: Overwritten with each update
- **Use Case**: Workflow decisions and current status

### call_sessions.workflow_metadata
- **Purpose**: Complete historical record
- **Behavior**: Preserved for each call attempt
- **Use Case**: Debugging, analytics, audit trail

Example call_sessions.workflow_metadata:
```json
{
  // Classification data
  "classification_type": "ivr_then_human",
  "ivr_actions": [...],
  "transfer_timing_ms": 15000,
  
  // Voicemail detection (if applicable)
  "voicemail_detected": true,
  "classification_skipped": true,
  
  // VAPI results
  "vapi_success_evaluation": "Sending Records",
  "vapi_summary": "Spoke with Sarah...",
  "is_successful": true
}
```

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
   - Voicemail detection prevents unnecessary calls

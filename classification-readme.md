# Pre-Classification Call System with Automated Scheduler

## Overview
This system pre-classifies clinic phone systems (human vs IVR vs IVR-then-human) and caches the results for 30 days, enabling instant routing for subsequent calls. The system uses intelligent call handling to minimize wasted time on IVR systems during classification, with a fully automated scheduler that orchestrates the entire workflow. **Timezone-aware scheduling ensures clinics are only called during their local business hours (9 AM - 5 PM).** Voicemail detection prevents false classifications and triggers appropriate retries. **Enhanced retry management ensures all failed calls are properly tracked and retried with exponential backoff.** **Successful classification calls do NOT increment retry_count, preserving retry attempts for actual task call failures.**

**Core Concept**: Make a test call to each clinic once, learn how their phone system works (excluding temporary states like voicemail), cache that knowledge for 30 days, then use it for all future calls to save time and improve reliability. **Classification calls that successfully identify the phone system type are NOT counted as retry attempts.** All calls respect the clinic's local timezone. A multi-layered retry system ensures no failed calls are missed.

## System Components

### 1. **Edge Functions** (Supabase)
- `pre-classify-call-07-21-2025`: Initiates calls with dynamic pending_call_id support
- `scheduler`: Orchestrates workflow states, triggers calls every minute **for clinics currently in business hours**, and handles orphaned calls

### 2. **API Endpoints** (Vercel)
- `api/twilio/preclassify-twiml.js`: Routes calls based on classification (TwiML webhook)
- `api/twilio/get-pending-call.js`: Provides call data to VAPI (secured with shared secret)
- `api/vapi/post_call.js`: Receives call results from VAPI, **skips retry increment for successful classifications**
- `api/twilio/call-status-complete.js`: Handles Twilio call status updates, **skips retry increment for successful classifications**

### 3. **WebSocket Server** (Railway)
- `server_deepgram.js`: Real-time call classification, IVR navigation, transfer timing, workflow state management, **and classification success flagging**
- Modules:
  - `ivr-navigator.js`: OpenAI-powered IVR menu navigation
  - `fast-classifier.js`: Pattern matching for instant classification (including voicemail detection)
  - `openai-classifier.js`: AI classification for complex cases
  - `supabase-logger.js`: Stores classifications and manages call state

### 4. **Automated Scheduler** (pg_cron)
- Runs every minute via pg_cron **during expanded hours (13:00-01:00 UTC)**
- **Timezone-aware filtering** - only processes clinics in their local business hours
- Processes pending calls through workflow states
- Handles retries with exponential backoff
- Manages two-call flow for IVR systems
- Special handling for voicemail encounters
- Detects and handles orphaned calls stuck in 'calling' state

## Webhook Architecture & Retry Management

### Dual Webhook System with Classification Protection
The system uses two complementary webhooks to ensure all call outcomes are tracked, **with special logic to prevent successful classification calls from consuming retry attempts:**

```mermaid
graph TD
    A[Call Initiated] --> B{Call Type?}
    
    B -->|Classification Call| C[Detect Phone System]
    C --> D{Classification Success?}
    
    D -->|IVR/Human Detected| E[Store Classification]
    E --> F[Set classification_successful=true]
    F --> G[End Call Early]
    G --> H{VAPI Webhook Fires}
    H --> I{Check: classification_successful?}
    I -->|YES| J[✅ Skip Retry Increment<br/>Keep retry_count=0]
    
    G --> K{CSC Webhook Fires}
    K --> L{Check: classification_successful?}
    L -->|YES| M[✅ Skip Retry Increment<br/>Audit Only]
    
    D -->|Voicemail Hit| N{isClassificationCall?}
    N -->|YES| O[✅ Skip Retry Increment<br/>Schedule 1hr Retry]
    N -->|NO| P[❌ Increment Retry<br/>Task Call Failed]
    
    B -->|Task Call| Q{Call Connects?}
    
    Q -->|No| R[Connection Failed]
    R --> S[CSC Webhook Fires]
    S --> T[❌ Increment Retry Count]
    
    Q -->|Yes| U{VAPI Engages?}
    
    U -->|No| V[Disconnect/Incomplete]
    V --> W[CSC Webhook Fires]
    W --> T
    
    U -->|Yes| X[Full Conversation]
    X --> Y[VAPI Completes]
    Y --> Z{Success Evaluation?}
    
    Z -->|Sending Records| AA[✅ Completed]
    Z -->|No Show| AA
    Z -->|Unable to Connect| T
    
    T --> AB{Max Retries?}
    AB -->|No| AC[retry_pending<br/>Exponential Backoff]
    AB -->|Yes| AD[❌ Mark Failed]
    
    style J fill:#90EE90
    style M fill:#90EE90
    style O fill:#90EE90
    style T fill:#FFB6C1
    style AD fill:#ff6666
```

#### **VAPI Post-Call Webhook** (`api/vapi/post_call.js`)
- **When it fires:** After VAPI completes a conversation OR when call disconnects
- **Handles:** Successful conversations, "Unable to connect" responses
- **NEW: Classification protection:** Checks if this was a successful classification call before incrementing retry
- **Logic:**
  ```javascript
  IF (workflow_state === 'classifying' || 'classification_pending')
     AND classification_successful === true
     AND successEvaluation === 'Unable to connect'
  THEN
     → Skip retry increment (expected disconnect)
     → Log metadata only
  ELSE
     → Normal retry logic
  ```

#### **Twilio Call Status Complete Webhook** (`api/twilio/call-status-complete.js`)
- **When it fires:** When any Twilio call ends
- **Handles:** Quick hangups, connection failures, incomplete calls
- **Request method:** Handles both GET (query parameters) and POST (body) from Twilio
- **NEW: Classification protection:** Checks if classification was stored before incrementing retry
- **Logic:**
  ```javascript
  // Parse request (GET query params or POST body)
  IF req.method === 'GET' THEN
     → Parse query string from URL
  ELSE
     → Parse POST body

  // Check for successful classification
  IF (workflow_state === 'classification_pending' || 'classifying')
     AND (classification_successful === true
          OR classification_stored_at exists)
  THEN
     → Skip retry increment (classification succeeded)
     → Update call_sessions.call_status = 'completed'
     → Update audit trail only
  ELSE
     → Check for incomplete call conditions
     → Increment retry count if applicable
     → Schedule retry with exponential backoff
  ```

#### **Scheduler Orphan Detection**
- **When it runs:** Every minute
- **Handles:** Calls stuck in 'calling' state > 5 minutes
- **Safety net for:** Failed webhooks or network issues
- **Retry logic:** Increments retry count for orphaned calls

## Benefits
- ⚡ **Speed**: Reduce call connection time from ~10s to ~5s
- 💰 **Cost**: One classification per clinic per month instead of every call
- 🎯 **Reliability**: Predictable routing behavior with automated retries
- 📊 **Scalability**: Handle high call volumes with batch processing
- 🤖 **Automation**: Fully automated workflow from classification to completion
- 🔄 **Self-Healing**: Automatic retries for failed connections and voicemail
- 📧 **Smart Detection**: Voicemail detection prevents false IVR classifications
- 🌎 **Timezone Aware**: Respects each clinic's local business hours (9 AM - 5 PM)
- 🛡️ **Robust Retry**: Multi-layered retry system catches all failure types
- ⚙️ **Smart Retry Preservation**: Classification calls don't burn retry attempts

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
   - **For classification calls:** Does NOT increment retry_count
   - **For task calls:** Does increment retry_count
   - Triggers retry in 1 hour
   - Call ends immediately to save costs

## Retry Management System

### Failure Types & Handling

| Failure Type | Detected By | Classification Call | Task Call | Retry Delay | Max Retries |
|-------------|------------|---------------------|-----------|-------------|-------------|
| IVR detected & stored | server_deepgram | ✅ Skip increment | N/A | Move to next phase | N/A |
| Voicemail during classification | server_deepgram | ✅ Skip increment | ❌ Increment | 60 min | 3 |
| VAPI disconnect (classification success) | post_call.js | ✅ Skip increment | ❌ Increment | N/A | 3 |
| Quick hangup (<5s) | CSC Webhook | ✅ Skip if classified | ❌ Increment | 5/15/30 min | 3 |
| Connection failed | CSC Webhook | ✅ Skip if classified | ❌ Increment | 5/15/30 min | 3 |
| Incomplete call (<30s) | CSC Webhook | ✅ Skip if classified | ❌ Increment | 5/15/30 min | 3 |
| VAPI "Unable to connect" | post_call.js | N/A | ❌ Increment | 5/15/30 min | 3 |
| Orphaned call (>5min) | Scheduler | ✅ Skip if classified | ❌ Increment | 5/15/30 min | 3 |

### Classification Success Indicators

The system uses multiple indicators to identify successful classification calls:

1. **`workflow_metadata.classification_successful = true`** - Set by server_deepgram when classification is stored
2. **`workflow_metadata.classification_stored_at`** - Timestamp when classification was saved
3. **`classification_id` exists** - Foreign key to call_classifications table
4. **`workflow_state = 'classification_pending'`** - Call moved to next phase after successful classification

### Exponential Backoff Strategy
- **1st retry:** 5 minutes
- **2nd retry:** 15 minutes
- **3rd retry:** 30 minutes
- **After 3rd failure:** Marked as `failed` (terminal state)

### Race Condition Prevention
The system includes multiple safeguards against webhook race conditions:
1. **State checking** - Webhooks check for terminal states before processing
2. **Classification checking** - Both webhooks check for classification success flags
3. **VAPI data checking** - CSC webhook checks for existing VAPI data
4. **Timing checks** - Both webhooks check for recent updates (< 3-5 seconds)
5. **Database constraints** - Unique constraints prevent duplicate records

## Timezone-Aware Scheduling

### Supported Timezones
The system supports all major US timezones:
- **Eastern**: `America/New_York` (EST/EDT)
- **Central**: `America/Chicago` (CST/CDT)
- **Mountain**: `America/Denver` (MST/MDT)
- **Pacific**: `America/Los_Angeles` (PST/PDT)

### Business Hours Windows
Each clinic is called only during their local 9 AM - 5 PM window:

| Timezone | Local Hours | UTC Hours (EDT/Summer) | UTC Hours (EST/Winter) |
|----------|------------|------------------------|------------------------|
| Eastern | 9 AM - 5 PM | 13:00 - 21:00 | 14:00 - 22:00 |
| Central | 9 AM - 5 PM | 14:00 - 22:00 | 15:00 - 23:00 |
| Mountain | 9 AM - 5 PM | 15:00 - 23:00 | 16:00 - 00:00 |
| Pacific | 9 AM - 5 PM | 16:00 - 00:00 | 17:00 - 01:00 |

### Scheduler Configuration
The cron job runs during an expanded window but only processes clinics currently in business hours:

```sql
-- Cron runs from 13:00 UTC to 01:00 UTC to cover all US timezones
SELECT cron.schedule(
  'call-scheduler',
  '* 13-23,0-1 * * 1-5',  -- Monday-Friday, expanded hours
  $$
  SELECT net.http_post(...)
  WHERE EXISTS (
    SELECT 1 FROM pending_calls
    WHERE 
      workflow_state IN ('new', 'checking_classification', 'ready_to_call', 'retry_pending')
      AND next_action_at <= NOW()
      AND (
        -- Automatically handles DST transitions
        (clinic_timezone = 'America/New_York' 
          AND EXTRACT(HOUR FROM NOW() AT TIME ZONE clinic_timezone) BETWEEN 9 AND 16)
        OR (clinic_timezone = 'America/Chicago'
          AND EXTRACT(HOUR FROM NOW() AT TIME ZONE clinic_timezone) BETWEEN 9 AND 16)
        OR (clinic_timezone = 'America/Denver'
          AND EXTRACT(HOUR FROM NOW() AT TIME ZONE clinic_timezone) BETWEEN 9 AND 16)
        OR (clinic_timezone = 'America/Los_Angeles'
          AND EXTRACT(HOUR FROM NOW() AT TIME ZONE clinic_timezone) BETWEEN 9 AND 16)
        OR (clinic_timezone IS NULL 
          AND EXTRACT(HOUR FROM NOW() AT TIME ZONE 'America/New_York') BETWEEN 9 AND 16)
      )
  );
  $$
);
```

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
| `retry_pending` | Call failed, waiting to retry | Retry after delay (5/15/30/60 min) | VAPI failure, voicemail, or disconnect |
| `completed` | Call successfully completed | None - terminal state | VAPI "Sending Records" or "No Show" |
| `failed` | Max retries exceeded | None - terminal state | After 3 failed attempts |

### State Transition Flows

#### Scenario 1: New Call with Existing Classification
```
new → checking_classification → ready_to_call → calling → completed
(retry_count never incremented - classification already exists)
```

#### Scenario 2: New Call Requiring Classification (IVR)
```
new → checking_classification → needs_classification → classifying → classification_pending → ready_to_call → calling → completed
(retry_count = 0 throughout - classification call doesn't increment)
```

#### Scenario 3: New Call with Human Answer
```
new → checking_classification → needs_classification → classifying → calling → completed
(retry_count = 0 - classification call doesn't increment)
```

#### Scenario 4: Voicemail Encounter During Classification
```
new → checking_classification → needs_classification → classifying → retry_pending → ready_to_call → calling → completed
(retry_count = 0 after voicemail - classification calls don't increment)
```

#### Scenario 5: Voicemail Encounter During Task Call
```
calling → retry_pending (retry_count = 1) → calling → retry_pending (retry_count = 2) → calling → completed
(retry_count properly increments for task call failures)
```

#### Scenario 6: Failed Call with Retry to Failure
```
calling → retry_pending (retry_count = 1) → calling → retry_pending (retry_count = 2) → calling → retry_pending (retry_count = 3) → failed
(After 3 failed task call attempts, automatically transitions to 'failed' state)
```

## Architecture Flow

### 1. SCHEDULER ORCHESTRATION (pg_cron every minute)
```
├─> Check for orphaned calls (stuck > 5 minutes)
│   ├─> Check if classification was successful
│   ├─> If classification successful: Don't increment retry
│   └─> If task call: Increment retry, set to retry_pending or failed
├─> Check current time against timezone windows
├─> Find pending calls needing action (next_action_at <= NOW)
├─> Filter for clinics in business hours (9 AM - 5 PM local)
├─> Process by workflow_state:
│   ├─> new → Check classification
│   ├─> classification_pending → Trigger task call
│   ├─> ready_to_call → Trigger task call
│   └─> retry_pending → Check max_retries → Retry or mark failed
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
├─> Configure Twilio webhooks:
│   ├─> TwiML webhook for call routing (Url parameter)
│   └─> StatusCallback webhook for disconnect detection
│       ├─> StatusCallback: ${WEBHOOK_BASE_URL}/api/twilio/call-status-complete
│       ├─> StatusCallbackEvent: ['completed']
│       └─> StatusCallbackMethod: 'POST' (Twilio may send GET)
└─> Initiate Twilio call
```

**Required Environment Variable:**
- `WEBHOOK_BASE_URL`: Base URL for webhooks (e.g., `https://your-app.vercel.app`)

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
│   ├─> Voicemail patterns → End call, NO retry increment for classification calls
│   ├─> Human patterns → Let VAPI continue, set classification_successful=true
│   └─> IVR patterns → Navigate and capture actions, set classification_successful=true
├─> OpenAI classification after 3 seconds
├─> Store classification state in session
├─> Update pending_call workflow state with classification_successful flag
├─> For IVR: Navigate and log actions with timing
├─> For IVR_then_human: Capture transfer timing
├─> For Voicemail (classification): Skip classification storage, NO retry increment
├─> For Voicemail (task call): Increment retry count normally
├─> Auto-terminate classification calls after capturing needed data
└─> Store final classification when call ends (except voicemail)
```

### 5. VAPI INTEGRATION & COMPLETION
```
├─> VAPI receives call with pending_call_id
├─> Fetches full call data via API endpoint
├─> NEW: Check if this is a successful classification call
│   └─> If yes: Skip retry increment, log metadata only
├─> Conducts conversation with clinic
├─> Posts results back with success evaluation:
│   ├─> "Sending Records" → completed, retry_count = 0
│   ├─> "No Show" → completed
│   └─> "Unable to connect" → increment retry (task calls only) → retry_pending or failed
├─> Updates workflow state in pending_calls
└─> Stores complete history in call_sessions
```

### 6. DISCONNECT DETECTION (CSC Webhook)
```
├─> Twilio sends call status on completion
├─> NEW: Check if classification was successful
│   └─> If yes: Skip retry increment, audit trail only
├─> Check if VAPI already processed
├─> If not processed and:
│   ├─> Duration < 5s → Quick hangup detected
│   ├─> Status = failed/busy/no-answer → Connection failed
│   └─> Duration < 30s → Incomplete interaction
├─> Increment retry count (task calls only)
├─> Check max retries:
│   ├─> Under limit → Set retry_pending with backoff
│   └─> At/over limit → Mark as failed
└─> Update call_sessions for audit trail
```

## Database Schema

### 1. pending_calls Table (with Timezone Support, Retry Management & Archiving)
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
  clinic_timezone TEXT DEFAULT 'America/New_York',  -- Timezone support
  appointment_time TIMESTAMPTZ,

  -- Workflow management
  workflow_state TEXT DEFAULT 'new',
  classification_id UUID REFERENCES call_classifications(id),
  classification_lookup_at TIMESTAMPTZ,
  retry_count INT DEFAULT 0,              -- Tracks retry attempts (task calls only)
  max_retries INT DEFAULT 3,              -- Configurable max retries
  next_action_at TIMESTAMPTZ DEFAULT NOW(),
  last_error TEXT,                        -- Latest error message
  last_attempt_at TIMESTAMPTZ,            -- When last attempted
  workflow_metadata JSONB DEFAULT '{}',   -- Latest state + classification_successful flag
  is_active BOOLEAN DEFAULT true,         -- Archive status (false = archived)

  -- Call results (overwritten with each attempt)
  call_status TEXT,
  trigger_attempted_at TIMESTAMPTZ,
  trigger_response JSONB,
  summary TEXT,
  success_evaluation TEXT,
  structured_data JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()    -- Track last update time
);

-- Index for efficient active call queries
CREATE INDEX idx_pending_calls_is_active ON pending_calls(is_active) WHERE is_active = true;
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
  call_status TEXT,                  -- active, completed, voicemail, failed
  ivr_detection_state TEXT,          -- human, ivr_only, ivr_then_human, voicemail
  ivr_classified_at TIMESTAMPTZ,
  ivr_detection_latency_ms INT4,
  ivr_confidence_score FLOAT8,
  stream_started BOOLEAN DEFAULT false,
  workflow_metadata JSONB DEFAULT '{}',  -- Complete history + classification flags
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
```

### 3. call_classifications Table (with Timezone)
```sql
CREATE TABLE call_classifications (
  id UUID PRIMARY KEY,
  phone_number TEXT NOT NULL,
  clinic_name TEXT,
  clinic_timezone TEXT DEFAULT 'America/New_York',  -- Timezone support
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

#### Classification Calls (Voicemail Hit)
1. **Detection** - Fast classifier identifies voicemail patterns
2. **No Classification** - Voicemail is NOT stored as a classification
3. **Call Termination** - Call ends immediately to save costs
4. **✅ NO Retry Increment** - retry_count stays at 0 (classification call)
5. **Metadata Logging** - Logged with `retry_count_not_incremented: true`
6. **Retry Scheduling** - Set to retry_pending with 1-hour delay
7. **Fresh Classification** - Next attempt will classify fresh (no cached result)

#### Task Calls (Voicemail Hit)
1. **Detection** - Fast classifier identifies voicemail patterns
2. **Call Termination** - Call ends immediately to save costs
3. **❌ Retry Increment** - retry_count increments (1, 2, or 3)
4. **Max Retry Check** - Marks as failed if max retries exceeded
5. **Metadata Logging** - Logged in call_sessions for tracking
6. **Retry Scheduling** - Set to retry_pending with 1-hour delay (if under max)

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

### Check Classification Call Behavior
```sql
-- Verify classification calls don't increment retry_count
SELECT 
  pc.id,
  pc.employee_name,
  pc.clinic_name,
  pc.workflow_state,
  pc.retry_count,  -- Should be 0 after classification
  pc.classification_id,
  pc.workflow_metadata->>'classification_successful' as classification_ok,
  pc.workflow_metadata->>'retry_count_not_incremented' as skip_flag,
  cs.workflow_metadata->>'retry_increment_skipped' as csc_skip,
  cs.workflow_metadata->>'classification_stored_at' as stored_at,
  cs.ivr_detection_state
FROM pending_calls pc
LEFT JOIN call_sessions cs ON cs.pending_call_id = pc.id
WHERE 
  pc.created_at > NOW() - INTERVAL '24 hours'
  AND (
    pc.classification_id IS NOT NULL
    OR pc.workflow_state IN ('classification_pending', 'classifying')
  )
ORDER BY pc.created_at DESC;

-- Expected results for successful classification calls:
-- retry_count: 0
-- workflow_state: 'classification_pending' or 'ready_to_call'
-- classification_successful: 'true'
-- retry_increment_skipped: 'true' (from webhooks)
```

### Check Scheduler Status with Timezone Info
```sql
-- View current business hours status across timezones
SELECT 
  tz as timezone,
  TO_CHAR(NOW() AT TIME ZONE tz, 'HH24:MI') as local_time,
  CASE 
    WHEN EXTRACT(HOUR FROM NOW() AT TIME ZONE tz) BETWEEN 9 AND 16 
     AND EXTRACT(DOW FROM NOW() AT TIME ZONE tz) BETWEEN 1 AND 5
    THEN '✅ Business Hours'
    ELSE '❌ Closed'
  END as status,
  COUNT(pc.id) as pending_calls
FROM (
  VALUES 
    ('America/New_York'),
    ('America/Chicago'),
    ('America/Denver'),
    ('America/Los_Angeles')
) t(tz)
LEFT JOIN pending_calls pc ON pc.clinic_timezone = t.tz
  AND pc.workflow_state NOT IN ('completed', 'failed', 'pending')
GROUP BY tz;

-- Monitor retry distribution (should show 0 for classification calls)
SELECT 
  workflow_state,
  retry_count,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE classification_id IS NOT NULL) as with_classification,
  CASE 
    WHEN retry_count >= COALESCE(max_retries, 3) AND workflow_state = 'retry_pending' 
    THEN '⚠️ SHOULD BE FAILED'
    WHEN workflow_state = 'failed' 
    THEN '❌ FAILED'
    WHEN workflow_state = 'completed' 
    THEN '✅ COMPLETED'
    WHEN workflow_state IN ('classification_pending', 'ready_to_call') AND retry_count = 0
    THEN '✅ CLASSIFICATION OK'
    ELSE '🔄 IN PROGRESS'
  END as status_check
FROM pending_calls
WHERE workflow_state NOT IN ('pending')
GROUP BY workflow_state, retry_count, max_retries
ORDER BY workflow_state, retry_count;

-- Check for orphaned calls
SELECT 
  id,
  employee_name,
  clinic_name,
  workflow_state,
  retry_count || '/' || COALESCE(max_retries, 3) as attempts,
  classification_id,
  workflow_metadata->>'classification_successful' as class_success,
  ROUND(EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60::numeric, 1) as minutes_in_state,
  CASE 
    WHEN EXTRACT(EPOCH FROM (NOW() - updated_at)) > 300 
    THEN '⚠️ Stuck - been calling for > 5 minutes'
    ELSE '✅ Normal'
  END as status
FROM pending_calls
WHERE workflow_state IN ('calling', 'classifying')
ORDER BY updated_at ASC;

-- View disconnect patterns
SELECT 
  DATE_TRUNC('hour', cs.created_at) as hour,
  COUNT(*) FILTER (WHERE cs.workflow_metadata->>'incomplete_call_detected' = 'true') as disconnects,
  COUNT(*) FILTER (WHERE cs.workflow_metadata->>'retry_increment_skipped' = 'true') as classification_skips,
  COUNT(*) FILTER (WHERE cs.workflow_metadata->>'detection_reason' = 'quick_hangup') as quick_hangups,
  COUNT(*) FILTER (WHERE cs.workflow_metadata->>'voicemail_detected' = 'true') as voicemails,
  COUNT(*) as total_calls,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE cs.workflow_metadata->>'incomplete_call_detected' = 'true') / 
    NULLIF(COUNT(*), 0), 1
  ) as disconnect_rate_pct
FROM call_sessions cs
WHERE cs.created_at > NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', cs.created_at)
ORDER BY hour DESC;
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

-- Fix stuck calls with retry increment (only for task calls)
UPDATE pending_calls
SET 
  workflow_state = 'retry_pending',
  retry_count = CASE 
    WHEN classification_id IS NULL THEN retry_count  -- Don't increment if classifying
    ELSE retry_count + 1  -- Increment for task calls
  END,
  last_error = 'Call stuck - manual intervention',
  next_action_at = NOW() + INTERVAL '5 minutes',
  updated_at = NOW()
WHERE 
  workflow_state IN ('calling', 'classifying')
  AND updated_at < NOW() - INTERVAL '5 minutes';
```

### Control Scheduler
```sql
-- Pause scheduler
UPDATE cron.job SET active = false WHERE jobname = 'call-scheduler';

-- Resume scheduler
UPDATE cron.job SET active = true WHERE jobname = 'call-scheduler';

-- Manual run (respects timezone filtering)
SELECT net.http_post(
  url := 'https://YOUR_PROJECT.supabase.co/functions/v1/scheduler',
  headers := jsonb_build_object(
    'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
    'Content-Type', 'application/json'
  ),
  body := '{}'::jsonb
);
```

## Call Archiving System

### Overview
The system automatically archives old completed/failed calls to keep the dashboard clean and performant while preserving historical data.

### Archiving Rules
Calls are marked as inactive (`is_active = false`) when:
- `workflow_state` is `'completed'` OR `'failed'`
- AND `updated_at` is older than 30 days (inactivity period)
- AND `is_active` is currently `true`

**Important**: Archived calls are NOT automatically un-archived if updated. Restoration requires manual intervention.

### Archive Function
```sql
-- Function to archive old calls
CREATE OR REPLACE FUNCTION archive_old_calls()
RETURNS TABLE(
  archived_count INT,
  archived_ids UUID[]
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_archived_count INT;
  v_archived_ids UUID[];
BEGIN
  WITH archived AS (
    UPDATE pending_calls
    SET
      is_active = false,
      updated_at = NOW()
    WHERE
      workflow_state IN ('completed', 'failed')
      AND updated_at < NOW() - INTERVAL '30 days'
      AND is_active = true
    RETURNING id
  )
  SELECT
    COUNT(*)::INT,
    ARRAY_AGG(id)
  INTO v_archived_count, v_archived_ids
  FROM archived;

  RAISE NOTICE 'Archived % calls: %', v_archived_count, v_archived_ids;
  RETURN QUERY SELECT v_archived_count, v_archived_ids;
END;
$$;
```

### Automated Archiving Setup
```sql
-- Schedule archiving to run daily at 2 AM UTC
SELECT cron.schedule(
  'archive-old-calls',
  '0 2 * * *',
  $$SELECT archive_old_calls();$$
);

-- Check archiving job status
SELECT * FROM cron.job WHERE jobname = 'archive-old-calls';

-- View archiving job history
SELECT *
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'archive-old-calls')
ORDER BY start_time DESC
LIMIT 10;
```

### Manual Archiving Operations
```sql
-- Run archiving manually
SELECT * FROM archive_old_calls();
-- Returns: archived_count: 15, archived_ids: {uuid1, uuid2, ...}

-- Preview calls that would be archived
SELECT
  id,
  employee_name,
  clinic_name,
  workflow_state,
  updated_at,
  AGE(NOW(), updated_at) as time_since_update
FROM pending_calls
WHERE
  workflow_state IN ('completed', 'failed')
  AND updated_at < NOW() - INTERVAL '30 days'
  AND is_active = true
ORDER BY updated_at ASC;

-- Archive specific call manually
UPDATE pending_calls
SET is_active = false, updated_at = NOW()
WHERE id = 'YOUR_CALL_ID';

-- Un-archive a call (restore to active)
UPDATE pending_calls
SET is_active = true, updated_at = NOW()
WHERE id = 'YOUR_CALL_ID';

-- View archiving statistics
SELECT
  is_active,
  workflow_state,
  COUNT(*) as count
FROM pending_calls
GROUP BY is_active, workflow_state
ORDER BY is_active DESC, workflow_state;
```

### Dashboard Integration
The dashboard includes an "Archive" filter that allows viewing:
- **Active Only** (default): Shows only active calls (`is_active = true`)
- **Inactive Only**: Shows only archived calls (`is_active = false`)
- **Both**: Shows all calls regardless of archive status

Filter state is saved to localStorage and persists across sessions.

### Archiving Best Practices
1. **Monitor first runs**: Check `cron.job_run_details` after enabling automated archiving
2. **Review retention period**: Adjust the 30-day interval if needed for your use case
3. **Backup before bulk operations**: Create backup of `is_active` states before manual bulk archiving
4. **Periodic review**: Check archived calls quarterly to ensure nothing important is hidden
5. **Performance monitoring**: Track dashboard load times before/after archiving implementation

For complete archiving documentation, see `ARCHIVING.md`.

## Performance & Optimization

### Timing Configuration
- **Scheduler frequency**: Every minute during 13:00-01:00 UTC
- **Orphan detection**: Checks for calls stuck > 5 minutes
- **Timezone filtering**: Only processes clinics in their local 9 AM - 5 PM
- **Classification wait**: 30 seconds before task call
- **Retry delays**: 
  - Standard failures: 5, 15, 30 minutes (exponential)
  - Voicemail: 60 minutes
  - Quick disconnects: 5, 15, 30 minutes
- **Max retries**: 3 attempts (configurable per call)
- **Classification cache**: 30 days

### Efficiency Features
- **Classification retry preservation**: Successful classifications don't burn retry attempts
- **Multi-layered retry system**: Webhooks + Scheduler ensure no missed failures
- **Timezone-aware batching**: Processes calls by local business hours
- **Smart scheduling**: Cron only triggers when eligible calls exist
- Batch processing (10 calls per scheduler run)
- Connection reuse (30-second WebSocket cache)
- Automatic call termination for IVR/voicemail classification
- Parallel processing within batches
- Cost savings through voicemail detection
- Race condition prevention in webhooks

## Success Evaluation Types

The system handles four distinct outcomes:

1. **"Sending Records"** - Success! Clinic is sending the requested records
   - Sets `workflow_state = 'completed'`
   - Resets `retry_count = 0`
   - No retries needed
   - Logged to both pending_calls and call_sessions

2. **"No Show"** - Employee didn't attend appointment
   - Sets `workflow_state = 'completed'`
   - Terminal state, no retries
   - Logged to both pending_calls and call_sessions

3. **"Unable to connect"** - Failed to reach clinic representative
   - **For classification calls:** Skip retry increment (expected disconnect)
   - **For task calls:** Increments retry_count
   - Sets `workflow_state = 'retry_pending'`
   - Automatic retry after 5/15/30 minutes
   - Up to 3 retry attempts before marking as 'failed'

4. **Connection Failures** - Technical issues detected by CSC webhook
   - Quick hangup (< 5 seconds)
   - Busy/No answer/Failed/Canceled
   - Incomplete interaction (< 30 seconds)
   - **For classification calls:** Skip retry increment if classification successful
   - **For task calls:** Increments retry_count
   - Sets `workflow_state = 'retry_pending'`
   - Same exponential backoff strategy

5. **Voicemail Detected** - Reached voicemail system
   - **For classification calls:** NO retry increment
   - **For task calls:** Increments retry_count
   - Sets `workflow_state = 'retry_pending'`
   - NO classification stored
   - Retry after 60 minutes
   - Fresh classification on next attempt

## Metadata Storage Strategy

### pending_calls.workflow_metadata
- **Purpose**: Current state and latest attempt info
- **Behavior**: Overwritten with each update
- **Use Case**: Workflow decisions and current status
- **New Fields:**
  - `classification_successful: true` - Indicates classification was stored
  - `retry_count_not_incremented: true` - Classification call didn't burn retry

### call_sessions.workflow_metadata
- **Purpose**: Complete historical record
- **Behavior**: Preserved for each call attempt
- **Use Case**: Debugging, analytics, audit trail
- **New Fields:**
  - `classification_stored_at` - When classification was saved
  - `retry_increment_skipped` - Webhook skipped retry increment
  - `skip_reason` - Why retry was skipped

Example call_sessions.workflow_metadata for successful classification:
```json
{
  // Classification data
  "classification_type": "ivr_then_human",
  "classification_stored_at": "2025-01-15T10:30:45Z",
  "classification_successful": true,
  "ivr_actions": [...],
  "transfer_timing_ms": 15000,
  
  // Webhook behavior
  "retry_increment_skipped": true,
  "skip_reason": "successful_classification",
  "vapi_disconnect_expected": true,
  "classification_call_ended_early": true,
  
  // VAPI results (for early disconnect)
  "vapi_success_evaluation": "Unable to connect",
  "vapi_summary": null
}
```

Example call_sessions.workflow_metadata for voicemail during classification:
```json
{
  // Voicemail detection
  "voicemail_detected": true,
  "classification_skipped": true,
  "retry_count_not_incremented": true,
  "reason": "voicemail_not_persistent_state",
  
  // Classification incomplete
  "classification_incomplete": true,
  "retry_scheduled": true,
  "should_retry": true
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
   - Timezone filtering prevents off-hours calls
   - Max retry limits prevent infinite loops
   - Classification calls don't consume retry attempts

## Implementation Checklist

### Required Components
- [x] Deploy `scheduler` edge function with orphan detection
- [x] Deploy `pre-classify-call-07-21-2025` edge function
- [x] Deploy `api/twilio/preclassify-twiml.js`
- [x] Deploy `api/twilio/call-status-complete.js` **with classification skip logic**
- [x] Deploy `api/vapi/post_call.js` **with classification skip logic**
- [x] Deploy WebSocket server (`server_deepgram.js`) **with classification success flagging**
- [x] Configure Twilio webhooks for status callbacks
- [x] Set up pg_cron for automated scheduling
- [x] Configure timezone data for clinics

### Monitoring Setup
- [ ] Set up alerts for failed calls exceeding threshold
- [ ] Monitor retry distribution daily (verify classification calls have retry_count=0)
- [ ] Track disconnect patterns
- [ ] Review orphaned call detection logs
- [ ] Verify timezone-based calling patterns
- [ ] **Monitor classification_successful flag usage**
- [ ] **Verify retry_increment_skipped in webhooks**

## Testing Checklist

### Test 1: IVR Classification (Should NOT increment retry)
```sql
-- Create test call
INSERT INTO pending_calls (id, employee_name, clinic_name, phone, workflow_state, retry_count)
VALUES (gen_random_uuid(), 'Test Employee', 'Test IVR Clinic', '+15551234567', 'new', 0);

-- After classification call completes, verify:
SELECT 
  retry_count,  -- Expected: 0 (not incremented)
  workflow_state,  -- Expected: 'classification_pending'
  classification_id,  -- Expected: [UUID]
  workflow_metadata->>'classification_successful' as success_flag,  -- Expected: 'true'
  workflow_metadata->>'retry_increment_skipped' as skip_flag  -- Expected: 'true'
FROM pending_calls WHERE clinic_name = 'Test IVR Clinic';
```

### Test 2: Classification Call Hits Voicemail (Should NOT increment retry)
```sql
-- After voicemail detected during classification:
SELECT 
  retry_count,  -- Expected: 0 (not incremented)
  workflow_state,  -- Expected: 'retry_pending'
  workflow_metadata->>'retry_count_not_incremented' as skip_flag,  -- Expected: 'true'
  next_action_at  -- Expected: NOW + 1 hour
FROM pending_calls WHERE clinic_name = 'Test VM Clinic';
```

### Test 3: Task Call Fails (Should increment retry)
```sql
-- After task call failure:
SELECT 
  retry_count,  -- Expected: 1, then 2, then 3
  workflow_state,  -- Expected: 'retry_pending' or 'failed' after 3
  last_error
FROM pending_calls WHERE clinic_name = 'Test Task Fail';
```

### Test 4: Task Call Hits Voicemail (Should increment retry)
```sql
-- After voicemail detected during task call:
SELECT 
  retry_count,  -- Expected: incremented (1, 2, or 3)
  workflow_state,  -- Expected: 'retry_pending' or 'failed'
  workflow_metadata->>'voicemail_count' as vm_count
FROM pending_calls WHERE clinic_name = 'Test Task VM';
```

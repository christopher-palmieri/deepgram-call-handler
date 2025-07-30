# Pre-Classification Call System

## Overview
This system pre-classifies clinic phone systems (human vs IVR vs IVR-then-human) and caches the results for 30 days, enabling instant routing for subsequent calls. The system uses intelligent call handling to minimize wasted time on IVR systems during classification.

**Core Concept**: Make a test call to each clinic once, learn how their phone system works, then use that knowledge for all future calls to save time and improve reliability.

## System Components

### 1. **Edge Functions** (Supabase)
- `pre-classify-call/index.ts`: Entry point that initiates calls using a hardcoded pending_call_id

### 2. **API Endpoints** (Vercel)
- `api/twilio/preclassify-twiml.js`: Routes calls based on classification (TwiML webhook)
- `api/twilio/get-pending-call.js`: Provides call data to VAPI (secured with shared secret)
- `api/vapi/post_call.js`: Receives call results from VAPI (secured with bearer token)

### 3. **WebSocket Server** (Railway)
- `server_deepgram.js`: Real-time call classification and IVR navigation
- Modules:
  - `ivr-navigator.js`: OpenAI-powered IVR menu navigation
  - `fast-classifier.js`: Pattern matching for instant classification
  - `openai-classifier.js`: AI classification for complex cases
  - `supabase-logger-twilio.js`: Stores classifications and manages call state

## Benefits
- ⚡ **Speed**: Reduce call connection time from ~10s to ~5s
- 💰 **Cost**: One classification per clinic per month instead of every call
- 🎯 **Reliability**: Predictable routing behavior
- 📊 **Scalability**: Handle high call volumes without classification bottleneck
- 🤖 **Efficiency**: Automatic call termination for IVR systems after classification

## Architecture Flow

### 1. CALL INITIATION (Edge Function)
```
├─> Hardcoded pending_call_id (for testing)
├─> Fetch pending call details from Supabase
├─> Check for existing classification
├─> Create call session
├─> Pass parameters to TwiML handler via URL
└─> Initiate Twilio call
```

### 2. CALL ROUTING (TwiML Handler)
```
├─> Retrieve session and classification data
├─> Build SIP headers with pending call info
├─> Route based on classification:
│   ├─> Human → Direct VAPI connection
│   ├─> IVR → Execute stored actions → VAPI
│   └─> Unknown → Dual stream (VAPI + WebSocket)
└─> Pass employee data in SIP headers
```

### 3. CLASSIFICATION PROCESS (WebSocket Server)
```
├─> Connect to Deepgram for transcription
├─> Fast pattern matching for instant detection
├─> OpenAI classification after 3 seconds
├─> Store classification state in session
├─> For IVR: Navigate and log first action
├─> Auto-terminate call after IVR action logged
└─> Store final classification when call ends
```

### 4. VAPI INTEGRATION
```
├─> VAPI receives call with pending_call_id
├─> Fetches full call data via API endpoint
├─> Conducts conversation with clinic
└─> Posts results back to Supabase
```

## Database Schema

### 1. pending_calls Table
Stores exam/appointment data from external systems with all necessary context for VAPI.
```sql
CREATE TABLE pending_calls (
  id UUID PRIMARY KEY,
  exam_id TEXT,                      -- External reference ID
  employee_name TEXT,                -- Patient name
  employee_dob DATE,                 -- Patient date of birth
  client_name TEXT,                  -- Employer/company name
  phone TEXT,                        -- Clinic phone number to call
  clinic_name TEXT,                  -- Name of the medical clinic
  appointment_time TIMESTAMPTZ,      -- When the appointment is scheduled
  type_of_visit TEXT,                -- Visit type (e.g., "Annual Physical")
  clinic_provider_address TEXT,      -- Clinic address
  clinic_scheduling_rep TEXT,        -- Name of scheduling contact
  procedures TEXT,                   -- Medical procedures needed
  call_status TEXT,                  -- Status: pending, calling, completed, failed
  trigger_attempted_at TIMESTAMPTZ,  -- When call was initiated
  trigger_response JSONB,            -- Twilio API response
  summary TEXT,                      -- VAPI's call summary
  success_evaluation BOOLEAN,        -- Whether call succeeded
  structured_data JSONB,             -- VAPI's structured extraction
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. call_sessions Table
Tracks individual call attempts and classification states.
```sql
CREATE TABLE call_sessions (
  id UUID PRIMARY KEY,
  call_id TEXT UNIQUE,               -- Twilio Call SID
  pending_call_id UUID REFERENCES pending_calls(id),  -- Link to pending call
  clinic_phone TEXT,                 -- Phone number being called
  classification_id UUID REFERENCES call_classifications(id),  -- Pre-existing classification
  call_status TEXT,                  -- active, completed, failed
  ivr_detection_state TEXT,          -- human, ivr_only, ivr_then_human
  ivr_classified_at TIMESTAMPTZ,     -- When classification was made
  ivr_detection_latency_ms INT4,     -- Time to classify (ms)
  ivr_confidence_score FLOAT8,       -- Classification confidence (0-1)
  stream_started BOOLEAN DEFAULT false,  -- WebSocket connected
  needs_ivr_actions BOOLEAN DEFAULT false,  -- Collecting IVR navigation
  twilio_call_sid TEXT,              -- Main call SID
  vapi_disconnected BOOLEAN DEFAULT false,  -- VAPI was disconnected
  vapi_disconnect_reason TEXT,       -- Why VAPI was disconnected
  call_ended_by TEXT,                -- Who ended the call
  call_end_reason TEXT,              -- Why call ended
  ended_at TIMESTAMPTZ,              -- When call ended
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. call_classifications Table
Stores pre-classified phone system types and IVR navigation paths with timing.
```sql
CREATE TABLE call_classifications (
  id UUID PRIMARY KEY,
  phone_number TEXT NOT NULL,        -- Clinic phone number
  clinic_name TEXT,                  -- Clinic name (often "Unknown Clinic")
  classification_type TEXT,          -- 'human', 'ivr_only', 'ivr_then_human'
  classification_confidence FLOAT8,   -- Confidence score
  ivr_actions JSONB,                 -- Array of navigation actions with timing
  classification_duration_ms INT4,    -- Time taken to classify
  pre_call_sid TEXT,                 -- Call SID that created this
  classification_expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  is_active BOOLEAN DEFAULT true,
  last_verified_at TIMESTAMPTZ,      -- Last time verified
  verification_count INT4 DEFAULT 1, -- Times verified
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  eps_id TEXT DEFAULT '0'            -- External system ID
);

-- Example ivr_actions structure:
-- [
--   {
--     "action_type": "dtmf",
--     "action_value": "3",
--     "timing_ms": 17000  -- Press 3 after 17 seconds
--   }
-- ]
```

### 4. ivr_events Table
Tracks IVR interactions during calls for navigation and classification.
```sql
CREATE TABLE ivr_events (
  id UUID PRIMARY KEY,
  call_id TEXT,                      -- Twilio Call SID
  transcript TEXT,                   -- What was heard
  stt_source TEXT DEFAULT 'deepgram',-- Transcription source
  ai_reply TEXT,                     -- OpenAI's response
  action_type TEXT,                  -- 'dtmf', 'speech', 'wait', 'skip', 'error'
  action_value TEXT,                 -- What to press/say
  client_state TEXT,                 -- Base64 encoded state
  command_id UUID,                   -- Unique command ID
  executed BOOLEAN DEFAULT false,    -- Has action been executed
  created_at TIMESTAMPTZ DEFAULT NOW()
);
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

### 1. Edge Function: `pre-classify-call`
**Location**: `supabase/functions/pre-classify-call/index.ts`

**Purpose**: Initiates calls with pre-classification support

**Key Features**:
- Uses hardcoded `pending_call_id` for testing
- Fetches pending call details including clinic phone
- Checks for existing valid classifications
- Creates call session with pending_call_id link
- Passes session ID and classification status to TwiML

### 2. TwiML Handler: `preclassify-twiml.js`
**Location**: `api/twilio/preclassify-twiml.js`

**Purpose**: Routes calls based on classification

**Key Features**:
- Builds SIP headers with pending call data
- Formats dates for readability (DOB, appointment time)
- Generates IVR navigation TwiML from stored actions
- Implements dual-stream for unknown classifications
- Properly encodes special characters in SIP URIs

### 3. WebSocket Server: `server_deepgram.js`
**Location**: Railway deployment

**Purpose**: Real-time classification and IVR navigation

**Key Features**:
- Deepgram integration for transcription
- Fast pattern matching for instant classification
- OpenAI-based classification for complex cases
- IVR action timing calculation from call start
- Final classification storage when call ends

### 4. VAPI Data Endpoint: `get-pending-call.js`
**Location**: `api/twilio/get-pending-call.js`

**Purpose**: Provides pending call data to VAPI

**Security**: 
- Requires `x-vapi-shared-secret` header
- Returns 401 for unauthorized requests

**Response**: Full pending call record with all fields needed by VAPI

### 5. VAPI Webhook: `post_call.js`
**Location**: `api/vapi/post_call.js`

**Purpose**: Receives call results from VAPI

**Updates**:
- Summary
- Success evaluation
- Structured data from VAPI analysis

## Classification Types

### 1. Human Classification
- Direct greeting from a person
- Natural, conversational tone
- Immediate VAPI connection without IVR navigation
- Call proceeds normally to completion

### 2. IVR Only Classification
- Automated menu system
- Requires DTMF or speech navigation
- Stores navigation actions with timing
- **Auto-terminates after first navigation action**

### 3. IVR Then Human Classification
- Starts with automated message
- Transitions to human after initial greeting
- May include transfer phrases
- **Auto-terminates after first navigation action**

## How It Works - Complete Flow

### First Call to a Clinic (No Classification)

1. **Edge Function** (`pre-classify-call`) initiates call:
   - Uses hardcoded `pending_call_id` (testing)
   - Fetches pending call details (patient info, appointment)
   - Checks for existing classification
   - Creates call_session record
   - Calls Twilio API with TwiML webhook URL

2. **TwiML Handler** (`preclassify-twiml.js`) receives call:
   - No classification exists, so uses dual-stream approach
   - Connects both VAPI (AI assistant) and WebSocket (for classification)
   - VAPI starts immediately in case it's a human

3. **WebSocket Server** (`server_deepgram.js`) classifies in real-time:
   - Transcribes audio via Deepgram
   - Uses pattern matching for instant detection
   - Falls back to OpenAI for complex cases
   - If human: Let call proceed with VAPI
   - If IVR: Navigate menu, log action, then auto-terminate

4. **VAPI Assistant** handles the conversation:
   - Fetches full patient/appointment data via `get-pending-call.js`
   - Attempts to schedule appointment
   - Posts results back via `post_call.js`

### Subsequent Calls (With Classification)

1. **Edge Function** finds existing classification
2. **TwiML Handler** routes based on type:
   - Human: Direct VAPI connection
   - IVR: Play stored DTMF sequence, then connect VAPI
3. **No WebSocket needed** - uses cached navigation

## IVR Navigation Intelligence

### Navigation Rules
The system uses OpenAI to intelligently navigate IVR menus with specific targeting:

**GOOD Keywords** (will navigate):
- Front Desk / Reception / Receptionist
- Scheduling / Appointments
- Operator / General representative
- General inquiries / Patient care
- Main office

**AVOIDED Keywords** (will wait):
- Billing department
- Pharmacy / Prescriptions
- Lab results
- Medical records
- Department-specific options

### Action Timing
IVR actions are stored with precise timing:
```json
{
  "action_type": "dtmf",
  "action_value": "3",
  "timing_ms": 17000  // 17 seconds after call start
}
```

## Real-Time Features

### WebSocket Classification
- Processes transcripts in real-time
- Handles sentence fragments for IVR menus
- Combines partial transcripts intelligently

### Fast Classification Patterns
Instant detection for common patterns:
- Human greetings: "Hi, this is Sarah..."
- IVR menus: "Press 1 for..."
- Transfer indicators: "Let me transfer you..."

### Automatic Call Termination
When classifying new clinics:
- **Human calls**: Continue normally with VAPI
- **IVR calls**: Automatically terminated after first navigation action is logged
- Prevents VAPI from wasting time talking to IVR systems
- Ensures efficient use of resources

### Real-Time IVR Action Monitoring
```javascript
// server_deepgram.js monitors IVR events in real-time
const ivrChannel = supabase
  .channel('ivr_events_twilio')
  .on('postgres_changes', {
    event: 'INSERT',
    table: 'ivr_events',
    filter: 'executed=eq.false'
  }, async ({ new: action }) => {
    // Automatically ends call if:
    // 1. It's an IVR classification call
    // 2. First navigation action is recorded
    // 3. No prior classification exists
  })
  .subscribe();
```

## Monitoring & Debugging

### Check Classification Status
```sql
-- View all active classifications
SELECT 
  phone_number, 
  clinic_name, 
  classification_type,
  jsonb_array_length(ivr_actions) as action_count,
  EXTRACT(DAY FROM (classification_expires_at - NOW())) as days_remaining
FROM call_classifications
WHERE is_active = true
ORDER BY created_at DESC;

-- View recent call sessions
SELECT 
  cs.call_id,
  cs.pending_call_id,
  pc.employee_name,
  cs.ivr_detection_state,
  cs.ivr_detection_latency_ms
FROM call_sessions cs
JOIN pending_calls pc ON cs.pending_call_id = pc.id
ORDER BY cs.created_at DESC
LIMIT 10;
```

### Trace Call Flow
```sql
-- Full call trace
SELECT 
  'pending_call' as stage,
  pc.created_at,
  pc.call_status,
  pc.phone
FROM pending_calls pc
WHERE pc.id = 'YOUR_PENDING_CALL_ID'

UNION ALL

SELECT 
  'call_session' as stage,
  cs.created_at,
  cs.call_status,
  cs.clinic_phone
FROM call_sessions cs
WHERE cs.pending_call_id = 'YOUR_PENDING_CALL_ID'

UNION ALL

SELECT 
  'ivr_event' as stage,
  ie.created_at,
  ie.action_type || ': ' || ie.action_value,
  cs.clinic_phone
FROM ivr_events ie
JOIN call_sessions cs ON ie.call_id = cs.call_id
WHERE cs.pending_call_id = 'YOUR_PENDING_CALL_ID'

ORDER BY created_at;
```

## Performance Optimization

### Connection Reuse
- WebSocket connections cached for 30 seconds
- Reduces connection overhead for retries
- Maintains audio streams and processors

### Timing Accuracy
- Actions timestamped relative to call start
- Precise pause calculations in TwiML
- Handles IVR menu timing variations

### Efficient Classification Calls
- Human-answered calls complete normally (70-80% of cases)
- IVR calls terminate after ~10-15 seconds
- Captures classification + one navigation action
- Subsequent calls use stored classification

## Error Handling

### Classification Failures
- Falls back to dual-stream approach
- VAPI connects regardless of classification
- WebSocket performs real-time classification

### Missing Data Scenarios
- Handles missing phone numbers gracefully
- Creates sessions even without full data
- Updates sessions when data becomes available

### Auto-Termination Safety
- Only terminates classification calls (no prior classification)
- Requires confirmed IVR detection before terminating
- Logs all termination attempts for debugging

## Security Considerations

1. **API Authentication**: 
   - VAPI endpoint requires shared secret
   - Supabase uses service role key
   
2. **Data Privacy**:
   - Employee PII passed via SIP headers
   - Dates formatted for readability
   - Phone numbers stored for classification

3. **Rate Limiting**:
   - Single hardcoded pending_call_id prevents abuse
   - 30-day classification cache reduces API calls

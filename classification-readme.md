# Pre-Classification Call System

## Overview
This system pre-classifies clinic phone systems (human vs IVR vs IVR-then-human) and caches the results for 30 days, enabling instant routing for subsequent calls. The system uses intelligent call handling to minimize wasted time on IVR systems during classification.

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
  exam_id TEXT,
  employee_name TEXT,
  employee_dob DATE,
  client_name TEXT,
  phone TEXT,
  clinic_name TEXT,
  appointment_time TIMESTAMPTZ,
  type_of_visit TEXT,
  procedures TEXT,
  call_status TEXT,
  trigger_attempted_at TIMESTAMPTZ,
  trigger_response JSONB,
  summary TEXT,
  success_evaluation TEXT,
  structured_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. call_sessions Table
Tracks individual call attempts and classification states.
```sql
CREATE TABLE call_sessions (
  id UUID PRIMARY KEY,
  call_id TEXT UNIQUE,
  pending_call_id UUID REFERENCES pending_calls(id),
  clinic_phone TEXT,
  classification_id UUID REFERENCES call_classifications(id),
  call_status TEXT,
  ivr_detection_state TEXT,
  ivr_classified_at TIMESTAMPTZ,
  ivr_detection_latency_ms INT4,
  ivr_confidence_score FLOAT8,
  stream_started BOOLEAN DEFAULT false,
  needs_ivr_actions BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. call_classifications Table
Stores pre-classified phone system types and IVR navigation paths with timing.
```sql
CREATE TABLE call_classifications (
  id UUID PRIMARY KEY,
  phone_number TEXT NOT NULL,
  clinic_name TEXT,
  classification_type TEXT, -- 'human', 'ivr_only', 'ivr_then_human'
  classification_confidence FLOAT8,
  ivr_actions JSONB, -- Stores actions with timing_ms calculated from call start
  classification_duration_ms INT4,
  pre_call_sid TEXT,
  classification_expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  is_active BOOLEAN DEFAULT true,
  last_verified_at TIMESTAMPTZ,
  verification_count INT4 DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  eps_id TEXT DEFAULT '0'
);
```

### 4. ivr_events Table
Tracks IVR interactions during calls for navigation and classification.
```sql
CREATE TABLE ivr_events (
  id UUID PRIMARY KEY,
  call_id TEXT,
  transcript TEXT,
  stt_source TEXT DEFAULT 'deepgram',
  ai_reply TEXT,
  action_type TEXT, -- 'dtmf', 'speech', 'wait', 'skip', 'error'
  action_value TEXT,
  client_state TEXT,
  command_id UUID,
  executed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Key Components

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

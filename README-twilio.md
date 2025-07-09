# Twilio IVR Classification & VAPI Bridge System

## Overview

This system provides real-time IVR (Interactive Voice Response) classification and intelligent call routing using Twilio, Deepgram, and VAPI. It detects whether calls are answered by humans or IVR systems and routes them accordingly, with sub-7-second classification and instant bridging to VAPI assistants.

### Key Features
- **Fast IVR Classification**: Detects human vs automated systems in 1-6 seconds
- **Pre-dial VAPI**: VAPI assistant is pre-dialed and held in conference, ready for instant connection
- **Smart Call Routing**: Immediately bridges to VAPI when human detected, navigates IVR menus automatically
- **Conference-Based Architecture**: Uses Twilio conferences for reliable multi-party calling
- **WebSocket Streaming**: Real-time audio processing via Railway server
- **Direct Bridge Control**: Classification triggers immediate conference participant management
- **Dynamic Variables**: Pass customer data to VAPI assistant via API updates

## Architecture

### System Components

1. **Supabase Edge Function** (`twilio-deepgram-conferences-IVR`)
   - Initiates outbound calls
   - Creates conference and call sessions in database
   - Pre-dials VAPI into conference (on hold)
   - Handles VAPI webhook callbacks
   - Updates VAPI with dynamic variables before dialing clinic
   - Sets up initial call state

2. **Vercel Webhooks**
   - `deepgram-twiml-refactor.js`: Main TwiML handler
   - `vapi-conference.js`: Places VAPI in conference
   - `clinic-conference.js`: Places clinic in conference with WebSocket stream
   - `conference-webhook-bridge.js`: Manual hold/unhold testing endpoint
   - `vapi-announcement.js`: Plays announcement to VAPI before unholding
   - Manages call flow and IVR action execution

3. **Railway WebSocket Server** (`server_deepgram.js`)
   - Receives real-time audio from Twilio via conference stream
   - Streams to Deepgram for transcription
   - Performs IVR classification using shared modules
   - **Directly manages conference participants when human detected**
   - Plays announcement to VAPI then takes off hold

4. **Database** (Supabase)
   - `call_sessions`: Tracks call state, classification, conference info, and VAPI status
   - `ivr_events`: Logs IVR interactions and navigation actions
   - Stores VAPI call ID for dynamic variable updates

### Shared Modules (Used by Railway)
- `ivr-processor.js`: Handles transcript processing and classification orchestration
- `fast-classifier.js`: Pattern-based instant classification (with transfer detection)
- `openai-classifier.js`: AI-based classification for complex cases
- `ivr-navigator.js`: Determines IVR navigation actions
- `supabase-logger-twilio.js`: Logs classification AND manages conference participants
- `deepgram-config.js`: Deepgram WebSocket configuration

## Call Flow

```
1. Edge Function triggered
   ├─> Creates conference
   ├─> Pre-dials VAPI into conference
   ├─> Waits for VAPI webhook with call ID
   ├─> Updates VAPI with dynamic variables via API
   ├─> Creates call_session record
   └─> Dials clinic into same conference

2. VAPI joins conference
   ├─> Edge function receives webhook with VAPI call ID
   ├─> Updates variables (customerName, etc.)
   └─> Puts VAPI on hold with music

3. Clinic answers → Conference webhook
   ├─> Starts WebSocket stream to Railway
   └─> Begins IVR classification

4. Railway WebSocket server
   ├─> Receives audio stream via conference
   ├─> Sends to Deepgram for transcription
   ├─> IVR Processor classifies (1-6 seconds)
   └─> On human detection:
       ├─> Plays "Hello" announcement to VAPI
       └─> Takes VAPI off hold in conference

5. VAPI Connected
   ├─> Both parties active in conference
   ├─> Audio flows between human and VAPI
   └─> WebSocket stream stops
```

## Database Schema

### call_sessions
```sql
- call_id: text (primary key) -- Clinic's Twilio CallSid
- conference_id: text -- Generated conference friendly name
- conference_sid: text -- Twilio's conference SID
- ivr_detection_state: text -- 'human', 'ivr_only', 'ivr_then_human'
- ivr_classified_at: timestamptz
- ivr_detection_latency_ms: integer
- ivr_confidence_score: float
- vapi_participant_sid: text -- VAPI's Twilio CallSid
- vapi_call_id: text -- VAPI's internal call ID (for API updates)
- vapi_on_hold: boolean -- Is VAPI on hold in conference?
- vapi_joined_at: timestamptz
- vapi_bridged_at: timestamptz -- When VAPI taken off hold
- call_status: text -- 'initiated', 'active', 'completed'
- stream_started: boolean
- created_at: timestamptz
- updated_at: timestamptz
```

### ivr_events
```sql
- id: uuid
- call_id: text
- transcript: text
- action_type: text -- 'dtmf', 'speech', 'wait'
- action_value: text
- executed: boolean
- executed_at: timestamptz
- ai_reply: text
- created_at: timestamptz
```

## Environment Variables

### Supabase Edge Function
```env
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_NUMBER=+1234567890
TO_NUMBER=+1987654321
TWIML_URL_DEEPGRAM_REFACTOR=https://your-vercel-app.vercel.app/api/twilio/deepgram-twiml-refactor
VAPI_SIP_ADDRESS=your-assistant@sip.vapi.ai
VAPI_API_KEY=your_vapi_private_api_key
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Vercel (Webhooks)
```env
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
DEEPGRAM_WS_URL=wss://your-railway-app.up.railway.app
WEBHOOK_URL=https://your-vercel-app.vercel.app
VAPI_SIP_ADDRESS=your-assistant@sip.vapi.ai
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Railway (WebSocket Server)
```env
PORT=8080
DEEPGRAM_API_KEY=your_deepgram_api_key
OPENAI_API_KEY=your_openai_api_key
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
```

## Key Implementation Details

### 1. Fast Classification (1-6 seconds)
The Railway WebSocket server uses pattern matching for instant classification with transfer detection:
```javascript
// Common human patterns detected instantly
"Hello, this is [name] speaking"
"How can I help you?"
"Thank you for calling [clinic name]"

// Transfer detection patterns
"Transferring your call"
"One moment please"
"Connecting you now"
```

### 2. Conference-Based Bridging
When classification happens, the `supabase-logger-twilio.js` module:
1. Updates the database with classification
2. Takes VAPI off hold in the conference
3. Plays announcement to trigger VAPI response
4. No polling delays - instant action!

```javascript
// Take VAPI off hold in conference
await twilioClient
  .conferences(session.conference_sid)
  .participants(session.vapi_participant_sid)
  .update({ hold: false });
```

### 3. Dynamic Variables Strategy
VAPI variables are passed via API after connection:
1. Edge function creates VAPI call
2. Waits for VAPI webhook with call ID
3. Updates variables before dialing clinic
```javascript
await fetch(`https://api.vapi.ai/v1/calls/${vapiCallId}`, {
  method: 'PATCH',
  body: JSON.stringify({
    assistantOverrides: {
      variableValues: {
        customerName: "Indiana Jones",
        clinicName: "Adventure Health Clinic"
      }
    }
  })
});
```

### 4. VAPI Authentication Setup
Required one-time setup for SIP variables:
- BYO SIP trunk credential created in VAPI
- Twilio phone number registered with VAPI
- VAPI IPs whitelisted in Twilio (44.229.228.186, 44.238.177.138)

### 5. IVR Navigation
For automated systems, the system:
- Listens for menu options
- Uses OpenAI to determine correct action
- Executes DTMF tones or speech commands
- Continues until human reached or transfer detected

## Common Issues & Solutions

### Variables not reaching VAPI
- **Cause**: SIP headers don't work with conference pre-dial
- **Solution**: Use VAPI API to update variables after connection
- **Note**: Variables use underscore format (e.g., `customer_name`)

### Conference hold not working
- **Cause**: Wrong conference or participant SID
- **Solution**: Store conference_sid when conference created
- **Verify**: Use conference-webhook-bridge endpoint for testing

### Duplicate database rows
- **Cause**: WebSocket server creating second session
- **Solution**: WebSocket now looks up existing session by conference_id

## Monitoring & Debugging

### Key Log Messages to Watch

**Success Flow**:
1. "✅ VAPI call created: [sid]" - Edge function
2. "📨 VAPI webhook received: in-progress" - Edge function
3. "✅ VAPI variables updated successfully" - Edge function
4. "✅ VAPI put on hold successfully" - Edge function
5. "📡 Stream started for conference: [id]" - Railway
6. "[FAST CLASSIFY] human" - Railway (1-6 seconds)
7. "🚀 INSTANT BRIDGE: Human detected" - Railway
8. "✅ VAPI taken off hold successfully" - Railway

**Performance Metrics**:
- Classification time: Check `ivr_detection_latency_ms` in database
- Variable update time: ~1-2 seconds waiting for VAPI webhook
- Bridge time: <100ms after classification

### Database Queries for Debugging

```sql
-- Check call status and timing with conference info
SELECT 
  call_id,
  conference_id,
  conference_sid,
  vapi_call_id,
  ivr_detection_state,
  ivr_detection_latency_ms,
  vapi_on_hold,
  EXTRACT(EPOCH FROM (vapi_bridged_at - ivr_classified_at)) * 1000 as bridge_delay_ms
FROM call_sessions 
WHERE call_id = 'YOUR_CALL_SID';

-- Check if VAPI variables were updated
SELECT 
  conference_id,
  vapi_participant_sid,
  vapi_call_id,
  created_at,
  vapi_joined_at
FROM call_sessions
WHERE vapi_call_id IS NOT NULL
ORDER BY created_at DESC;
```

## Testing Endpoints

### Manual Conference Hold/Unhold
```bash
# Put on hold
curl "https://your-app.vercel.app/api/twilio/conference-webhook-bridge?hold=true&conference_id=conf-123&sid=CAxxxx"

# Take off hold  
curl "https://your-app.vercel.app/api/twilio/conference-webhook-bridge?hold=false&conference_id=conf-123&sid=CAxxxx"
```

## Architecture Decision Log

### Why Conferences Instead of Queues?
- More reliable for multi-party scenarios
- Better control over participant state (hold/unhold)
- Supports WebSocket streaming from conference

### Why API Variables Instead of SIP Headers?
- SIP headers only work with `<Dial><Sip>` TwiML
- Can't use TwiML approach with pre-dial strategy
- API update allows keeping fast bridge architecture

### Why Announcement Before Unhold?
- VAPI misses initial human greeting due to classification delay
- "Hello" announcement triggers VAPI to introduce itself
- Creates more natural conversation flow

### Conference vs Direct Bridge Trade-offs
- **Conference Pros**: Reliable, supports hold/unhold, better for complex flows
- **Conference Cons**: Slightly more complex than queues
- **Decision**: Conference architecture provides more control and flexibility

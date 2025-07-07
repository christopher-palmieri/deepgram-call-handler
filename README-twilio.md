# Twilio IVR Classification & VAPI Bridge System

## Overview

This system provides real-time IVR (Interactive Voice Response) classification and intelligent call routing using Twilio, Deepgram, and VAPI. It detects whether calls are answered by humans or IVR systems and routes them accordingly, with sub-7-second classification and instant bridging to VAPI assistants.

### Key Features
- **Fast IVR Classification**: Detects human vs automated systems in 1-6 seconds
- **Pre-dial VAPI**: VAPI assistant is pre-dialed and held, ready for instant connection
- **Smart Call Routing**: Immediately bridges to VAPI when human detected, navigates IVR menus automatically
- **No Conference Complexity**: Uses Twilio queues for simple call bridging
- **WebSocket Streaming**: Real-time audio processing via Railway server
- **Direct Bridge Control**: Classification triggers immediate call updates (no polling delays)

## Architecture

### System Components

1. **Supabase Edge Function** (`edge-function-with-predial`)
   - Initiates outbound calls
   - Creates call session in database
   - Pre-dials VAPI into hold queue
   - Sets up initial call state

2. **Vercel Webhooks**
   - `deepgram-twiml-refactor.js`: Main TwiML handler
   - `vapi-hold.js`: Places VAPI in hold queue
   - `check-classification.js`: Fallback classification check
   - Manages call flow and IVR action execution

3. **Railway WebSocket Server** (`server_deepgram.js`)
   - Receives real-time audio from Twilio
   - Streams to Deepgram for transcription
   - Performs IVR classification using shared modules
   - **Directly bridges calls when human detected** (key optimization)

4. **Database** (Supabase)
   - `call_sessions`: Tracks call state, classification, and VAPI status
   - `ivr_events`: Logs IVR interactions and navigation actions

### Shared Modules (Used by Railway)
- `ivr-processor.js`: Handles transcript processing and classification orchestration
- `fast-classifier.js`: Pattern-based instant classification
- `openai-classifier.js`: AI-based classification for complex cases
- `ivr-navigator.js`: Determines IVR navigation actions
- `supabase-logger-twilio.js`: Logs classification AND triggers instant bridging
- `deepgram-config.js`: Deepgram WebSocket configuration

## Call Flow

```
1. Edge Function triggered
   ├─> Creates outbound call to clinic
   ├─> Creates call_session record
   └─> Pre-dials VAPI into hold queue

2. Call answered → TwiML webhook
   ├─> Checks if already classified (fast path)
   ├─> Starts WebSocket stream to Railway
   └─> Sets 30-second safety timeout

3. Railway WebSocket server
   ├─> Receives audio stream
   ├─> Sends to Deepgram for transcription
   ├─> IVR Processor classifies (1-6 seconds)
   └─> On human detection:
       └─> Logger IMMEDIATELY bridges calls via Twilio API

4. VAPI Connected
   ├─> Both calls join bridge queue
   ├─> Audio flows between human and VAPI
   └─> WebSocket stream stops
```

## Database Schema

### call_sessions
```sql
- call_id: text (primary key) -- Twilio CallSid
- call_control_id: text -- Not used for Twilio
- ivr_detection_state: text -- 'human', 'ivr_only', 'ivr_then_human'
- ivr_classified_at: timestamptz
- ivr_detection_latency_ms: integer
- ivr_confidence_score: float
- vapi_participant_sid: text -- VAPI's Twilio CallSid
- vapi_on_hold: boolean -- Is VAPI waiting in queue?
- vapi_joined_at: timestamptz
- vapi_bridged_at: timestamptz -- When calls were connected
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
TWIML_URL_DEEPGRAM=https://your-vercel-app.vercel.app/api/twilio/deepgram-twiml-refactor
VAPI_SIP_ADDRESS=your-assistant@sip.vapi.ai
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
The Railway WebSocket server uses pattern matching for instant classification:
```javascript
// Common human patterns detected instantly
"Hello, this is [name] speaking"
"How can I help you?"
"Thank you for calling [clinic name]"
```

### 2. Instant Bridging (The Secret Sauce)
When classification happens, the `supabase-logger-twilio.js` module:
1. Updates the database with classification
2. **Immediately calls Twilio API to bridge both calls**
3. No waiting for polling cycles!

```javascript
// Direct bridge without polling delays
await updateTwilioCall(mainCallSid, bridgeTwiML);
await updateTwilioCall(vapiCallSid, bridgeTwiML);
```

### 3. Pre-dial Strategy
VAPI is called immediately when the main call starts:
- Placed in a hold queue (silent waiting)
- Ready to bridge instantly when human detected
- No "line trill" or connection delays

### 4. IVR Navigation
For automated systems, the system:
- Listens for menu options
- Uses OpenAI to determine correct action
- Executes DTMF tones or speech commands
- Continues until human reached

## Common Issues & Solutions

### "Duplicate key" errors in Railway logs
- **Cause**: Session already created by edge function
- **Solution**: Logger now handles this gracefully with update fallback
- **Note**: These errors are cosmetic and don't affect functionality

### Slow VAPI connection
- **Cause**: Polling delays in TwiML loop
- **Solution**: Implemented direct bridging from WebSocket server
- **Result**: <100ms bridge time after classification

### VAPI not pre-dialing
- **Check**: Edge function logs for VAPI creation
- **Verify**: `vapi_participant_sid` is set in database
- **Ensure**: VAPI_SIP_ADDRESS is correct

## Monitoring & Debugging

### Key Log Messages to Watch

**Success Flow**:
1. "✅ VAPI pre-dialed: [sid]" - Edge function
2. "📡 Stream started: [callId]" - Railway
3. "[FAST CLASSIFY] human" - Railway (1-6 seconds)
4. "🚀 INSTANT BRIDGE: Human detected" - Railway
5. "✅ Calls bridged successfully" - Railway

**Performance Metrics**:
- Classification time: Check `ivr_detection_latency_ms` in database
- Time to VAPI connection: Compare `ivr_classified_at` vs `vapi_bridged_at`
- Should be <100ms difference with direct bridging

### Database Queries for Debugging

```sql
-- Check call status and timing
SELECT 
  call_id,
  ivr_detection_state,
  ivr_detection_latency_ms,
  vapi_on_hold,
  EXTRACT(EPOCH FROM (vapi_bridged_at - ivr_classified_at)) * 1000 as bridge_delay_ms
FROM call_sessions 
WHERE call_id = 'YOUR_CALL_SID';

-- View IVR interactions
SELECT * FROM ivr_events 
WHERE call_id = 'YOUR_CALL_SID' 
ORDER BY created_at;
```

## Development Workflow

### Testing Changes
1. **IVR Classification**: Modify patterns in `fast-classifier.js`
2. **Navigation Logic**: Update `ivr-navigator.js` prompts
3. **Bridge Timing**: Adjust logic in `supabase-logger-twilio.js`

### Adding New Features
- All classification logic lives in Railway server modules
- TwiML handlers should remain simple (just orchestration)
- Database is source of truth for call state

### Performance Optimization
- Current: 1-6 second classification, <100ms bridge
- Target: Maintain these metrics as system scales
- Monitor: Railway logs for classification timing

## Future Enhancements

### Potential Improvements
1. **Voicemail Detection**: Detect and handle voicemail systems
2. **Multiple Language Support**: Extend classifiers for non-English
3. **Custom Hold Music**: Replace silence with branded experience
4. **Analytics Dashboard**: Real-time classification metrics

### Scaling Considerations
- Railway WebSocket server can handle multiple simultaneous calls
- Each call maintains separate state and connections
- Database indexes on `call_id` for fast lookups

## Troubleshooting Checklist

- [ ] Edge function creating call sessions?
- [ ] VAPI pre-dialing successfully?
- [ ] WebSocket stream starting?
- [ ] Classification happening in Railway logs?
- [ ] Direct bridge executing after classification?
- [ ] Both calls joining bridge queue?

## Architecture Decision Log

### Why Not Conferences?
- Twilio conferences add complexity
- Queues are simpler for two-party bridges
- Easier state management

### Why Direct Bridging from WebSocket?
- Eliminates polling delays (was 20+ seconds)
- Classification and action in same place
- Instant response (<100ms)

### Why Pre-dial VAPI?
- Eliminates connection time when human detected
- Better user experience (no waiting)
- VAPI ready instantly when needed

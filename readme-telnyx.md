# Telnyx IVR Classification System

## Overview
This system is a Telnyx-based implementation of the IVR classification and navigation system. It provides the same core functionality as the Twilio version but uses Telnyx's Programmable Voice API for call control and media streaming.

## Architecture

### Components
1. **Vercel API Endpoint** (`/api/telnyx/voice-api-handler.js`)
   - Handles Telnyx webhook events
   - Manages call control via Telnyx API
   - Implements polling mechanism for IVR actions

2. **Railway WebSocket Server** (`server_telnyx.js`)
   - Receives audio streams from Telnyx
   - Implements audio buffering for complete transcriptions
   - Manages persistent connections

3. **Shared IVR Pipeline** (same as Twilio)
   - Uses identical `ivr-listener.js` and modules
   - Maintains compatibility across both platforms

## Key Differences from Twilio

### API Approach
- Uses Telnyx Programmable Voice API (REST) instead of TwiML
- Direct API calls for call control actions
- WebSocket-based media streaming

### Audio Handling
- Implements audio buffering (160 bytes/20ms chunks)
- Compensates for smaller audio packets from Telnyx
- Ensures complete transcriptions like Twilio

### Call Flow
- No TwiML redirects - uses polling mechanism
- Checks for IVR actions every 2 seconds
- Direct API calls for DTMF and speech synthesis

## Technical Stack
- **Telnyx**: Call handling and media streaming
- **Deepgram**: Real-time speech-to-text (shared)
- **OpenAI**: IVR classification and navigation (shared)
- **Supabase**: Session management (shared schema)
- **WebSocket**: Bidirectional audio streaming
- **Node.js**: Server runtime

## Database Schema ##
call_sessions
CREATE TABLE call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id text UNIQUE NOT NULL,
  stream_started boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  ivr_detection_state text,
  ivr_classified_at timestamptz,
  ivr_detection_latency_ms int4,
  ivr_confidence_score numeric,
  conference_created boolean DEFAULT false,
  vapi_participant_sid text,
  vapi_joined_at timestamptz,
  stream_initialized boolean DEFAULT false,
  call_status varchar(50) DEFAULT 'active'
);
ivr_events
CREATE TABLE ivr_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id text NOT NULL,
  transcript text,
  ai_reply text,
  action_type text,
  action_value text,
  created_at timestamp DEFAULT now(),
  executed boolean DEFAULT false,
  stt_source text,
  executed_at timestamptz,
  error text
);

-- Index for faster queries
CREATE INDEX idx_ivr_events_call_id ON ivr_events(call_id);
CREATE INDEX idx_ivr_events_executed ON ivr_events(executed);

## Configuration

### Environment Variables
```env
# Telnyx
TELNYX_API_KEY=
TELNYX_WS_URL=wss://telnyx-server-production.up.railway.app

# Shared Services (same as Twilio)
DEEPGRAM_API_KEY=
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# VAPI Integration
VAPI_SIP_ADDRESS=
VAPI_PHONE_NUMBER=

# Server
PORT=3002
```

## Call Flow (Telnyx-Specific)

1. **Call Initiated** → Webhook to `/api/telnyx/voice-api-handler`
2. **Answer Call** → API call to answer (inbound only)
3. **Start Stream** → WebSocket connection with call metadata
4. **Audio Buffering** → Accumulate chunks before sending to Deepgram
5. **IVR Detection** → Shared classification pipeline
6. **Action Polling** → Check database every 2 seconds
7. **Execute Actions** → API calls for DTMF/speech
8. **Human Transfer** → Transfer API to VAPI endpoint

## Telnyx-Specific Features

### Audio Buffering
```javascript
const AUDIO_BUFFER_SIZE = 160; // 20ms of audio at 8kHz
const AUDIO_BUFFER_TIMEOUT = 20; // Flush after 20ms
```

### Polling Mechanism
- Polls every 2 seconds for IVR actions
- Maximum 60 polls (2 minutes)
- Stops on human detection or call end
- Unique poller ID for debugging

### API Actions
```javascript
// DTMF
{
  digits: "1",
  duration_millis: 500,
  client_state: base64_encoded_state,
  command_id: uuid
}

// Speech
{
  payload: "Hello",
  voice: "female",
  language: "en-US",
  client_state: base64_encoded_state,
  command_id: uuid
}
```

## Webhook Events Handled

- `call.initiated` - Setup session, answer if inbound
- `call.answered` - Start WebSocket stream
- `streaming.started` - Log stream initiation
- `streaming.stopped` - Clean up resources
- `call.hangup` - Update session status

## Key Implementation Details

### WebSocket URL Format
```
wss://your-server.com?call_id={call_leg_id}&call_control_id={control_id}
```

### Stream Configuration
```javascript
{
  stream_url: websocket_url,
  stream_track: 'both_tracks',
  enable_dialogflow: false
}
```

### Error Handling
- Comprehensive try-catch blocks
- Detailed error logging
- Graceful fallbacks
- Action failure tracking in database

## Deployment Considerations

### Vercel
- Single endpoint for all webhooks
- Ensure body parsing is enabled
- Configure Telnyx webhook URL

### Railway
- Different port from Twilio server (3002)
- WebSocket server with query parameter support
- Health check endpoint at `/health`

## Monitoring & Debugging

### Logging Prefixes
- `📞` Call events
- `✅` Success operations
- `❌` Errors
- `🔍` Debugging/search operations
- `🎯` Action execution
- `🔄` Polling operations
- `📡` Stream events

### Key Metrics
- Audio buffer efficiency
- Polling frequency and duration
- Action execution success rate
- Transcription completeness

## Migration from Twilio

1. **Shared Components**: All IVR logic remains the same
2. **API Translation**: TwiML actions → Telnyx API calls
3. **Audio Handling**: Added buffering for consistency
4. **State Management**: Same Supabase schema
5. **Classification**: Identical pipeline

## Known Issues & Solutions

### Issue: Incomplete Transcriptions
**Solution**: Implemented audio buffering to accumulate small chunks

### Issue: DTMF Not Executing
**Status**: Under investigation - reviewing API payload and timing

### Issue: Polling Overhead
**Consideration**: 2-second polling interval balances responsiveness vs. API usage

## Performance Optimizations

1. **Audio Buffering**: Reduces Deepgram API calls
2. **Connection Reuse**: Maintains WebSocket across call lifecycle
3. **Efficient Polling**: Early termination conditions
4. **Shared Modules**: No code duplication with Twilio

## Future Enhancements
1. WebSocket-based action delivery (eliminate polling)
2. Adaptive buffer sizing based on network conditions
3. Enhanced error recovery mechanisms
4. Real-time metrics dashboard

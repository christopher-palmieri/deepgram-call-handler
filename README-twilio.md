# Twilio IVR Classification System

## Overview
This system provides real-time IVR (Interactive Voice Response) detection and navigation for outbound calls using Twilio, Deepgram, OpenAI, and Supabase. It classifies whether calls are answered by humans, automated systems, or a combination, and can navigate IVR menus automatically.

## Architecture

### Components
1. **Vercel API Endpoints** (`/api/twilio/`)
   - `deepgram-twiml.js` - Main TwiML endpoint that handles call flow
   - `call-status.js` - Webhook for Twilio call status updates

2. **Railway WebSocket Server** (`server_deepgram.js`)
   - Receives audio streams from Twilio
   - Manages persistent connections for call audio
   - Handles reconnections efficiently

3. **IVR Detection Pipeline** (`ivr-listener.js`)
   - Connects to Deepgram for speech-to-text
   - Performs fast pattern-based classification
   - Falls back to OpenAI for complex cases
   - Manages transcript fragment handling

## Key Features

### IVR Classification
- **Human**: Natural conversational greetings
- **IVR Only**: Automated menu systems
- **IVR Then Human**: Automated greeting followed by human transfer
- **Undetermined**: Insufficient data for classification

### Smart IVR Navigation
- Selective action taking (only routes to general representatives)
- DTMF tone generation for menu navigation
- Speech synthesis for voice-activated systems
- Fragment handling for split IVR messages

### Fragment Handling
The system intelligently combines fragmented IVR messages:
- Detects incomplete sentences ending with commas
- Buffers fragments until the completing phrase arrives
- Example: "To speak with someone," + "press 1" → "To speak with someone, press 1"

## Technical Stack
- **Twilio**: Call handling and media streaming
- **Deepgram**: Real-time speech-to-text with WebSocket API
- **OpenAI**: Advanced IVR classification and navigation decisions
- **Supabase**: Session management and event logging
- **WebSocket**: Bidirectional audio streaming
- **Node.js**: Server runtime

## Configuration

### Environment Variables
```env
# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=

# Deepgram
DEEPGRAM_API_KEY=

# OpenAI
OPENAI_API_KEY=

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# VAPI Integration
VAPI_SIP_ADDRESS=
VAPI_PHONE_NUMBER=

# Server
PORT=3000
```

### Deepgram Settings
- Model: `nova-3`
- Encoding: `mulaw`
- Sample Rate: `8000`
- Endpointing: `700ms`
- Utterances: `true`
- Smart Format: `true`

## Database Schema

### call_sessions
```sql
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
```

### ivr_events
```sql
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
```

### Real-time Configuration (Optional for Telnyx)
If using the Telnyx implementation with real-time features:
1. Go to Supabase Dashboard → Database → Replication
2. Enable replication for the `ivr_events` table
3. `ALTER TABLE ivr_events REPLICA IDENTITY FULL;`

## Call Flow

1. **Inbound Call** → Twilio webhook hits `/api/twilio/deepgram-twiml`
2. **Session Check** → Queries Supabase for existing classification
3. **Audio Stream** → Starts WebSocket stream to Railway server
4. **Real-time STT** → Deepgram processes audio chunks
5. **Classification** → Fast classifier → OpenAI fallback
6. **IVR Navigation** → OpenAI determines actions
7. **Action Execution** → TwiML redirect to execute DTMF/speech
8. **Human Transfer** → Routes to VAPI SIP when human detected

## Module Structure

```
├── api/twilio/
│   ├── deepgram-twiml.js      # Main TwiML endpoint
│   └── call-status.js          # Call status webhook
├── server_deepgram.js          # WebSocket server
├── ivr-listener.js             # Main IVR detection
├── call_state.js               # In-memory state management
└── modules/
    ├── actions/
    │   └── ivr-navigator.js    # OpenAI navigation logic
    ├── classifiers/
    │   ├── fast-classifier.js  # Pattern-based classification
    │   └── openai-classifier.js # AI-based classification
    ├── config/
    │   └── deepgram-config.js  # Deepgram URL builder
    ├── database/
    │   └── supabase-logger.js  # Database operations
    └── handlers/
        └── transcript-handler.js # Fragment management
```

## Performance Optimizations

1. **Connection Reuse**: Maintains WebSocket connections across TwiML redirects
2. **Fast Classification**: Pattern matching before AI classification
3. **Fragment Buffering**: Intelligently combines split messages
4. **Cleanup Timers**: Automatic resource cleanup after 30 seconds
5. **Pre-warmed Connections**: (Disabled but available for optimization)

## Deployment

### Vercel
- Deploy API endpoints to Vercel
- Configure environment variables
- Set up Twilio webhooks to point to Vercel URLs

### Railway
- Deploy WebSocket server
- Expose WebSocket endpoint
- Configure environment variables

## Monitoring

### Key Metrics
- Classification latency
- Transcript confidence scores
- Action execution success rate
- WebSocket connection stability

### Debugging
- Extensive console logging with prefixes
- Call duration tracking
- Utterance timing
- Fragment detection logging

## Known Limitations
1. Requires stable WebSocket connection
2. Classification accuracy depends on audio quality
3. IVR navigation limited to simple menu structures
4. 30-second timeout for idle connections

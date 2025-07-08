# Twilio IVR Classification & VAPI Bridge System - Conference Approach

## Overview

This system provides real-time IVR (Interactive Voice Response) classification and intelligent call routing using Twilio, Deepgram, and VAPI. It detects whether calls are answered by humans or IVR systems and instantly unmutes a pre-connected VAPI assistant, achieving sub-7-second human connection times.

### Key Features
- **Fast IVR Classification**: Detects human vs automated systems in 1-6 seconds
- **Pre-connected VAPI**: VAPI joins conference muted, ready for instant unmute
- **Simple Conference Architecture**: Both calls in same conference from the start
- **No Transfer Delays**: Just unmute VAPI when human detected
- **WebSocket Streaming**: Real-time audio processing from conference
- **Zero Bridge Time**: No call transfers or reconnections needed

## Architecture

### System Components

1. **Supabase Edge Function** (`edge-function-with-predial`)
   - Creates unique conference ID
   - Dials VAPI first into conference (muted)
   - Then dials clinic into same conference
   - Stores conference details in database

2. **Vercel Webhooks**
   - `vapi-conference.js`: Places VAPI in conference (muted)
   - `clinic-conference.js`: Places clinic call in conference with WebSocket stream
   - `vapi-status.js`: Tracks VAPI call status
   - `call-status.js`: Tracks main call status

3. **Railway WebSocket Server** (`server_deepgram.js`)
   - Receives audio stream FROM the conference
   - Performs IVR classification
   - **Unmutes VAPI instantly when human detected**

4. **Database** (Supabase)
   - `call_sessions`: Tracks calls, conference ID, and mute status
   - `ivr_events`: Logs IVR interactions

## Call Flow

```
1. Edge Function triggered
   ├─> Generate unique conference ID
   ├─> Dial VAPI → joins conference (muted)
   └─> Dial Clinic → joins conference (with WebSocket)

2. Both calls now in conference
   ├─> VAPI: Muted and waiting
   └─> Clinic: Active with WebSocket stream

3. WebSocket server classifies audio
   ├─> Receives conference audio
   ├─> Classifies in 1-6 seconds
   └─> On human detection:
       └─> Single API call to unmute VAPI

4. Instant connection
   ├─> No transfers needed
   ├─> No bridging required
   └─> Just unmute and talk!
```

## Database Schema

### call_sessions
```sql
- call_id: text (primary key) -- Clinic call SID
- conference_id: text -- Unique conference identifier
- vapi_participant_sid: text -- VAPI's call SID
- vapi_on_hold: boolean -- Is VAPI muted?
- vapi_joined_at: timestamptz
- vapi_unmuted_at: timestamptz -- When VAPI was unmuted
- ivr_detection_state: text -- 'human', 'ivr_only', 'ivr_then_human'
- ivr_classified_at: timestamptz
- ivr_detection_latency_ms: integer
- call_status: text
- created_at: timestamptz
```

## Conference Approach Benefits

### Why This Works
1. **No Complex Bridging**: Both calls start in the same conference
2. **Instant Unmute**: Single API call vs complex call transfers
3. **VAPI Stays Connected**: No disconnect/reconnect issues
4. **Simple State**: Just track muted/unmuted status

### Performance Metrics
- Edge function → Conference setup: ~2 seconds
- Human classification: 1-6 seconds
- Unmute VAPI: <100ms
- **Total time to human connection: 3-8 seconds**

## Key Implementation Details

### Conference Creation (Edge Function)
```javascript
// Unique conference for each call
const conferenceId = `conf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// VAPI joins muted
<Conference muted="true" startConferenceOnEnter="true">
  ${conferenceId}
</Conference>

// Clinic joins with WebSocket
<Start>
  <Stream url="${DEEPGRAM_WS_URL}">
    <Parameter name="streamSid" value="${conferenceId}" />
  </Stream>
</Start>
<Dial>
  <Conference>${conferenceId}</Conference>
</Dial>
```

### Instant Unmute (WebSocket Logger)
```javascript
// When human detected, single API call to unmute
await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${SID}/Conferences/${conferenceId}/Participants/${vapiSid}.json`,
  {
    method: 'POST',
    body: new URLSearchParams({ Muted: 'false' })
  }
);
```

## Common Issues & Solutions

### WebSocket receives conference ID, not call ID
- Solution: Look up call session by conference_id in database
- The stream parameter is the conference ID

### VAPI doesn't like being on hold
- Solution: Use conference with mute instead of queues/enqueue
- VAPI stays active in conference, just muted

### Multiple conferences
- Each call gets unique conference ID
- No conflicts between simultaneous calls
- Conferences auto-cleanup when empty

## Testing & Monitoring

### Expected Flow
1. Edge function logs: "VAPI call created" then "Clinic call created"
2. Vercel logs: Both calls joining conference
3. Railway logs: Classification in 1-6 seconds
4. Railway logs: "🎤 Human detected - unmuting VAPI"
5. Call proceeds normally

### Database Queries
```sql
-- Check conference status
SELECT 
  conference_id,
  vapi_on_hold,
  ivr_detection_state,
  EXTRACT(EPOCH FROM (vapi_unmuted_at - ivr_classified_at)) * 1000 as unmute_delay_ms
FROM call_sessions 
WHERE conference_id = 'YOUR_CONF_ID';
```

## Why Conferences Over Other Approaches

### Tried Approaches That Failed
1. **Queues**: VAPI interpreted <Enqueue> as customer hanging up
2. **Long Pause**: Couldn't bridge two separate calls without conference
3. **Direct Bridge**: Race conditions with multiple control points

### Why Conferences Work
- Both parties connected from start
- Simple mute/unmute control
- No call transfers needed
- VAPI stays happily connected
- Twilio conferences are simple (unlike Telnyx)

## Cost Considerations
- Conference: ~$0.0025/participant/minute
- 2 participants = ~$0.005/minute
- Similar to regular call costs
- Auto-cleanup when calls end

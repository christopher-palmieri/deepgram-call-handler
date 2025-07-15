# Pre-Classification Call System

## Overview
This system pre-classifies clinic phone systems (human vs IVR) and caches the results for 30 days, enabling instant routing for subsequent calls. Instead of classifying during every call (adding 3-6 seconds), we classify once and reuse the results.

## Benefits
- ⚡ **Speed**: Reduce call connection time from ~10s to ~5s
- 💰 **Cost**: One classification per clinic per month instead of every call
- 🎯 **Reliability**: Predictable routing behavior
- 📊 **Scalability**: Handle high call volumes without classification bottleneck

## Architecture Flow

### 1. PRE-CLASSIFICATION (Once per clinic/month)
```
├─> Call clinic
├─> Detect if human or IVR
├─> If IVR, record navigation steps with timing
├─> Store classification with IVR actions
└─> Cache for 30 days
```

### 2. ACTUAL CALLS (Unlimited for 30 days)
```
├─> Look up cached classification
├─> If human → Connect VAPI directly
├─> If IVR → Execute stored actions with timing → Connect VAPI
└─> If no classification → VAPI + WebSocket for classification
```

## Database Schema

### 1. call_classifications Table
Stores pre-classified phone system types and IVR navigation paths with timing.
```sql
CREATE TABLE call_classifications (
  id UUID PRIMARY KEY,
  phone_number TEXT NOT NULL,
  clinic_name TEXT,
  classification_type TEXT, -- 'human', 'ivr_only', 'ivr_then_human'
  classification_confidence FLOAT8,
  ivr_actions JSONB, -- [{"action_type": "dtmf", "action_value": "3", "timing_ms": 17000}]
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

### 2. call_sessions Table Updates
```sql
ALTER TABLE call_sessions 
ADD COLUMN clinic_phone TEXT,
ADD COLUMN classification_id UUID REFERENCES call_classifications(id);
```

### 3. ivr_events Table
Tracks IVR interactions during pre-classification calls.
```sql
CREATE TABLE ivr_events (
  id UUID PRIMARY KEY,
  call_id TEXT,
  transcript TEXT,
  action_type TEXT, -- 'dtmf', 'speech', 'wait', 'skip'
  action_value TEXT,
  executed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Edge Functions

### 1. Pre-Classification Function
**Endpoint**: `POST /functions/v1/pre-classify-call`

**Purpose**: Classify a clinic's phone system and cache results

**Request**:
```json
{
  "phone_number": "+16093694379"
}
```

**Response**:
```json
{
  "result": {
    "sid": "CA123...",
    "status": "queued"
  },
  "phone_number": "+16093694379",
  "classification_found": false,
  "classification_type": null
}
```

**Process**:
1. Check for existing valid classification
2. If none/expired, make classification call
3. Connect VAPI + WebSocket stream for classification
4. Railway server detects type and stores IVR navigation with timing
5. Classification stored when call ends (with IVR actions if applicable)

## Classification Storage

### Human Classification
Stored immediately when detected:
```json
{
  "classification_type": "human",
  "ivr_actions": null
}
```

### IVR Classification
Stored at call end with navigation actions and timing:
```json
{
  "classification_type": "ivr_only",
  "ivr_actions": [
    {
      "action_type": "dtmf",
      "action_value": "3",
      "timing_ms": 17000
    }
  ]
}
```

## Routing Logic

### With Classification
1. **Human**: Direct VAPI connection (no WebSocket)
2. **IVR Only**: 
   - Execute stored actions with proper timing
   - Use `<Pause>` elements based on `timing_ms`
   - Then connect VAPI
3. **IVR Then Human**: (To be implemented)

### Without Classification
- Dual stream approach: VAPI + WebSocket
- If human: VAPI already connected
- If IVR: Classify and store for future calls

## TwiML Examples

### Human Classification
```xml
<Response>
  <Dial>
    <Sip>sip:assistant@vapi.ai?X-Call-ID=CA123</Sip>
  </Dial>
</Response>
```

### IVR Classification with Timing
```xml
<Response>
  <Pause length="17" />
  <Play digits="3" />
  <Pause length="1" />
  <Dial>
    <Sip>sip:assistant@vapi.ai?X-Call-ID=CA123</Sip>
  </Dial>
</Response>
```

### No Classification (Dual Stream)
```xml
<Response>
  <Start>
    <Stream url="wss://railway.app">
      <Parameter name="streamSid" value="CA123" />
      <Parameter name="phoneNumber" value="+16093694379" />
    </Stream>
  </Start>
  <Dial>
    <Sip>sip:assistant@vapi.ai?X-Call-ID=CA123</Sip>
  </Dial>
</Response>
```

## Implementation Components

### Supabase Edge Functions
- `pre-classify-call`: Initiates calls and checks for existing classifications

### Vercel Webhooks
- `preclassify-twiml.js`: Routes calls based on classification status

### Railway WebSocket Server
- `server_deepgram.js`: Performs real-time classification
- `supabase-logger-twilio.js`: Stores classifications
- `storeFinalClassification()`: Captures IVR actions with timing at call end

## Monitoring & Maintenance

### Check Classification Status
```sql
-- View all active classifications with timing info
SELECT 
  phone_number, 
  clinic_name, 
  classification_type,
  jsonb_array_length(ivr_actions) as action_count,
  classification_expires_at,
  EXTRACT(DAY FROM (classification_expires_at - NOW())) as days_remaining
FROM call_classifications
WHERE is_active = true
ORDER BY classification_expires_at;

-- View IVR action details
SELECT 
  phone_number,
  jsonb_pretty(ivr_actions) as actions
FROM call_classifications
WHERE classification_type = 'ivr_only'
  AND is_active = true;
```

### Force Refresh Classification
```javascript
await fetch('/pre-classify-call', {
  method: 'POST',
  body: JSON.stringify({
    phone_number: '+16093694379',
    force_refresh: true // Bypasses cache
  })
});
```

## Performance Metrics

### Classification Timing
- Human detection: 1-3 seconds
- IVR detection: 3-6 seconds
- Full IVR mapping: 15-30 seconds (depends on menu depth)

### Cost Savings
- Without pre-classification: 3,000 classifications/month
- With pre-classification: 50 classifications/month
- **94% reduction** in classification overhead

## Troubleshooting

### Classification Not Working
1. Check `clinic_phone` is stored in `call_sessions`
2. Verify Railway server has `storeFinalClassification()` function
3. Ensure `timing_ms` is calculated from `created_at` timestamps

### IVR Navigation Timing Issues
- Review `timing_ms` values in stored actions
- Add buffer time if needed (round up seconds)
- Check if IVR menu has changed

### No Classification Stored
- Verify phone number is passed through TwiML chain
- Check Railway logs for classification events
- Ensure call completes (not terminated early)

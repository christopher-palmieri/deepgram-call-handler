# VAPI Dynamic Variables Implementation Log
**Date**: July 9, 2025  
**Goal**: Pass dynamic variables to VAPI while maintaining fast conference bridging

## Problem Statement
- Need to pass customer data (e.g., `customerName`) to VAPI assistant
- Current setup pre-dials VAPI into conference for instant bridging
- SIP headers with variables only work with `<Dial><Sip>` TwiML, not with Twilio Call API
- Can't have both pre-dial AND SIP headers with current approach

## Key Discoveries

### 1. SIP Header Format
- VAPI expects lowercase headers with underscores: `x-customer_name` (not `x-customerName`)
- Headers must be URL-encoded: `Indiana+Jones` (not `Indiana Jones`)
- Working format: `sip:brandon-call-for-kits@sip.vapi.ai?x-customer_name=Indiana+Jones`

### 2. VAPI Authentication Setup Required
- Created BYO SIP trunk credential in VAPI
- Registered Twilio phone number (+18507501280) with VAPI
- Added VAPI's IPs to Twilio ACL (44.229.228.186, 44.238.177.138)
- Credential ID: `393ac978-f999-4b6a-b7dd-838c79a830ab`

### 3. Direct TwiML Works
```xml
<Dial>
  <Sip>sip:brandon-call-for-kits@sip.vapi.ai?x-customer_name=Indiana+Jones</Sip>
</Dial>
```
✅ Variables received by VAPI as `customer_name: "Indiana+Jones"`

### 4. Conference Pre-dial Doesn't Support Headers
- Twilio Call API doesn't support SIP headers
- Conference architecture prevents using `<Dial><Sip>` for pre-dial

## Solution: Update Variables After Connection

### Architecture Decision
Keep fast bridging by pre-dialing VAPI, then update variables via VAPI API after connection.

### Implementation Flow
1. **Edge function** (`twilio-deepgram-conferences-IVR`) creates VAPI call
2. **Same edge function** receives VAPI webhook with call ID
3. **Edge function** updates VAPI with variables via API
4. **Edge function** dials clinic
5. Normal flow continues (classification, hold/unhold)

### Key Code Changes

#### 1. Database Update
```sql
ALTER TABLE call_sessions ADD COLUMN vapi_call_id TEXT;
```

#### 2. Edge Function Updates
- Handles both call creation AND VAPI webhooks
- Waits for VAPI call ID from webhook
- Updates variables via VAPI API:
```javascript
await fetch(`https://api.vapi.ai/v1/calls/${vapiCallId}`, {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${VAPI_API_KEY}`,
    'Content-Type': 'application/json'
  },
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

#### 3. VAPI Webhook Data
- Triggers on `status: "in-progress"`
- Contains VAPI call ID: `message.call.id`
- Contains Twilio call SID: `message.call.assistantOverrides.variableValues['twilio-callsid']`

### Environment Variables Needed
- Add `VAPI_API_KEY` to edge function

### Trade-offs
- **Pros**: Maintains fast bridging, minimal refactoring, variables work
- **Cons**: Adds ~1-2 seconds before dialing clinic (waiting for VAPI webhook)

## Testing Results
- ✅ Direct SIP dial with headers works
- ✅ VAPI receives variables as `customer_name`
- ✅ Conference bridging still works
- ⏳ Implementation in progress

## Next Steps
1. Deploy updated edge function
2. Update VAPI webhook URL to point to edge function
3. Test full flow with variables
4. Update VAPI assistant to use `{{customer_name}}` instead of `{{customerName}}`

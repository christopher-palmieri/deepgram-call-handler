Pre-Classification Call System
Overview
This system pre-classifies clinic phone systems (human vs IVR) and caches the results for 30 days, enabling instant routing for subsequent calls. Instead of classifying during every call (adding 3-6 seconds), we classify once and reuse the results.
Benefits

⚡ Speed: Reduce call connection time from ~10s to ~5s
💰 Cost: One classification per clinic per month instead of every call
🎯 Reliability: Predictable routing behavior
📊 Scalability: Handle high call volumes without classification bottleneck

Architecture Flow
1. PRE-CLASSIFICATION (Once per clinic/month)
   ├─> Call clinic
   ├─> Detect if human or IVR
   ├─> If IVR, record navigation steps
   └─> Cache for 30 days

2. ACTUAL CALLS (Unlimited for 30 days)
   ├─> Look up cached classification
   ├─> If human → Connect VAPI directly
   └─> If IVR → Navigate automatically → Connect VAPI
Database Schema
1. call_classifications Table
Stores pre-classified phone system types and IVR navigation paths.
sqlCREATE TABLE call_classifications (
  id UUID PRIMARY KEY,
  phone_number TEXT NOT NULL,
  clinic_name TEXT,
  classification_type TEXT, -- 'human', 'ivr_only', 'ivr_then_human'
  ivr_actions JSONB, -- [{"action_type": "dtmf", "action_value": "2"}]
  classification_expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
2. pending_calls Table Updates
Add classification support to existing table:
sqlALTER TABLE pending_calls 
ADD COLUMN classification_id UUID REFERENCES call_classifications(id),
ADD COLUMN classification_checked_at TIMESTAMPTZ;
3. call_sessions Table
Already exists - tracks individual call attempts and IVR events.
Edge Functions
1. Pre-Classification Function
Endpoint: POST /functions/v1/pre-classify
Purpose: Classify a clinic's phone system and cache results
Request:
json{
  "phone_number": "+16093694379",
  "clinic_name": "Adventure Health Clinic",
  "force_refresh": false
}
Response:
json{
  "success": true,
  "cached": false,
  "classification": {
    "id": "uuid",
    "classification_type": "ivr_then_human",
    "ivr_actions": [
      {"action_type": "dtmf", "action_value": "2"}
    ]
  }
}
Process:

Check for existing valid classification
If none/expired, make classification call
Use WebSocket/Deepgram to detect type
Store IVR navigation steps from ivr_events
Cache for 30 days

2. Main Call Function
Endpoint: POST /functions/v1/main-call
Purpose: Make actual calls using cached classification
Request:
json{
  "phone_number": "+16093694379",
  "customer_name": "Indiana Jones",
  "appointment_time": "3:00 PM"
}
Response:
json{
  "success": true,
  "call_sid": "CA123...",
  "classification_type": "ivr_then_human",
  "message": "Navigating IVR then connecting VAPI"
}
Process:

Look up classification for phone number
Route based on type:

Human: Direct VAPI connection with SIP headers
IVR: Execute stored actions → Connect VAPI



Webhooks (Vercel)
1. /api/twilio/pre-classify-twiml
Handles pre-classification calls - starts WebSocket stream for 15 seconds.
2. /api/twilio/direct-vapi-bridge
Human path - connects VAPI directly with variables in SIP headers.
3. /api/twilio/ivr-navigate-then-vapi
IVR path - executes stored DTMF/actions, then connects VAPI.
Implementation Steps
Phase 1: Setup Infrastructure
bash# 1. Create call_classifications table
psql -d your_database -f create_classifications_table.sql

# 2. Update pending_calls table
psql -d your_database -f update_pending_calls.sql

# 3. Deploy edge functions
supabase functions deploy pre-classify
supabase functions deploy main-call

# 4. Deploy webhooks to Vercel
vercel deploy
Phase 2: Pre-Classify Clinics
javascript// Pre-classify all unique clinics
const clinics = await getUniqueClinics();

for (const clinic of clinics) {
  await fetch('/pre-classify', {
    method: 'POST',
    body: JSON.stringify({
      phone_number: clinic.phone,
      clinic_name: clinic.name
    })
  });
  
  // Wait between calls to avoid rate limits
  await sleep(5000);
}
Phase 3: Update Call Logic
javascript// In your call processor
async function processKitConfirmation(pendingCall) {
  // Ensure classification exists
  const hasClassification = await checkClassification(pendingCall.phone);
  
  if (!hasClassification) {
    await preClassify(pendingCall.phone, pendingCall.clinic_name);
  }
  
  // Make the actual call
  const result = await makeCall({
    phone_number: pendingCall.phone,
    customer_name: pendingCall.employee_name,
    appointment_time: pendingCall.appointment_time
  });
  
  // Update pending_call status
  await updatePendingCall(pendingCall.id, {
    triggered: true,
    trigger_response: result
  });
}
Monitoring & Maintenance
Check Classification Status
sql-- View all active classifications
SELECT phone_number, clinic_name, classification_type, 
       classification_expires_at,
       EXTRACT(DAY FROM (classification_expires_at - NOW())) as days_remaining
FROM call_classifications
WHERE is_active = true
ORDER BY classification_expires_at;

-- Find clinics needing re-classification soon
SELECT * FROM call_classifications
WHERE is_active = true
  AND classification_expires_at < NOW() + INTERVAL '7 days';
Force Refresh Classification
javascript// If clinic changes their phone system
await fetch('/pre-classify', {
  method: 'POST',
  body: JSON.stringify({
    phone_number: '+16093694379',
    force_refresh: true
  })
});
Cost Analysis
Without Pre-Classification:

100 calls/day × 30 days = 3,000 classification attempts
3,000 × 5 seconds = 4.2 hours of classification time

With Pre-Classification:

50 unique clinics × 1 classification = 50 classification attempts
50 × 30 seconds = 25 minutes of classification time
94% reduction in classification overhead!

Troubleshooting
Classification Not Found

Check phone number format (must include country code)
Verify classification hasn't expired
Check is_active flag

IVR Navigation Failing

Force refresh classification
Check if clinic changed their phone menu
Review ivr_events for the pre-classification call

Performance Issues

Add index on phone_number if not exists
Implement classification warm-up for new clinics
Consider shorter TTL for frequently changing clinics

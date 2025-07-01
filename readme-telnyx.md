IVR-to-VAPI Bridge System Documentation
Overview
This system automates outbound calls to medical clinics, navigates IVR phone systems, and bridges to VAPI (AI voice assistant) when a human is reached. The architecture uses Telnyx for telephony, Railway for real-time audio processing, and Vercel for call orchestration.
System Architecture
Core Components

Supabase Edge Function (telnyx-conference-vapi)

Initiates the call flow
Creates a Telnyx conference
Dials VAPI first (to eliminate connection delay)
Returns session ID for tracking


Vercel Functions

conference-webhook-bridge.js - Handles conference events, manages VAPI hold/unhold
voice-api-handler-vapi-bridge.js - Processes call events, manages IVR detection state


Railway WebSocket Server (server_telnyx.js)

Receives real-time audio stream from Telnyx
Processes audio through Deepgram for speech-to-text
Performs IVR detection (automated system vs human)
Navigates IVR menus using OpenAI
Executes DTMF tones and speech commands



Call Flow
Phase 1: Conference Setup

Edge function creates conference and dials VAPI
VAPI joins conference and is immediately put on hold
System dials the target medical clinic number
Clinic call webhooks route to voice-api-handler-vapi-bridge

Phase 2: IVR Detection & Navigation

Audio streams to Railway WebSocket server
Deepgram converts speech to text
Fast classifier checks for human/IVR patterns
If IVR detected:

OpenAI analyzes menu options
System presses appropriate numbers to reach reception/scheduling
Actions stored in ivr_events table


If human detected:

Classification stored as "human" or "ivr_then_human"
Triggers VAPI unmute process



Phase 3: VAPI Bridge

When human is detected or IVR navigation completes
VAPI is unmuted (taken off hold)
VAPI conducts the conversation with the human

Database Schema
call_sessions

call_id - Unique identifier (format: clinic-{session_id} for conference calls)
telnyx_leg_id - Actual Telnyx call leg ID (used by Railway)
conference_session_id - Links to conference
ivr_detection_state - Classification result (ivr_only/human/ivr_then_human)
vapi_on_hold - Whether VAPI is currently muted
vapi_control_id - For hold/unhold operations
Plus various timestamps and status fields

ivr_events

call_id - Links to call (uses Telnyx leg ID)
transcript - What was heard
action_type - dtmf/speech/wait
action_value - What to do (e.g., "1" for DTMF)
executed - Whether action was performed

Key Technical Details
Audio Processing

Telnyx sends μ-law 8kHz audio
Railway broadcasts to multiple sinks (Deepgram, VAPI)
Deepgram provides real-time transcription
VAPI expects PCM 16-bit audio (conversion handled)

IVR Detection Logic

Fast Classification: Pattern matching for instant detection
OpenAI Classification: More nuanced detection after 3 seconds
Navigation AI: Only navigates to general reception/scheduling, avoids department-specific options

Conference Management

Uses Telnyx conference API
VAPI participant held/unheld via conference participant endpoints
Unmute triggers:

Human detection
Successful IVR navigation
Multiple IVR actions completed



Current Implementation Status
Working Features ✅

Conference creation with VAPI on hold
Clinic dialing with proper webhook routing
Real-time audio streaming to Railway
IVR transcription and action generation
Human vs IVR detection
DTMF tone execution
Conference participant tracking

Known Issues ❌

IVR State Not Updating in Database

Railway detects human/IVR correctly
Database update fails because telnyx_leg_id is null
Railway can't find session to update


Hold/Unhold 404 Errors

Initially tried call-level hold (doesn't work in conference)
Fixed by using conference participant endpoints
Requires proper conference_id and participant_id tracking



Debugging Notes
Why telnyx_leg_id is null

Conference webhook creates session before call exists
Uses clinic-{session_id} as call_id
When actual call initiates, should update with real Telnyx leg ID
Update appears to be failing silently

Railway Lookup Logic

First checks by telnyx_leg_id
Falls back to call_id
Both fields null/mismatched = no session found

Next Steps

Deploy enhanced logging in voice-api-handler-vapi-bridge
Verify telnyx_leg_id is being stored on call initiation
Confirm Railway can find sessions using either field
Test full flow: IVR navigation → human detection → VAPI unmute

Environment Variables Required
# Telnyx
TELNYX_API_KEY
TELNYX_PHONE_NUMBER
TELNYX_CONNECTION_ID
TELNYX_WS_URL (Railway WebSocket)

# Supabase
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY

# VAPI
VAPI_SIP_ADDRESS
VAPI_API_KEY (for Railway if using VAPI sink)

# APIs
OPENAI_API_KEY
DEEPGRAM_API_KEY

# URLs
WEBHOOK_URL (your Vercel deployment)
Architecture Benefits

No VAPI connection delay - VAPI ready instantly when human detected
Intelligent IVR navigation - Reaches correct department
Scalable - Separate services for different concerns
Fault tolerant - Conference persists even if one leg fails

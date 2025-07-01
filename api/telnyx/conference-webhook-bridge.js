// api/telnyx/conference-webhook-bridge.js
// Enhanced conference webhook that unmutes VAPI based on IVR events

import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: true } };

const TELNYX_API_URL = 'https://api.telnyx.com/v2';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Track VAPI participants and their hold status
const vapiParticipants = new Map();

export default async function handler(req, res) {
  const FROM_NUMBER = process.env.TELNYX_PHONE_NUMBER || '+16092370151';
  
  if (req.method === 'GET') {
    return res.status(200).send('Conference webhook endpoint is live');
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Parse request body
    let body = req.body || {};
    if (!Object.keys(body).length) {
      const raw = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      try { body = JSON.parse(raw); } catch {}
    }

    const evt = (body.data && body.data.event_type) || body.event_type;
    const pl = (body.data && body.data.payload) || body.payload;
    console.log('🎯 Conference webhook hit:', evt, JSON.stringify(pl));

    if (['status-update', 'end-of-call-report'].includes(evt)) {
      return res.status(200).json({ received: true });
    }

    // When VAPI joins the conference
    if (evt === 'conference.participant.joined') {
      console.log('🎯 Participant joined:', pl.participant_id, 'Call Control:', pl.call_control_id);
      
      // Check if this is VAPI by looking at the client state
      let isVAPI = false;
      let sessionData = null;
      
      if (pl.client_state) {
        try {
          sessionData = JSON.parse(atob(pl.client_state));
          // The initial VAPI call should have session_id and human in client_state
          isVAPI = sessionData.session_id && sessionData.human && !sessionData.is_conference_leg;
          console.log('📍 Client state:', sessionData, 'Is VAPI?', isVAPI);
        } catch (e) {
          console.log('Failed to parse client state');
        }
      }
      
      if (isVAPI && sessionData) {
        const { session_id, human } = sessionData;
        const room = `conf-${session_id}`;
        console.log('🤖 VAPI joined conference:', room);

        // Store VAPI participant info
        vapiParticipants.set(session_id, {
          call_control_id: pl.call_control_id,
          participant_id: pl.participant_id,
          on_hold: false, // Will be set to true after hold
          joined_at: new Date().toISOString()
        });

        // Use the conference hold endpoint instead of call hold
        console.log('🔇 Holding VAPI participant:', pl.participant_id);
        const holdResp = await fetch(
          `${TELNYX_API_URL}/conferences/${pl.conference_id}/participants/${pl.participant_id}/hold`,
          { 
            method: 'PUT', 
            headers: { 
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
              'Content-Type':'application/json' 
            },
            body: JSON.stringify({})
          }
        );
        const holdResult = await holdResp.text();
        console.log('Hold response:', holdResp.status, holdResult);
        
        if (holdResp.ok) {
          vapiParticipants.get(session_id).on_hold = true;
        }

        // Update database to track VAPI hold status
        await supabase
          .from('call_sessions')
          .update({ 
            vapi_on_hold: holdResp.ok,
            vapi_control_id: pl.call_control_id,
            vapi_participant_id: pl.participant_id,
            conference_id: pl.conference_id
          })
          .eq('conference_session_id', session_id);

      // Dial clinic/human into conference with IVR detection webhook
      const webhookUrl = `${process.env.WEBHOOK_URL || 'https://v0-new-project-qykgboija9j.vercel.app'}/api/telnyx/voice-api-handler-vapi-bridge`;
      console.log('📞 Dialing clinic with webhook URL:', webhookUrl);
      
      const dialBody = {
        connection_id: pl.connection_id,
        to: human,
        from: FROM_NUMBER,
        enable_early_media: true,
        conference_config: { 
          conference_name: room, 
          start_conference_on_enter: true, 
          end_conference_on_exit: true 
        },
        // IMPORTANT: Send webhooks to voice-api-handler-vapi-bridge for IVR detection
        webhook_url: webhookUrl,
        webhook_url_method: 'POST',
        // Pass conference info in client state
        client_state: btoa(JSON.stringify({
          ...JSON.parse(atob(pl.client_state)),
          conference_name: room,
          vapi_control_id: pl.call_control_id,
          is_conference_leg: true
        }))
      };
      
      console.log('📤 Dial request body:', JSON.stringify(dialBody, null, 2));
      
      const dialResp = await fetch(
        `${TELNYX_API_URL}/calls`,
        {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
            'Content-Type':'application/json' 
          },
          body: JSON.stringify(dialBody)
        }
      );
      const dialResult = await dialResp.json();
      console.log('Clinic dial response:', dialResp.status, JSON.stringify(dialResult));
      
      // Store the conference info in database
      const clinicCallId = `clinic-${session_id}`;
      
      // Check if session already exists
      const { data: existingSession } = await supabase
        .from('call_sessions')
        .select('*')
        .eq('call_id', clinicCallId)
        .maybeSingle();
      
      if (!existingSession) {
        // Create new session
        await supabase
          .from('call_sessions')
          .insert([{
            call_id: clinicCallId,
            conference_session_id: session_id,
            conference_created: true,
            vapi_control_id: pl.call_control_id,
            vapi_on_hold: true,
            target_number: human,
            call_status: 'active',
            bridge_mode: true,
            created_at: new Date().toISOString()
          }]);
        console.log('✅ Created call session for clinic leg');
      } else {
        // Update existing session
        await supabase
          .from('call_sessions')
          .update({
            vapi_control_id: pl.call_control_id,
            vapi_on_hold: true
          })
          .eq('call_id', clinicCallId);
        console.log('✅ Updated existing call session');
      }

      // Start monitoring for unmute conditions
      startUnmuteMonitor(session_id, pl.call_control_id);
    }

    // When human joins the conference
    if (evt === 'conference.participant.joined' && pl.call_control_id !== pl.creator_call_control_id) {
      console.log('👤 Human joined conference');
      
      // Try to find session by parsing client_state
      if (pl.client_state) {
        try {
          const { session_id } = JSON.parse(atob(pl.client_state));
          
          // Update database
          await supabase
            .from('call_sessions')
            .update({ 
              human_joined_conference: true,
              human_joined_at: new Date().toISOString() 
            })
            .eq('conference_session_id', session_id);
            
        } catch (e) {
          console.error('Failed to parse client_state:', e);
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(200).json({ received: true, error: err.message });
  }
}

// Monitor for conditions to unmute VAPI
async function startUnmuteMonitor(sessionId, vapiControlId) {
  console.log('👁️ Starting unmute monitor for session:', sessionId);
  let checkCount = 0;
  const maxChecks = 120; // 60 seconds at 500ms intervals

  const monitor = setInterval(async () => {
    checkCount++;
    
    try {
      // Get current session state from database
      const { data: session } = await supabase
        .from('call_sessions')
        .select('*')
        .eq('conference_session_id', sessionId)
        .maybeSingle();

      if (!session) {
        console.log('⚠️ No session found for:', sessionId);
        clearInterval(monitor);
        return;
      }

      // Check if we should unmute
      const shouldUnmute = await checkUnmuteConditions(session);
      
      if (shouldUnmute || checkCount >= maxChecks) {
        console.log(`🔊 Unmuting VAPI (reason: ${shouldUnmute ? shouldUnmute.reason : 'timeout'})`);
        
        // Get participant info
        const participant = vapiParticipants.get(sessionId);
        if (!participant) {
          console.error('❌ No participant info found');
          clearInterval(monitor);
          return;
        }
        
        // Get conference ID from session
        const { data: sessionData } = await supabase
          .from('call_sessions')
          .select('conference_id')
          .eq('conference_session_id', sessionId)
          .single();
        
        if (!sessionData?.conference_id) {
          console.error('❌ No conference ID found');
          clearInterval(monitor);
          return;
        }
        
        // Unhold VAPI using conference participant endpoint
        const unholdResp = await fetch(
          `${TELNYX_API_URL}/conferences/${sessionData.conference_id}/participants/${participant.participant_id}/unhold`,
          { 
            method: 'PUT', 
            headers: { 
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
              'Content-Type':'application/json' 
            },
            body: JSON.stringify({})
          }
        );
        console.log('Unhold response:', unholdResp.status);

        // Update database
        await supabase
          .from('call_sessions')
          .update({ 
            vapi_on_hold: false,
            vapi_unmuted_at: new Date().toISOString(),
            vapi_unmute_reason: shouldUnmute ? shouldUnmute.reason : 'timeout'
          })
          .eq('conference_session_id', sessionId);

        // Clean up
        vapiParticipants.delete(sessionId);
        clearInterval(monitor);
      }

    } catch (err) {
      console.error('❌ Unmute monitor error:', err);
    }
  }, 500); // Check every 500ms
}

// Check conditions for unmuting VAPI
async function checkUnmuteConditions(session) {
  // 1. Human detected
  if (['human', 'ivr_then_human'].includes(session.ivr_detection_state)) {
    // Wait for human to actually join the conference
    if (session.human_joined_conference) {
      return { reason: 'human_detected_and_joined' };
    }
  }

  // 2. Check recent IVR actions
  const { data: recentActions } = await supabase
    .from('ivr_events')
    .select('*')
    .eq('call_id', session.call_id)
    .eq('executed', true)
    .gte('executed_at', new Date(Date.now() - 30000).toISOString()) // Last 30 seconds
    .order('executed_at', { ascending: false });

  if (recentActions && recentActions.length > 0) {
    // Check if we navigated to reception/scheduling
    const navigationComplete = recentActions.some(action => {
      const transcript = (action.transcript || '').toLowerCase();
      return (
        transcript.includes('reception') ||
        transcript.includes('scheduling') ||
        transcript.includes('front desk') ||
        transcript.includes('speak to someone') ||
        transcript.includes('representative')
      ) && action.action_type === 'dtmf';
    });

    if (navigationComplete) {
      return { reason: 'ivr_navigation_complete' };
    }

    // Multiple successful actions
    if (recentActions.length >= 2) {
      return { reason: 'multiple_ivr_actions' };
    }
  }

  // 3. Human joined but no IVR detection (direct human answer)
  if (session.human_joined_conference && !session.ivr_detection_state) {
    const timeSinceJoin = Date.now() - new Date(session.human_joined_at).getTime();
    if (timeSinceJoin > 3000) { // 3 seconds after human joined
      return { reason: 'human_joined_no_ivr' };
    }
  }

  return null;
}

// Clean up old participants periodically
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, participant] of vapiParticipants.entries()) {
    const age = now - new Date(participant.joined_at).getTime();
    if (age > 300000) { // 5 minutes
      console.log('🧹 Cleaning up old participant:', sessionId);
      vapiParticipants.delete(sessionId);
    }
  }
}, 60000); // Every minute

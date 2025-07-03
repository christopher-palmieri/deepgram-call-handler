// api/telnyx/conference-webhook-bridge.js
// Enhanced conference webhook that unmutes VAPI based on IVR events
// FIXED VERSION - Uses correct hold endpoint

import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: true } };

const TELNYX_API_URL = 'https://api.telnyx.com/v2';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Track VAPI participants and their hold status
const vapiParticipants = new Map();

// Helper function to dial clinic into conference
async function dialClinicIntoConference(sessionData, room, human) {
  const webhookUrl = `${process.env.WEBHOOK_URL || 'https://v0-new-project-qykgboija9j.vercel.app'}/api/telnyx/voice-api-handler-vapi-bridge`;
  console.log('📞 Dialing clinic with webhook URL:', webhookUrl);
  
  const dialBody = {
    connection_id: sessionData.connection_id,
    to: human,
    from: process.env.TELNYX_PHONE_NUMBER || '+16092370151',
    enable_early_media: true,
    conference_config: { 
      conference_name: room, 
      start_conference_on_enter: true, 
      end_conference_on_exit: true 
    },
    webhook_url: webhookUrl,
    webhook_url_method: 'POST',
    client_state: btoa(JSON.stringify({
      session_id: sessionData.session_id,
      conference_name: room,
      vapi_control_id: sessionData.vapi_control_id,
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
  const clinicCallId = `clinic-${sessionData.session_id}`;
  
  const { data: existingSession } = await supabase
    .from('call_sessions')
    .select('*')
    .eq('call_id', clinicCallId)
    .maybeSingle();
  
  if (!existingSession) {
    await supabase
      .from('call_sessions')
      .insert([{
        call_id: clinicCallId,
        conference_session_id: sessionData.session_id,
        conference_created: true,
        vapi_control_id: sessionData.vapi_control_id,
        vapi_on_hold: true,
        target_number: human,
        call_status: 'active',
        bridge_mode: true,
        created_at: new Date().toISOString()
        // Note: telnyx_leg_id will be filled in when the call is initiated
      }]);
    console.log('✅ Created call session for clinic leg');
  } else {
    await supabase
      .from('call_sessions')
      .update({
        vapi_control_id: sessionData.vapi_control_id,
        vapi_on_hold: true
      })
      .eq('call_id', clinicCallId);
    console.log('✅ Updated existing call session');
  }
}

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
    
    // ADD COMPREHENSIVE LOGGING HERE
    console.log('🎯 Conference webhook hit:', evt);
    console.log('📦 Full body structure:', JSON.stringify(body, null, 2));
    console.log('📋 Payload structure:', JSON.stringify(pl, null, 2));

    if (['status-update', 'end-of-call-report'].includes(evt)) {
      return res.status(200).json({ received: true });
    }

    // When VAPI joins the conference
    if (evt === 'conference.participant.joined') {
      // We don't have participant_id, but we have call_control_id
      const callControlId = pl.call_control_id;
      const conferenceId = pl.conference_id;
      
      console.log('🎯 Participant joined:');
      console.log('  - Call Control ID:', callControlId);
      console.log('  - Conference ID:', conferenceId);
      console.log('  - Call Leg ID:', pl.call_leg_id);
      console.log('  - Call Session ID:', pl.call_session_id);
      
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
      
      if (isVAPI && sessionData && conferenceId) {
        const { session_id, human } = sessionData;
        const room = `conf-${session_id}`;
        console.log('🤖 VAPI joined conference:', room);

        // Store VAPI participant info
        vapiParticipants.set(session_id, {
          call_control_id: callControlId,
          call_leg_id: pl.call_leg_id,
          call_session_id: pl.call_session_id,
          conference_id: conferenceId,
          on_hold: false, // Will be set to true after hold
          joined_at: new Date().toISOString()
        });

        // Use the conference ACTIONS hold endpoint with call_control_ids in body
        console.log('🔇 Holding VAPI participant using call_control_id:', callControlId);
        const holdResp = await fetch(
          `${TELNYX_API_URL}/conferences/${conferenceId}/actions/hold`,
          { 
            method: 'POST', 
            headers: { 
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
              'Content-Type':'application/json' 
            },
            body: JSON.stringify({
              call_control_ids: [callControlId]  // Pass as array in body
            })
          }
        );
        const holdResult = await holdResp.text();
        console.log('Hold response:', holdResp.status, holdResult);
        
        if (holdResp.ok) {
          vapiParticipants.get(session_id).on_hold = true;
          console.log('✅ VAPI successfully placed on hold');
        } else {
          console.error('❌ Failed to hold VAPI:', holdResult);
        }

        // Update database to track VAPI hold status
        await supabase
          .from('call_sessions')
          .update({ 
            vapi_on_hold: holdResp.ok,
            vapi_control_id: callControlId,
            vapi_call_leg_id: pl.call_leg_id,
            conference_id: conferenceId
          })
          .eq('conference_session_id', session_id);

        // Dial clinic/human into conference
        await dialClinicIntoConference({
          session_id,
          connection_id: pl.connection_id,
          vapi_control_id: callControlId
        }, room, human);

        // Start monitoring for unmute conditions
        startUnmuteMonitor(session_id, callControlId);
      }
    }

    // When human joins the conference
    if (evt === 'conference.participant.joined' && pl.client_state) {
      try {
        const clientState = JSON.parse(atob(pl.client_state));
        if (clientState.is_conference_leg) {
          console.log('👤 Human/Clinic leg joined conference');
          
          // Update database
          await supabase
            .from('call_sessions')
            .update({ 
              human_joined_conference: true,
              human_joined_at: new Date().toISOString() 
            })
            .eq('conference_session_id', clientState.session_id);
        }
      } catch (e) {
        console.error('Failed to parse client_state:', e);
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
        
        // Unhold VAPI using conference actions endpoint with call_control_ids
        const unholdResp = await fetch(
          `${TELNYX_API_URL}/conferences/${participant.conference_id}/actions/unhold`,
          { 
            method: 'POST', 
            headers: { 
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
              'Content-Type':'application/json' 
            },
            body: JSON.stringify({
              call_control_ids: [participant.call_control_id]  // Pass as array in body
            })
          }
        );
        console.log('Unhold response:', unholdResp.status);

        if (unholdResp.ok) {
          console.log('✅ VAPI successfully removed from hold');
        } else {
          const error = await unholdResp.text();
          console.error('❌ Failed to unhold VAPI:', error);
        }

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
  console.log('🔍 Checking unmute conditions for session:', {
    conference_session_id: session.conference_session_id,
    ivr_detection_state: session.ivr_detection_state,
    human_joined_conference: session.human_joined_conference,
    vapi_on_hold: session.vapi_on_hold,
    telnyx_leg_id: session.telnyx_leg_id,
    call_id: session.call_id
  });

  // 1. Human detected by IVR classification
  if (['human', 'ivr_then_human'].includes(session.ivr_detection_state)) {
    console.log('✅ Human detected via IVR classification:', session.ivr_detection_state);
    
    // For direct human detection, unmute immediately
    if (session.ivr_detection_state === 'human') {
      return { reason: 'human_detected_direct' };
    }
    
    // For ivr_then_human, wait for human to actually join
    if (session.human_joined_conference) {
      return { reason: 'human_detected_and_joined' };
    } else {
      console.log('⏳ Waiting for human to join conference...');
    }
  }

  // 2. Check recent IVR actions (for clinic leg)
  // We need to check the clinic leg ID, not the VAPI session ID
  const clinicCallId = `clinic-${session.conference_session_id}`;
  const { data: clinicSession } = await supabase
    .from('call_sessions')
    .select('telnyx_leg_id, ivr_detection_state')
    .eq('call_id', clinicCallId)
    .maybeSingle();
    
  if (clinicSession) {
    console.log('🏥 Clinic session found:', {
      telnyx_leg_id: clinicSession.telnyx_leg_id,
      ivr_detection_state: clinicSession.ivr_detection_state
    });
    
    // Check if clinic leg detected human
    if (['human', 'ivr_then_human'].includes(clinicSession.ivr_detection_state)) {
      console.log('✅ Human detected on clinic leg!');
      return { reason: 'human_detected_clinic_leg' };
    }
    
    // Check IVR actions on clinic leg
    if (clinicSession.telnyx_leg_id) {
      const { data: recentActions } = await supabase
        .from('ivr_events')
        .select('*')
        .eq('call_id', clinicSession.telnyx_leg_id)
        .eq('executed', true)
        .gte('executed_at', new Date(Date.now() - 30000).toISOString()) // Last 30 seconds
        .order('executed_at', { ascending: false });

      console.log('📋 Recent IVR actions on clinic leg:', recentActions?.length || 0);

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
          console.log('✅ Navigation to reception/front desk complete');
          return { reason: 'ivr_navigation_complete' };
        }

        // Multiple successful actions
        if (recentActions.length >= 2) {
          console.log('✅ Multiple IVR actions executed');
          return { reason: 'multiple_ivr_actions' };
        }
      }
    }
  } else {
    console.log('⚠️ No clinic session found for conference');
  }

  // 3. Human joined but no IVR detection (direct human answer)
  if (session.human_joined_conference && !session.ivr_detection_state) {
    const timeSinceJoin = Date.now() - new Date(session.human_joined_at).getTime();
    console.log(`⏱️ Human joined ${Math.round(timeSinceJoin/1000)}s ago without IVR detection`);
    if (timeSinceJoin > 3000) { // 3 seconds after human joined
      return { reason: 'human_joined_no_ivr' };
    }
  }

  console.log('❌ No unmute conditions met yet');
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

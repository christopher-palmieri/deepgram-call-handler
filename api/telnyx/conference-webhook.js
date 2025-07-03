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
      conference_id: sessionData.conference_id,  // ADD THIS
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
        conference_id: sessionData.conference_id,  // ADD THIS
        created_at: new Date().toISOString()
      }]);
    console.log('✅ Created call session for clinic leg');
  } else {
    await supabase
      .from('call_sessions')
      .update({
        vapi_control_id: sessionData.vapi_control_id,
        vapi_on_hold: true,
        conference_id: sessionData.conference_id  // ADD THIS
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
    console.log('🎯 Conference webhook hit:', evt, JSON.stringify(pl));

    if (['status-update', 'end-of-call-report'].includes(evt)) {
      return res.status(200).json({ received: true });
    }

    // When VAPI joins the conference
    if (evt === 'conference.participant.joined') {
      console.log('🎯 Participant joined - Call Control:', pl.call_control_id);
      
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
        const callControlId = pl.call_control_id;
        const conferenceId = pl.conference_id;
        
        console.log('🤖 VAPI joined conference:', room);

        // Store VAPI participant info
        vapiParticipants.set(session_id, {
          call_control_id: callControlId,
          conference_id: conferenceId,
          on_hold: false,
          joined_at: new Date().toISOString()
        });

        // Use the CALL hold endpoint (like the working version)
        console.log('🔇 Holding VAPI using call endpoint:', callControlId);
        const holdResp = await fetch(
          `${TELNYX_API_URL}/calls/${callControlId}/actions/hold`,
          { 
            method: 'POST', 
            headers: { 
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
              'Content-Type':'application/json' 
            }
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
        const updateResult = await supabase
          .from('call_sessions')
          .update({ 
            vapi_on_hold: holdResp.ok,
            vapi_control_id: callControlId,
            conference_id: conferenceId
          })
          .eq('conference_session_id', session_id);
          
        console.log('📝 Update VAPI session result:', {
          session_id,
          updateResult: updateResult.data,
          error: updateResult.error
        });
        
        // If update didn't find a record, we might need to create one
        if (!updateResult.data || updateResult.data.length === 0) {
          console.log('⚠️ No VAPI session found to update, checking if we need to create one');
          
          // Check if a session exists with this conference_session_id
          const { data: existingSession } = await supabase
            .from('call_sessions')
            .select('*')
            .eq('conference_session_id', session_id)
            .maybeSingle();
            
          if (!existingSession) {
            console.log('🆕 Creating VAPI session');
            const { data: newSession, error } = await supabase
              .from('call_sessions')
              .insert([{
                call_id: `vapi-${session_id}`,
                conference_session_id: session_id,
                vapi_on_hold: holdResp.ok,
                vapi_control_id: callControlId,
                conference_id: conferenceId,
                call_status: 'active',
                created_at: new Date().toISOString()
              }])
              .select()
              .single();
              
            console.log('VAPI session creation result:', { newSession, error });
          }
        }

        // Start monitoring for unmute conditions
        console.log('🚀 About to start unhold monitor');
        startUnmuteMonitor(session_id, callControlId, conferenceId);

        // Dial clinic/human into conference
        await dialClinicIntoConference({
          session_id,
          connection_id: pl.connection_id,
          vapi_control_id: callControlId,
          conference_id: conferenceId  // ADD THIS
        }, room, human);
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
function startUnmuteMonitor(sessionId, vapiControlId, conferenceId) {
  console.log('👁️ Starting unmute monitor for session:', sessionId);
  console.log('📊 Monitor params:', {
    sessionId,
    vapiControlId,
    conferenceId,
    clinicCallId: `clinic-${sessionId}`
  });
  
  let checkCount = 0;
  const maxChecks = 240; // 60 seconds at 250ms intervals

  const monitor = setInterval(async () => {
    checkCount++;
    
    // Log every 10th check
    if (checkCount % 10 === 0) {
      console.log(`⏱️ Monitor check #${checkCount} for session ${sessionId}`);
    }
    
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

      // Skip if already unholding
      if (!session.vapi_on_hold) {
        console.log('✅ VAPI already unheld');
        clearInterval(monitor);
        return;
      }

      // Check if we should unmute
      const shouldUnmute = await checkUnmuteConditions(session, sessionId);
      
      if (shouldUnmute || checkCount >= maxChecks) {
        console.log(`🔊 Unholding VAPI (reason: ${shouldUnmute ? shouldUnmute.reason : 'timeout'})`);
        
        // Get participant info
        const participant = vapiParticipants.get(sessionId);
        if (!participant) {
          console.error('❌ No participant info found');
          clearInterval(monitor);
          return;
        }
        
        // Unhold VAPI using CALL endpoint (not conference endpoint)
        const unholdResp = await fetch(
          `${TELNYX_API_URL}/calls/${participant.call_control_id}/actions/unhold`,
          { 
            method: 'POST', 
            headers: { 
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
              'Content-Type':'application/json' 
            }
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
  }, 250); // Check every 250ms
}

// Check conditions for unmuting VAPI
async function checkUnmuteConditions(session, sessionId) {
  // Check the CLINIC leg's IVR detection
  const clinicCallId = `clinic-${sessionId}`;
  const { data: clinicSession } = await supabase
    .from('call_sessions')
    .select('*')
    .eq('call_id', clinicCallId)
    .maybeSingle();
    
  if (!clinicSession) {
    return null;
  }

  // Log only first time we find the clinic session
  if (!session._clinicFound) {
    console.log('🏥 Found clinic session:', {
      ivr_detection_state: clinicSession.ivr_detection_state,
      telnyx_leg_id: clinicSession.telnyx_leg_id
    });
    // Mark that we've logged this
    await supabase
      .from('call_sessions')
      .update({ _clinicFound: true })
      .eq('conference_session_id', sessionId);
  }
  
  // Check if clinic leg detected human
  if (['human', 'ivr_then_human'].includes(clinicSession.ivr_detection_state)) {
    console.log('✅ Human detected on clinic leg!', clinicSession.ivr_detection_state);
    return { reason: `human_detected_clinic_leg_${clinicSession.ivr_detection_state}` };
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

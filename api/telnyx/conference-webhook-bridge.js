// api/telnyx/conference-webhook-bridge.js
// Enhanced conference webhook with proper session management and test endpoints

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
      conference_id: sessionData.conference_id,
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
  
  // Create or update the clinic session
  const clinicCallId = `clinic-${sessionData.session_id}`;
  
  try {
    // First check if session exists
    const { data: existingSession } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('call_id', clinicCallId)
      .maybeSingle();
    
    if (!existingSession) {
      // Create new clinic session
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
          conference_id: sessionData.conference_id,
          created_at: new Date().toISOString()
        }]);
      console.log('✅ Created call session for clinic leg');
    } else {
      // Update existing session
      await supabase
        .from('call_sessions')
        .update({
          vapi_control_id: sessionData.vapi_control_id,
          vapi_on_hold: true,
          conference_id: sessionData.conference_id
        })
        .eq('call_id', clinicCallId);
      console.log('✅ Updated existing call session');
    }
  } catch (err) {
    console.error('❌ Error managing clinic session:', err);
  }
}

export default async function handler(req, res) {
  const FROM_NUMBER = process.env.TELNYX_PHONE_NUMBER || '+16092370151';
  
  // ===== TEST ENDPOINTS START =====
  
  // Test endpoint for manual unhold
  if (req.method === 'GET' && req.url.includes('/test-unhold')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const session_id = url.searchParams.get('session_id');
    
    if (!session_id) {
      return res.status(400).json({ 
        error: 'Missing session_id parameter',
        usage: '/api/telnyx/conference-webhook-bridge?test-unhold=true&session_id=YOUR_SESSION_ID'
      });
    }
    
    console.log('🧪 TEST: Manual unhold triggered for session:', session_id);
    
    // Get participant info from memory
    let participant = vapiParticipants.get(session_id);
    
    if (!participant) {
      // If not in memory, try to get from database
      const vapiCallId = `vapi-${session_id}`;
      const { data: vapiSession, error } = await supabase
        .from('call_sessions')
        .select('*')
        .eq('call_id', vapiCallId)
        .maybeSingle();
      
      if (!vapiSession) {
        return res.status(404).json({ 
          error: 'Session not found',
          searched_for: vapiCallId,
          active_participants: Array.from(vapiParticipants.keys())
        });
      }
      
      // Reconstruct participant info from database
      participant = {
        call_control_id: vapiSession.vapi_control_id,
        conference_id: vapiSession.conference_id,
        on_hold: vapiSession.vapi_on_hold
      };
    }
    
    if (!participant.on_hold) {
      return res.status(200).json({ 
        message: 'VAPI is already unheld',
        session_id,
        participant
      });
    }
    
    console.log('🔊 TEST: Attempting to unhold VAPI...');
    console.log('📊 Participant info:', participant);
    
    try {
      // Try conference unhold first
      const unholdResp = await fetch(
        `${TELNYX_API_URL}/conferences/${participant.conference_id}/actions/unhold`,
        { 
          method: 'POST', 
          headers: { 
            'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
            'Content-Type':'application/json' 
          },
          body: JSON.stringify({
            call_control_ids: [participant.call_control_id]
          })
        }
      );
      
      const unholdResult = await unholdResp.text();
      console.log('Conference unhold response:', unholdResp.status, unholdResult);
      
      let success = false;
      let method = 'conference';
      
      if (!unholdResp.ok) {
        // Try alternative method using calls endpoint
        console.log('🔄 Trying alternative unhold method...');
        const altUnholdResp = await fetch(
          `${TELNYX_API_URL}/calls/${participant.call_control_id}/actions/unhold`,
          { 
            method: 'POST', 
            headers: { 
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
              'Content-Type':'application/json' 
            }
          }
        );
        
        const altResult = await altUnholdResp.text();
        console.log('Call unhold response:', altUnholdResp.status, altResult);
        
        if (altUnholdResp.ok) {
          success = true;
          method = 'call';
        }
      } else {
        success = true;
      }
      
      if (success) {
        // Update participant state
        if (vapiParticipants.has(session_id)) {
          vapiParticipants.get(session_id).on_hold = false;
        }
        
        // Update database
        const vapiCallId = `vapi-${session_id}`;
        await supabase
          .from('call_sessions')
          .update({ 
            vapi_on_hold: false,
            vapi_unmuted_at: new Date().toISOString(),
            vapi_unmute_reason: 'manual_test_unhold'
          })
          .eq('call_id', vapiCallId);
        
        return res.status(200).json({ 
          success: true,
          message: 'VAPI successfully unheld',
          method_used: method,
          session_id,
          participant
        });
      } else {
        return res.status(500).json({ 
          success: false,
          error: 'Failed to unhold VAPI',
          conference_response: unholdResult,
          session_id,
          participant
        });
      }
      
    } catch (err) {
      console.error('❌ Test unhold error:', err);
      return res.status(500).json({ 
        error: 'Unhold operation failed',
        details: err.message,
        session_id
      });
    }
  }
  
  // Test endpoint to check hold status
  if (req.method === 'GET' && req.url.includes('/check-hold')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const session_id = url.searchParams.get('session_id');
    
    if (!session_id) {
      // Return all active sessions
      const activeSessions = [];
      
      // Get from memory
      for (const [sid, participant] of vapiParticipants.entries()) {
        activeSessions.push({
          session_id: sid,
          source: 'memory',
          on_hold: participant.on_hold,
          call_control_id: participant.call_control_id,
          conference_id: participant.conference_id,
          joined_at: participant.joined_at
        });
      }
      
      // Get recent from database
      const { data: dbSessions } = await supabase
        .from('call_sessions')
        .select('*')
        .like('call_id', 'vapi-%')
        .gte('created_at', new Date(Date.now() - 300000).toISOString()) // Last 5 minutes
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (dbSessions) {
        dbSessions.forEach(session => {
          const sid = session.conference_session_id;
          if (!activeSessions.find(s => s.session_id === sid)) {
            activeSessions.push({
              session_id: sid,
              source: 'database',
              on_hold: session.vapi_on_hold,
              call_control_id: session.vapi_control_id,
              conference_id: session.conference_id,
              created_at: session.created_at
            });
          }
        });
      }
      
      return res.status(200).json({ 
        active_sessions: activeSessions,
        total_count: activeSessions.length
      });
    }
    
    // Check specific session
    const participant = vapiParticipants.get(session_id);
    const vapiCallId = `vapi-${session_id}`;
    const clinicCallId = `clinic-${session_id}`;
    
    const { data: vapiSession } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('call_id', vapiCallId)
      .maybeSingle();
    
    const { data: clinicSession } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('call_id', clinicCallId)
      .maybeSingle();
    
    return res.status(200).json({
      session_id,
      memory_state: participant || 'not_found',
      vapi_session: vapiSession || 'not_found',
      clinic_session: clinicSession || 'not_found',
      summary: {
        vapi_on_hold: vapiSession?.vapi_on_hold || participant?.on_hold || false,
        ivr_detection: clinicSession?.ivr_detection_state || 'unknown',
        human_joined: clinicSession?.human_joined_conference || false
      }
    });
  }
  
  // ===== TEST ENDPOINTS END =====
  
  // Regular webhook handling
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

        // Use the conference hold endpoint
        console.log('🔇 Holding VAPI using conference endpoint:', callControlId);
        const holdResp = await fetch(
          `${TELNYX_API_URL}/conferences/${conferenceId}/actions/hold`,
          { 
            method: 'POST', 
            headers: { 
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
              'Content-Type':'application/json' 
            },
            body: JSON.stringify({
              call_control_ids: [callControlId]
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

        // Create or update VAPI session - use upsert to avoid duplicates
        const vapiCallId = `vapi-${session_id}`;
        
        try {
          // Use upsert to avoid duplicate key errors
          const { data: upsertedSession, error } = await supabase
            .from('call_sessions')
            .upsert({
              call_id: vapiCallId,
              conference_session_id: session_id,
              vapi_on_hold: holdResp.ok,
              vapi_control_id: callControlId,
              conference_id: conferenceId,
              call_status: 'active',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'call_id'
            })
            .select()
            .single();
            
          console.log('Upsert result:', { upsertedSession, error });
        } catch (err) {
          console.error('❌ Error upserting VAPI session:', err);
        }

        // Start monitoring for unmute conditions
        console.log('🚀 About to start unhold monitor');
        startUnmuteMonitor(session_id, callControlId, conferenceId);

        // Dial clinic/human into conference
        await dialClinicIntoConference({
          session_id,
          connection_id: pl.connection_id,
          vapi_control_id: callControlId,
          conference_id: conferenceId
        }, room, human);
      }
    }

    // When human joins the conference
    if (evt === 'conference.participant.joined' && pl.client_state) {
      try {
        const clientState = JSON.parse(atob(pl.client_state));
        if (clientState.is_conference_leg) {
          console.log('👤 Human/Clinic leg joined conference');
          
          // Update the clinic session
          const clinicCallId = `clinic-${clientState.session_id}`;
          await supabase
            .from('call_sessions')
            .update({ 
              human_joined_conference: true,
              human_joined_at: new Date().toISOString() 
            })
            .eq('call_id', clinicCallId);
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
      // Get VAPI session specifically
      const vapiCallId = `vapi-${sessionId}`;
      const { data: vapiSession, error: vapiError } = await supabase
        .from('call_sessions')
        .select('*')
        .eq('call_id', vapiCallId)
        .maybeSingle();

      if (vapiError) {
        console.error('❌ Error fetching VAPI session:', vapiError);
      }

      if (!vapiSession) {
        console.log('⚠️ No VAPI session found for:', vapiCallId);
        clearInterval(monitor);
        return;
      }

      // Skip if already unholding
      if (!vapiSession.vapi_on_hold) {
        console.log('✅ VAPI already unheld');
        clearInterval(monitor);
        return;
      }

      // Check if we should unmute
      const shouldUnmute = await checkUnmuteConditions(sessionId);
      
      if (shouldUnmute || checkCount >= maxChecks) {
        console.log(`🔊 Unholding VAPI (reason: ${shouldUnmute ? shouldUnmute.reason : 'timeout'})`);
        
        // Get participant info
        const participant = vapiParticipants.get(sessionId);
        if (!participant) {
          console.error('❌ No participant info found');
          clearInterval(monitor);
          return;
        }
        
        // Unhold VAPI using conference endpoint with specific call control ID
        const unholdResp = await fetch(
          `${TELNYX_API_URL}/conferences/${conferenceId}/actions/unhold`,
          { 
            method: 'POST', 
            headers: { 
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
              'Content-Type':'application/json' 
            },
            body: JSON.stringify({
              call_control_ids: [participant.call_control_id]
            })
          }
        );
        
        const unholdResult = await unholdResp.text();
        console.log('Unhold response:', unholdResp.status, unholdResult);

        if (unholdResp.ok) {
          console.log('✅ VAPI successfully removed from hold');
          participant.on_hold = false;
        } else {
          console.error('❌ Failed to unhold VAPI:', unholdResult);
          
          // Try alternative unhold method using calls endpoint
          console.log('🔄 Trying alternative unhold method...');
          const altUnholdResp = await fetch(
            `${TELNYX_API_URL}/calls/${participant.call_control_id}/actions/unhold`,
            { 
              method: 'POST', 
              headers: { 
                'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
                'Content-Type':'application/json' 
              }
            }
          );
          console.log('Alternative unhold response:', altUnholdResp.status);
        }

        // Update database
        await supabase
          .from('call_sessions')
          .update({ 
            vapi_on_hold: false,
            vapi_unmuted_at: new Date().toISOString(),
            vapi_unmute_reason: shouldUnmute ? shouldUnmute.reason : 'timeout'
          })
          .eq('call_id', vapiCallId);

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
async function checkUnmuteConditions(sessionId) {
  // Check the CLINIC leg's IVR detection
  const clinicCallId = `clinic-${sessionId}`;
  const { data: clinicSession } = await supabase
    .from('call_sessions')
    .select('*')
    .eq('call_id', clinicCallId)
    .maybeSingle();
    
  if (!clinicSession) {
    console.log('⚠️ No clinic session found');
    return null;
  }

  // Log clinic session state
  console.log('🏥 Clinic session state:', {
    ivr_detection_state: clinicSession.ivr_detection_state,
    telnyx_leg_id: clinicSession.telnyx_leg_id,
    human_joined: clinicSession.human_joined_conference
  });
  
  // Check if clinic leg detected human
  if (['human', 'ivr_then_human'].includes(clinicSession.ivr_detection_state)) {
    console.log('✅ Human detected on clinic leg!', clinicSession.ivr_detection_state);
    return { reason: `human_detected_clinic_leg_${clinicSession.ivr_detection_state}` };
  }
  
  // Alternative: Check if human joined conference (as a backup)
  if (clinicSession.human_joined_conference) {
    console.log('✅ Human joined conference!');
    return { reason: 'human_joined_conference' };
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

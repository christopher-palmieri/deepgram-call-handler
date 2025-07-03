// api/telnyx/conference-webhook-bridge.js
// Single session approach - no duplicate rows

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
  
  // NO NEED TO CREATE A NEW SESSION - Just update the existing one
  console.log('✅ Clinic dial initiated - using existing session');
}

export default async function handler(req, res) {
  const FROM_NUMBER = process.env.TELNYX_PHONE_NUMBER || '+16092370151';
  
  // Test endpoint to check hold status
  if (req.method === 'GET' && req.url.includes('check-hold')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const session_id = url.searchParams.get('session_id');
    
    if (!session_id) {
      // Return all recent sessions
      const { data: recentSessions } = await supabase
        .from('call_sessions')
        .select('*')
        .gte('created_at', new Date(Date.now() - 300000).toISOString()) // Last 5 minutes
        .order('created_at', { ascending: false })
        .limit(10);
      
      const activeSessions = [];
      for (const [sid, participant] of vapiParticipants.entries()) {
        activeSessions.push({
          session_id: sid,
          source: 'memory',
          on_hold: participant.on_hold,
          call_control_id: participant.call_control_id,
          conference_id: participant.conference_id
        });
      }
      
      return res.status(200).json({ 
        active_sessions_memory: activeSessions,
        recent_sessions_db: recentSessions,
        total_count: recentSessions?.length || 0
      });
    }
    
    // Check specific session
    const participant = vapiParticipants.get(session_id);
    const { data: session } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('conference_session_id', session_id)
      .maybeSingle();
    
    return res.status(200).json({
      session_id,
      memory_state: participant || 'not_found',
      database_session: session || 'not_found',
      summary: {
        vapi_on_hold: session?.vapi_on_hold || participant?.on_hold || false,
        ivr_detection: session?.ivr_detection_state || 'unknown',
        human_joined: session?.human_joined_conference || false
      }
    });
  }
  
  // Test endpoint for manual unhold
  if (req.method === 'GET' && req.url.includes('test-unhold')) {
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
      const { data: session } = await supabase
        .from('call_sessions')
        .select('*')
        .eq('conference_session_id', session_id)
        .maybeSingle();
      
      if (!session) {
        return res.status(404).json({ 
          error: 'Session not found',
          searched_for: session_id,
          active_participants: Array.from(vapiParticipants.keys())
        });
      }
      
      // Reconstruct participant info from database
      participant = {
        call_control_id: session.vapi_control_id,
        conference_id: session.conference_id,
        on_hold: session.vapi_on_hold
      };
    }
    
    if (!participant.on_hold) {
      return res.status(200).json({ 
        message: 'VAPI is already unheld',
        session_id,
        participant
      });
    }
    
    try {
      // Try conference unhold
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
      
      if (unholdResp.ok) {
        // Update participant state
        if (vapiParticipants.has(session_id)) {
          vapiParticipants.get(session_id).on_hold = false;
        }
        
        // Update database
        await supabase
          .from('call_sessions')
          .update({ 
            vapi_on_hold: false,
            vapi_unmuted_at: new Date().toISOString(),
            vapi_unmute_reason: 'manual_test_unhold'
          })
          .eq('conference_session_id', session_id);
        
        return res.status(200).json({ 
          success: true,
          message: 'VAPI successfully unheld',
          session_id,
          participant
        });
      } else {
        return res.status(500).json({ 
          success: false,
          error: 'Failed to unhold VAPI',
          response: unholdResult,
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
    
    console.log('🎯 Conference webhook hit:', evt);
    console.log('📋 Payload key fields:', {
      participant_id: pl.participant_id,
      conference_id: pl.conference_id,
      call_control_id: pl.call_control_id,
      client_state: pl.client_state ? 'present' : 'missing'
    });

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
        console.log('🤖 VAPI joined conference:', room);

        // Store VAPI participant info
        vapiParticipants.set(session_id, {
          call_control_id: pl.call_control_id,
          participant_id: pl.participant_id,
          conference_id: pl.conference_id,
          on_hold: false,
          joined_at: new Date().toISOString()
        });

        // Create or update THE SINGLE session
        const { data: existingSession } = await supabase
          .from('call_sessions')
          .select('*')
          .eq('conference_session_id', session_id)
          .maybeSingle();
          
        if (!existingSession) {
          // Create the session
          const { data: newSession, error } = await supabase
            .from('call_sessions')
            .insert([{
              call_id: `conf-${session_id}`, // Single ID for the conference
              conference_session_id: session_id,
              conference_created: true,
              vapi_control_id: pl.call_control_id,
              vapi_participant_id: pl.participant_id,
              conference_id: pl.conference_id,
              vapi_on_hold: false, // Will be updated after hold
              target_number: human,
              call_status: 'active',
              bridge_mode: true,
              created_at: new Date().toISOString()
            }])
            .select()
            .single();
            
          if (error) {
            console.error('❌ Error creating session:', error);
          } else {
            console.log('✅ Created single conference session:', newSession.call_id);
          }
        } else {
          // Update existing session
          await supabase
            .from('call_sessions')
            .update({
              vapi_control_id: pl.call_control_id,
              vapi_participant_id: pl.participant_id,
              conference_id: pl.conference_id
            })
            .eq('conference_session_id', session_id);
          console.log('✅ Updated existing session');
        }

        // Hold VAPI using conference endpoint
        console.log('🔇 Holding VAPI using conference endpoint');
        const holdResp = await fetch(
          `${TELNYX_API_URL}/conferences/${pl.conference_id}/actions/hold`,
          { 
            method: 'POST', 
            headers: { 
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
              'Content-Type':'application/json' 
            },
            body: JSON.stringify({
              call_control_ids: [pl.call_control_id]
            })
          }
        );
        const holdResult = await holdResp.text();
        console.log('Hold response:', holdResp.status, holdResult);
        
        if (holdResp.ok) {
          vapiParticipants.get(session_id).on_hold = true;
          console.log('✅ VAPI successfully placed on hold');
          
          // Update hold status in database
          await supabase
            .from('call_sessions')
            .update({ vapi_on_hold: true })
            .eq('conference_session_id', session_id);
        } else {
          console.error('❌ Failed to hold VAPI:', holdResult);
        }

        // Start monitoring for unmute conditions
        startUnmuteMonitor(session_id, pl.call_control_id, pl.conference_id);

        // Dial clinic/human into conference
        await dialClinicIntoConference({
          session_id,
          connection_id: pl.connection_id,
          vapi_control_id: pl.call_control_id,
          conference_id: pl.conference_id
        }, room, human);
      }
    }

    // When human joins the conference (clinic leg)
    if (evt === 'conference.participant.joined' && pl.client_state) {
      try {
        const clientState = JSON.parse(atob(pl.client_state));
        if (clientState.is_conference_leg) {
          console.log('👤 Human/Clinic leg joined conference');
          
          // Update THE SINGLE session
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
  let checkCount = 0;
  const maxChecks = 240; // 60 seconds at 250ms intervals

  const monitor = setInterval(async () => {
    checkCount++;
    
    try {
      // Get current session state from database
      const { data: session, error } = await supabase
        .from('call_sessions')
        .select('*')
        .eq('conference_session_id', sessionId)
        .maybeSingle();

      if (error) {
        console.error('❌ Error fetching session:', error);
        return;
      }

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
        
        // Unhold VAPI using conference endpoint
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
async function checkUnmuteConditions(session) {
  // 1. Human detected via IVR classification
  if (['human', 'ivr_then_human'].includes(session.ivr_detection_state)) {
    console.log('✅ Human detected via IVR classification:', session.ivr_detection_state);
    return { reason: `ivr_detected_${session.ivr_detection_state}` };
  }

  // 2. Human joined conference (fallback)
  if (session.human_joined_conference) {
    const timeSinceJoin = Date.now() - new Date(session.human_joined_at).getTime();
    if (timeSinceJoin > 2000) { // 2 seconds after human joined
      console.log('✅ Human joined conference');
      return { reason: 'human_joined_conference' };
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

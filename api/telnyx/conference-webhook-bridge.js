// api/telnyx/conference-webhook-bridge.js
// Enhanced conference webhook with real-time VAPI unhold based on IVR classification

import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: true } };

const TELNYX_API_URL = 'https://api.telnyx.com/v2';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Track VAPI participants waiting to be unholded
const vapiParticipantsWaiting = new Map();
let classificationSubscription = null;

// Initialize real-time listener for classification changes
function initializeClassificationListener() {
  console.log('🎧 Initializing real-time classification listener');
  
  // Clean up existing subscription if any
  if (classificationSubscription) {
    supabase.removeChannel(classificationSubscription);
    classificationSubscription = null;
  }
  
  classificationSubscription = supabase
    .channel('ivr_classification_changes')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'call_sessions'
      },
      async (payload) => {
        const { new: updatedSession, old: previousSession } = payload;
        
        // Log updates for debugging
        console.log('📡 Database update detected:', {
          conference_session_id: updatedSession.conference_session_id,
          old_ivr_state: previousSession.ivr_detection_state,
          new_ivr_state: updatedSession.ivr_detection_state,
          vapi_on_hold: updatedSession.vapi_on_hold
        });
        
        // Check if classification changed to human
        if (updatedSession.conference_session_id &&
            updatedSession.ivr_detection_state === 'human' && 
            previousSession.ivr_detection_state !== 'human' &&
            updatedSession.vapi_on_hold === true) {
          
          console.log('🎉 Human classification detected for session:', updatedSession.conference_session_id);
          
          // Check if we have VAPI info in our waiting map
          const vapiInfo = vapiParticipantsWaiting.get(updatedSession.conference_session_id);
          
          if (vapiInfo) {
            console.log('🔊 Found VAPI to unhold:', {
              session_id: updatedSession.conference_session_id,
              conference_id: vapiInfo.conference_id,
              call_control_id: vapiInfo.call_control_id
            });
            
            try {
              // Unhold the VAPI participant using correct endpoint
              const unholdResp = await fetch(
                `${TELNYX_API_URL}/conferences/${vapiInfo.conference_id}/actions/unhold`,
                { 
                  method: 'POST', 
                  headers: { 
                    'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
                    'Content-Type': 'application/json' 
                  },
                  body: JSON.stringify({
                    call_control_ids: [vapiInfo.call_control_id]
                  })
                }
              );
              
              const responseText = await unholdResp.text();
              console.log('Unhold response:', unholdResp.status, responseText);
              
              if (unholdResp.ok) {
                console.log('✅ VAPI unhold successful via real-time');
                
                // Update database to reflect unhold
                await supabase
                  .from('call_sessions')
                  .update({ 
                    vapi_on_hold: false,
                    vapi_unmuted_at: new Date().toISOString(),
                    vapi_unmute_reason: 'human_detected_realtime'
                  })
                  .eq('conference_session_id', updatedSession.conference_session_id);
                
                // Remove from waiting map
                vapiParticipantsWaiting.delete(updatedSession.conference_session_id);
                console.log('✅ Removed session from waiting map');
              } else {
                console.error('❌ Unhold failed:', unholdResp.status, responseText);
              }
            } catch (error) {
              console.error('❌ Error during unhold process:', error);
            }
          } else {
            console.log('⚠️ No VAPI info found in waiting map for session:', updatedSession.conference_session_id);
            console.log('Current waiting map keys:', Array.from(vapiParticipantsWaiting.keys()));
          }
        }
      }
    )
    .subscribe((status) => {
      console.log('📡 Classification listener subscription status:', status);
      if (status === 'SUBSCRIBED') {
        console.log('✅ Successfully subscribed to classification changes');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('❌ Subscription error, will retry...');
        setTimeout(initializeClassificationListener, 5000);
      }
    });
}

// Initialize the listener when this module loads
initializeClassificationListener();

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
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Return diagnostic info
    const diagnostics = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      vapiWaitingCount: vapiParticipantsWaiting.size,
      vapiWaitingKeys: Array.from(vapiParticipantsWaiting.keys()),
      subscriptionActive: !!classificationSubscription
    };
    return res.status(200).json(diagnostics);
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

        // Store VAPI participant info for real-time unhold
        vapiParticipantsWaiting.set(session_id, {
          conference_id: pl.conference_id,
          participant_id: pl.participant_id,
          call_control_id: pl.call_control_id,
          joined_at: new Date().toISOString()
        });
        console.log('📝 Added VAPI to waiting map with session_id:', session_id);

        // Use the conference hold endpoint (corrected)
        console.log('🔇 Holding VAPI participant');
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
          console.log('✅ VAPI successfully placed on hold');
        } else {
          console.error('❌ Failed to hold VAPI');
        }

        // Create the single row for this conference session
        const { data: newSession, error } = await supabase
          .from('call_sessions')
          .insert([{
            call_id: `vapi-${session_id}`, // Required field - using vapi prefix
            conference_session_id: session_id,
            conference_id: pl.conference_id,
            vapi_control_id: pl.call_control_id,
            vapi_participant_id: pl.participant_id,
            vapi_on_hold: holdResp.ok,
            conference_created: true,
            call_status: 'active',
            created_at: new Date().toISOString()
          }])
          .select()
          .single();
        
        if (error) {
          console.error('❌ Error creating session:', error);
        } else {
          console.log('✅ Created conference session:', newSession?.conference_session_id);
        }

        // Dial clinic/human into conference
        await dialClinicIntoConference({
          session_id,
          connection_id: pl.connection_id,
          vapi_control_id: pl.call_control_id
        }, room, human);
      }
    }

    // When clinic/human joins the conference
    if (evt === 'conference.participant.joined' && pl.call_control_id !== pl.creator_call_control_id) {
      console.log('👤 Another participant joined conference (likely clinic)');
      
      // Try to find session by parsing client_state
      if (pl.client_state) {
        try {
          const { session_id, is_conference_leg } = JSON.parse(atob(pl.client_state));
          
          if (is_conference_leg && session_id) {
            // Update database to track clinic joined
            await supabase
              .from('call_sessions')
              .update({ 
                clinic_joined_conference: true,
                clinic_joined_at: new Date().toISOString()
              })
              .eq('conference_session_id', session_id);
            
            console.log('✅ Clinic joined conference for session:', session_id);
          }
        } catch (e) {
          console.error('Failed to parse client_state:', e);
        }
      }
    }

    // Clean up when conference ends
    if (evt === 'conference.ended') {
      console.log('🏁 Conference ended:', pl.conference_id);
      
      // Remove any VAPI participants from this conference
      for (const [sessionId, info] of vapiParticipantsWaiting.entries()) {
        if (info.conference_id === pl.conference_id) {
          console.log('🧹 Removing ended conference participant:', sessionId);
          vapiParticipantsWaiting.delete(sessionId);
        }
      }
    }

    // When any participant leaves
    if (evt === 'conference.participant.left') {
      console.log('👋 Participant left conference:', pl.call_control_id);
      
      // Check if this was a VAPI participant
      for (const [sessionId, info] of vapiParticipantsWaiting.entries()) {
        if (info.call_control_id === pl.call_control_id) {
          console.log('🧹 VAPI left conference, removing from waiting map:', sessionId);
          vapiParticipantsWaiting.delete(sessionId);
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(200).json({ received: true, error: err.message });
  }
}

// Clean up stale entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, info] of vapiParticipantsWaiting.entries()) {
    const age = now - new Date(info.joined_at).getTime();
    if (age > 300000) { // 5 minutes
      console.log('🧹 Removing stale VAPI from waiting map:', sessionId);
      vapiParticipantsWaiting.delete(sessionId);
    }
  }
}, 60000); // Every minute

// Clean up on server shutdown
process.on('SIGTERM', () => {
  console.log('📛 SIGTERM received, cleaning up...');
  if (classificationSubscription) {
    supabase.removeChannel(classificationSubscription);
  }
  vapiParticipantsWaiting.clear();
});

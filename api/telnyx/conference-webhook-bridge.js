// api/telnyx/conference-webhook-bridge.js
// Enhanced conference webhook with real-time VAPI unhold based on IVR classification

import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: true } };

const TELNYX_API_URL = 'https://api.telnyx.com/v2';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Map to track active VAPI participants waiting to be unholded
const vapiParticipantsWaiting = new Map();
let classificationSubscription = null;
let subscriptionRetryCount = 0;

// Initialize real-time listener for classification changes
function initializeClassificationListener() {
  console.log('🎧 Initializing real-time classification listener');
  
  // Clean up existing subscription if any
  if (classificationSubscription) {
    supabase.removeChannel(classificationSubscription);
  }
  
  classificationSubscription = supabase
    .channel('ivr_classification_changes')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'call_sessions'
        // Removed filter to catch ALL updates for debugging
      },
      async (payload) => {
        const { new: updatedSession, old: previousSession } = payload;
        
        // Debug log ALL updates
        console.log('📡 Database update detected:', {
          conference_session_id: updatedSession.conference_session_id,
          old_ivr_state: previousSession.ivr_detection_state,
          new_ivr_state: updatedSession.ivr_detection_state,
          vapi_on_hold: updatedSession.vapi_on_hold,
          call_id: updatedSession.call_id
        });
        
        // Skip if no conference_session_id
        if (!updatedSession.conference_session_id) {
          return;
        }
        
        // Check if classification changed to human
        if (updatedSession.ivr_detection_state === 'human' && 
            previousSession.ivr_detection_state !== 'human') {
          
          console.log('🎉 Human classification detected for session:', updatedSession.conference_session_id);
          
          // Check if we have a waiting VAPI for this session
          const vapiInfo = vapiParticipantsWaiting.get(updatedSession.conference_session_id);
          
          if (vapiInfo && updatedSession.vapi_on_hold) {
            console.log('🔊 Unholding VAPI for session:', updatedSession.conference_session_id);
            
            try {
              // Unhold the VAPI participant
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
                
                // Update database
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
          } else if (!vapiInfo) {
            console.log('⚠️ No VAPI info found for session:', updatedSession.conference_session_id);
          } else if (!updatedSession.vapi_on_hold) {
            console.log('ℹ️ VAPI already off hold for session:', updatedSession.conference_session_id);
          }
        }
        
        // Also handle ivr_then_human if you want immediate unhold
        if (updatedSession.ivr_detection_state === 'ivr_then_human' && 
            previousSession.ivr_detection_state !== 'ivr_then_human' &&
            updatedSession.vapi_on_hold) {
          console.log('📞 IVR-then-human detected, considering unhold...');
          // You could add logic here if you want to unhold on ivr_then_human
        }
      }
    )
    .subscribe((status) => {
      console.log('📡 Classification listener subscription status:', status);
      if (status === 'SUBSCRIBED') {
        subscriptionRetryCount = 0;
        console.log('✅ Successfully subscribed to classification changes');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('❌ Subscription error, will retry...');
        handleSubscriptionError();
      }
    });
}

// Handle subscription errors with exponential backoff
function handleSubscriptionError() {
  subscriptionRetryCount++;
  const retryDelay = Math.min(1000 * Math.pow(2, subscriptionRetryCount), 30000);
  console.log(`⏳ Retrying subscription in ${retryDelay}ms (attempt ${subscriptionRetryCount})`);
  setTimeout(initializeClassificationListener, retryDelay);
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

        // Store VAPI participant info for real-time unhold
        vapiParticipantsWaiting.set(session_id, {
          conference_id: pl.conference_id,  // Fixed: use snake_case to match
          participant_id: pl.participant_id,
          call_control_id: pl.call_control_id,
          joined_at: new Date().toISOString()
        });
        console.log('📝 Added VAPI to waiting map:', session_id);

        // Use the conference hold endpoint
        console.log('🔇 Holding VAPI participant:', pl.participant_id);
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

        // Dial clinic/human into conference
        await dialClinicIntoConference({
          session_id,
          connection_id: pl.connection_id,
          vapi_control_id: pl.call_control_id
        }, room, human);
      }
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

// Safety net: Periodic check for missed real-time events
setInterval(async () => {
  if (vapiParticipantsWaiting.size === 0) return;
  
  console.log('🔍 Running safety net check for', vapiParticipantsWaiting.size, 'waiting VAPI participants');
  
  for (const [sessionId, vapiInfo] of vapiParticipantsWaiting.entries()) {
    try {
      // Check if this session should be unholded
      const { data: session } = await supabase
        .from('call_sessions')
        .select('ivr_detection_state, vapi_on_hold')
        .eq('conference_session_id', sessionId)
        .single();
      
      if (session?.ivr_detection_state === 'human' && session.vapi_on_hold) {
        console.log('🔧 Safety net: Found VAPI that should be unholded:', sessionId);
        
        // Trigger unhold
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
        
        if (unholdResp.ok) {
          console.log('✅ Safety net: Successfully unholded VAPI');
          
          await supabase
            .from('call_sessions')
            .update({ 
              vapi_on_hold: false,
              vapi_unmuted_at: new Date().toISOString(),
              vapi_unmute_reason: 'human_detected_safety_net'
            })
            .eq('conference_session_id', sessionId);
          
          vapiParticipantsWaiting.delete(sessionId);
        }
      }
      
      // Clean up old entries (over 5 minutes)
      const age = Date.now() - new Date(vapiInfo.joined_at).getTime();
      if (age > 300000) {
        console.log('🧹 Removing stale entry from waiting map:', sessionId);
        vapiParticipantsWaiting.delete(sessionId);
      }
    } catch (error) {
      console.error('❌ Safety net error for session', sessionId, ':', error);
    }
  }
}, 30000); // Run every 30 seconds

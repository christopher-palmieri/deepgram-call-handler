// api/telnyx/conference-webhook-bridge.js
// DEBUG VERSION - Enhanced logging to diagnose real-time issues

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

// Add a debug polling function to see what's in the database
async function debugCheckDatabase() {
  console.log('🔍 DEBUG: Checking database directly...');
  
  try {
    // Get all sessions with conference_session_id
    const { data: sessions, error } = await supabase
      .from('call_sessions')
      .select('conference_session_id, ivr_detection_state, vapi_on_hold, vapi_control_id, updated_at')
      .not('conference_session_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(5);
    
    if (error) {
      console.error('❌ DEBUG: Database query error:', error);
      return;
    }
    
    console.log('📊 DEBUG: Recent sessions in database:');
    sessions?.forEach(session => {
      console.log({
        session_id: session.conference_session_id,
        ivr_state: session.ivr_detection_state,
        vapi_on_hold: session.vapi_on_hold,
        has_vapi_control: !!session.vapi_control_id,
        updated: session.updated_at
      });
    });
    
    // Check waiting map
    console.log('📦 DEBUG: VAPI waiting map contains:', vapiParticipantsWaiting.size, 'entries');
    vapiParticipantsWaiting.forEach((info, sessionId) => {
      console.log(`  - ${sessionId}: conference=${info.conference_id}, control=${info.call_control_id}`);
    });
    
  } catch (err) {
    console.error('❌ DEBUG: Error checking database:', err);
  }
}

// Run debug check every 10 seconds
setInterval(debugCheckDatabase, 10000);

// Initialize real-time listener for classification changes
function initializeClassificationListener() {
  console.log('🎧 Initializing real-time classification listener');
  
  // Clean up existing subscription if any
  if (classificationSubscription) {
    supabase.removeChannel(classificationSubscription);
  }
  
  // Try a more basic subscription first
  classificationSubscription = supabase
    .channel('any-db-change')
    .on(
      'postgres_changes',
      {
        event: '*', // Listen to ALL events
        schema: 'public',
        table: 'call_sessions'
      },
      (payload) => {
        console.log('🔔 DEBUG: Database event received:', {
          event: payload.eventType,
          table: payload.table,
          schema: payload.schema,
          has_new: !!payload.new,
          has_old: !!payload.old
        });
        
        if (payload.eventType === 'UPDATE') {
          const { new: updatedSession, old: previousSession } = payload;
          
          // Log EVERY update in detail
          console.log('📡 DEBUG: UPDATE detected:', {
            conference_session_id: updatedSession?.conference_session_id,
            old_ivr: previousSession?.ivr_detection_state,
            new_ivr: updatedSession?.ivr_detection_state,
            old_hold: previousSession?.vapi_on_hold,
            new_hold: updatedSession?.vapi_on_hold,
            has_vapi_control: !!updatedSession?.vapi_control_id
          });
          
          // Original logic for unholding
          if (updatedSession?.conference_session_id &&
              updatedSession?.ivr_detection_state === 'human' && 
              previousSession?.ivr_detection_state !== 'human' &&
              updatedSession?.vapi_on_hold === true) {
            
            console.log('🎉 Human classification detected for session:', updatedSession.conference_session_id);
            
            const vapiInfo = vapiParticipantsWaiting.get(updatedSession.conference_session_id);
            
            if (vapiInfo) {
              console.log('🔊 Found VAPI in waiting map, attempting unhold...');
              
              // Attempt unhold
              fetch(
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
              ).then(async (unholdResp) => {
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
                  
                  vapiParticipantsWaiting.delete(updatedSession.conference_session_id);
                }
              }).catch(error => {
                console.error('❌ Error during unhold:', error);
              });
            } else {
              console.log('⚠️ No VAPI in waiting map for:', updatedSession.conference_session_id);
            }
          }
        }
      }
    )
    .subscribe((status, err) => {
      console.log('📡 Subscription status:', status);
      if (err) console.error('📡 Subscription error:', err);
      
      if (status === 'SUBSCRIBED') {
        console.log('✅ Successfully subscribed to database changes');
        
        // Test the subscription with a manual database update
        console.log('🧪 Testing subscription with a dummy update...');
        supabase
          .from('call_sessions')
          .update({ test_field: new Date().toISOString() })
          .eq('id', 'non-existent-id')
          .then(() => console.log('🧪 Test update sent'));
      }
    });
}

// Initialize the listener when this module loads
initializeClassificationListener();

// Rest of your existing code remains the same...
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
  
  await supabase
    .from('call_sessions')
    .update({
      target_number: human,
      clinic_dial_initiated: true,
      clinic_dial_initiated_at: new Date().toISOString()
    })
    .eq('conference_session_id', sessionData.session_id);
  
  console.log('✅ Updated session with clinic dial info');
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).send('Conference webhook endpoint is live');
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
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
      
      let isVAPI = false;
      let sessionData = null;
      
      if (pl.client_state) {
        try {
          sessionData = JSON.parse(atob(pl.client_state));
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
        vapiParticipantsWaiting.set(session_id, {
          conference_id: pl.conference_id,
          participant_id: pl.participant_id,
          call_control_id: pl.call_control_id,
          joined_at: new Date().toISOString()
        });
        console.log('📝 Added VAPI to waiting map with session_id:', session_id);

        // Hold VAPI
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

        // Create or update session
        const { data: existingSession } = await supabase
          .from('call_sessions')
          .select('*')
          .eq('conference_session_id', session_id)
          .maybeSingle();
        
        if (!existingSession) {
          const { data: newSession, error } = await supabase
            .from('call_sessions')
            .insert([{
              conference_session_id: session_id,
              conference_id: pl.conference_id,
              vapi_control_id: pl.call_control_id,
              vapi_participant_id: pl.participant_id,
              vapi_on_hold: holdResp.ok,
              conference_created: true,
              call_status: 'active',
              bridge_mode: true,
              created_at: new Date().toISOString()
            }])
            .select()
            .single();
          
          console.log('✅ Created new call session:', newSession?.id);
          if (error) console.error('❌ Error creating session:', error);
        } else {
          await supabase
            .from('call_sessions')
            .update({ 
              vapi_on_hold: holdResp.ok,
              vapi_control_id: pl.call_control_id,
              vapi_participant_id: pl.participant_id,
              conference_id: pl.conference_id
            })
            .eq('conference_session_id', session_id);
          console.log('✅ Updated existing call session');
        }

        // Dial clinic
        await dialClinicIntoConference({
          session_id,
          connection_id: pl.connection_id,
          vapi_control_id: pl.call_control_id
        }, room, human);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(200).json({ received: true, error: err.message });
  }
}

// Aggressive safety net - check every 5 seconds
setInterval(async () => {
  if (vapiParticipantsWaiting.size === 0) return;
  
  console.log('🔍 Safety net check...');
  
  for (const [sessionId, vapiInfo] of vapiParticipantsWaiting.entries()) {
    try {
      const { data: session } = await supabase
        .from('call_sessions')
        .select('ivr_detection_state, vapi_on_hold')
        .eq('conference_session_id', sessionId)
        .single();
      
      if (session?.ivr_detection_state === 'human' && session.vapi_on_hold === true) {
        console.log('🔧 Safety net: Found VAPI that should be unholded:', sessionId);
        
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
        console.log('Safety net unhold response:', unholdResp.status, responseText);
        
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
    } catch (error) {
      console.error('❌ Safety net error:', error);
    }
  }
}, 5000); // Check every 5 seconds

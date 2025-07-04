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

// Clean up any stale entries on startup
console.log('🧹 Clearing any stale VAPI participants from previous runs');

// Diagnostic function to test real-time is working
async function testRealtimeConnection() {
  console.log('🧪 Testing real-time connection...');
  
  // Create a test subscription
  const testChannel = supabase
    .channel('test-channel')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'call_sessions'
      },
      (payload) => {
        console.log('🎉 TEST: Received real-time event!', {
          eventType: payload.eventType,
          table: payload.table,
          hasData: !!payload.new || !!payload.old
        });
      }
    )
    .subscribe(async (status, error) => {
      console.log('🧪 Test subscription status:', status);
      if (error) console.error('🧪 Test subscription error:', error);
      
      if (status === 'SUBSCRIBED') {
        // Make a test update to trigger an event
        console.log('🧪 Making test update...');
        const { error: updateError } = await supabase
          .from('call_sessions')
          .update({ 
            test_timestamp: new Date().toISOString() 
          })
          .eq('id', '00000000-0000-0000-0000-000000000000'); // Non-existent ID
          
        if (updateError) {
          console.log('🧪 Test update completed (expected to affect 0 rows)');
        }
        
        // Clean up test channel after 5 seconds
        setTimeout(() => {
          supabase.removeChannel(testChannel);
          console.log('🧪 Test channel cleaned up');
        }, 5000);
      }
    });
}

// Run the test when the module loads
testRealtimeConnection();

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
        
        // Log ALL updates to understand what's happening
        console.log('📡 Database update detected:', {
          call_id: updatedSession.call_id,
          conference_session_id: updatedSession.conference_session_id,
          old_ivr_state: previousSession.ivr_detection_state,
          new_ivr_state: updatedSession.ivr_detection_state,
          vapi_on_hold: updatedSession.vapi_on_hold,
          vapi_control_id: updatedSession.vapi_control_id,
          telnyx_leg_id: updatedSession.telnyx_leg_id
        });
        
        // Check if this is a clinic leg getting classified as human
        if (updatedSession.call_id && 
            updatedSession.call_id.startsWith('clinic-') &&
            updatedSession.ivr_detection_state === 'human' && 
            previousSession.ivr_detection_state !== 'human') {
          
          // Extract session ID from clinic call ID
          const sessionId = updatedSession.call_id.replace('clinic-', '');
          console.log('🎉 Human detected on clinic leg for session:', sessionId);
          
          // Look up VAPI info from our waiting map
          const vapiInfo = vapiParticipantsWaiting.get(sessionId);
          
          if (vapiInfo) {
            console.log('🔊 Found VAPI to unhold:', vapiInfo);
            
            // Check if vapi_on_hold is false (already unholded somehow)
            if (updatedSession.vapi_on_hold === false) {
              console.log('⚠️ VAPI appears to already be off hold in database');
              
              // Still try to unhold in case database is out of sync
              console.log('🔄 Attempting unhold anyway in case database is out of sync');
            }
            
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
              
              if (unholdResp.ok || unholdResp.status === 404) {
                console.log('✅ VAPI unhold completed (or already unholded)');
                
                // Update the ORIGINAL session row (with conference_session_id)
                await supabase
                  .from('call_sessions')
                  .update({ 
                    vapi_on_hold: false,
                    vapi_unmuted_at: new Date().toISOString(),
                    vapi_unmute_reason: 'human_detected_clinic_leg'
                  })
                  .eq('conference_session_id', sessionId);
                
                vapiParticipantsWaiting.delete(sessionId);
              } else {
                console.error('❌ Unhold failed:', unholdResp.status, responseText);
              }
            } catch (error) {
              console.error('❌ Error during unhold:', error);
            }
          } else {
            console.log('⚠️ No VAPI info in waiting map for session:', sessionId);
            console.log('Current waiting map keys:', Array.from(vapiParticipantsWaiting.keys()));
            
            // Even if not in waiting map, try to unhold if we have the info in the database
            if (updatedSession.vapi_control_id && updatedSession.conference_id) {
              console.log('🔄 Attempting unhold using database info');
              console.log('   Conference ID:', updatedSession.conference_id);
              console.log('   VAPI Control ID:', updatedSession.vapi_control_id);
              
              try {
                const unholdResp = await fetch(
                  `${TELNYX_API_URL}/conferences/${updatedSession.conference_id}/actions/unhold`,
                  { 
                    method: 'POST', 
                    headers: { 
                      'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 
                      'Content-Type': 'application/json' 
                    },
                    body: JSON.stringify({
                      call_control_ids: [updatedSession.vapi_control_id]
                    })
                  }
                );
                
                const responseText = await unholdResp.text();
                console.log('Database-based unhold response:', unholdResp.status, responseText);
                
                if (unholdResp.ok || unholdResp.status === 404) {
                  console.log('✅ Successfully unholded using database info');
                  
                  await supabase
                    .from('call_sessions')
                    .update({ 
                      vapi_on_hold: false,
                      vapi_unmuted_at: new Date().toISOString(),
                      vapi_unmute_reason: 'human_detected_database_info'
                    })
                    .eq('conference_session_id', sessionId);
                }
              } catch (error) {
                console.error('❌ Error during database-based unhold:', error);
              }
            }
          }
        }
        
        // ALSO check if classification changed to human on the main session row
        if (updatedSession.conference_session_id &&
            updatedSession.ivr_detection_state === 'human' && 
            previousSession.ivr_detection_state !== 'human') {
          
          console.log('🎉 Human classification detected for main session:', updatedSession.conference_session_id);
          
          // Check if we have VAPI info in our waiting map
          const vapiInfo = vapiParticipantsWaiting.get(updatedSession.conference_session_id);
          
          if (vapiInfo) {
            console.log('🔊 Found VAPI in waiting map, unholding:', {
              session_id: updatedSession.conference_session_id,
              conference_id: vapiInfo.conference_id,
              call_control_id: vapiInfo.call_control_id
            });
            
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
              
              if (unholdResp.ok || unholdResp.status === 404) {
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
        subscriptionRetryCount = 0;
        console.log('✅ Successfully subscribed to classification changes');
        console.log('📊 Active channels:', supabase.getChannels().map(ch => ch.topic));
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
  
  // Update the existing session with clinic dial info
  // Note: There's only ONE row per conference session
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
  const FROM_NUMBER = process.env.TELNYX_PHONE_NUMBER || '+16092370151';
  
  if (req.method === 'GET') {
    // Return diagnostic info
    const diagnostics = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      vapiWaitingCount: vapiParticipantsWaiting.size,
      vapiWaitingKeys: Array.from(vapiParticipantsWaiting.keys()),
      vapiWaitingDetails: Array.from(vapiParticipantsWaiting.entries()).map(([key, value]) => ({
        sessionId: key,
        conferenceId: value.conference_id,
        callControlId: value.call_control_id,
        joinedAt: value.joined_at
      })),
      subscriptionActive: !!classificationSubscription,
      activeChannels: supabase.getChannels().map(ch => ({
        topic: ch.topic,
        state: ch.state
      }))
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
        console.log('📊 Current waiting map size:', vapiParticipantsWaiting.size);

        // Use the conference hold endpoint
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

        // Create or update the session record
        const { data: existingSession } = await supabase
          .from('call_sessions')
          .select('*')
          .eq('conference_session_id', session_id)
          .maybeSingle();
        
        if (!existingSession) {
          // Create new session
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
          
          if (error) {
            console.error('❌ Error creating session:', error);
          } else {
            console.log('✅ Created new call session:', newSession?.id);
          }
        } else {
          // Update existing session
          const { data: updateResult } = await supabase
            .from('call_sessions')
            .update({ 
              vapi_on_hold: holdResp.ok,
              vapi_control_id: pl.call_control_id,
              vapi_participant_id: pl.participant_id,
              conference_id: pl.conference_id
            })
            .eq('conference_session_id', session_id)
            .select();
          console.log('✅ Updated existing call session:', updateResult?.[0]?.id);
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
                clinic_joined_at: new Date().toISOString(),
                clinic_control_id: pl.call_control_id,
                clinic_leg_id: pl.call_leg_id
              })
              .eq('conference_session_id', session_id);
            
            console.log('✅ Clinic joined conference for session:', session_id);
          }
        } catch (e) {
          console.error('Failed to parse client_state:', e);
        }
      }
    }

    // Clean up completed conferences
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

// Safety net: Periodic check for missed real-time events
setInterval(async () => {
  if (vapiParticipantsWaiting.size === 0) return;
  
  console.log('🔍 Running safety net check for', vapiParticipantsWaiting.size, 'waiting VAPI participants');
  
  for (const [sessionId, vapiInfo] of vapiParticipantsWaiting.entries()) {
    try {
      // Check the session for human detection (check both main session and clinic leg)
      const { data: sessions } = await supabase
        .from('call_sessions')
        .select('ivr_detection_state, vapi_on_hold, call_id, conference_id, vapi_control_id')
        .or(`conference_session_id.eq.${sessionId},call_id.eq.clinic-${sessionId}`);
      
      // Check if any of the related sessions show human detected
      const humanDetected = sessions?.some(s => s.ivr_detection_state === 'human');
      const mainSession = sessions?.find(s => s.conference_session_id === sessionId);
      
      if (humanDetected && mainSession) {
        console.log('🔧 Safety net: Found VAPI that should be unholded:', sessionId);
        console.log('   Human detected in:', sessions.find(s => s.ivr_detection_state === 'human')?.call_id);
        console.log('   VAPI on hold:', mainSession.vapi_on_hold);
        
        // Always try to unhold if human detected, regardless of database state
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
        
        if (unholdResp.ok || unholdResp.status === 404) {
          console.log('✅ Safety net: Successfully unholded VAPI (or already unholded)');
          
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

// Clean up on server shutdown
process.on('SIGTERM', () => {
  console.log('📛 SIGTERM received, cleaning up...');
  if (classificationSubscription) {
    supabase.removeChannel(classificationSubscription);
  }
  vapiParticipantsWaiting.clear();
});

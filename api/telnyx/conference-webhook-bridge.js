// Add this to your conference-webhook-bridge.js handler function

export default async function handler(req, res) {
  const FROM_NUMBER = process.env.TELNYX_PHONE_NUMBER || '+16092370151';
  
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
    const participant = vapiParticipants.get(session_id);
    
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
  
  // Regular webhook handling continues below...
  if (req.method === 'GET') {
    return res.status(200).send('Conference webhook endpoint is live');
  }
  
  // ... rest of your webhook handler code
}

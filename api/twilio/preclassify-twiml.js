// /api/twilio/preclassify-twiml.js
import { createClient } from '@supabase/supabase-js';
import querystring from 'querystring';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Helper function to generate IVR navigation TwiML
function generateIvrNavigationTwiml(ivrActions) {
  let twiml = '';
  let lastTimingMs = 0;
  
  // Sort actions by timing to ensure correct order
  const sortedActions = [...ivrActions].sort((a, b) => a.timing_ms - b.timing_ms);
  
  for (const action of sortedActions) {
    // Calculate pause needed since last action (or start)
    const pauseMs = action.timing_ms - lastTimingMs;
    const pauseSeconds = Math.ceil(pauseMs / 1000); // Round up for safety
    
    if (pauseSeconds > 0) {
      twiml += `<Pause length="${pauseSeconds}" />`;
    }
    
    // Execute the action
    if (action.action_type === 'dtmf') {
      twiml += `<Play digits="${action.action_value}" />`;
    } else if (action.action_type === 'speech') {
      twiml += `<Say>${action.action_value}</Say>`;
    }
    
    lastTimingMs = action.timing_ms;
  }
  
  // Add a small pause after last action before connecting VAPI
  twiml += '<Pause length="1" />';
  
  return twiml;
}

// Helper to build SIP URI with custom headers as query parameters
function buildSipUriWithHeaders(baseUri, headers) {
  const params = new URLSearchParams();
  
  // Add X- prefix to all custom headers as required by Twilio
  for (const [key, value] of Object.entries(headers)) {
    params.append(`X-${key}`, value);
  }
  
  // Get the query string and replace & with &amp; for XML
  const queryString = params.toString().replace(/&/g, '&amp;');
  
  return `${baseUri}?${queryString}`;
}

export default async function handler(req, res) {
  // Parse POST body from Twilio
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  const twilioData = querystring.parse(body);
  const callSid = twilioData.CallSid;
  
  // Twilio sends the called number as 'To' and the calling number as 'From'
  const phoneNumber = twilioData.To; // This is the number we called (the clinic)
  const fromNumber = twilioData.From; // This is our Twilio number
  
  console.log('📞 Call answered:', callSid);
  console.log('📱 Called number (To):', phoneNumber);
  console.log('📱 From number:', fromNumber);
  
  // Get query parameters including the new pendingCallId
  const { sessionId, pendingCallId, hasClassification } = req.query;
  
  console.log('🆔 Session ID:', sessionId);
  console.log('📋 Pending Call ID:', pendingCallId);
  console.log('📊 Has classification:', hasClassification);
  
  let classification = null;
  
  // Look up session and classification if sessionId provided
  if (sessionId) {
    const { data: session } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
    
    if (session) {
      if (session.classification_id) {
        // Look up the classification details
        const { data: classData } = await supabase
          .from('call_classifications')
          .select('*')
          .eq('id', session.classification_id)
          .single();
        
        if (classData) {
          classification = classData;
          console.log('📊 Classification found:', classification.classification_type);
        }
      }
    }
    
    // Update session with actual call ID
    await supabase
      .from('call_sessions')
      .update({
        call_id: callSid,
        call_status: 'active'
      })
      .eq('id', sessionId);
  }
  
  // Base SIP URI from environment
  const baseSipUri = process.env.VAPI_SIP_ADDRESS; // e.g., sip:assistant@sip.vapi.ai
  
  // Custom headers to pass to VAPI - ONLY the pending call ID
  const customHeaders = {
    'pendingcallid': pendingCallId || 'none',  // VAPI will use this to fetch all data
    'sessionid': sessionId || 'none'           // For tracking this specific attempt
  };
  
  let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>';
  
  // Route based on classification (same logic as before)
  if (classification) {
    console.log('🎯 Using cached classification:', classification.classification_type);
    
    // Add classification type to headers
    customHeaders['classification'] = classification.classification_type;
    
    if (classification.classification_type === 'human') {
      // Direct VAPI connection - no WebSocket needed
      console.log('👤 Human classification - direct VAPI connection');
      
      const sipUri = buildSipUriWithHeaders(baseSipUri, customHeaders);
      twiml += `<Dial><Sip>${sipUri}</Sip></Dial>`;
        
    } else if (classification.classification_type === 'ivr_only') {
      // Execute IVR actions then connect VAPI
      console.log('🤖 IVR classification - executing stored actions');
      
      if (classification.ivr_actions && classification.ivr_actions.length > 0) {
        twiml += generateIvrNavigationTwiml(classification.ivr_actions);
      }
      
      // After IVR navigation, connect to VAPI
      const sipUri = buildSipUriWithHeaders(baseSipUri, customHeaders);
      twiml += `<Dial><Sip>${sipUri}</Sip></Dial>`;
        
    } else if (classification.classification_type === 'ivr_then_human') {
      // TODO: Implement IVR then human logic
      console.log('🤖➡️👤 IVR then human - to be implemented');
      
      // For now, treat like IVR only
      if (classification.ivr_actions && classification.ivr_actions.length > 0) {
        twiml += generateIvrNavigationTwiml(classification.ivr_actions);
      }
      
      const sipUri = buildSipUriWithHeaders(baseSipUri, customHeaders);
      twiml += `<Dial><Sip>${sipUri}</Sip></Dial>`;
    }
    
  } else {
    // No classification - use dual approach (VAPI + WebSocket for classification)
    console.log('❓ No classification - using dual stream approach');
    
    customHeaders['classification'] = 'unknown';
    const sipUri = buildSipUriWithHeaders(baseSipUri, customHeaders);
    
    twiml += `
      <Start>
        <Stream url="${process.env.DEEPGRAM_WS_URL}">
          <Parameter name="streamSid" value="${callSid}" />
          <Parameter name="phoneNumber" value="${phoneNumber}" />
        </Stream>
      </Start>
      <Dial><Sip>${sipUri}</Sip></Dial>`;
  }
  
  twiml += '</Response>';
  
  console.log('📄 TwiML Response:', twiml);
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

export const config = {
  api: {
    bodyParser: false
  }
};

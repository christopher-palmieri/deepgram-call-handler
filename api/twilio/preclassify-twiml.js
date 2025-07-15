// Updated section for preclassify-twiml.js

// Build the base SIP URI (no query parameters)
const sipUri = process.env.VAPI_SIP_ADDRESS; // Should be like: sip:assistant@sip.vapi.ai

let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>';

// Route based on classification
if (classification) {
  console.log('🎯 Using cached classification:', classification.classification_type);
  
  if (classification.classification_type === 'human') {
    // Direct VAPI connection with SIP headers
    console.log('👤 Human classification - direct VAPI connection');
    twiml += `
      <Dial>
        <Sip>
          <Uri>${sipUri}</Uri>
          <Header name="X-Customer-Name" value="${customerName}" />
          <Header name="X-Clinic-Name" value="${clinicName}" />
          <Header name="X-Session-Id" value="${sessionId}" />
          <Header name="X-Classification" value="human" />
        </Sip>
      </Dial>`;
      
  } else if (classification.classification_type === 'ivr_only') {
    // Execute IVR actions then connect VAPI
    console.log('🤖 IVR classification - executing stored actions');
    
    if (classification.ivr_actions && classification.ivr_actions.length > 0) {
      twiml += generateIvrNavigationTwiml(classification.ivr_actions);
    }
    
    // After IVR navigation, connect to VAPI with headers
    twiml += `
      <Dial>
        <Sip>
          <Uri>${sipUri}</Uri>
          <Header name="X-Customer-Name" value="${customerName}" />
          <Header name="X-Clinic-Name" value="${clinicName}" />
          <Header name="X-Session-Id" value="${sessionId}" />
          <Header name="X-Classification" value="ivr_only" />
        </Sip>
      </Dial>`;
      
  } else if (classification.classification_type === 'ivr_then_human') {
    // TODO: Implement IVR then human logic
    console.log('🤖➡️👤 IVR then human - to be implemented');
    
    // For now, treat like IVR only
    if (classification.ivr_actions && classification.ivr_actions.length > 0) {
      twiml += generateIvrNavigationTwiml(classification.ivr_actions);
    }
    
    twiml += `
      <Dial>
        <Sip>
          <Uri>${sipUri}</Uri>
          <Header name="X-Customer-Name" value="${customerName}" />
          <Header name="X-Clinic-Name" value="${clinicName}" />
          <Header name="X-Session-Id" value="${sessionId}" />
          <Header name="X-Classification" value="ivr_then_human" />
        </Sip>
      </Dial>`;
  }
  
} else {
  // No classification - use dual approach (VAPI + WebSocket for classification)
  console.log('❓ No classification - using dual stream approach');
  
  twiml += `
    <Start>
      <Stream url="${process.env.DEEPGRAM_WS_URL}">
        <Parameter name="streamSid" value="${callSid}" />
        <Parameter name="phoneNumber" value="${phoneNumber}" />
      </Stream>
    </Start>
    <Dial>
      <Sip>
        <Uri>${sipUri}</Uri>
        <Header name="X-Customer-Name" value="${customerName}" />
        <Header name="X-Clinic-Name" value="${clinicName}" />
        <Header name="X-Session-Id" value="${sessionId}" />
        <Header name="X-Classification" value="unknown" />
      </Sip>
    </Dial>`;
}

twiml += '</Response>';

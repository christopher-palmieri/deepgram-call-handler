// api/telnyx/test-sip-transfer.js
// Handles both Telnyx webhooks AND manual transfer tests

import fetch from 'node-fetch';

export default async function handler(req, res) {
  console.log('🧪 TEST endpoint hit - Method:', req.method);
  
  // Support GET for status check
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'Test endpoint is working!',
      env_check: {
        has_telnyx_key: !!process.env.TELNYX_API_KEY,
        has_vapi_address: !!process.env.VAPI_SIP_ADDRESS,
        vapi_address: process.env.VAPI_SIP_ADDRESS || 'not set'
      }
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  
  // Check if this is a Telnyx webhook
  if (body.data && body.data.event_type) {
    console.log('📨 Telnyx webhook received:', body.data.event_type);
    
    const event = body.data;
    const payload = event.payload || {};
    
    // Handle specific events
    switch (event.event_type) {
      case 'call.answered':
        console.log('📞 Call answered - Testing immediate transfer');
        console.log('📞 Control ID:', payload.call_control_id);
        
        // TEST: Immediate transfer when call is answered
        if (process.env.TEST_AUTO_TRANSFER === 'true') {
          // For outgoing calls: 'from' is YOUR Telnyx number
          return await doTransferTest(payload.call_control_id, payload.from, res);
        }
        break;
        
      case 'call.speak.ended':
        // Could trigger transfer after a speak action
        console.log('🗣️ Speak ended - Control ID:', payload.call_control_id);
        break;
        
      default:
        console.log('📨 Other event:', event.event_type);
    }
    
    // Always return 200 for webhooks
    return res.status(200).json({ received: true });
  }
  
  // Manual test - look for control_id in body
  const control_id = body.control_id || body.call_control_id;
  if (control_id) {
    console.log('🧪 Manual transfer test requested');
    return await doTransferTest(control_id, null, res);
  }
  
  // Unknown request
  return res.status(400).json({ 
    error: 'Invalid request',
    hint: 'Send webhook or { "control_id": "..." }'
  });
}

// Helper function to do the actual transfer test
async function doTransferTest(control_id, fromNumber, res) {
  console.log('🚀 Starting transfer test for:', control_id);
  
  const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
  const VAPI_SIP_ADDRESS = process.env.VAPI_SIP_ADDRESS;
  
  if (!TELNYX_API_KEY || !VAPI_SIP_ADDRESS) {
    return res.status(500).json({ 
      error: 'Missing environment variables'
    });
  }

  const sipAddress = VAPI_SIP_ADDRESS.startsWith('sip:') 
    ? VAPI_SIP_ADDRESS 
    : `sip:${VAPI_SIP_ADDRESS}`;
  
  console.log('📍 Transferring to:', sipAddress);
  
  // Use the fromNumber if provided, otherwise use env var
  const from = fromNumber || process.env.TELNYX_PHONE_NUMBER;
  console.log('📞 Using from number:', from);

  try {
    const transferPayload = { 
      to: sipAddress,
      from: from
    };
    
    console.log('📤 Transfer payload:', JSON.stringify(transferPayload, null, 2));
    
    const response = await fetch(
      `https://api.telnyx.com/v2/calls/${control_id}/actions/transfer`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(transferPayload)
      }
    );

    const responseData = await response.json();
    
    console.log('📥 Telnyx Response Status:', response.status);
    console.log('📥 Telnyx Response:', JSON.stringify(responseData, null, 2));

    return res.status(200).json({
      transfer_test: 'completed',
      success: response.ok,
      telnyx_response: {
        status: response.status,
        data: responseData
      },
      details: {
        control_id,
        sip_address: sipAddress
      }
    });

  } catch (error) {
    console.error('❌ Transfer error:', error);
    return res.status(500).json({
      error: 'Transfer failed',
      message: error.message
    });
  }
}

export const config = {
  api: {
    bodyParser: true
  }
};

// api/telnyx/test-sip-transfer.js
// Simple, isolated SIP transfer test
// Transfer to VAPI

import fetch from 'node-fetch';

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { call_control_id } = req.body;
  
  if (!call_control_id) {
    return res.status(400).json({ 
      error: 'Missing call_control_id',
      usage: 'POST /api/telnyx/test-sip-transfer with { "call_control_id": "..." }'
    });
  }

  console.log('🧪 TEST: Starting simple SIP transfer test');
  console.log('📞 Call Control ID:', call_control_id);
  
  const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
  const VAPI_SIP_ADDRESS = process.env.VAPI_SIP_ADDRESS;
  
  if (!TELNYX_API_KEY || !VAPI_SIP_ADDRESS) {
    return res.status(500).json({ 
      error: 'Missing environment variables',
      missing: {
        TELNYX_API_KEY: !TELNYX_API_KEY,
        VAPI_SIP_ADDRESS: !VAPI_SIP_ADDRESS
      }
    });
  }

  // Ensure SIP address has proper format
  const sipAddress = VAPI_SIP_ADDRESS.startsWith('sip:') 
    ? VAPI_SIP_ADDRESS 
    : `sip:${VAPI_SIP_ADDRESS}`;
  
  console.log('📍 SIP Address:', sipAddress);

  // Simple transfer request - minimal payload
  const transferPayload = {
    to: sipAddress
  };

  console.log('📤 Transfer payload:', JSON.stringify(transferPayload, null, 2));

  try {
    // Make the Telnyx API call
    const response = await fetch(
      `https://api.telnyx.com/v2/calls/${call_control_id}/actions/transfer`,
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

    const responseText = await response.text();
    let responseData;
    
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { raw: responseText };
    }

    console.log('📥 Telnyx Response Status:', response.status);
    console.log('📥 Telnyx Response Headers:', response.headers.raw());
    console.log('📥 Telnyx Response Body:', JSON.stringify(responseData, null, 2));

    // Return full details for debugging
    return res.status(200).json({
      success: response.ok,
      test_details: {
        call_control_id,
        sip_address: sipAddress,
        payload_sent: transferPayload
      },
      telnyx_response: {
        status: response.status,
        status_text: response.statusText,
        body: responseData
      }
    });

  } catch (error) {
    console.error('❌ Transfer test error:', error);
    return res.status(500).json({
      error: 'Transfer failed',
      message: error.message,
      details: error.stack
    });
  }
}

export const config = {
  api: {
    bodyParser: true
  }
};

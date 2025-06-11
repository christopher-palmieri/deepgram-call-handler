// api/telnyx/test-dtmf.js - Simple endpoint to test DTMF
import fetch from 'node-fetch';

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_API_URL = 'https://api.telnyx.com/v2';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // GET request - show active calls
    try {
      const response = await fetch(`${TELNYX_API_URL}/calls`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        }
      });
      
      const data = await response.json();
      const calls = data.data || [];
      
      return res.status(200).json({
        active_calls: calls.length,
        calls: calls.map(call => ({
          call_leg_id: call.call_leg_id,
          call_control_id: call.call_control_id,
          from: call.from,
          to: call.to,
          state: call.state
        }))
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
  
  if (req.method === 'POST') {
    // POST request - send DTMF
    const { call_control_id, digits } = req.body;
    
    if (!call_control_id || !digits) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: { call_control_id: 'string', digits: 'string' }
      });
    }
    
    try {
      const response = await fetch(`${TELNYX_API_URL}/calls/${call_control_id}/actions/send_dtmf`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          digits: digits,
          duration_millis: 500
        })
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        return res.status(response.status).json({ error: result });
      }
      
      return res.status(200).json({ 
        success: true, 
        message: `DTMF "${digits}" sent successfully`,
        result 
      });
      
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
}

export const config = {
  api: {
    bodyParser: true
  }
};

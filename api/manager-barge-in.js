// /api/manager-barge-in.js
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const { callId, managerPhone } = req.body;
  
  if (!callId || !managerPhone) {
    return res.status(400).json({ error: 'Missing callId or managerPhone' });
  }

  try {
    console.log(`👔 Manager barge-in requested for call ${callId}`);
    
    const vercelUrl = process.env.VERCEL_URL.startsWith('http') 
      ? process.env.VERCEL_URL 
      : `https://${process.env.VERCEL_URL}`;

    // Create call to manager that joins the conference
    const call = await twilioClient.calls.create({
      url: `${vercelUrl}/api/manager-conference-join?callId=${callId}`,
      to: managerPhone,
      from: process.env.TWILIO_PHONE_NUMBER,
      statusCallback: `${vercelUrl}/api/call-status`,
      statusCallbackEvent: ['answered', 'completed']
    });

    // Log the barge-in event
    await supabase.from('manager_barge_ins').insert({
      call_id: callId,
      manager_phone: managerPhone,
      manager_call_sid: call.sid,
      created_at: new Date().toISOString()
    });

    res.status(200).json({ 
      success: true, 
      managerCallSid: call.sid,
      message: 'Manager call initiated' 
    });

  } catch (error) {
    console.error('❌ Barge-in error:', error);
    res.status(500).json({ error: error.message });
  }
}

export const config = {
  api: {
    bodyParser: true
  }
};

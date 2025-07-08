// /api/twilio/conference-webhook-bridge.js
import twilio from 'twilio';

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export default async function handler(req, res) {
  const { hold, conference_id, sid } = req.query;
  
  console.log('🎯 Conference webhook called:');
  console.log('Hold:', hold);
  console.log('Conference ID:', conference_id);
  console.log('Call SID:', sid);
  
  // Validate inputs
  if (!conference_id || !sid) {
    return res.status(400).json({
      error: 'Missing required parameters: conference_id and sid'
    });
  }
  
  if (hold !== 'true' && hold !== 'false') {
    return res.status(400).json({
      error: 'Hold parameter must be "true" or "false"'
    });
  }
  
  try {
    // First, we need to find the Conference SID from the friendly name
    const conferences = await twilioClient.conferences.list({
      friendlyName: conference_id,
      status: 'in-progress',
      limit: 1
    });
    
    if (conferences.length === 0) {
      return res.status(404).json({
        error: 'Conference not found',
        conference_id: conference_id
      });
    }
    
    const conferenceSid = conferences[0].sid;
    console.log('Found Conference SID:', conferenceSid);
    
    // Now update the participant
    const participant = await twilioClient
      .conferences(conferenceSid)
      .participants(sid.trim()) // Trim any whitespace
      .update({
        hold: hold === 'true',
        holdUrl: hold === 'true' ? 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical' : undefined
      });
    
    console.log('✅ Participant updated successfully');
    
    return res.status(200).json({
      success: true,
      conference_id: conference_id,
      conference_sid: conferenceSid,
      call_sid: sid,
      hold: participant.hold,
      muted: participant.muted
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      error: error.message,
      code: error.code,
      status: error.status
    });
  }
}

export const config = {
  api: {
    bodyParser: true
  }
};

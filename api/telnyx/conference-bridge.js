// -----------------------------
// File: conference-bridge.js
// Encapsulates conference creation and management logic 
// -----------------------------
import fetch from 'node-fetch';

const TELNYX_API_URL = 'https://api.telnyx.com/v2';

/**
 * Initiates a VAPI-first conference:
 *  - Dials VAPI leg (muted)
 *  - Returns session and conference room
 */
export async function initiateConference(vapiSip, humanNumber, fromNumber, voiceAppId, apiKey, webhookUrl) {
  const session_id = crypto.randomUUID();
  const room = `conf-${session_id}`;
  const clientState = btoa(JSON.stringify({ session_id, human: humanNumber }));

  const resp = await fetch(`${TELNYX_API_URL}/calls`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      connection_id: voiceAppId,
      to: vapiSip,
      from: fromNumber,
      enable_early_media: true,
      conference_config: {
        conference_name: room,
        start_conference_on_enter: true,
        end_conference_on_exit: true,
        muted: true
      },
      webhook_events_filter: [
        'conference.participant.joined',
        'conference.participant.left'
      ],
      webhook_url: webhookUrl,
      webhook_url_method: 'POST',
      client_state: clientState
    })
  });

  const result = await resp.json();
  if (!resp.ok) throw new Error(`Failed to start conference: ${JSON.stringify(result)}`);

  return { session_id, room, telnyxResponse: result };
}



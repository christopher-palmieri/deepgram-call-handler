// pages/api/telnyx/test-dtmf.js
import fetch from "node-fetch";

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Grab from req.body instead of req.json()
  const { call_control_id, digits } = req.body;
  if (!call_control_id || !digits) {
    return res
      .status(400)
      .json({ error: "Missing call_control_id or digits" });
  }

  const dtmfResp = await fetch(
    `https://api.telnyx.com/v2/calls/${call_control_id}/actions/send_dtmf`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ digits, duration_millis: 500 }),
    }
  );
  const dtmfJson = await dtmfResp.json();

  if (!dtmfResp.ok) {
    return res.status(dtmfResp.status).json({ error: dtmfJson });
  }
  return res.status(200).json({ success: true, result: dtmfJson });
}

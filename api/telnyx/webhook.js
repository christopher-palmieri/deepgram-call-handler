// pages/api/telnyx/webhook.js
export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Next.js already parsed the JSON into req.body
  const hook = req.body;
  const { event_type, payload } = hook.data || {};

  console.log("📥 Telnyx Webhook:", event_type, "leg =", payload?.call_control_id);
  // TODO: save payload.call_control_id somewhere for DTMF

  return res.status(200).json({ received: true });
}

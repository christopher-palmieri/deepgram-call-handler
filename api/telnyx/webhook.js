// pages/api/telnyx/webhook.js
export default async function handler(req, res) {
  // Only accept Telnyx webhooks via POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const hook = await req.json();
  // You can verify a webhook signature here if you’ve configured one
  const { event_type, payload } = hook.data;
  console.log("📥 Telnyx Webhook:", event_type, "leg =", payload.call_control_id);

  // TODO: store payload.call_control_id (and any other info)
  // into your database for later DTMF use.

  // Acknowledge receipt
  return res.status(200).json({ received: true });
}

export default function handler(req, res) {
  const response = `
    <Response>
      <Start>
        <Stream url="wss://twilio-ws-server-production-81ba.up.railway.app" />
      </Start>
      <Say voice="alice">Connecting you now. Please hold.</Say>
      <Pause length="60" />
    </Response>
  `;
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(response.trim());
}

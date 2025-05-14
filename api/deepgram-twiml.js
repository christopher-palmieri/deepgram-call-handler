export default function handler(req, res) {
  const response = `
    <Response>
      <Start>
        <Stream url="${process.env.DEEPGRAM_HANDLER_URL}" />
      </Start>
      <Say voice="alice">Connecting you now. Please hold.</Say>
      <Pause length="60" />
    </Response>
  `;
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(response.trim());
}

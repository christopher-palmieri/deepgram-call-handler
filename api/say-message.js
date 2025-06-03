// /api/say-message.js
export default async function handler(req, res) {
  const { text = 'Hello' } = req.query;
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${text}</Say>
</Response>`;

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

export const config = {
  api: {
    bodyParser: false
  }
};

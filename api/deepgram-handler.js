import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';

const deepgramWsUrl = `wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000&endpointing=1500&utterance_end_ms=1000&smart_format=true&model=phonecall`;

let server;

export default function handler(req, res) {
  if (!server) {
    server = new WebSocketServer({ noServer: true });

    server.on('connection', (wsTwilio) => {
      console.log('🔌 Twilio media stream connected');

      const dgSocket = new WebSocket(deepgramWsUrl, {
        headers: {
          Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        },
      });

      dgSocket.on('open', () => {
        console.log('🧠 Connected to Deepgram');
      });

      dgSocket.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.is_final && msg.channel?.alternatives?.[0]?.transcript) {
          const transcript = msg.channel.alternatives[0].transcript;
          console.log('📝 Final Transcript:', transcript);

          // Optional: forward to Supabase or webhook
          fetch(process.env.TRANSCRIPT_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transcript,
              stt_source: 'deepgram',
              timestamp: new Date().toISOString(),
            }),
          });
        }
      });

      wsTwilio.on('message', (msg) => {
        const { event, media, start } = JSON.parse(msg.toString());

        if (event === 'start') {
          console.log(`📞 Call started: ${start.callSid}`);
        }

        if (event === 'media' && dgSocket.readyState === WebSocket.OPEN) {
          const audio = Buffer.from(media.payload, 'base64');
          dgSocket.send(audio);
        }

        if (event === 'stop') {
          console.log('❌ Call ended');
          dgSocket.close();
        }
      });

      wsTwilio.on('close', () => {
        console.log('🚪 Twilio connection closed');
        dgSocket.close();
      });
    });

    // Upgrade incoming HTTP request to WebSocket
    req.socket.server.on('upgrade', (request, socket, head) => {
      server.handleUpgrade(request, socket, head, (ws) => {
        server.emit('connection', ws, request);
      });
    });
  }

  res.status(200).json({ message: 'WebSocket handler ready' });
}

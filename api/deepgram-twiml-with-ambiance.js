// === STEP 1: Update your Vercel endpoint ===
// deepgram-call-handler/api/deepgram-twiml-with-ambiance.js

import { createClient } from '@supabase/supabase-js';
import querystring from 'querystring';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const parsed = querystring.parse(body);
  const callId = parsed.CallSid || 'unknown';
  console.log('📞 Incoming call for call_id:', callId);

  // Check if we've already set up streams
  const { data: session } = await supabase
    .from('call_sessions')
    .select('*')
    .eq('call_id', callId)
    .single();

  // === NEW: Set up dual streams on first request ===
  if (!session?.streams_initialized) {
    console.log('🚀 Initializing streams...');
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <!-- Stream 1: Your existing Deepgram stream -->
  <Start>
    <Stream name="deepgram-stream" 
            url="wss://twilio-ws-server-production-81ba.up.railway.app">
      <Parameter name="streamSid" value="${callId}" />
      <Parameter name="audioTrack" value="inbound_track" />
    </Stream>
  </Start>
  
  <!-- Stream 2: NEW Ambiance stream -->
  <Start>
    <Stream name="ambiance-stream" 
            url="wss://ambiance-controller-production.up.railway.app">
      <Parameter name="callId" value="${callId}" />
      <Parameter name="audioTrack" value="outbound_track" />
    </Stream>
  </Start>
  
  <Pause length="3" />
  <Redirect>/api/deepgram-twiml-with-ambiance</Redirect>
</Response>`;

    // Mark streams as initialized
    await supabase
      .from('call_sessions')
      .upsert({ 
        call_id: callId,
        streams_initialized: true,
        created_at: new Date().toISOString()
      });

    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);
    return;
  }

  // Continue with your existing logic for IVR actions
  // ... rest of your existing code ...
  
  // When you need to play DTMF, stop ambiance first:
  if (ivrAction?.action_type === 'dtmf') {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <!-- Stop ambiance for clean DTMF -->
  <Stop>
    <Stream name="ambiance-stream" />
  </Stop>
  
  <!-- Play DTMF -->
  <Play digits="${ivrAction.action_value}" />
  
  <!-- Restart ambiance -->
  <Start>
    <Stream name="ambiance-stream" 
            url="wss://ambiance-controller-production.up.railway.app">
      <Parameter name="callId" value="${callId}" />
      <Parameter name="audioTrack" value="outbound_track" />
    </Stream>
  </Start>
  
  <Pause length="2" />
  <Redirect>/api/deepgram-twiml-with-ambiance</Redirect>
</Response>`;

    await supabase
      .from('ivr_events')
      .update({ executed: true })
      .eq('id', ivrAction.id);

    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);
    return;
  }
  
  // Default keepalive
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="3" />
  <Redirect>/api/deepgram-twiml-with-ambiance</Redirect>
</Response>`;
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}

// === STEP 2: Create Ambiance Service in Railway ===
// twilio-ws-services/services/ambiance-service/index.js

import WebSocket, { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || 8081;
const wss = new WebSocketServer({ port: PORT });

// === OPTION A: Simple Generated Ambiance ===
// Start with this for testing
function generateSimpleAmbiance() {
  // Generate 1 second of simple office-like noise at 8kHz
  const sampleRate = 8000;
  const duration = 1; // 1 second
  const samples = sampleRate * duration;
  const buffer = Buffer.alloc(samples);
  
  for (let i = 0; i < samples; i++) {
    // Mix of low frequency hum and random noise
    const hum = Math.sin(2 * Math.PI * 60 * i / sampleRate) * 10; // 60Hz hum
    const noise = (Math.random() - 0.5) * 5; // Random noise
    const aircon = Math.sin(2 * Math.PI * 120 * i / sampleRate) * 3; // AC sound
    
    // Combine and convert to μ-law
    const combined = hum + noise + aircon;
    // Simple μ-law approximation (center at 128)
    buffer[i] = Math.floor(128 + combined);
  }
  
  return buffer;
}

// === OPTION B: Real Audio File ===
// Use this once you have an audio file
let ambianceBuffer;
try {
  // Load your audio file (must be 8kHz, mono, μ-law)
  ambianceBuffer = fs.readFileSync('./audio/office-ambiance.mulaw');
  console.log('✅ Loaded ambiance file:', ambianceBuffer.length, 'bytes');
} catch (err) {
  console.log('⚠️ No audio file found, using generated ambiance');
  ambianceBuffer = generateSimpleAmbiance();
}

// === WebSocket Connection Handler ===
wss.on('connection', (ws) => {
  console.log('🎵 New ambiance stream connection');
  
  let callId = null;
  let isActive = true;
  let position = 0;
  let streamInterval = null;

  ws.on('message', (data) => {
    const message = JSON.parse(data);
    
    if (message.event === 'start') {
      callId = message.start.customParameters?.callId;
      console.log(`🎵 Starting ambiance for call: ${callId}`);
      
      // Start streaming ambiance
      streamInterval = setInterval(() => {
        if (!isActive || ws.readyState !== WebSocket.OPEN) {
          return;
        }
        
        // Get next chunk of ambiance (20ms = 160 samples at 8kHz)
        const chunkSize = 160;
        const chunk = Buffer.alloc(chunkSize);
        
        for (let i = 0; i < chunkSize; i++) {
          chunk[i] = ambianceBuffer[position % ambianceBuffer.length];
          position++;
        }
        
        // Send to Twilio
        const mediaMessage = {
          event: 'media',
          streamSid: callId,
          media: {
            track: 'outbound_track',
            chunk: chunk.toString('base64'),
            timestamp: Date.now()
          }
        };
        
        ws.send(JSON.stringify(mediaMessage));
      }, 20); // Send every 20ms
    }
    
    if (message.event === 'stop') {
      console.log(`🛑 Stopping ambiance for call: ${callId}`);
      isActive = false;
      if (streamInterval) {
        clearInterval(streamInterval);
      }
    }
  });

  ws.on('close', () => {
    console.log(`❌ Ambiance stream closed for: ${callId}`);
    if (streamInterval) {
      clearInterval(streamInterval);
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
});

console.log(`🎵 Ambiance Controller running on port ${PORT}`);

// Health check endpoint
import express from 'express';
const app = express();

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    connections: wss.clients.size 
  });
});

app.listen(PORT + 1, () => {
  console.log(`📡 Health check on port ${PORT + 1}`);
});

// === STEP 3: Package.json for ambiance service ===
// twilio-ws-services/services/ambiance-service/package.json
{
  "name": "ambiance-service",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js"
  },
  "dependencies": {
    "ws": "^8.0.0",
    "express": "^4.18.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.0"
  }
}

// === STEP 4: Railway deployment ===
// In your Railway project:

// 1. Create new service:
// railway service create ambiance-controller

// 2. Set environment variables:
// PORT=8081

// 3. Deploy:
// cd services/ambiance-service
// railway up

// === STEP 5: Update Supabase schema ===
// Add to your call_sessions table:
/*
ALTER TABLE call_sessions 
ADD COLUMN streams_initialized BOOLEAN DEFAULT FALSE;
*/

// === STEP 6: Convert audio file (if using real audio) ===
// Run this command to convert your audio to the right format:
/*
ffmpeg -i office-ambiance.mp3 \
  -ar 8000 \           # 8kHz sample rate
  -ac 1 \              # Mono
  -acodec pcm_mulaw \  # μ-law encoding
  office-ambiance.mulaw
*/

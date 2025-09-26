#!/usr/bin/env node

/**
 * Live WebSocket audio stream player
 * Connects to the monitor WebSocket and plays audio in real-time
 * 
 * Usage: node test-audio-live.js [callId] [token]
 * 
 * Requirements:
 * - sox (for 'play' command): apt-get install sox
 * - OR ffplay (from ffmpeg): apt-get install ffmpeg
 */

const WebSocket = require('ws');
const { spawn } = require('child_process');

// Configuration
const WS_URL = 'wss://standalone-monitor-production.up.railway.app/monitor';

// Command line arguments
const callId = process.argv[2] || '';
const token = process.argv[3] || '';

// Stats
let messageCount = 0;
let audioChunkCount = 0;
let totalBytes = 0;

// Audio player process
let audioPlayer = null;
let playerCommand = null;
let playerReady = false;

console.log('\n🎧 Live WebSocket Audio Player');
console.log('================================');
console.log(`WebSocket URL: ${WS_URL}`);
console.log(`Call ID: ${callId || '(none)'}`);
console.log('');

// Detect available audio player
function detectAudioPlayer() {
    const { execSync } = require('child_process');
    
    // Try different players in order of preference
    const players = [
        {
            name: 'play (sox)',
            command: 'play',
            args: ['-t', 'raw', '-r', '8000', '-e', 'mu-law', '-b', '8', '-c', '1', '-'],
            test: 'which play'
        },
        {
            name: 'ffplay',
            command: 'ffplay',
            args: ['-f', 'mulaw', '-ar', '8000', '-ac', '1', '-nodisp', '-autoexit', '-'],
            test: 'which ffplay'
        },
        {
            name: 'aplay',
            command: 'aplay',
            args: ['-f', 'MU_LAW', '-r', '8000', '-c', '1', '-'],
            test: 'which aplay'
        }
    ];
    
    for (const player of players) {
        try {
            execSync(player.test, { stdio: 'ignore' });
            console.log(`✅ Found audio player: ${player.name}`);
            return player;
        } catch (e) {
            // Player not found, try next
        }
    }
    
    return null;
}

// Start audio player
function startAudioPlayer() {
    playerCommand = detectAudioPlayer();
    
    if (!playerCommand) {
        console.error('❌ No audio player found! Please install one of:');
        console.error('   - sox (for play command): apt-get install sox');
        console.error('   - ffmpeg (for ffplay): apt-get install ffmpeg');
        console.error('   - alsa-utils (for aplay): apt-get install alsa-utils');
        console.error('\n   On macOS: brew install sox');
        process.exit(1);
    }
    
    console.log(`🔊 Starting audio player: ${playerCommand.command}`);
    console.log(`   Command: ${playerCommand.command} ${playerCommand.args.join(' ')}`);
    console.log('');
    
    audioPlayer = spawn(playerCommand.command, playerCommand.args, {
        stdio: ['pipe', 'ignore', 'ignore']
    });
    
    audioPlayer.on('error', (error) => {
        console.error(`❌ Audio player error: ${error.message}`);
        playerReady = false;
    });
    
    audioPlayer.on('exit', (code, signal) => {
        console.log(`\n🔇 Audio player stopped (code: ${code}, signal: ${signal})`);
        playerReady = false;
        
        // Restart player if WebSocket is still connected
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log('🔄 Restarting audio player...');
            setTimeout(startAudioPlayer, 1000);
        }
    });
    
    playerReady = true;
}

// Build connection URL
let wsUrl = WS_URL;
const params = [];
if (callId) params.push(`callId=${encodeURIComponent(callId)}`);
if (token) params.push(`token=${encodeURIComponent(token)}`);
if (params.length > 0) {
    wsUrl += '?' + params.join('&');
}

// Start audio player first
startAudioPlayer();

console.log(`📡 Connecting to WebSocket...`);
const ws = new WebSocket(wsUrl);

// Set binary type
ws.binaryType = 'arraybuffer';

// Connection opened
ws.on('open', () => {
    console.log('✅ Connected successfully!');
    console.log('🎵 Audio will play as it arrives... (Press Ctrl+C to stop)\n');
});

// Message received
ws.on('message', (data) => {
    messageCount++;
    
    if (typeof data === 'string') {
        // JSON message
        try {
            const json = JSON.parse(data);
            totalBytes += data.length;
            
            // Only log non-audio messages
            if (json.type || json.event) {
                console.log(`📨 [${new Date().toLocaleTimeString()}] ${json.type || json.event}`);
            }
            
            // Check for base64 audio in JSON
            if (json.audio) {
                audioChunkCount++;
                const audioBytes = Buffer.from(json.audio, 'base64');
                
                // Send to audio player
                if (playerReady && audioPlayer && !audioPlayer.killed) {
                    audioPlayer.stdin.write(audioBytes);
                    
                    // Show activity indicator
                    process.stdout.write(`\r🔊 Playing: ${audioChunkCount} chunks, ${formatBytes(totalBytes)} received`);
                }
            }
            
        } catch (e) {
            // Non-JSON text message
            if (data.length < 100) {
                console.log(`📝 Text: ${data}`);
            }
        }
    } else if (data instanceof ArrayBuffer) {
        // Binary audio data
        audioChunkCount++;
        const buffer = Buffer.from(data);
        totalBytes += buffer.length;
        
        // Send directly to audio player
        if (playerReady && audioPlayer && !audioPlayer.killed) {
            audioPlayer.stdin.write(buffer);
            
            // Show activity indicator
            process.stdout.write(`\r🔊 Playing: ${audioChunkCount} chunks, ${formatBytes(totalBytes)} received`);
        }
    }
});

// Error occurred
ws.on('error', (error) => {
    console.error(`\n❌ WebSocket error: ${error.message}`);
});

// Connection closed
ws.on('close', (code, reason) => {
    console.log(`\n\n📴 Connection closed (code: ${code}, reason: ${reason || 'none'})`);
    
    console.log(`\nFinal stats:`);
    console.log(`  Messages: ${messageCount}`);
    console.log(`  Audio chunks: ${audioChunkCount}`);
    console.log(`  Total data: ${formatBytes(totalBytes)}`);
    
    // Stop audio player
    if (audioPlayer && !audioPlayer.killed) {
        audioPlayer.kill();
    }
    
    process.exit(0);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping...');
    
    if (audioPlayer && !audioPlayer.killed) {
        audioPlayer.kill();
    }
    
    if (ws) {
        ws.close();
    }
    
    setTimeout(() => process.exit(0), 500);
});

// Format bytes for display
function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Show instructions if no call ID provided
if (!callId) {
    console.log('💡 Tip: Provide a call ID to monitor a specific call:');
    console.log('   node test-audio-live.js <call_id> [token]\n');
}
import WebSocket from 'ws';
import fs from 'node:fs';

const env = fs.readFileSync('.env', 'utf-8');
const token = (env.match(/^GATEWAY_TOKEN=(.+)$/m) || [])[1]?.trim() || '';

console.log('Testing gateway WebSocket with token:', token);

const ws = new WebSocket('ws://127.0.0.1:8787');

ws.on('open', () => {
  console.log('[open] Sending start message...');
  ws.send(JSON.stringify({
    type: 'start',
    token,
    mode: 'audio',
    sourceLanguage: 'en',
    targetLanguage: 'fr',
    audioOffsetMs: 0,
    enableAudioOut: false,
  }));
});

ws.on('message', (data) => {
  console.log('[message]', data.toString());
  const msg = JSON.parse(data.toString());
  if (msg.type === 'ready') {
    console.log('✅ Gateway ready!');
    ws.close(1000);
  }
});

ws.on('error', (err) => {
  console.log('[error]', err.message);
});

ws.on('close', (code, reason) => {
  console.log('[close] code:', code, 'reason:', reason.toString());
  process.exit(code === 1000 ? 0 : 1);
});

setTimeout(() => {
  console.log('[timeout] No response after 10s');
  ws.close();
  process.exit(1);
}, 10000);

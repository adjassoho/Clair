import WebSocket from 'ws';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf-8');
const keyMatch = env.match(/GEMINI_API_KEY=(.+)/);
const apiKey = keyMatch ? keyMatch[1].trim() : '';

async function testResumption() {
  let lastHandle = null;
  let socket = null;
  let running = true;
  let count = 0;

  function connect() {
    console.log(`Connecting to Gemini Live (resumption handle: ${lastHandle ? lastHandle.slice(0, 8) + '...' : 'none'})...`);
    const url = new URL('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent');
    url.searchParams.set('key', apiKey);
    socket = new WebSocket(url);

    socket.on('open', () => {
      console.log('Connected! Sending setup with resumption...');
      const setup = {
        setup: {
          model: 'models/gemini-3.8-live',
          generationConfig: { responseModalities: ['TEXT'] },
          ...(lastHandle ? { sessionResumption: { handle: lastHandle } } : { sessionResumption: {} }),
        },
      };
      socket.send(JSON.stringify(setup));
    });

    socket.on('message', (data) => {
      const json = JSON.parse(data.toString());
      if (json.sessionResumptionUpdate?.newHandle) {
        lastHandle = json.sessionResumptionUpdate.newHandle;
        console.log('Updated session resumption handle:', lastHandle.slice(0, 10) + '...');
      }
      if (json.setupComplete) {
        console.log('Setup complete! Session active.');
      }
    });

    socket.on('close', (code) => {
      console.log(`Gemini socket closed with code ${code}.`);
      if (running) {
        console.log('Reconnecting in 500ms using session resumption...');
        setTimeout(connect, 500);
      }
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err.message);
    });
  }

  connect();

  // Send audio every 100ms
  const interval = setInterval(() => {
    count++;
    if (count > 450) { // 45 seconds test (will cover the 30s drop and resumption!)
      clearInterval(interval);
      running = false;
      socket?.close();
      console.log('Test completed successfully!');
      return;
    }
    if (socket?.readyState === WebSocket.OPEN) {
      const pcm16 = new Int16Array(1600);
      const base64Data = Buffer.from(pcm16.buffer).toString('base64');
      socket.send(JSON.stringify({
        realtimeInput: {
          mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: base64Data }],
        },
      }));
    }
    if (count % 50 === 0) {
      console.log(`Streamed ${(count / 10).toFixed(1)}s audio...`);
    }
  }, 100);
}

testResumption();

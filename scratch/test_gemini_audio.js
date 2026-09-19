import WebSocket from 'ws';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf-8');
const keyMatch = env.match(/GEMINI_API_KEY=(.+)/);
const apiKey = keyMatch ? keyMatch[1].trim() : '';

async function testAudioStream() {
  const url = new URL('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent');
  url.searchParams.set('key', apiKey);
  const ws = new WebSocket(url);
  
  ws.on('open', () => {
    console.log('Open! Sending setup...');
    const setup = {
      setup: {
        model: 'models/gemini-3.8-live',
        generationConfig: {
          responseModalities: ['TEXT'],
          temperature: 0.1,
          maxOutputTokens: 2048,
        },
        systemInstruction: {
          parts: [{
            text: 'You are a real-time French interpreter for English Microsoft Teams meetings. Continuously translate English spoken words into clear, natural French. Preserve speaker identities, names, numbers and technical terms accurately.',
          }],
        },
      },
    };
    ws.send(JSON.stringify(setup));
  });

  let setupDone = false;

  ws.on('message', (data) => {
    const str = data.toString();
    console.log('Received from Gemini:', str.slice(0, 300));
    const json = JSON.parse(str);
    if (json.setupComplete) {
      setupDone = true;
      console.log('Setup complete received! Starting audio loop (100ms packets of 16kHz PCM)...');
      // Send 3 seconds of dummy audio (1600 samples = 3200 bytes per 100ms)
      let count = 0;
      const interval = setInterval(() => {
        if (count++ > 30) {
          clearInterval(interval);
          console.log('Done sending audio packets.');
          return;
        }
        const pcm16 = new Int16Array(1600); // 100ms of silence/noise
        // add tiny sine wave so it's not complete zero
        for (let i = 0; i < 1600; i++) {
          pcm16[i] = Math.sin(i / 10) * 1000;
        }
        const base64Data = Buffer.from(pcm16.buffer).toString('base64');
        ws.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{
              mimeType: 'audio/pcm;rate=16000',
              data: base64Data,
            }],
          },
        }));
      }, 100);
    }
  });

  ws.on('error', (err) => console.error('WS Error:', err));
  ws.on('close', (code, reason) => console.log('Closed:', code, reason.toString()));

  setTimeout(() => {
    console.log('Closing test...');
    ws.close();
  }, 10000);
}

testAudioStream();

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

  let interval;

  ws.on('message', (data) => {
    const str = data.toString();
    console.log('Received from Gemini:', str.slice(0, 300));
    const json = JSON.parse(str);
    if (json.setupComplete) {
      console.log('Setup complete received! Starting 60s audio streaming...');
      let count = 0;
      interval = setInterval(() => {
        count++;
        if (count % 50 === 0) console.log(`Streamed ${count * 100}ms (${(count / 10).toFixed(1)}s)... bufferedAmount:`, ws.bufferedAmount);
        if (count >= 600) { // 60 seconds
          clearInterval(interval);
          console.log('Done 60 seconds of audio streaming.');
          ws.close();
          return;
        }
        const pcm16 = new Int16Array(1600); // 100ms of 16kHz audio
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
  ws.on('close', (code, reason) => {
    clearInterval(interval);
    console.log('Closed:', code, reason.toString());
  });
}

testAudioStream();

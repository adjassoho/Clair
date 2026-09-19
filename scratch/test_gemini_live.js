import WebSocket from 'ws';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf-8');
const keyMatch = env.match(/GEMINI_API_KEY=(.+)/);
const apiKey = keyMatch ? keyMatch[1].trim() : '';

console.log('Testing apiKey:', apiKey ? apiKey.slice(0, 10) + '...' : 'none');

async function testModel(modelName) {
  return new Promise((resolve) => {
    console.log('\n--- Testing model:', modelName, '---');
    const url = new URL('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent');
    url.searchParams.set('key', apiKey);
    const ws = new WebSocket(url);
    ws.on('open', () => {
      console.log('Connected! Sending setup for', modelName);
      ws.send(JSON.stringify({
        setup: {
          model: modelName.startsWith('models/') ? modelName : `models/${modelName}`,
          generationConfig: {
            responseModalities: ['TEXT'],
          }
        }
      }));
    });
    ws.on('message', (data) => {
      console.log('Received message:', data.toString().slice(0, 200));
      ws.close();
      resolve(true);
    });
    ws.on('error', (err) => {
      console.log('Error:', err.message);
    });
    ws.on('close', (code, reason) => {
      console.log('Closed with code:', code, 'reason:', reason.toString());
      resolve(false);
    });
    setTimeout(() => {
      ws.terminate();
      resolve(false);
    }, 6000);
  });
}

async function run() {
  await testModel('gemini-3.8-live');
  await testModel('gemini-2.0-flash-exp');
  await testModel('gemini-2.0-flash-realtime-exp');
}
run();

// Diagnostic: does the response-parsing path used by providers.js actually match
// what the Live API returns? A text turn removes audio from the equation.
import WebSocket from 'ws';
import fs from 'node:fs';

const env = fs.readFileSync('.env', 'utf-8');
const apiKey = (env.match(/GEMINI_API_KEY=(.+)/) || [])[1]?.trim() || '';
const model = (env.match(/GEMINI_LIVE_MODEL=(.+)/) || [])[1]?.trim() || 'gemini-3.8-live';

const url = new URL('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent');
url.searchParams.set('key', apiKey);

const ws = new WebSocket(url, { perMessageDeflate: false });
let sawModelTurnText = false;
let sawAnyServerContent = false;

const PARSE_PATH = (msg) => msg?.serverContent?.modelTurn?.parts;

ws.on('open', () => {
  console.log('[1] socket open, sending setup for model:', model);
  ws.send(JSON.stringify({
    setup: {
      model: model.startsWith('models/') ? model : `models/${model}`,
      generationConfig: { responseModalities: ['TEXT'], temperature: 0.1, maxOutputTokens: 2048 },
      systemInstruction: { parts: [{ text: 'You are a real-time French interpreter. Translate English speech into French. Output only the French translation.' }] },
    },
  }));
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); }
  catch { console.log('[!] non-JSON frame, length', data.length); return; }

  const keys = Object.keys(msg).join(',');

  if (msg.setupComplete) {
    console.log('[2] setupComplete -> model name accepted');
    console.log('[3] sending an English text turn (clientContent)...');
    ws.send(JSON.stringify({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: 'Good morning everyone, we will start the quarterly review in two minutes.' }] }],
        turnComplete: true,
      },
    }));
    return;
  }

  if (msg.serverContent) {
    sawAnyServerContent = true;
    const parts = PARSE_PATH(msg);
    if (parts) {
      const text = parts.map(p => p.text).filter(Boolean).join('');
      if (text) { sawModelTurnText = true; console.log('[4] TEXT via serverContent.modelTurn.parts ->', JSON.stringify(text)); }
    } else {
      // The parsing path used in providers.js did NOT match. Show the real shape.
      console.log('[!] serverContent present but modelTurn.parts is MISSING. Real keys:', Object.keys(msg.serverContent).join(','));
      console.log('    full frame:', JSON.stringify(msg).slice(0, 600));
    }
    if (msg.serverContent.turnComplete) {
      console.log('[5] turnComplete received');
      setTimeout(() => ws.close(1000), 200);
    }
    return;
  }

  if (msg.error) { console.log('[!] API error frame:', JSON.stringify(msg.error).slice(0, 400)); return; }
  if (msg.sessionResumptionUpdate) return;
  console.log('[i] other frame keys:', keys, JSON.stringify(msg).slice(0, 300));
});

ws.on('error', (e) => console.log('[!] socket error:', e.message));
ws.on('close', (code) => {
  console.log(`[6] closed (${code})`);
  console.log('--- VERDICT ---');
  console.log('serverContent frames seen :', sawAnyServerContent);
  console.log('parse path matched + text :', sawModelTurnText);
  if (!sawAnyServerContent) console.log('=> Model never produced content. Setup or model config is the problem.');
  else if (!sawModelTurnText) console.log('=> Model responded but providers.js reads the WRONG field. This is the silent failure.');
  else console.log('=> Parsing path is correct. Look upstream at the audio actually being sent.');
  process.exit(0);
});

setTimeout(() => { console.log('[timeout 25s]'); ws.close(); }, 25000);

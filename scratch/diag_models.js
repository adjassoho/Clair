// Diagnostic: do the configured model names actually exist, and what does the
// Live socket say when it closes? Close reason text is the missing signal.
import WebSocket from 'ws';
import fs from 'node:fs';

const env = fs.readFileSync('.env', 'utf-8');
const pick = (k) => (env.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim() || '';
const apiKey = pick('GEMINI_API_KEY');
const textModel = pick('GEMINI_MODEL');
const liveModel = pick('GEMINI_LIVE_MODEL');

console.log('configured GEMINI_MODEL      :', textModel);
console.log('configured GEMINI_LIVE_MODEL :', liveModel);
console.log('api key prefix               :', apiKey.slice(0, 6) + '…', `(len ${apiKey.length})`);

// --- 1. Which models does this key actually have? ---
async function listModels() {
  console.log('\n=== ListModels ===');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`);
  const body = await res.text();
  if (!res.ok) {
    console.log('HTTP', res.status);
    console.log(body.slice(0, 700));
    return [];
  }
  const json = JSON.parse(body);
  const names = (json.models || []).map(m => m.name.replace(/^models\//, ''));
  console.log('total models visible:', names.length);
  const live = names.filter(n => /live|realtime|bidi/i.test(n));
  console.log('\nmodels supporting a live/bidi style name:');
  for (const n of live) console.log('  -', n);
  console.log('\nflash/pro text models (first 15):');
  for (const n of names.filter(n => /flash|pro/.test(n)).slice(0, 15)) console.log('  -', n);
  console.log('\nconfigured names present?');
  console.log('  GEMINI_MODEL      exists:', names.includes(textModel));
  console.log('  GEMINI_LIVE_MODEL exists:', names.includes(liveModel));
  return names;
}

// --- 2. Does the translation model work at all? (captions mode depends on it) ---
async function testTranslator() {
  console.log('\n=== generateContent on GEMINI_MODEL ===');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(textModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Translate to French: Good morning everyone.' }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
    }),
  });
  const body = await res.text();
  console.log('HTTP', res.status);
  if (!res.ok) { console.log(body.slice(0, 500)); return false; }
  const text = JSON.parse(body).candidates?.[0]?.content?.parts?.[0]?.text;
  console.log('translation ->', JSON.stringify(text));
  return Boolean(text);
}

// --- 3. Live socket, this time keeping the close reason ---
function testLive(model) {
  return new Promise((resolve) => {
    console.log(`\n=== Live socket: ${model} ===`);
    const url = new URL('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent');
    url.searchParams.set('key', apiKey);
    const ws = new WebSocket(url, { perMessageDeflate: false });
    let gotSetup = false, gotContent = false;
    ws.on('open', () => ws.send(JSON.stringify({
      setup: {
        model: model.startsWith('models/') ? model : `models/${model}`,
        generationConfig: { responseModalities: ['TEXT'] },
      },
    })));
    ws.on('message', (d) => {
      let m; try { m = JSON.parse(d.toString()); } catch { return; }
      if (m.setupComplete) {
        gotSetup = true;
        console.log('  setupComplete');
        ws.send(JSON.stringify({
          clientContent: { turns: [{ role: 'user', parts: [{ text: 'Say hello in French.' }] }], turnComplete: true },
        }));
        return;
      }
      if (m.serverContent) {
        const t = (m.serverContent.modelTurn?.parts || []).map(p => p.text).filter(Boolean).join('');
        if (t) { gotContent = true; console.log('  text ->', JSON.stringify(t)); }
        if (m.serverContent.turnComplete) ws.close(1000);
        return;
      }
      if (m.error) console.log('  error frame:', JSON.stringify(m.error).slice(0, 300));
    });
    ws.on('error', (e) => console.log('  socket error:', e.message));
    ws.on('close', (code, reason) => {
      console.log(`  closed code=${code} reason=${JSON.stringify(reason?.toString() || '')}`);
      resolve({ model, gotSetup, gotContent });
    });
    setTimeout(() => ws.close(), 20000);
  });
}

const names = await listModels();
await testTranslator();
const results = [await testLive(liveModel)];

// If the configured live model failed, try the real live models this key exposes.
if (!results[0].gotContent) {
  for (const candidate of names.filter(n => /live|bidi/i.test(n)).slice(0, 3)) {
    if (candidate === liveModel) continue;
    results.push(await testLive(candidate));
  }
}

console.log('\n===== SUMMARY =====');
for (const r of results) {
  console.log(`${r.gotContent ? 'WORKS  ' : 'FAILS  '} ${r.model}  (setup=${r.gotSetup}, text=${r.gotContent})`);
}
process.exit(0);

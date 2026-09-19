// Decisive end-to-end test: real English speech -> each candidate live model
// -> did we get French text back?
//
// Speech is synthesized with the TTS model on this same key, so no extra
// install is needed. ffmpeg converts it to the PCM16/16kHz mono the
// extension actually sends.
import WebSocket from 'ws';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const env = fs.readFileSync('.env', 'utf-8');
const pick = (k) => (env.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim() || '';
const apiKey = pick('GEMINI_API_KEY');

const SENTENCE = 'Good morning everyone. Before we start the quarterly review, '
  + 'I want to confirm that the migration to the new database finished last night. '
  + 'We processed about fourteen thousand records with no errors.';

const PCM_PATH = '/tmp/clair_diag_speech.pcm';

// ---------- 1. Synthesize real English speech ----------
async function buildSpeechPcm() {
  if (fs.existsSync(PCM_PATH) && fs.statSync(PCM_PATH).size > 100000) {
    console.log('reusing cached speech PCM:', fs.statSync(PCM_PATH).size, 'bytes');
    return fs.readFileSync(PCM_PATH);
  }
  console.log('synthesizing English speech via TTS...');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `Say this clearly in a neutral American accent: ${SENTENCE}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      }),
    },
  );
  const body = await res.text();
  if (!res.ok) { console.log('TTS failed HTTP', res.status, body.slice(0, 400)); return null; }
  const inline = JSON.parse(body).candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
  if (!inline?.data) { console.log('TTS returned no audio'); return null; }
  console.log('TTS mimeType:', inline.mimeType);

  // TTS returns raw PCM (usually 24kHz mono s16le). Resample to 16kHz for Live.
  const rateMatch = /rate=(\d+)/.exec(inline.mimeType || '');
  const inRate = rateMatch ? rateMatch[1] : '24000';
  fs.writeFileSync('/tmp/clair_diag_tts.raw', Buffer.from(inline.data, 'base64'));
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 's16le', '-ar', inRate, '-ac', '1', '-i', '/tmp/clair_diag_tts.raw',
    '-f', 's16le', '-ar', '16000', '-ac', '1', PCM_PATH,
  ]);
  const pcm = fs.readFileSync(PCM_PATH);
  console.log(`speech ready: ${pcm.length} bytes = ${(pcm.length / 32000).toFixed(1)}s at 16kHz`);
  return pcm;
}

// ---------- 2. Stream it at one candidate model ----------
function trial({ model, modalities, pcm, label }) {
  return new Promise((resolve) => {
    const url = new URL('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent');
    url.searchParams.set('key', apiKey);
    const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 8 * 1024 * 1024 });

    const out = { label, model, modalities: modalities.join('+'), setup: false, text: '', audioBytes: 0, code: null, reason: '', transcript: '' };
    let sender = null;
    const done = (t) => { clearInterval(sender); try { ws.close(); } catch {} resolve(out); };

    ws.on('open', () => {
      ws.send(JSON.stringify({
        setup: {
          model: `models/${model}`,
          generationConfig: {
            responseModalities: modalities,
            ...(modalities.includes('AUDIO')
              ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } } }
              : {}),
          },
          systemInstruction: { parts: [{ text: 'You are a live English-to-French interpreter. Translate everything you hear into French immediately. Output only the French translation.' }] },
          // Ask for transcripts explicitly - this is how an audio-only model can still yield text.
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
      }));
    });

    ws.on('message', (d) => {
      let m; try { m = JSON.parse(d.toString()); } catch { return; }

      if (m.setupComplete) {
        out.setup = true;
        let off = 0;
        const CHUNK = 3200; // 100ms of 16kHz s16le
        sender = setInterval(() => {
          if (off >= pcm.length) {
            clearInterval(sender);
            ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
            setTimeout(() => done(), 9000); // let the model finish its turn
            return;
          }
          const slice = pcm.subarray(off, off + CHUNK);
          off += CHUNK;
          ws.send(JSON.stringify({
            realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: slice.toString('base64') }] },
          }));
        }, 100);
        return;
      }

      const sc = m.serverContent;
      if (sc) {
        for (const p of sc.modelTurn?.parts || []) {
          if (p.text) out.text += p.text;
          if (p.inlineData?.data) out.audioBytes += Buffer.from(p.inlineData.data, 'base64').length;
        }
        if (sc.outputTranscription?.text) out.transcript += sc.outputTranscription.text;
        if (sc.inputTranscription?.text) out.transcript += `[in] ${sc.inputTranscription.text}`;
      }
      if (m.error) out.reason = JSON.stringify(m.error).slice(0, 200);
    });

    ws.on('error', (e) => { out.reason ||= e.message; });
    ws.on('close', (code, reason) => {
      out.code = code;
      out.reason = reason?.toString() || out.reason;
      clearInterval(sender);
      resolve(out);
    });
    setTimeout(() => done(), 75000);
  });
}

// ---------- 3. Run the matrix ----------
const pcm = await buildSpeechPcm();
if (!pcm) { console.log('cannot proceed without speech audio'); process.exit(1); }

const CANDIDATES = [
  { model: 'gemini-3.8-live',                   modalities: ['TEXT'],  label: 'configured (current code)' },
  { model: 'gemini-3.8-live',                   modalities: ['AUDIO'], label: 'configured, AUDIO out' },
  { model: 'gemini-3.5-live-translate-preview', modalities: ['TEXT'],  label: 'live-translate' },
  { model: 'gemini-3.5-live-translate-preview', modalities: ['AUDIO'], label: 'live-translate, AUDIO out' },
  { model: 'gemini-3.5-transcribe-live',        modalities: ['TEXT'],  label: 'transcribe-live' },
];

const results = [];
for (const c of CANDIDATES) {
  process.stdout.write(`\n--- ${c.model} [${c.modalities.join('+')}] ... `);
  const r = await trial({ ...c, pcm });
  results.push(r);
  const got = r.text.trim() || r.transcript.trim();
  console.log(got ? 'GOT TEXT' : (r.audioBytes ? `audio only (${r.audioBytes}B)` : 'nothing'));
  if (got) console.log('    ->', JSON.stringify(got.slice(0, 220)));
  if (r.code !== 1000 && r.code !== null) console.log(`    close=${r.code} ${JSON.stringify(r.reason.slice(0, 160))}`);
}

console.log('\n\n================ MATRIX ================');
for (const r of results) {
  const verdict = (r.text.trim() || r.transcript.trim()) ? 'TEXT OK' : (r.audioBytes ? 'AUDIO ONLY' : 'FAIL');
  console.log(`${verdict.padEnd(11)} ${r.model} [${r.modalities}] close=${r.code}`);
}
process.exit(0);

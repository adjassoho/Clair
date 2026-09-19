import fixWebmDuration from 'fix-webm-duration';
import { normalizeRect } from './geometry.js';
import { buildExport, buildManifest, buildSrt } from './export.js';
import { all, get, put, remove, clearSession } from './storage.js';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

let session = null;
let origin = 0;
let active = false;
let starting = false;
let finishing = false;
let segments = [];
let incidents = [];
let clips = [];
let stream, audio, source, processor, mute, analyser, video, socket;
let micStream = null, micSource = null, audioMixDest = null, micAnalyser = null;
let currentActiveSpeaker = { name: null, timestamp: 0, source: null };
let rect = null;
let previewDimensions = null;
let recording = null;
let clipStopping = null;
let sessionRecordingJob = null;
let sessionRecordingStopping = null;
let finishPromise = null;
let adapter = '';
let levelTimer;
let gatewayReady = false;
let gatewayFinished = false;
let resolveFinished;
let resolveFlush;
let incoming = Promise.resolve();
let captionRequests = new Map();
let captionVersions = new Map();
let currentAudioLevel = 0;
let sessionToken = 'clair-local-session-secret-token-2026';
const objectUrls = new Set();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const epoch = () => Date.now();
const now = () => Math.max(0, Date.now() - origin);
const notify = (type, data) => {
  chrome.runtime.sendMessage({ target: 'panel', type, ...data }).catch(() => {});
  chrome.runtime.sendMessage({ target: 'worker-relay', type, ...data }).catch(() => {});
};

function state() {
  return { ok: true, session, active: active || starting, finishing, recording: !!recording, hasPreview: !!rect,
    sessionOriginEpochMs: origin, durationMs: active ? now() : session?.durationMs || 0,
    clipCount: clips.length, segments, adapter, audioLevel: currentAudioLevel };
}
function publish() { notify('state', { state: state() }); }
async function persist() {
  if (session) await put('session', 'current', { session: { ...session, durationMs: active ? now() : session.durationMs }, incidents, origin });
}
async function incident(message, type = 'interruption') {
  const time = now();
  incidents.push({ type, startMs: time, endMs: time + 1, message });
  if (session) session.status = 'incomplete';
  notify('error', { message });
  await persist().catch(() => {});
}
const restored = (async () => {
  const saved = await get('session', 'current');
  if (!saved) return;
  ({ session, incidents, origin } = saved);
  segments = await all('segments');
  clips = await all('clips');
  if (session.status === 'active') {
    session.status = 'incomplete';
    incidents.push({ type: 'recovery', startMs: session.durationMs, endMs: session.durationMs + 1,
      message: 'Session interrompue. Seuls les extraits finalises sont recuperables ; les blocs bruts restent locaux jusqu’a suppression.' });
    await persist();
  }
})();

function formatTimestamp(ms, separator = ',') {
  const value = Math.max(0, Math.round(ms));
  const hours = String(Math.floor(value / 3600000)).padStart(2, '0');
  const minutes = String(Math.floor((value % 3600000) / 60000)).padStart(2, '0');
  const seconds = String(Math.floor((value % 60000) / 1000)).padStart(2, '0');
  const millis = String(value % 1000).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}${separator}${millis}`;
}

function generateSrtFromSegments(segmentList, videoOffsetMs = 0) {
  const sorted = [...segmentList].sort((a, b) => a.startMs - b.startMs);
  const cues = [];
  let index = 1;
  for (const seg of sorted) {
    const text = seg.translatedText?.trim() || seg.sourceText?.trim();
    if (!text) continue;
    const speaker = seg.speakerName ? `${seg.speakerName} : ` : '';
    // Caler les sous-titres sur le début réel de la piste vidéo avec une légère avance (120ms)
    const adjStart = Math.max(0, seg.startMs - videoOffsetMs - 120);
    const adjEnd = Math.max(adjStart + 1000, seg.endMs - videoOffsetMs);
    const start = formatTimestamp(adjStart, ',');
    const end = formatTimestamp(adjEnd, ',');
    cues.push(`${index++}\n${start} --> ${end}\n${speaker}${text}\n`);
  }
  return cues.join('\n');
}

function generateFormattedTranscript(sess, segmentList) {
  const sorted = [...segmentList].sort((a, b) => a.startMs - b.startMs);
  const dateStr = sess?.startedAt ? new Date(sess.startedAt).toLocaleString('fr-FR') : new Date().toLocaleString('fr-FR');
  const durationSec = sess?.durationMs ? Math.round(sess.durationMs / 1000) : 0;
  const durationStr = `${Math.floor(durationSec / 60)} min ${durationSec % 60} s`;

  const header = [
    '======================================================================',
    'CLAIR AI - TRANSCRIPTION COMPLÈTE DE SESSION TEAMS',
    `Date de la séance : ${dateStr}`,
    `Durée totale      : ${durationStr}`,
    `Total segments    : ${sorted.length}`,
    '======================================================================\n',
  ].join('\n');

  const lines = sorted.map(seg => {
    const time = `[${formatTimestamp(seg.startMs, '.')}]`;
    const speaker = seg.speakerName ? seg.speakerName : 'Intervenant';
    const fr = seg.translatedText ? seg.translatedText.trim() : '';
    const en = seg.sourceText ? seg.sourceText.trim() : '';
    if (en && fr && en !== fr) {
      return `${time} ${speaker} :\n  FR : ${fr}\n  EN : ${en}\n`;
    }
    return `${time} ${speaker} : ${fr || en}\n`;
  });

  return `${header}${lines.join('\n')}`;
}

async function receiveSegment(value) {
  console.log('[DEBUG] receiveSegment appelé avec:', value);
  if (!session || !value || typeof value.id !== 'string' || !Number.isFinite(value.startMs) || !Number.isFinite(value.endMs)
    || value.startMs < 0 || value.endMs <= value.startMs || typeof value.translatedText !== 'string') {
    console.error('[DEBUG] Segment invalide rejeté:', value);
    await incident('Segment linguistique invalide.', 'gateway'); return;
  }
  let speakerName = typeof value.speakerName === 'string' && value.speakerName.trim() ? value.speakerName.trim() : null;
  // Si l'orateur n'est pas précisé ou est un libellé IA générique ("Intervenant 1", "Locuteur 1"),
  // et qu'un locuteur actif Teams a été détecté dans les 8 dernières secondes, lui attribuer le nom réel.
  if (!speakerName || /^Intervenant\s+\d+$/i.test(speakerName) || /^Locuteur\s+\d+$/i.test(speakerName)) {
    if (currentActiveSpeaker.name && (Date.now() - currentActiveSpeaker.timestamp) < 8000) {
      speakerName = currentActiveSpeaker.name;
    }
  }
  const speakerStatus = speakerName ? 'identified' : 'unknown';

  // Late translation updates replace the same caption, never shift its media origin.
  const segment = { id: value.id, startMs: value.startMs, endMs: value.endMs,
    speakerName,
    speakerStatus,
    translatedText: value.translatedText,
    sourceText: typeof value.sourceText === 'string' ? value.sourceText : '',
    status: ['final', 'provisional'].includes(value.status) ? value.status : 'incomplete' };
  const pending = captionVersions.get(value.id);
  if (pending && (pending.startMs !== value.startMs || pending.endMs !== value.endMs || pending.sourceText !== value.sourceText)) return;
  captionRequests.delete(value.id);
  const index = segments.findIndex(item => item.id === value.id);
  const isUpdate = index >= 0;
  if (!isUpdate) segments.push(segment); else segments[index] = segment;
  console.log(`[DEBUG] Segment ${isUpdate ? 'mis à jour' : 'ajouté'} (${segment.status}, total: ${segments.length}): "${segment.translatedText || segment.sourceText}"`);
  await put('segments', segment.id, segment);
  await persist(); publish();
  if (globalThis.chrome?.storage?.session) {
    chrome.storage.session.set({
      liveSegments: [...segments],
      liveInterimText: '',
      lastSegmentTime: Date.now(),
    }).catch(() => {});
  }
  notify('segment', { segment });
  notify('interim', { text: '' });
  console.log('[DEBUG] Segment publié vers le panel et Teams');
}

let playbackCtx = null;
let nextPlayTime = 0;
function playAudioOut(base64Data) {
  try {
    const raw = atob(base64Data);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const pcm16 = new Int16Array(bytes.buffer);
    if (!playbackCtx || playbackCtx.state === 'closed') {
      playbackCtx = new AudioContext({ sampleRate: 24000 });
    }
    const buffer = playbackCtx.createBuffer(1, pcm16.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm16.length; i++) channel[i] = pcm16[i] / 32768;
    const node = playbackCtx.createBufferSource();
    node.buffer = buffer;
    node.connect(playbackCtx.destination);
    const start = Math.max(playbackCtx.currentTime, nextPlayTime);
    node.start(start);
    nextPlayTime = start + buffer.duration;
  } catch {}
}

let visualTimer = null;
function startVisualSampling() {
  stopVisualSampling();
  visualTimer = setInterval(() => {
    if (!active || !rect || !video || !gatewayReady || socket?.readyState !== WebSocket.OPEN) return;
    try {
      const snapCanvas = document.createElement('canvas');
      const scale = Math.min(1, 640 / Math.max(1, rect.width));
      snapCanvas.width = Math.round(rect.width * scale);
      snapCanvas.height = Math.round(rect.height * scale);
      const ctx = snapCanvas.getContext('2d');
      ctx.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, snapCanvas.width, snapCanvas.height);
      const dataUrl = snapCanvas.toDataURL('image/jpeg', 0.5);
      const base64 = dataUrl.slice('data:image/jpeg;base64,'.length);
      socket.send(JSON.stringify({ type: 'visual-frame', data: base64 }));
    } catch {}
  }, 4000);
}
function stopVisualSampling() {
  if (visualTimer) { clearInterval(visualTimer); visualTimer = null; }
}

function connectGateway(token, mode, audioOffsetMs = 0, enableAudioOut = false) {
  return new Promise((resolve, reject) => {
    console.log('[DEBUG] connectGateway appelé - mode:', mode, 'token:', token.substring(0, 10) + '...');
    socket = new WebSocket('ws://127.0.0.1:8787');
    console.log('[DEBUG] WebSocket créé, état:', socket.readyState);
    const timeout = setTimeout(() => { reject(new Error('Service local indisponible ou authentification expiree.')); socket.close(); }, 12000);
    const safeOffset = Math.round(Number.isFinite(audioOffsetMs) ? Math.max(0, audioOffsetMs) : 0);
    socket.onopen = () => {
      const startMsg = { type: 'start', token, mode, sourceLanguage: 'en', targetLanguage: 'fr', audioOffsetMs: safeOffset, enableAudioOut };
      console.log('[DEBUG] WebSocket ouvert, envoi message start:', startMsg);
      socket.send(JSON.stringify(startMsg));
    };
    socket.onerror = () => { clearTimeout(timeout); reject(new Error('Impossible de joindre le service local sur 127.0.0.1:8787.')); };
    socket.onmessage = event => {
      let data;
      try { data = JSON.parse(event.data); } catch { incident('Reponse du service local illisible.'); return; }
      console.log('[DEBUG] Message reçu du serveur:', data.type, data);
      if (data.type === 'ready') { clearTimeout(timeout); gatewayReady = true; console.log('[DEBUG] Gateway ready, résolution de la promesse'); resolve(); }
      if (data.type === 'segment') {
        console.log('[DEBUG] Segment reçu:', data.segment);
        incoming = incoming.then(() => receiveSegment(data.segment)).catch(error => incident(`Sauvegarde du texte impossible : ${error.message}`, 'storage'));
      }
      if (data.type === 'interim') {
        notify('interim', { text: data.text });
        if (globalThis.chrome?.storage?.session) {
          chrome.storage.session.set({ liveInterimText: data.text || '' }).catch(() => {});
        }
      }
      if (data.type === 'audio-out') playAudioOut(data.data);
      if (data.type === 'error') {
        console.error('[DEBUG] Erreur reçue du serveur:', data.message);
        if (!gatewayReady) { clearTimeout(timeout); reject(new Error(data.message || 'Connexion refusee.')); }
        incident(data.message || 'Erreur du service linguistique.', 'gateway');
      }
      if (data.type === 'finished') {
        gatewayFinished = true;
        if (data.incomplete) incident('Le service a signale une transcription incomplete.', 'gateway');
        resolveFinished?.();
      }
      if (data.type === 'status') { adapter = data.message; publish(); }
    };
    socket.onclose = () => {
      clearTimeout(timeout);
      if (processor && source) {
        try { source.disconnect(processor); } catch {}
      }
      if (!gatewayReady) reject(new Error('Connexion au service local fermee.'));
      if (active && !gatewayFinished) {
        incident('Connexion au service linguistique fermee. Terminez et exportez cette session.', 'network');
        resolveFinished?.();
      }
      gatewayReady = false;
    };
  });
}

async function releaseMedia() {
  clearInterval(levelTimer);
  stopVisualSampling();
  if (playbackCtx) { playbackCtx.close().catch(() => {}); playbackCtx = null; nextPlayTime = 0; }
  if (video) { video.pause(); video.srcObject = null; video.remove(); video = null; }
  if (processor) { processor.port.onmessage = null; processor.disconnect(); processor = null; }
  if (micStream) { micStream.getTracks().forEach(track => track.stop()); micStream = null; }
  if (micSource) { micSource.disconnect(); micSource = null; }
  if (micAnalyser) { try { micAnalyser.disconnect(); } catch {} micAnalyser = null; }
  if (audioMixDest) { try { audioMixDest.disconnect(); } catch {} audioMixDest = null; }
  source?.disconnect(); mute?.disconnect();
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  if (audio) { await audio.close().catch(() => {}); audio = null; }
  if (socket) { socket.close(); socket = null; }
  gatewayReady = false;
}

async function start({ streamId, token, mode, enableAudioOut, enableMic = true }) {
  if (active || starting || finishing) throw new Error('Une session est deja active.');
  if (typeof token !== 'string' || token.length < 16) throw new Error('Un jeton local de 16 caracteres minimum est requis.');
  if (!['audio', 'captions'].includes(mode)) throw new Error('Mode invalide.');
  if (session) {
    await clearSession();
    session = null; segments = []; clips = []; incidents = []; origin = 0; adapter = '';
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
  }
  starting = true;
  sessionToken = token;
  origin = epoch();
  session = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), sourceLanguage: 'en', targetLanguage: 'fr',
    durationMs: 0, platform: 'microsoft-teams-web', status: 'active', mode, enableAudioOut: Boolean(enableAudioOut) };
  segments = []; clips = []; incidents = []; captionRequests.clear(); captionVersions.clear(); incoming = Promise.resolve();
  gatewayFinished = false; rect = null; previewDimensions = null;
  adapter = mode === 'audio' ? 'Mode audio direct haute fidélité actif.' : 'Attente des sous-titres Teams anglais avec noms.';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxFrameRate: 30 } },
    });
    if (!stream.getAudioTracks().length || !stream.getVideoTracks().length) throw new Error('Le son et la video de l’onglet sont necessaires.');
    video = document.createElement('video'); video.muted = true; video.playsInline = true;
    document.body.append(video); video.srcObject = stream; await video.play();
    audio = new AudioContext({ sampleRate: 16000 });
    if (audio.state !== 'running') {
      await audio.resume().catch(() => {});
    }
    source = audio.createMediaStreamSource(stream);
    source.connect(audio.destination); // tabCapture otherwise suppresses local playback.
    analyser = audio.createAnalyser();
    source.connect(analyser);

    try {
      audioMixDest = audio.createMediaStreamDestination();
      source.connect(audioMixDest);
    } catch {}

    if (enableMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
        micSource = audio.createMediaStreamSource(micStream);
        micSource.connect(analyser);
        if (audioMixDest) micSource.connect(audioMixDest);
        try {
          micAnalyser = audio.createAnalyser();
          micSource.connect(micAnalyser);
        } catch {}
      } catch (err) {
        console.warn('Microphone local non accessible:', err.message);
      }
    }
    const values = new Float32Array(analyser.fftSize);
    levelTimer = setInterval(() => {
      if (audio?.state === 'suspended') {
        audio.resume().catch(() => {});
      }
      analyser.getFloatTimeDomainData(values);
      currentAudioLevel = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
      notify('level', { level: currentAudioLevel });
      if (micAnalyser) {
        try {
          const micVals = new Float32Array(micAnalyser.fftSize);
          micAnalyser.getFloatTimeDomainData(micVals);
          const micLevel = Math.sqrt(micVals.reduce((sum, v) => sum + v * v, 0) / micVals.length);
          if (micLevel > 0.035) {
            currentActiveSpeaker = { name: 'Moi', timestamp: Date.now(), source: 'local-mic' };
          }
        } catch {}
      }
      chrome.runtime.sendMessage({ target: 'worker', type: 'heartbeat' }).catch(() => {});
      persist().catch(() => {});
    }, 1000);
    if (mode === 'audio') {
      if (audio.sampleRate !== 16000) throw new Error('Echantillonnage audio 16 kHz indisponible.');
      await audio.audioWorklet.addModule('pcm-worklet.js');
      processor = new AudioWorkletNode(audio, 'pcm-capture', { channelCount: 1, channelCountMode: 'explicit' });
      mute = audio.createGain(); mute.gain.value = 0; processor.connect(mute).connect(audio.destination);
      const contextOrigin = epoch() - audio.currentTime * 1000;
      const buffered = [];
      let firstOffset;
      let resolveFirst;
      let sentChunkCount = 0;
      const first = new Promise(resolve => { resolveFirst = resolve; });
      processor.port.onmessage = ({ data }) => {
        if (data.flushed) { resolveFlush?.(); return; }
        if (firstOffset === undefined) {
          firstOffset = Math.round(Math.max(0, contextOrigin + data.startFrame / 16 - origin));
          console.log('[DEBUG] Premier chunk audio reçu, offset:', firstOffset, 'taille:', data.samples.byteLength);
          resolveFirst(firstOffset);
        }
        if (!gatewayReady) {
          if (!active) {
            if (buffered.length < 300) buffered.push(data.samples);
            else { incident('Tampon audio saturé pendant la connexion initiale.', 'audio'); try { source.disconnect(processor); } catch {} }
          }
        } else if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 1024 * 1024) {
          sentChunkCount++;
          if (sentChunkCount % 50 === 0) {
            console.log(`[DEBUG] Flux audio PCM actif vers le serveur (${sentChunkCount} chunks transmis)`);
          }
          socket.send(data.samples);
        } else if (active) {
          console.error('[DEBUG] Transmission audio impossible - socket état:', socket?.readyState, 'buffered:', socket?.bufferedAmount);
          incident('Transmission audio interrompue.', 'audio');
          try { source.disconnect(processor); } catch {}
        }
      };
      source.connect(processor);
      if (micSource) micSource.connect(processor);
      const offset = await Promise.race([first, sleep(5000).then(() => { throw new Error('Aucun flux audio disponible.'); })]);
      console.log('[DEBUG] Audio offset calculé:', offset, 'ms');
      await connectGateway(token, mode, offset, enableAudioOut);
      console.log('[DEBUG] Gateway connecté, envoi de', buffered.length, 'chunks audio bufferisés');
      buffered.forEach(bytes => socket.send(bytes)); buffered.length = 0;
    } else await connectGateway(token, mode, 0, enableAudioOut);
    active = true;
    for (const track of stream.getTracks()) track.onended = () => {
      if (active && !finishing) incident('La capture de l’onglet a ete interrompue.', 'capture').then(() => finish());
    };
    startSessionRecording();
    await persist(); publish();
    if (globalThis.chrome?.storage?.session) {
      chrome.storage.session.set({
        sessionOriginEpochMs: origin,
        sessionActive: true,
        sessionStatus: 'active',
        liveSegments: [],
        liveInterimText: '',
        sessionToken,
      }).catch(() => {});
    }
    return { ok: true, sessionOriginEpochMs: origin };
  } catch (error) {
    await releaseMedia();
    await clearSession();
    session = null;
    segments = [];
    clips = [];
    incidents = [];
    publish();
    throw error;
  } finally { starting = false; publish(); }
}

function startSessionRecording() {
  if (sessionRecordingJob || !stream) return;
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) return;
  const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) {
    console.warn('[Session Recording] Aucun codec WebM supporté');
    return;
  }
  const audioTracks = audioMixDest?.stream?.getAudioTracks()?.length
    ? audioMixDest.stream.getAudioTracks()
    : stream.getAudioTracks();
  const mediaStream = new MediaStream([videoTrack, ...audioTracks]);
  const recorder = new MediaRecorder(mediaStream, { mimeType, videoBitsPerSecond: 1800000 });
  const clip = {
    id: crypto.randomUUID(),
    sessionStartMs: now(),
    sessionEndMs: 0,
    durationMs: 0,
    width: video?.videoWidth || 1920,
    height: video?.videoHeight || 1080,
    mimeType,
    hasAudio: true,
    status: 'complete',
    isFullSession: true,
  };
  const job = {
    recorder,
    clip,
    chunks: [],
    keys: [],
    writes: Promise.resolve(),
    mediaStream,
    canvasStream: null,
    interval: null,
    end: null,
    stopped: null,
    size: 0,
  };
  sessionRecordingJob = job;
  job.stopped = new Promise(resolve => { job.end = resolve; });
  recorder.ondataavailable = event => {
    if (!event.data?.size) return;
    job.chunks.push(event.data);
    job.size += event.data.size;
  };
  recorder.onerror = () => {
    job.clip.status = 'incomplete';
    incident('Erreur d’enregistrement vidéo de session.', 'encoding');
    stopSessionRecording();
  };
  recorder.onstop = () => {
    job.clip.sessionEndMs = job.clip.sessionEndMs || now();
    job.clip.durationMs = Math.max(1, job.clip.sessionEndMs - job.clip.sessionStartMs);
    job.end?.();
    if (!sessionRecordingStopping) stopSessionRecording();
  };
  recorder.start(1000);
  console.log('[Session Recording] Enregistrement vidéo continu démarré avec succès');
}

async function stopSessionRecording() {
  if (sessionRecordingStopping) return sessionRecordingStopping;
  if (!sessionRecordingJob) return { ok: true };
  const job = sessionRecordingJob;
  sessionRecordingStopping = (async () => {
    job.clip.sessionEndMs = now();
    if (job.recorder.state !== 'inactive') {
      try { job.recorder.stop(); } catch {}
    } else {
      job.end?.();
    }
    await Promise.race([job.stopped, sleep(2000)]);
    await Promise.race([job.writes, sleep(2000)]);
    try {
      let raw = null;
      if (job.chunks && job.chunks.length) {
        raw = new Blob(job.chunks, { type: job.clip.mimeType });
      }
      if (raw) {
        job.clip.durationMs = Math.max(1, job.clip.sessionEndMs - job.clip.sessionStartMs);
        job.clip.blob = raw;
        await put('clips', job.clip.id, job.clip).catch(() => {});
        const existingIdx = clips.findIndex(c => c.id === job.clip.id);
        if (existingIdx >= 0) clips[existingIdx] = job.clip;
        else clips.push(job.clip);
        console.log(`[Session Recording] Vidéo de séance finalisée avec succès (${Math.round(job.clip.durationMs / 1000)}s, ${(raw.size / (1024 * 1024)).toFixed(2)} Mo)`);
      }
    } catch (error) {
      await incident(`Vidéo de séance non finalisée : ${error.message}`, 'encoding');
    } finally {
      sessionRecordingJob = null;
      sessionRecordingStopping = null;
      await persist();
      publish();
    }
    return { ok: true };
  })();
  return sessionRecordingStopping;
}

async function preview(selected) {
  if (!active || finishing || recording) throw new Error('Capture indisponible.');
  rect = normalizeRect(selected, video.videoWidth, video.videoHeight);
  previewDimensions = { width: video.videoWidth, height: video.videoHeight };
  startVisualSampling();
  const canvas = document.createElement('canvas'); canvas.width = rect.width; canvas.height = rect.height;
  canvas.getContext('2d').drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const image = canvas.toDataURL('image/jpeg', .65);
  publish(); return { ok: true, preview: image };
}

async function record() {
  if (!active || finishing || !rect || clipStopping) throw new Error('Selectionnez et confirmez une nouvelle zone.');
  if (recording) await stopClip();
  if (video.videoWidth !== previewDimensions?.width || video.videoHeight !== previewDimensions?.height) {
    rect = null; throw new Error('Dimensions modifiees. Selectionnez de nouveau la zone.');
  }
  const estimate = await navigator.storage.estimate();
  if (estimate.quota && estimate.quota - estimate.usage < 100 * 1024 * 1024) throw new Error('Moins de 100 Mo de stockage local disponibles.');
  const canvas = document.createElement('canvas'); canvas.width = rect.width; canvas.height = rect.height;
  const context = canvas.getContext('2d');
  const crop = { ...rect };
  const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error('Encodage WebM avec audio indisponible.');
  const canvasStream = canvas.captureStream(0);
  const videoTrack = canvasStream.getVideoTracks()[0];
  const audioTracks = audioMixDest?.stream?.getAudioTracks()?.length
    ? audioMixDest.stream.getAudioTracks()
    : stream.getAudioTracks();
  const mediaStream = new MediaStream([videoTrack, ...audioTracks]);
  const recorder = new MediaRecorder(mediaStream, { mimeType, videoBitsPerSecond: 1800000 });
  const clip = { id: crypto.randomUUID(), sessionStartMs: now(), sessionEndMs: 0, durationMs: 0,
    width: canvas.width, height: canvas.height, mimeType, hasAudio: true, status: 'complete' };
  const job = { recorder, clip, chunks: [], keys: [], writes: Promise.resolve(), canvasStream, interval: null, end: null, stopped: null, size: 0 };
  recording = job;
  const draw = () => {
    if (video.videoWidth !== previewDimensions?.width || video.videoHeight !== previewDimensions?.height) {
      invalidate('Dimensions de la capture modifiees. Selectionnez de nouveau la zone.'); return;
    }
    context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    videoTrack.requestFrame();
  };
  job.stopped = new Promise(resolve => { job.end = resolve; });
  recorder.ondataavailable = event => {
    if (!event.data?.size) return;
    job.chunks.push(event.data);
    job.size += event.data.size;
  };
  recorder.onerror = () => { clip.status = 'incomplete'; incident('Erreur d’encodage de l’extrait.', 'encoding'); stopClip(); };
  recorder.onstop = () => {
    if (job.interval) clearInterval(job.interval);
    clip.sessionEndMs = clip.sessionEndMs || now(); clip.durationMs = clip.sessionEndMs - clip.sessionStartMs;
    job.end?.();
    if (!clipStopping) stopClip();
  };
  recorder.start(1000); draw(); job.interval = setInterval(draw, 1000 / 30);
  publish(); return { ok: true };
}

async function stopClip() {
  if (clipStopping) return clipStopping;
  if (!recording) return { ok: true };
  const job = recording;
  clipStopping = (async () => {
    job.clip.sessionEndMs = now();
    if (job.interval) clearInterval(job.interval);
    if (job.recorder.state !== 'inactive') {
      try { job.recorder.stop(); } catch {}
    } else {
      job.end?.();
    }
    await Promise.race([job.stopped, sleep(1500)]);
    await Promise.race([job.writes, sleep(1500)]);
    try {
      let raw = null;
      if (job.chunks && job.chunks.length) {
        raw = new Blob(job.chunks, { type: job.clip.mimeType });
      } else if (job.keys && job.keys.length) {
        const blobs = await Promise.all(job.keys.map(key => get('chunks', key)));
        if (blobs.length && blobs.some(Boolean)) {
          raw = new Blob(blobs.filter(Boolean), { type: job.clip.mimeType });
        }
        await Promise.all(job.keys.map(key => remove('chunks', key))).catch(() => {});
      }
      if (raw) {
        job.clip.durationMs = Math.max(1, job.clip.sessionEndMs - job.clip.sessionStartMs);
        job.clip.blob = raw;
        await put('clips', job.clip.id, job.clip).catch(() => {});
        clips.push(job.clip);
      }
    } catch (error) { await incident(`Extrait non finalise : ${error.message}`, 'encoding'); }
    finally {
      if (job.canvasStream) job.canvasStream.getTracks().forEach(track => track.stop());
      recording = null; clipStopping = null; await persist(); publish();
    }
    return { ok: true };
  })();
  return clipStopping;
}

async function invalidate(reason) {
  if (!rect) return { ok: true };
  rect = null;
  await stopClip();
  if (active) { adapter = reason || 'Cadrage invalide. Selectionnez une nouvelle zone.'; publish(); }
  return { ok: true };
}

async function finish() {
  if (finishPromise) return finishPromise;
  if (!active) return { ok: true };
  finishing = true; publish();
  finishPromise = (async () => {
    try {
      try { await stopClip(); } catch (e) { console.warn('stopClip failed:', e); }
      try { await stopSessionRecording(); } catch (e) { console.warn('stopSessionRecording failed:', e); }
      if (processor) {
        try { source?.disconnect?.(processor); } catch {}
        const flushed = new Promise(resolve => { resolveFlush = resolve; });
        try { processor.port.postMessage('flush'); } catch {}
        await Promise.race([flushed, sleep(300)]);
      }
      if (gatewayReady && socket?.readyState === WebSocket.OPEN) {
        const completed = new Promise(resolve => { resolveFinished = resolve; });
        try { socket.send(JSON.stringify({ type: 'finish' })); } catch {}
        await Promise.race([completed, sleep(2500)]);
        if (!gatewayFinished) await incident('Delai de finalisation linguistique depasse.', 'gateway');
      }
      await incoming.catch(() => {});
      for (const pending of captionRequests.values()) {
        if (!segments.some(segment => segment.id === pending.id)) {
          const missing = { id: pending.id, startMs: pending.startMs, endMs: pending.endMs, speakerName: pending.speakerName,
            translatedText: '[Traduction indisponible]', status: 'incomplete' };
          segments.push(missing); await put('segments', missing.id, missing);
        }
      }
      if (captionRequests.size) {
        await incident('La transcription contient des passages manquants.', 'transcription');
      } else if (!segments.length) {
        adapter = session.mode === 'captions' ? 'Aucun sous-titre détecté depuis Teams.' : 'Aucune parole détectée pendant la session.';
      }
      session.durationMs = now();
      session.status = incidents.length ? 'incomplete' : 'complete';
      if (globalThis.chrome?.storage?.session) {
        chrome.storage.session.set({
          sessionActive: false,
          sessionStatus: session.status,
          sessionDurationMs: session.durationMs,
        }).catch(() => {});
      }
    } finally {
      active = false; rect = null; finishing = false;
      await releaseMedia(); await persist(); publish(); finishPromise = null;
    }
    return { ok: true };
  })();
  return finishPromise;
}

async function command(message) {
  if (message.type === 'ping') return { ok: true, ready: true };
  await restored;
  switch (message.type) {
    case 'ping': return { ok: true, ready: true };
    case 'status': return state();
    case 'start': return start(message);
    case 'preview': return preview(message.rect);
    case 'record': return record();
    case 'stop-clip': return stopClip();
    case 'invalidate': return invalidate(message.reason);
    case 'adapter-status':
      adapter = String(message.message || 'Adaptateur indisponible.'); publish(); return { ok: true };
    case 'active-speaker': {
      if (typeof message.speakerName === 'string' && message.speakerName.trim()) {
        currentActiveSpeaker = {
          name: message.speakerName.trim(),
          timestamp: Date.now(),
          source: message.source || 'teams',
        };
      }
      return { ok: true };
    }
    case 'caption': {
      if (!active || session.mode !== 'captions' || !gatewayReady || finishing) return { ok: false, error: 'Transcription indisponible.' };
      const value = message.segment;
      if (!value || typeof value.id !== 'string' || typeof value.sourceText !== 'string' || value.sourceText.length > 8000
        || !Number.isFinite(value.startMs) || !Number.isFinite(value.endMs) || value.startMs < 0 || value.endMs <= value.startMs) throw new Error('Sous-titre invalide.');
      captionRequests.set(value.id, value);
      captionVersions.set(value.id, value);
      if (socket.bufferedAmount > 512000) { await incident('File de transcription saturee.'); return { ok: false, error: 'File saturee.' }; }
      socket.send(JSON.stringify({ type: 'caption', ...value })); return { ok: true };
    }
    case 'copilot-ask': {
      if (!active || !gatewayReady || socket?.readyState !== WebSocket.OPEN) {
        return { ok: false, error: 'Session non active ou copilote indisponible.' };
      }
      socket.send(JSON.stringify({ type: 'copilot-ask', query: message.query }));
      return { ok: true };
    }
    case 'finish': return finish();
    case 'export': {
      if (active || starting || finishing || !session) throw new Error('Terminez la session avant l’export.');
      const blob = await buildExport(session, segments, clips, incidents);
      const url = URL.createObjectURL(blob); objectUrls.add(url);
      return { ok: true, url, filename: `clair-${session.startedAt.slice(0, 10)}.zip` };
    }
    case 'export-full': {
      if (active || starting || finishing || !session) throw new Error('Terminez la session avant l’export.');
      let segmentsToUse = (segments && segments.length > 0) ? [...segments] : [];
      if ((!segmentsToUse.length || (message.segments && message.segments.length > segmentsToUse.length)) && Array.isArray(message.segments) && message.segments.length) {
        segmentsToUse = [...message.segments];
        segments = [...message.segments];
      }
      if (!segmentsToUse.length && globalThis.chrome?.storage?.session) {
        try {
          const stored = await chrome.storage.session.get('liveSegments');
          if (stored?.liveSegments && stored.liveSegments.length) {
            segmentsToUse = [...stored.liveSegments];
            segments = [...stored.liveSegments];
          }
        } catch {}
      }
      if (!segmentsToUse.length) {
        try {
          const dbSegments = await all('segments');
          if (dbSegments && dbSegments.length) {
            segmentsToUse = [...dbSegments];
            segments = [...dbSegments];
          }
        } catch {}
      }

      if (sessionRecordingJob) {
        await stopSessionRecording().catch(() => {});
      }
      const fullClip = clips.find(c => c.isFullSession && c.blob) || clips.find(c => c.blob);
      const videoOffsetMs = fullClip?.sessionStartMs || 0;
      const srtContent = generateSrtFromSegments(segmentsToUse, videoOffsetMs);
      const txtContent = generateFormattedTranscript(session, segmentsToUse);
      const unifiedBlob = fullClip ? fullClip.blob : (clips.length > 0 && clips[0].blob ? new Blob(clips.map(c => c.blob).filter(Boolean), { type: clips[0].mimeType || 'video/webm' }) : null);

      let videoBlobUrl = null;
      if (unifiedBlob) {
        videoBlobUrl = URL.createObjectURL(unifiedBlob);
        objectUrls.add(videoBlobUrl);
      }

      let serverExport = null;
      const tokenToUse = message.token || sessionToken || 'clair-local-session-secret-token-2026';
      let exportId = null;

      if (unifiedBlob) {
        try {
          const metaRes = await fetch('http://127.0.0.1:8787/api/export-meta', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${tokenToUse}`,
              'x-clair-token': tokenToUse,
            },
            body: JSON.stringify({
              token: tokenToUse,
              session,
              segments: segmentsToUse,
              srtContent,
              synthesisMode: message.synthesisMode || 'meeting',
            }),
          });
          if (metaRes.ok) {
            const metaJson = await metaRes.json();
            exportId = metaJson.exportId || null;
          }
        } catch (metaErr) {
          console.warn('[Export] Métadonnées serveur non enregistrées par /api/export-meta:', metaErr.message);
        }

        try {
          const headers = {
            'Authorization': `Bearer ${tokenToUse}`,
            'x-clair-token': tokenToUse,
            'x-clair-synthesis-mode': message.synthesisMode || 'meeting',
            'Content-Type': unifiedBlob.type || 'video/webm',
          };
          if (exportId) {
            headers['x-clair-export-id'] = exportId;
          } else {
            try {
              headers['x-clair-session'] = btoa(unescape(encodeURIComponent(JSON.stringify(session))));
              headers['x-clair-segments'] = btoa(unescape(encodeURIComponent(JSON.stringify(segmentsToUse))));
              headers['x-clair-srt'] = btoa(unescape(encodeURIComponent(srtContent || '')));
            } catch {}
          }
          const uploadUrl = exportId
            ? `http://127.0.0.1:8787/api/export-full?exportId=${encodeURIComponent(exportId)}`
            : 'http://127.0.0.1:8787/api/export-full';

          const response = await fetch(uploadUrl, {
            method: 'POST',
            headers,
            body: unifiedBlob,
          });
          if (response.ok) {
            serverExport = await response.json();
          } else {
            console.warn('[Export] Réponse serveur non-OK:', response.status);
          }
        } catch (fetchErr) {
          console.warn('[Export] Erreur upload direct serveur:', fetchErr.message);
        }
      }

      return {
        ok: true,
        session,
        segments: segmentsToUse,
        srtContent,
        txtContent,
        videoBlobUrl,
        video: serverExport?.video || null,
        synthesis: serverExport?.synthesis || null,
      };
    }
    case 'get-transcript': {
      let segmentsToUse = (segments && segments.length > 0) ? [...segments] : [];
      if (!segmentsToUse.length && globalThis.chrome?.storage?.session) {
        try {
          const stored = await chrome.storage.session.get('liveSegments');
          if (stored?.liveSegments && stored.liveSegments.length) segmentsToUse = stored.liveSegments;
        } catch {}
      }
      if (!segmentsToUse.length) {
        try {
          const dbSegments = await all('segments');
          if (dbSegments && dbSegments.length) segmentsToUse = dbSegments;
        } catch {}
      }
      const fullClip = clips.find(c => c.isFullSession && c.blob) || clips.find(c => c.blob);
      const srtContent = generateSrtFromSegments(segmentsToUse, fullClip?.sessionStartMs || 0);
      const txtContent = generateFormattedTranscript(session, segmentsToUse);
      return { ok: true, srtContent, txtContent, session, segments: segmentsToUse };
    }
    case 'revoke': if (objectUrls.delete(message.url)) URL.revokeObjectURL(message.url); return { ok: true };
    case 'reset':
    case 'delete':
      if (active || starting || finishing) throw new Error('Terminez la session avant de supprimer les donnees.');
      await clearSession(); session = null; segments = []; clips = []; incidents = []; origin = 0; adapter = '';
      for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear(); publish(); return { ok: true };
    default: throw new Error('Commande inconnue.');
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target !== 'offscreen' || sender.id !== chrome.runtime.id || sender.tab) return;
  command(message).then(reply, error => reply({ ok: false, error: error?.message || 'Erreur interne de capture.' }));
  return true;
});

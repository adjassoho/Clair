const $ = id => document.getElementById(id);
let state = {};
let following = true;
let busy = false;
let savedToken = '';
let discreteMode = false;
let localSessionActive = false;
let localOriginEpochMs = 0;

const time = ms => new Date(Math.max(0, ms)).toISOString().slice(11, 19);

let timerInterval = null;

function startLocalTimer(originEpochMs) {
  localSessionActive = true;
  localOriginEpochMs = originEpochMs || Date.now();
  updateDuration();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (localSessionActive && localOriginEpochMs > 0) {
      updateDuration();
    }
  }, 250);
}

function stopLocalTimer(finalDurationMs) {
  localSessionActive = false;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (finalDurationMs !== undefined) {
    const el = $('duration');
    if (el) el.textContent = time(finalDurationMs);
  }
}
async function send(type, data = {}) {
  if (!globalThis.chrome?.runtime?.sendMessage) return { ok: true };
  const result = await chrome.runtime.sendMessage({ target: 'worker', type, ...data });
  if (!result?.ok) throw new Error(result?.error || 'Extension indisponible.');
  return result;
}
function error(message) {
  const errorEl = $('error');
  if (!errorEl) return;
  if (!message) {
    errorEl.hidden = true;
    errorEl.textContent = '';
    return;
  }
  errorEl.hidden = false;
  if (message.includes('session precedente') || message.includes('precedente')) {
    errorEl.innerHTML = `<span>${message}</span> <button id="btn-quick-reset" type="button" style="margin-top: 8px; display: inline-block; padding: 4px 10px; font-size: 11px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Réinitialiser maintenant</button>`;
    $('btn-quick-reset')?.addEventListener('click', async () => {
      await run('reset');
      error('');
    });
  } else {
    errorEl.textContent = message;
  }
}
let activeInterimText = '';
function renderInterim(text) {
  activeInterimText = (text || '').trim();
  const list = $('transcript');
  if (!list) return;
  let item = $('interim-item');
  if (!activeInterimText) {
    if (item) item.remove();
    if (!state.segments?.length) $('empty').hidden = false;
    return;
  }
  if (!item) {
    item = document.createElement('li');
    item.id = 'interim-item';
    item.className = 'interim-item';
    const meta = document.createElement('div'); meta.className = 'meta';
    const badge = document.createElement('strong'); badge.className = 'live-badge';
    badge.innerHTML = '<span class="live-dot"></span> En direct';
    const stamp = document.createElement('time'); stamp.id = 'interim-time'; stamp.textContent = time(localSessionActive && localOriginEpochMs > 0 ? Date.now() - localOriginEpochMs : (state.durationMs || 0));
    const p = document.createElement('p'); p.id = 'interim-text';
    meta.append(badge, stamp); item.append(meta, p); list.append(item);
  }
  const p = item.querySelector('#interim-text');
  if (p) p.textContent = activeInterimText;
  const timeEl = item.querySelector('#interim-time');
  if (timeEl) timeEl.textContent = time(localSessionActive && localOriginEpochMs > 0 ? Date.now() - localOriginEpochMs : (state.durationMs || 0));
  $('empty').hidden = true;
  if (following) list.scrollTop = list.scrollHeight;
}

function updateDuration() {
  const el = $('duration');
  if (!el) return;
  if (localSessionActive && localOriginEpochMs > 0) {
    el.textContent = time(Date.now() - localOriginEpochMs);
    return;
  }
  const origin = state.sessionOriginEpochMs || (state.session?.startedAt ? new Date(state.session.startedAt).getTime() : 0);
  const isRunning = Boolean(state.active || state.recording || (state.session && state.session.status === 'active'));
  if (isRunning && origin > 0) {
    el.textContent = time(Date.now() - origin);
  } else if (state.session?.durationMs || state.durationMs) {
    el.textContent = time(state.session?.durationMs || state.durationMs || 0);
  }
}

function render(next) {
  state = { ...state, ...next };
  $('setup').hidden = !!state.active || !!state.session;
  $('session-actions').hidden = !state.active;
  $('results').hidden = !state.session || !!state.active;
  $('status').textContent = state.finishing ? 'Finalisation' : state.recording ? 'Enregistrement actif' : state.active ? 'Transcription active' : state.session ? (state.session.status === 'complete' ? 'Session terminee' : 'Session incomplete') : 'Pret';
  updateDuration();
  if (typeof state.audioLevel === 'number') {
    const active = state.audioLevel > .0005;
    const el = $('signal');
    if (el) {
      el.textContent = active ? 'Audio actif ●' : 'Silence';
      el.style.color = active ? '#10b981' : '';
    }
  }
  if (state.active) {
    if (!localSessionActive) {
      startLocalTimer(state.sessionOriginEpochMs || (state.session?.startedAt ? new Date(state.session.startedAt).getTime() : Date.now()));
    }
  } else if (!state.finishing) {
    if (localSessionActive) {
      stopLocalTimer(state.session?.durationMs);
    }
  }
  $('clip-count').textContent = `${state.clipCount || 0} extrait(s)`;
  $('record').disabled = busy || !state.hasPreview || !!state.recording || !!state.finishing;
  $('stop-clip').disabled = busy || !state.recording;
  $('select').disabled = busy || !!state.finishing;
  $('finish').disabled = busy || !!state.finishing;
  if (state.adapter) $('adapter').textContent = state.adapter;
  if ($('discrete-banner')) $('discrete-banner').hidden = !discreteMode || !state.active;
  if (!state.hasPreview) $('preview').hidden = true;
  renderTranscript();
}

let lastRenderedKey = '';
function renderTranscript() {
  if (!state.segments) return;
  const currentKey = `${state.segments.length}:${state.segments.map(s => `${s.id}_${s.status}_${s.translatedText || s.sourceText}`).join(';')}:${activeInterimText}`;
  if (currentKey === lastRenderedKey) return;
  lastRenderedKey = currentKey;

  const list = $('transcript');
  if (!list) return;
  list.replaceChildren();
  for (const segment of [...state.segments].sort((a, b) => a.startMs - b.startMs)) {
    const item = document.createElement('li');
    if (segment.status === 'provisional') item.className = 'provisional-item';
    const meta = document.createElement('div'); meta.className = 'meta';
    const name = document.createElement('strong');
    name.textContent = segment.speakerName || (segment.status === 'provisional' ? 'En cours de traduction...' : 'Intervenant');
    const stamp = document.createElement('time'); stamp.textContent = time(segment.startMs);
    const text = document.createElement('p'); text.textContent = segment.translatedText || segment.sourceText || '[Traduction indisponible]';
    meta.append(name, stamp); item.append(meta, text); list.append(item);
  }
  if (activeInterimText) {
    const item = document.createElement('li');
    item.id = 'interim-item';
    item.className = 'interim-item';
    const meta = document.createElement('div'); meta.className = 'meta';
    const badge = document.createElement('strong'); badge.className = 'live-badge';
    badge.innerHTML = '<span class="live-dot"></span> En direct';
    const stamp = document.createElement('time'); stamp.id = 'interim-time'; stamp.textContent = time(state.durationMs || 0);
    const p = document.createElement('p'); p.id = 'interim-text'; p.textContent = activeInterimText;
    meta.append(badge, stamp); item.append(meta, p); list.append(item);
  }
  $('empty').hidden = state.segments.length > 0 || Boolean(activeInterimText);
  if (following) list.scrollTop = list.scrollHeight;
}
async function run(type, data = {}) {
  if (busy) {
    console.warn('[Panel] Déblocage forcé état occupé');
    busy = false;
  }
  busy = true; error(''); render({});
  const timeoutId = setTimeout(() => {
    if (busy) {
      console.warn('[Panel] Timeout commande expirée:', type);
      busy = false;
      render({});
    }
  }, 7000);
  try {
    const result = await send(type, data);
    if (result.preview) { $('preview').src = result.preview; $('preview').hidden = false; }
    if (result?.url) {
      if (globalThis.chrome?.downloads?.download) {
        chrome.downloads.download({ url: result.url, filename: result.filename || 'clair-session.zip', saveAs: true });
      } else {
        const link = document.createElement('a');
        link.href = result.url;
        link.download = result.filename || 'clair-session.zip';
        document.body.append(link);
        link.click();
        link.remove();
      }
    }
    render(await send('status'));
    return result;
  } catch (err) {
    error(err.message);
    try { render(await send('status')); } catch {}
  }
  finally {
    clearTimeout(timeoutId);
    busy = false;
    render({});
  }
}

function downloadFile(url, filename) {
  if (globalThis.chrome?.downloads?.download) {
    chrome.downloads.download({ url, filename, saveAs: false });
  } else {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
  }
}

async function downloadFullVideo() {
  const statusEl = $('export-status');
  if (statusEl) {
    statusEl.hidden = false;
    statusEl.textContent = 'Préparation et transcodage de la vidéo complète MP4...';
  }
  try {
    const token = savedToken || $('token')?.value || localStorage.getItem('clair_token') || defaultToken;
    const data = await send('export-full', {
      token,
      synthesisMode: $('synthesis-mode')?.value || 'meeting',
      segments: (state.segments && state.segments.length) ? state.segments : undefined,
    });

    if (data.video?.downloadUrl) {
      downloadFile(`http://127.0.0.1:8787${data.video.downloadUrl}`, data.video.filename);
      if (statusEl) {
        statusEl.innerHTML = `<strong>Succès !</strong> Vidéo complète <strong>${(data.video.format || 'MP4').toUpperCase()}</strong> avec sous-titres téléchargée.`;
      }
      return;
    }

    // Repli direct si le serveur n'a pas pu transcoder ou n'a pas fourni de vidéo MP4
    if (data.videoBlobUrl) {
      const dateTag = data.session?.startedAt ? data.session.startedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
      downloadFile(data.videoBlobUrl, `clair-seance-${dateTag}.webm`);
      if (data.srtContent) {
        const srtBlob = new Blob([data.srtContent], { type: 'text/plain;charset=utf-8' });
        downloadFile(URL.createObjectURL(srtBlob), `sous-titres-${dateTag}.srt`);
      }
      if (statusEl) {
        statusEl.innerHTML = `<strong>Téléchargement direct prêt !</strong> Fichier vidéo et sous-titres .SRT téléchargés.`;
      }
    } else {
      if (statusEl) statusEl.textContent = 'Aucun flux vidéo disponible pour cette session.';
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = `Erreur : ${err.message}`;
    error(err.message);
  }
}

async function downloadTranscriptTxt() {
  const statusEl = $('export-status');
  try {
    const data = await send('get-transcript');
    const dateTag = data.session?.startedAt ? data.session.startedAt.slice(0, 10) : 'seance';
    const blob = new Blob([data.txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    downloadFile(url, `transcription-clair-${dateTag}.txt`);
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.innerHTML = `<strong>Téléchargement réussi :</strong> Fichier texte de transcription enregistré.`;
    }
  } catch (err) {
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = `Erreur transcription : ${err.message}`;
    }
    error(err.message);
  }
}

async function downloadTranscriptSrt() {
  const statusEl = $('export-status');
  try {
    const data = await send('get-transcript');
    const dateTag = data.session?.startedAt ? data.session.startedAt.slice(0, 10) : 'seance';
    const blob = new Blob([data.srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    downloadFile(url, `sous-titres-clair-${dateTag}.srt`);
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.innerHTML = `<strong>Téléchargement réussi :</strong> Fichier de sous-titres .SRT enregistré.`;
    }
  } catch (err) {
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = `Erreur sous-titres : ${err.message}`;
    }
    error(err.message);
  }
}

$('toggle-discrete')?.addEventListener('click', async () => {
  discreteMode = !discreteMode;
  document.querySelector('main')?.classList.toggle('discrete-mode', discreteMode);
  $('toggle-discrete')?.classList.toggle('active', discreteMode);
  $('toggle-discrete').textContent = discreteMode ? 'Mode Normal' : 'Mode Discret';
  if ($('discrete-banner')) $('discrete-banner').hidden = !discreteMode || !state.active;

  // Activer ou désactiver l'incrustation directe de sous-titres sur Teams
  send('set-discrete-mode', { enabled: discreteMode }).catch(() => {});
});

$('download-full-video')?.addEventListener('click', downloadFullVideo);
$('download-transcript-txt')?.addEventListener('click', downloadTranscriptTxt);
$('download-transcript-srt')?.addEventListener('click', downloadTranscriptSrt);

const defaultToken = 'clair-local-session-secret-token-2026';
if ($('token') && !$('token').value) {
  $('token').value = localStorage.getItem('clair_token') || defaultToken;
}

$('setup').addEventListener('submit', async event => {
  event.preventDefault();
  $('start').disabled = true;
  savedToken = $('token').value || localStorage.getItem('clair_token') || defaultToken;
  localStorage.setItem('clair_token', savedToken);
  startLocalTimer(Date.now());
  let micAllowed = $('enable-mic')?.checked !== false;
  if (micAllowed && navigator.mediaDevices?.getUserMedia) {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach(track => track.stop());
    } catch {
      micAllowed = false;
    }
  }
  const started = await run('start', {
    token: savedToken,
    mode: $('mode').value,
    consent: $('consent').checked,
    enableMic: micAllowed,
  });
  if (started?.sessionOriginEpochMs) {
    localOriginEpochMs = started.sessionOriginEpochMs;
  }
  $('start').disabled = false;
  if (discreteMode) {
    send('set-discrete-mode', { enabled: true }).catch(() => {});
  }
});
for (const type of ['select', 'record', 'export']) $(type)?.addEventListener('click', () => run(type));

$('stop-clip')?.addEventListener('click', async () => {
  if (state.recording) {
    await run('stop-clip');
  } else {
    // Si l'utilisateur clique sur arrêter alors qu'aucun extrait partiel n'est actif, arrêter la session entière
    $('finish')?.click();
  }
});

$('finish')?.addEventListener('click', async () => {
  $('finish').disabled = true;
  $('finish').textContent = '⏹️ Arrêt en cours...';
  try {
    stopLocalTimer();
    await run('finish');
    stopLocalTimer(state.session?.durationMs);
  } finally {
    $('finish').textContent = "⏹️ Arrêter l'enregistrement et terminer la réunion";
  }
});

$('reload-extension')?.addEventListener('click', async () => {
  try {
    stopLocalTimer(0);
    await run('reset');
  } catch {}
  try { chrome.runtime?.reload?.(); } catch {}
  window.location.reload();
});

$('delete')?.addEventListener('click', () => {
  if (confirm('Supprimer definitivement le texte et les enregistrements locaux ? Exportez-les auparavant.')) {
    stopLocalTimer(0);
    run('delete');
  }
});

$('reset-session')?.addEventListener('click', async () => {
  if (confirm('Voulez-vous réinitialiser et démarrer une session propre ?')) {
    stopLocalTimer(0);
    await run('reset');
    error('');
    window.location.reload();
  }
});
$('mode').addEventListener('change', () => {
  $('mode-help').textContent = $('mode').value === 'audio'
    ? "Audio direct : transcription et traduction française instantanées en temps réel."
    : "Sous-titres Teams : vous devez impérativement activer les sous-titres en direct dans Teams (Menu ... > Langue et parole > Activer les sous-titres en direct).";
});
$('transcript').addEventListener('wheel', () => { following = false; });
$('transcript').addEventListener('touchmove', () => { following = false; });
$('follow').addEventListener('click', () => { following = true; $('transcript').scrollTop = $('transcript').scrollHeight; });

// Restaurer l'état du mode discret depuis le stockage de session
try {
  chrome.storage?.session?.get('discreteMode').then(res => {
    if (res?.discreteMode) {
      discreteMode = true;
      document.querySelector('main')?.classList.toggle('discrete-mode', true);
      $('toggle-discrete')?.classList.toggle('active', true);
      if ($('toggle-discrete')) $('toggle-discrete').textContent = 'Mode Normal';
      if ($('discrete-banner')) $('discrete-banner').hidden = !state.active;
    }
  }).catch(() => {});
} catch {}

// Synchronisation réactive sécurisée avec chrome.storage (segments en direct et chrono)
try {
  if (globalThis.chrome?.storage?.session) {
    chrome.storage.session.get(['liveSegments', 'liveInterimText', 'sessionOriginEpochMs', 'sessionActive', 'sessionDurationMs']).then(res => {
      if (res?.sessionActive) {
        state.active = true;
        startLocalTimer(res.sessionOriginEpochMs || Date.now());
      } else if (res?.sessionDurationMs) {
        stopLocalTimer(res.sessionDurationMs);
      }
      if (res?.liveSegments && res.liveSegments.length) {
        state.segments = res.liveSegments;
        renderTranscript();
      }
      if (res?.liveInterimText) {
        renderInterim(res.liveInterimText);
      }
    }).catch(() => {});
  }

  if (globalThis.chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'session') {
        if (changes.liveSegments) {
          state.segments = changes.liveSegments.newValue || [];
          renderTranscript();
        }
        if (changes.liveInterimText) {
          renderInterim(changes.liveInterimText.newValue || '');
        }
        if (changes.sessionOriginEpochMs) {
          localOriginEpochMs = changes.sessionOriginEpochMs.newValue;
        }
        if (changes.sessionActive) {
          state.active = Boolean(changes.sessionActive.newValue);
          if (state.active) {
            startLocalTimer(localOriginEpochMs || Date.now());
          } else {
            stopLocalTimer();
          }
        }
      }
    });
  }
} catch (e) {
  console.warn('Storage sync init error:', e);
}

// Réception directe des messages depuis offscreen et worker
if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(message => {
    if (message.target !== 'panel') return;
    if (message.type === 'state') render(message.state);
    if (message.type === 'segment' && message.segment) {
      if (!state.segments) state.segments = [];
      const idx = state.segments.findIndex(s => s.id === message.segment.id);
      if (idx >= 0) state.segments[idx] = message.segment;
      else state.segments.push(message.segment);
      activeInterimText = '';
      state.active = true;
      renderTranscript();
    }
    if (message.type === 'interim') renderInterim(message.text);
    if (message.type === 'error') error(message.message);
    if (message.type === 'level') {
      const active = message.level > .0005;
      const el = $('signal');
      if (el) {
        el.textContent = active ? 'Audio actif ●' : 'Silence';
        el.style.color = active ? '#10b981' : '';
      }
    }
  });
}

send('status').then((state) => {
  error('');
  render(state);
}).catch(err => {
  console.warn('[Panel] Statut initial en cours d’initialisation:', err.message);
});
setInterval(() => {
  updateDuration();
}, 250);
setInterval(() => {
  if (!busy) {
    send('status')
      .then(render)
      .catch(() => {});
  }
}, 2000);

const $ = id => document.getElementById(id);
let state = {};
let following = true;
let busy = false;
let savedToken = '';
let discreteMode = false;
let localSessionActive = false;
let localOriginEpochMs = 0;
let currentLang = 'fr';

const time = ms => new Date(Math.max(0, ms)).toISOString().slice(11, 19);

let timerInterval = null;

const I18N = {
  fr: {
    // Header & buttons
    newSession: 'Nouvelle session',
    reload: '🔄 Recharger',
    discreteTitle: 'Activer / désactiver le mode discret',
    discreteOn: 'Mode Normal',
    discreteOff: 'Mode Discret',

    // Intro
    eyebrow: 'COMPRENDRE. CONSERVER.',
    title: 'Votre reunion,<br>en francais.',
    subtitle: 'Les paroles et les demonstrations, sur une meme ligne de temps.',

    // Status bar & signals
    statusReady: 'Pret',
    statusActive: 'Transcription active',
    statusRecording: 'Enregistrement actif',
    statusFinishing: 'Finalisation',
    statusComplete: 'Session terminee',
    statusIncomplete: 'Session incomplete',
    discreteBanner: 'Enregistrement discret en cours...',
    signalActive: 'Audio actif ●',
    signalSilence: 'Silence',
    signalDefault: 'Audio : --',

    // Setup Form
    labelMode: 'Source de transcription',
    modeAudio: 'Audio direct haute fidélité (Recommandé)',
    modeCaptions: 'Sous-titres natifs Teams (expérimental)',
    labelMic: 'Capturer aussi ma voix (Microphone local)',
    modeHelpAudio: 'Audio direct : transcription et traduction française instantanées en temps réel.',
    modeHelpCaptions: 'Sous-titres Teams : vous devez impérativement activer les sous-titres en direct dans Teams (Menu ... > Langue et parole > Activer les sous-titres en direct).',
    labelSynthesis: 'Type de synthèse attendue',
    synthCourse: 'Fiche de cours approfondie (Concepts, Q&R, Définitions, Devoirs)',
    synthMeeting: 'Compte-rendu exécutif de réunion (Décisions, Actions, Synthèse)',
    langSource: 'Anglais',
    langSourceSub: 'LANGUE PARLEE',
    langTarget: 'Francais',
    langTargetSub: 'TRADUCTION',
    labelToken: 'Jeton du service local',
    hintToken: 'Service : 127.0.0.1:8787. Jeton utilise en memoire uniquement.',
    consent: "J'ai informé les participants et dispose des autorisations nécessaires. Le flux audio et texte est traité de manière sécurisée et chiffrée par le service Clair. La vidéo reste locale.",
    start: 'Demarrer la session',

    // Active session card
    activeTitle: "Séance en cours d'enregistrement",
    activeSubtitle: 'Vidéo de la réunion et transcription en direct actives',
    finish: "⏹️ Arrêter l'enregistrement et terminer la réunion",
    stoppingSession: '⏹️ Arrêt en cours...',

    // Crop / Select section
    cropSummary: 'Recadrer une zone spécifique (Optionnel)',
    cropHint: "Par défaut, l'écran entier de la réunion est enregistré. Vous pouvez encadrer une zone précise si vous le désirez.",
    select: 'Encadrer une zone',
    record: 'Enregistrer la zone',
    stopClip: 'Arrêter le recadrage',
    clipCount: (n) => `${n} extrait(s)`,
    adapterWaiting: 'Adaptateur en attente.',

    // Results section
    resultsTitle: 'Votre session est terminée',
    resultsHint: 'Téléchargez votre enregistrement complet ou vos transcriptions :',
    cardVideoTitle: 'Vidéo complète de la séance',
    cardVideoDesc: 'Vidéo intégrale de la réunion avec la transcription sous forme de sous-titres intégrés et synchronisés.',
    downloadVideo: 'Télécharger la vidéo complète (MP4)',
    cardTranscriptTitle: 'Transcriptions de la séance',
    cardTranscriptDesc: 'Texte complet et horodaté des échanges avec noms des intervenants et traduction française.',
    downloadTxt: 'Télécharger la transcription (.TXT)',
    downloadSrt: 'Sous-titres (.SRT)',
    delete: 'Nouvelle session / Supprimer les données locales',

    // Transcript feed
    transcriptTitle: 'Le fil de la reunion',
    follow: 'Suivre le direct',
    emptyTranscript: 'Les interventions apparaitront ici.<br>Aucun contenu de demonstration n\'est injecte.',
    liveBadge: 'En direct',
    provisionalTranslating: 'En cours de traduction...',
    speakerDefault: 'Intervenant',
    translationUnavailable: '[Traduction indisponible]',
    footer: 'Installation pilote. Noms et synchronisation Teams a valider en reunion reelle. Microphone local non capture.',

    // Dialogs & Export status
    resetConfirm: 'Voulez-vous réinitialiser et démarrer une session propre ?',
    deleteConfirm: 'Supprimer definitivement le texte et les enregistrements locaux ? Exportez-les auparavant.',
    exportPrepVideo: 'Préparation et transcodage de la vidéo complète MP4...',
    exportSuccessVideo: '<strong>Succès !</strong> Vidéo complète <strong>MP4</strong> avec sous-titres téléchargée.',
    exportSuccessDirect: '<strong>Téléchargement direct prêt !</strong> Fichier vidéo et sous-titres .SRT téléchargés.',
    exportNoVideo: 'Aucun flux vidéo disponible pour cette session.',
    exportSuccessTxt: '<strong>Téléchargement réussi :</strong> Fichier texte de transcription enregistré.',
    exportSuccessSrt: '<strong>Téléchargement réussi :</strong> Fichier de sous-titres .SRT enregistré.',
  },
  en: {
    // Header & buttons
    newSession: 'New session',
    reload: '🔄 Reload',
    discreteTitle: 'Toggle discrete mode on / off',
    discreteOn: 'Normal Mode',
    discreteOff: 'Discrete Mode',

    // Intro
    eyebrow: 'UNDERSTAND. PRESERVE.',
    title: 'Your meeting,<br>in French.',
    subtitle: 'Speech and visuals, synchronized on a single timeline.',

    // Status bar & signals
    statusReady: 'Ready',
    statusActive: 'Live transcription',
    statusRecording: 'Recording active',
    statusFinishing: 'Finalizing',
    statusComplete: 'Session completed',
    statusIncomplete: 'Session incomplete',
    discreteBanner: 'Discrete recording in progress...',
    signalActive: 'Audio active ●',
    signalSilence: 'Silence',
    signalDefault: 'Audio: --',

    // Setup Form
    labelMode: 'Transcription source',
    modeAudio: 'High-fidelity direct audio (Recommended)',
    modeCaptions: 'Teams native captions (experimental)',
    labelMic: 'Capture my voice too (Local microphone)',
    modeHelpAudio: 'Direct audio: instant real-time transcription and French translation.',
    modeHelpCaptions: 'Teams captions: you must turn on live captions in Teams (Menu ... > Language and speech > Turn on live captions).',
    labelSynthesis: 'Summary format',
    synthCourse: 'In-depth lecture notes (Concepts, Q&A, Definitions, Assignments)',
    synthMeeting: 'Executive meeting summary (Decisions, Action items, Synthesis)',
    langSource: 'English',
    langSourceSub: 'SPOKEN LANGUAGE',
    langTarget: 'French',
    langTargetSub: 'TRANSLATION',
    labelToken: 'Local service token',
    hintToken: 'Service: 127.0.0.1:8787. In-memory token only.',
    consent: 'I have informed participants and obtained necessary permissions. Audio and text streams are securely processed and encrypted by Clair. Video remains local.',
    start: 'Start session',

    // Active session card
    activeTitle: 'Meeting recording in progress',
    activeSubtitle: 'Meeting video and live transcription are active',
    finish: '⏹️ Stop recording and end meeting',
    stoppingSession: '⏹️ Stopping...',

    // Crop / Select section
    cropSummary: 'Crop a specific area (Optional)',
    cropHint: 'By default, the entire meeting screen is recorded. You can frame a specific area if desired.',
    select: 'Select area',
    record: 'Record area',
    stopClip: 'Stop cropping',
    clipCount: (n) => `${n} clip(s)`,
    adapterWaiting: 'Adapter waiting.',

    // Results section
    resultsTitle: 'Your session is complete',
    resultsHint: 'Download your full recording or transcripts:',
    cardVideoTitle: 'Full meeting video',
    cardVideoDesc: 'Complete meeting video with synchronized embedded subtitles from the live transcript.',
    downloadVideo: 'Download full video (MP4)',
    cardTranscriptTitle: 'Meeting transcripts',
    cardTranscriptDesc: 'Full timestamped transcript of conversations with speaker names and French translation.',
    downloadTxt: 'Download transcript (.TXT)',
    downloadSrt: 'Subtitles (.SRT)',
    delete: 'New session / Clear local data',

    // Transcript feed
    transcriptTitle: 'Live meeting feed',
    follow: 'Follow live',
    emptyTranscript: 'Speech segments will appear here.<br>No mock content is injected.',
    liveBadge: 'Live',
    provisionalTranslating: 'Translating...',
    speakerDefault: 'Speaker',
    translationUnavailable: '[Translation unavailable]',
    footer: 'Pilot setup. Teams names and synchronization to be validated in real meetings. Local mic optional.',

    // Dialogs & Export status
    resetConfirm: 'Do you want to reset and start a clean session?',
    deleteConfirm: 'Permanently delete text and local recordings? Please export them first.',
    exportPrepVideo: 'Preparing and transcoding full MP4 video...',
    exportSuccessVideo: '<strong>Success!</strong> Full <strong>MP4</strong> video with subtitles downloaded.',
    exportSuccessDirect: '<strong>Direct download ready!</strong> Video and .SRT subtitle files downloaded.',
    exportNoVideo: 'No video stream available for this session.',
    exportSuccessTxt: '<strong>Download complete:</strong> Transcript text file saved.',
    exportSuccessSrt: '<strong>Download complete:</strong> .SRT subtitle file saved.',
  }
};

function t(key, ...args) {
  const dict = I18N[currentLang] || I18N.fr;
  const val = dict[key] ?? I18N.fr[key] ?? '';
  if (typeof val === 'function') return val(...args);
  return val;
}

function setLanguage(lang) {
  if (lang !== 'fr' && lang !== 'en') lang = 'fr';
  currentLang = lang;
  document.documentElement.lang = lang;

  try {
    localStorage.setItem('clair_ui_lang', lang);
    if (globalThis.chrome?.storage?.session) {
      chrome.storage.session.set({ uiLang: lang }).catch(() => {});
    }
  } catch {}

  $('lang-fr')?.classList.toggle('active', lang === 'fr');
  $('lang-en')?.classList.toggle('active', lang === 'en');
  $('lang-fr')?.setAttribute('aria-pressed', String(lang === 'fr'));
  $('lang-en')?.setAttribute('aria-pressed', String(lang === 'en'));

  // Mise à jour de tous les éléments statiques data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (val) {
      if (val.includes('<')) {
        el.innerHTML = val;
      } else {
        el.textContent = val;
      }
    }
  });

  // Mise à jour du bouton mode discret
  const toggleBtn = $('toggle-discrete');
  if (toggleBtn) {
    toggleBtn.textContent = discreteMode ? t('discreteOn') : t('discreteOff');
    toggleBtn.title = t('discreteTitle');
  }

  // Mise à jour de l'aide sur le mode
  const modeVal = $('mode')?.value;
  const helpEl = $('mode-help');
  if (helpEl) {
    helpEl.textContent = modeVal === 'audio' ? t('modeHelpAudio') : t('modeHelpCaptions');
  }

  // Actualisation du statut et du transcript
  renderStatus();
  lastRenderedKey = '';
  renderTranscript();
}

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
    badge.innerHTML = `<span class="live-dot"></span> ${t('liveBadge')}`;
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

function renderStatus() {
  const statusEl = $('status');
  if (!statusEl) return;
  const statusText = state.finishing
    ? t('statusFinishing')
    : state.recording
      ? t('statusRecording')
      : state.active
        ? t('statusActive')
        : state.session
          ? (state.session.status === 'complete' ? t('statusComplete') : t('statusIncomplete'))
          : t('statusReady');
  statusEl.textContent = statusText;
}

function render(next) {
  state = { ...state, ...next };
  $('setup').hidden = !!state.active || !!state.session;
  $('session-actions').hidden = !state.active;
  $('results').hidden = !state.session || !!state.active;
  
  renderStatus();
  updateDuration();

  if (typeof state.audioLevel === 'number') {
    const active = state.audioLevel > .0005;
    const el = $('signal');
    if (el) {
      el.textContent = active ? t('signalActive') : t('signalSilence');
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

  $('clip-count').textContent = t('clipCount', state.clipCount || 0);
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
  const currentKey = `${currentLang}:${state.segments.length}:${state.segments.map(s => `${s.id}_${s.status}_${s.translatedText || s.sourceText}`).join(';')}:${activeInterimText}`;
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
    name.textContent = segment.speakerName || (segment.status === 'provisional' ? t('provisionalTranslating') : t('speakerDefault'));
    const stamp = document.createElement('time');
    stamp.textContent = time(segment.startMs);
    const displayText = (segment.translatedText && !segment.translatedText.startsWith('[Traduction'))
      ? segment.translatedText
      : (segment.sourceText || segment.translatedText || t('translationUnavailable'));
    const text = document.createElement('p'); text.textContent = displayText;
    meta.append(name, stamp); item.append(meta, text); list.append(item);
  }
  if (activeInterimText) {
    const item = document.createElement('li');
    item.id = 'interim-item';
    item.className = 'interim-item';
    const meta = document.createElement('div'); meta.className = 'meta';
    const badge = document.createElement('strong'); badge.className = 'live-badge';
    badge.innerHTML = `<span class="live-dot"></span> ${t('liveBadge')}`;
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
  try {
    if (globalThis.chrome?.downloads?.download) {
      chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          console.warn('[Download] Repli DOM download suite à erreur chrome.downloads:', chrome.runtime.lastError?.message);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          document.body.append(link);
          link.click();
          link.remove();
        }
      });
      return;
    }
  } catch {}
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

async function downloadFullVideo() {
  const statusEl = $('export-status');
  if (statusEl) {
    statusEl.hidden = false;
    statusEl.innerHTML = `<span>⏳</span> ${t('exportPrepVideo')}`;
  }
  try {
    const token = savedToken || $('token')?.value || localStorage.getItem('clair_token') || defaultToken;
    const data = await send('export-full', {
      token,
      synthesisMode: $('synthesis-mode')?.value || 'meeting',
      segments: (state.segments && state.segments.length) ? state.segments : undefined,
    });

    if (data.video?.downloadUrl) {
      const downloadUrl = `http://127.0.0.1:8787${data.video.downloadUrl}`;
      downloadFile(downloadUrl, data.video.filename);
      if (statusEl) {
        statusEl.innerHTML = `<div>${t('exportSuccessVideo')}</div><div style="margin-top:8px;"><a href="${downloadUrl}" download="${data.video.filename}" style="display:inline-block; padding:5px 12px; background:#21c095; color:#0f1d19; font-weight:700; border-radius:6px; text-decoration:none; font-size:12px;">📥 ${data.video.filename}</a></div>`;
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
        statusEl.innerHTML = t('exportSuccessDirect');
      }
    } else {
      if (statusEl) statusEl.textContent = t('exportNoVideo');
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
      statusEl.innerHTML = t('exportSuccessTxt');
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
      statusEl.innerHTML = t('exportSuccessSrt');
    }
  } catch (err) {
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = `Erreur sous-titres : ${err.message}`;
    }
    error(err.message);
  }
}

// Initialiser les écouteurs de changement de langue
$('lang-fr')?.addEventListener('click', () => setLanguage('fr'));
$('lang-en')?.addEventListener('click', () => setLanguage('en'));

$('toggle-discrete')?.addEventListener('click', async () => {
  discreteMode = !discreteMode;
  document.querySelector('main')?.classList.toggle('discrete-mode', discreteMode);
  $('toggle-discrete')?.classList.toggle('active', discreteMode);
  $('toggle-discrete').textContent = discreteMode ? t('discreteOn') : t('discreteOff');
  if ($('discrete-banner')) $('discrete-banner').hidden = !discreteMode || !state.active;

  // Activer ou désactiver l'incrustation directe de sous-titres sur Teams
  send('set-discrete-mode', { enabled: discreteMode }).catch(() => {});

  if (discreteMode && window.location.protocol === 'chrome-extension:') {
    // Fermer le panneau latéral pour libérer tout l'espace d'écran
    setTimeout(() => {
      try {
        window.close();
      } catch {}
    }, 150);
  }
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
    if (window.location.protocol === 'chrome-extension:') {
      setTimeout(() => {
        try { window.close(); } catch {}
      }, 250);
    }
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
  $('finish').textContent = t('stoppingSession');
  try {
    stopLocalTimer();
    await run('finish');
    stopLocalTimer(state.session?.durationMs);
  } finally {
    $('finish').textContent = t('finish');
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
  if (confirm(t('deleteConfirm'))) {
    stopLocalTimer(0);
    run('delete');
  }
});

$('reset-session')?.addEventListener('click', async () => {
  if (confirm(t('resetConfirm'))) {
    stopLocalTimer(0);
    await run('reset');
    error('');
    window.location.reload();
  }
});

$('mode').addEventListener('change', () => {
  $('mode-help').textContent = $('mode').value === 'audio'
    ? t('modeHelpAudio')
    : t('modeHelpCaptions');
});

$('transcript').addEventListener('wheel', () => { following = false; });
$('transcript').addEventListener('touchmove', () => { following = false; });
$('follow').addEventListener('click', () => { following = true; $('transcript').scrollTop = $('transcript').scrollHeight; });

// Restaurer la préférence de langue et la synchroniser
try {
  const savedLang = localStorage.getItem('clair_ui_lang') || 'fr';
  setLanguage(savedLang);
} catch {
  setLanguage('fr');
}

// Restaurer l'état du mode discret depuis le stockage de session
try {
  chrome.storage?.session?.get(['discreteMode', 'uiLang']).then(res => {
    if (res?.uiLang && (res.uiLang === 'fr' || res.uiLang === 'en')) {
      setLanguage(res.uiLang);
    }
    if (res?.discreteMode) {
      discreteMode = true;
      document.querySelector('main')?.classList.toggle('discrete-mode', true);
      $('toggle-discrete')?.classList.toggle('active', true);
      if ($('toggle-discrete')) $('toggle-discrete').textContent = t('discreteOn');
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
        if (changes.uiLang) {
          setLanguage(changes.uiLang.newValue);
        }
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
        el.textContent = active ? t('signalActive') : t('signalSilence');
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

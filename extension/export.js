const encoder = new TextEncoder();
const ZIP_MAX = 0xffffffff;
const ZIP_COUNT_MAX = 0xffff;
const MIME_EXTENSIONS = new Map([['video/webm', 'webm'], ['video/mp4', 'mp4'], ['video/ogg', 'ogv']]);
const INCIDENT_MESSAGES = new Map([
  ['capture-interrupted', 'La capture a ete interrompue.'],
  ['recording-error', "Un extrait n'a pas pu etre finalise."],
  ['translation-error', "Une traduction n'a pas pu etre finalisee."],
  ['transcription-error', "Une transcription n'a pas pu etre finalisee."],
  ['speaker-unknown', "Un intervenant n'a pas pu etre identifie."],
  ['pause', 'La capture a ete mise en pause.'],
  ['other', 'Un incident a ete signale pendant la session.'],
]);

function requireValue(condition, message) {
  if (!condition) throw new TypeError(message);
}

function time(value, label) {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER,
    `${label} must be a finite, nonnegative, safe millisecond value`);
}

function interval(start, end, duration, label) {
  time(start, `${label}.start`);
  time(end, `${label}.end`);
  requireValue(end > start && end <= duration, `${label} must have start < end <= session duration`);
}

function identifier(value, seen, label) {
  requireValue(typeof value === 'string' && value.trim().length > 0, `${label} must have a nonempty string id`);
  requireValue(!seen.has(value), `Duplicate ${label} id: ${value}`);
  seen.add(value);
  return value;
}

function safeId(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'export';
}

/** Build a detached, allowlisted manifest. Recording timestamps must already be normalized. */
export function buildManifest(session, segments, clips, incidents = []) {
  requireValue(session && typeof session === 'object', 'session is required');
  identifier(session.id, new Set(), 'session');
  time(session.durationMs, 'session.durationMs');
  requireValue(typeof session.startedAt === 'string' && Number.isFinite(Date.parse(session.startedAt)), 'Invalid session.startedAt');
  requireValue(session.sourceLanguage === 'en' && session.targetLanguage === 'fr', 'Only en to fr exports are supported');
  requireValue(typeof session.status === 'string' && session.status.length > 0, 'session.status is required');
  requireValue(Array.isArray(segments) && Array.isArray(clips) && Array.isArray(incidents), 'segments, clips and incidents must be arrays');

  const speakerIds = new Map();
  const speakers = [];
  const segmentIds = new Set();
  const normalizedSegments = segments.map((segment) => {
    requireValue(segment && typeof segment === 'object', 'Invalid segment');
    const id = identifier(segment.id, segmentIds, 'segment');
    interval(segment.startMs, segment.endMs, session.durationMs, `segment ${id}`);
    requireValue(typeof segment.translatedText === 'string', `segment ${id} needs translatedText`);
    requireValue(['final', 'provisional', 'incomplete'].includes(segment.status), `Invalid segment ${id} status`);
    requireValue(['identified', 'unknown'].includes(segment.speakerStatus), `Invalid segment ${id} speakerStatus`);
    requireValue(segment.speakerName == null || typeof segment.speakerName === 'string', `Invalid segment ${id} speakerName`);
    const name = segment.speakerStatus === 'identified' && typeof segment.speakerName === 'string'
      ? segment.speakerName.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
      : null;
    let speakerId = null;
    if (name) {
      if (!speakerIds.has(name)) {
        const nextId = `speaker-${String(speakers.length + 1).padStart(3, '0')}`;
        speakerIds.set(name, nextId);
        speakers.push({ id: nextId, displayName: name });
      }
      speakerId = speakerIds.get(name);
    }
    return {
      id, startMs: segment.startMs, endMs: segment.endMs,
      speakerId, speakerStatus: speakerId ? 'identified' : 'unknown',
      translatedText: segment.translatedText, status: segment.status,
    };
  }).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const clipIds = new Set();
  const normalizedClips = clips.map((clip, index) => {
    requireValue(clip && typeof clip === 'object', 'Invalid clip');
    const id = identifier(clip.id, clipIds, 'clip');
    interval(clip.sessionStartMs, clip.sessionEndMs, session.durationMs, `clip ${id}`);
    time(clip.durationMs, `clip ${id}.durationMs`);
    // No rescaling or guessed pause offsets: a clip is a continuous, zero-origin recording.
    requireValue(clip.durationMs === clip.sessionEndMs - clip.sessionStartMs,
      `clip ${id} duration must exactly match its session interval; normalize the recording before export`);
    requireValue(Number.isSafeInteger(clip.width) && clip.width > 0 && Number.isSafeInteger(clip.height) && clip.height > 0,
      `Invalid clip ${id} dimensions`);
    requireValue(['complete', 'incomplete'].includes(clip.status), `Invalid clip ${id} status`);
    requireValue(clip.hasAudio === true, `clip ${id} must include original audio`);
    requireValue(typeof clip.mimeType === 'string', `Invalid clip ${id} MIME type`);
    const mimeType = clip.mimeType.split(';', 1)[0].trim().toLowerCase();
    requireValue(MIME_EXTENSIONS.has(mimeType), `Unsupported clip ${id} MIME type`);
    const basename = `clip-${String(index + 1).padStart(3, '0')}`;
    return {
      id, file: `videos/${basename}.${MIME_EXTENSIONS.get(mimeType)}`, mimeType,
      sessionStartMs: clip.sessionStartMs, sessionEndMs: clip.sessionEndMs,
      durationMs: clip.durationMs, width: clip.width, height: clip.height, hasAudio: true,
      subtitleFile: `sous-titres/${basename}.fr.srt`, status: clip.status,
    };
  });

  const mediaLinks = [];
  for (const segment of normalizedSegments) {
    for (const clip of normalizedClips) {
      const start = Math.max(segment.startMs, clip.sessionStartMs);
      const end = Math.min(segment.endMs, clip.sessionEndMs);
      if (start < end) mediaLinks.push({
        segmentId: segment.id, clipId: clip.id,
        sessionStartMs: start, sessionEndMs: end,
        mediaStartMs: start - clip.sessionStartMs, mediaEndMs: end - clip.sessionStartMs,
      });
    }
  }
  const normalizedIncidents = incidents.map((incident) => {
    requireValue(incident && typeof incident === 'object', 'Invalid incident');
    interval(incident.startMs, incident.endMs, session.durationMs, 'incident');
    const type = INCIDENT_MESSAGES.has(incident.type) ? incident.type : 'other';
    // Never copy provider errors, free-form messages, tokens, or arbitrary incident fields.
    return { type, startMs: incident.startMs, endMs: incident.endMs, message: INCIDENT_MESSAGES.get(type) };
  });
  const complete = session.status === 'complete'
    && normalizedSegments.every((segment) => segment.status === 'final' && segment.translatedText.trim())
    && normalizedClips.every((clip) => clip.status === 'complete')
    && normalizedIncidents.every((incident) => incident.type === 'pause' || incident.type === 'speaker-unknown');
  return {
    schemaVersion: '1.0',
    session: {
      id: session.id, platform: 'microsoft-teams-web', startedAt: new Date(session.startedAt).toISOString(),
      durationMs: session.durationMs, sourceLanguage: 'en', targetLanguage: 'fr',
      status: complete ? 'complete' : 'incomplete',
    },
    speakers, segments: normalizedSegments, clips: normalizedClips, mediaLinks, incidents: normalizedIncidents,
  };
}

function timestamp(ms, separator = ',') {
  const value = Math.round(ms);
  return `${String(Math.floor(value / 3600000)).padStart(2, '0')}:${String(Math.floor(value / 60000) % 60).padStart(2, '0')}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')}${separator}${String(value % 1000).padStart(3, '0')}`;
}

function segmentText(segment, speakers) {
  const name = segment.speakerId === null ? 'Intervenant inconnu' : speakers.get(segment.speakerId);
  requireValue(typeof name === 'string', `Unknown speaker reference: ${segment.speakerId}`);
  return `${name} : ${segment.translatedText.trim() || '[Traduction indisponible]'}`;
}

/** French transcript in session time, including passages without a recording. */
export function buildText(manifest) {
  const speakers = new Map(manifest.speakers.map((speaker) => [speaker.id, speaker.displayName]));
  const lines = manifest.segments.map((segment) => {
    const status = segment.status === 'final' ? '' : ` [${segment.status === 'provisional' ? 'provisoire' : 'incomplet'}]`;
    return `[${timestamp(segment.startMs, '.')} --> ${timestamp(segment.endMs, '.')}]${status}\n${segmentText(segment, speakers)}\n`;
  });
  return `TRANSCRIPTION FRANCAISE\nEtat : ${manifest.session.status === 'complete' ? 'complet' : 'incomplet'}\n\n${lines.join('\n')}`;
}

/** One clip's subtitles, using the manifest's intersections rather than recalculating them. */
export function buildSrt(manifest, clipId) {
  const clip = manifest.clips.find((item) => item.id === clipId);
  requireValue(clip, `Unknown clip reference: ${clipId}`);
  const speakers = new Map(manifest.speakers.map((speaker) => [speaker.id, speaker.displayName]));
  const segments = new Map(manifest.segments.map((segment) => [segment.id, segment]));
  const cues = [];
  for (const link of manifest.mediaLinks.filter((item) => item.clipId === clipId).sort((a, b) => a.mediaStartMs - b.mediaStartMs)) {
    const segment = segments.get(link.segmentId);
    requireValue(segment, `Unknown segment reference: ${link.segmentId}`);
    interval(link.mediaStartMs, link.mediaEndMs, clip.durationMs, 'media link');
    const start = Math.round(link.mediaStartMs);
    const end = Math.round(link.mediaEndMs);
    if (start >= end) continue; // Sub-millisecond intersections cannot be represented in SRT.
    const text = segmentText(segment, speakers)
      .replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\u0000/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    cues.push(`${cues.length + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${text}\n`);
  }
  return cues.length ? `${cues.join('\n')}\n` : '';
}

// This function is serialized verbatim. It must not reference module-scope values.
function offlinePlayer() {
  const manifest = JSON.parse(document.getElementById('session-data').textContent);
  const video = document.getElementById('video');
  const selector = document.getElementById('clip-selector');
  const notice = document.getElementById('notice');
  const rows = new Map();
  const speakers = new Map(manifest.speakers.map((speaker) => [speaker.id, speaker.displayName]));
  const clips = new Map(manifest.clips.map((clip) => [clip.id, clip]));
  const linksBySegment = new Map();
  for (const link of manifest.mediaLinks) {
    if (!linksBySegment.has(link.segmentId)) linksBySegment.set(link.segmentId, []);
    linksBySegment.get(link.segmentId).push(link);
  }
  let selected = null;
  let pending = null;
  let generation = 0;
  function clock(ms) {
    const seconds = Math.floor(ms / 1000);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map((value) => String(value).padStart(2, '0')).join(':');
  }
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function highlight() {
    const active = new Set();
    const ms = video.currentTime * 1000;
    if (selected && !video.error) for (const link of manifest.mediaLinks) {
      if (link.clipId === selected.id && link.mediaStartMs <= ms && ms < link.mediaEndMs) active.add(link.segmentId);
    }
    for (const [id, row] of rows) row.classList.toggle('active', active.has(id));
    document.getElementById('position').textContent = selected
      ? `Extrait ${clock(ms)} / ${clock(selected.durationMs)} | Session ${clock(selected.sessionStartMs + ms)}` : '';
  }
  function applySeek() {
    if (!pending || video.readyState < 1) return;
    const request = pending;
    pending = null;
    try {
      video.currentTime = request.ms / 1000;
      highlight();
      if (request.play) {
        const result = video.play();
        if (result) result.catch(() => {
          if (request.generation === generation) notice.textContent = 'Appuyez sur Lecture pour lancer cet extrait.';
        });
      }
    } catch {
      notice.textContent = 'Positionnement impossible dans ce fichier. Utilisez les commandes du lecteur ou telechargez le clip.';
    }
  }
  function selectClip(id, ms = 0, play = false) {
    const clip = clips.get(id);
    if (!clip) return;
    generation += 1;
    const changed = selected?.id !== id;
    selected = clip;
    selector.value = id;
    notice.textContent = clip.status === 'incomplete' ? 'Extrait incomplet : la fin de la capture peut manquer.' : '';
    document.getElementById('download-video').href = clip.file;
    document.getElementById('download-srt').href = clip.subtitleFile;
    pending = { ms, play, generation };
    if (changed) {
      video.pause();
      video.src = clip.file;
      video.load();
      for (const row of rows.values()) row.classList.remove('active');
    } else applySeek();
  }
  document.getElementById('summary').textContent = `${new Date(manifest.session.startedAt).toLocaleString('fr-FR')} | Anglais vers francais | ${clock(manifest.session.durationMs)} | ${manifest.clips.length} extrait(s)`;
  const state = document.getElementById('state');
  state.textContent = manifest.session.status === 'complete' ? 'Session complete' : 'Session incomplete';
  state.classList.toggle('incomplete', manifest.session.status !== 'complete');
  const transcript = document.getElementById('transcript');
  for (const segment of manifest.segments) {
    const row = node('article', undefined, 'segment');
    row.append(node('div', clock(segment.startMs), 'time'));
    const content = node('div');
    content.append(node('h3', speakers.get(segment.speakerId) || 'Intervenant inconnu'));
    content.append(node('p', segment.translatedText || '[Traduction indisponible]'));
    if (segment.status !== 'final') content.append(node('span', segment.status === 'provisional' ? 'Traduction provisoire' : 'Traduction incomplete', 'status'));
    row.append(content);
    const media = node('div', undefined, 'media-links');
    const links = linksBySegment.get(segment.id) || [];
    for (const link of links) {
      const index = manifest.clips.findIndex((clip) => clip.id === link.clipId) + 1;
      const button = node('button', `Extrait ${index} · ${clock(link.mediaStartMs)}`);
      button.type = 'button';
      button.addEventListener('click', () => selectClip(link.clipId, link.mediaStartMs, true));
      media.append(button);
    }
    if (!links.length) media.append(node('span', 'Sans video', 'muted'));
    row.append(media);
    rows.set(segment.id, row);
    transcript.append(row);
  }
  if (!manifest.segments.length) transcript.append(node('p', 'Aucune transcription pour cette session.', 'empty'));
  manifest.clips.forEach((clip, index) => {
    const option = node('option', `Extrait ${index + 1} | ${clock(clip.sessionStartMs)} - ${clock(clip.sessionEndMs)}${clip.status === 'incomplete' ? ' | incomplet' : ''}`);
    option.value = clip.id;
    selector.append(option);
  });
  selector.addEventListener('change', () => selectClip(selector.value));
  video.addEventListener('loadedmetadata', applySeek);
  for (const event of ['timeupdate', 'seeking', 'seeked', 'ended']) video.addEventListener(event, highlight);
  video.addEventListener('error', () => {
    pending = null;
    highlight();
    notice.textContent = 'Media absent, endommage ou codec non pris en charge. Extrayez tout le ZIP et conservez le dossier videos avec index.html. Vous pouvez aussi telecharger le clip.';
  });
  if (manifest.clips.length) selectClip(manifest.clips[0].id);
  else {
    document.getElementById('media-panel').hidden = true;
    notice.textContent = 'Aucun enregistrement video. La transcription reste consultable dans son integralite.';
  }
  const incidentList = document.getElementById('incidents');
  if (!manifest.incidents.length) incidentList.hidden = true;
  for (const incident of manifest.incidents) {
    incidentList.append(node('p', `${clock(incident.startMs)} - ${clock(incident.endMs)} : ${incident.message}`));
  }
}

function buildHtml(manifest) {
  const json = JSON.stringify(manifest).replace(/[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src 'self' file:; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'">
<title>Session Teams | Transcription</title>
<style>
:root{color-scheme:light;--bg:#f8fafc;--card:#ffffff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--primary:#4f46e5;--primary-hover:#4338ca;--primary-gradient:linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%);--brand-gradient:linear-gradient(135deg, #2563eb 0%, #7c3aed 50%, #ec4899 100%);--radius:12px;--shadow-sm:0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px 0 rgba(0,0,0,0.04);--shadow-md:0 4px 14px -2px rgba(15,23,42,0.08), 0 2px 6px -1px rgba(15,23,42,0.04)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}main{max-width:1200px;margin:auto;padding:40px 28px}header{background:var(--card);border-radius:var(--radius);padding:28px 32px;border:1px solid var(--line);box-shadow:var(--shadow-md);margin-bottom:28px;position:relative;overflow:hidden}header::before{content:"";position:absolute;top:0;left:0;right:0;height:5px;background:var(--brand-gradient)}.eyebrow{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;font-weight:800;background:var(--brand-gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent;display:inline-block;margin-bottom:4px}h1{font-size:clamp(26px,4vw,38px);font-weight:800;line-height:1.2;margin:8px 0 12px;color:var(--ink);letter-spacing:-0.6px}h2{font-size:20px;font-weight:700;letter-spacing:-0.4px;margin:0 0 16px;color:var(--ink)}h3{font-size:15px;font-weight:700;color:#1e1b4b;margin:0 0 6px}p{margin:0 0 10px}#summary,.muted{color:var(--muted);font-size:14px}#state{display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:9999px;font-size:12px;font-weight:700;background:#ecfdf5;color:#059669;border:1px solid #a7f3d0;margin-top:10px}#state.incomplete{background:#fffbeb;color:#b45309;border-color:#fde68a}.layout{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.3fr);gap:28px}.player{align-self:start;position:sticky;top:24px;background:var(--card);padding:24px;border-radius:var(--radius);border:1px solid var(--line);box-shadow:var(--shadow-md)}video{display:block;width:100%;max-height:52vh;background:#090d16;border-radius:10px;margin-top:14px;border:1px solid #1e293b;box-shadow:0 8px 20px -4px rgba(0,0,0,0.25)}label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;color:var(--muted);margin-bottom:8px}select{width:100%;font:inherit;font-size:13px;padding:10px 14px;background:#f8fafc;border:1.5px solid var(--line);border-radius:8px;color:var(--ink);outline:none;transition:all .15s}select:focus{border-color:#6366f1;background:#ffffff;box-shadow:0 0 0 3px rgba(99,102,241,0.15)}a{color:var(--primary);text-decoration:none;font-weight:600;transition:color .15s}a:hover{color:var(--primary-hover);text-decoration:underline}button{cursor:pointer;border:1px solid var(--line);background:#f1f5f9;color:#334155;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:600;transition:all .15s cubic-bezier(0.4,0,0.2,1)}button:hover{background:var(--primary);color:#ffffff;border-color:var(--primary);box-shadow:0 2px 8px rgba(79,70,229,0.25);transform:translateY(-1px)}.downloads{display:flex;flex-wrap:wrap;gap:10px 16px;font-size:13px;margin:16px 0}.downloads a{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;background:#f8fafc;border:1px solid var(--line);border-radius:20px;font-size:12px;color:var(--ink);transition:all .15s ease}.downloads a:hover{background:#eef2ff;border-color:#c7d2fe;color:var(--primary);text-decoration:none;transform:translateY(-1px)}#notice{font-size:13px;margin:14px 0;color:#b45309;background:#fffbeb;border-left:3px solid #f59e0b;padding:8px 12px;border-radius:6px}#notice:empty{display:none}#position{font-size:12px;font-family:ui-monospace,monospace;color:var(--muted);margin-top:10px;font-variant-numeric:tabular-nums}#transcript{display:flex;flex-direction:column;gap:12px}.segment{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px 20px;display:grid;grid-template-columns:75px minmax(0,1fr);gap:8px 16px;box-shadow:var(--shadow-sm);transition:all .2s ease;position:relative}.segment:hover{border-color:#cbd5e1;box-shadow:var(--shadow-md)}.segment.active{background:#eef2ff;border-color:#818cf8;box-shadow:0 4px 16px rgba(79,70,229,0.15)}.segment.active::before{content:"";position:absolute;top:0;left:0;bottom:0;width:5px;background:var(--primary-gradient);border-radius:var(--radius) 0 0 var(--radius)}.segment p{white-space:pre-wrap;overflow-wrap:anywhere;color:#334155;font-size:14.5px;line-height:1.55}.segment h3{overflow-wrap:anywhere}.time{font-size:11px;font-family:ui-monospace,monospace;font-weight:700;color:#4f46e5;background:#eef2ff;padding:4px 8px;border-radius:6px;align-self:start;text-align:center;border:1px solid #e0e7ff}.media-links{grid-column:2;display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;margin-top:4px}.status{font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;background:#fff7ed;color:#c2410c;border:1px solid #ffedd5;display:inline-block;margin-top:4px}#incidents{background:var(--card);border:1px solid #fee2e2;border-radius:var(--radius);padding:20px 24px;margin-top:28px;box-shadow:var(--shadow-sm)}#incidents h2{color:#dc2626;font-size:16px;margin-bottom:10px}#incidents p{color:#991b1b;font-size:13px}.empty{padding:40px 20px;text-align:center;color:var(--muted);background:var(--card);border-radius:var(--radius);border:1px dashed var(--line)}footer{margin-top:48px;padding:20px 0;border-top:1px solid var(--line);font-size:12px;color:var(--muted);text-align:center}[hidden]{display:none!important}@media(max-width:800px){main{padding:20px 14px}.layout{grid-template-columns:1fr}.player{position:static}.segment{padding:14px;grid-template-columns:65px minmax(0,1fr)}video{max-height:40vh}}
</style>
</head>
<body><main>
<header><div class="eyebrow">Archive locale / Microsoft Teams</div><h1>Le fil de la session</h1><p id="summary"></p><span id="state"></span></header>
<div class="layout"><section class="player" aria-label="Enregistrements">
<div id="media-panel"><label for="clip-selector">Choisir un extrait</label><select id="clip-selector"></select><video id="video" controls preload="metadata" playsinline></video><p id="position"></p><div class="downloads"><a id="download-video" download>Telecharger le clip</a><a id="download-srt" download>Sous-titres SRT</a></div></div>
<p id="notice" role="status" aria-live="polite"></p>
<div class="downloads"><a href="transcription.fr.txt" download>Transcription TXT</a><a href="session.json" download>Donnees JSON</a></div>
</section><section aria-labelledby="transcript-title"><h2 id="transcript-title">Transcription francaise</h2><div id="transcript"></div></section></div>
<section id="incidents" aria-label="Incidents"><h2>Points d'attention</h2></section>
<footer>Consultation hors ligne. Les heures de la transcription se rapportent a la session ; les liens indiquent le temps dans chaque extrait. Un etat complet ne garantit pas l'exactitude linguistique.</footer>
<noscript>Activez JavaScript pour consulter le lecteur synchronise, ou ouvrez transcription.fr.txt.</noscript>
</main><script id="session-data" type="application/json">${json}</script><script>(${offlinePlayer.toString()})();</script></body></html>`;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

async function crc32(blob) {
  let crc = 0xffffffff;
  // Bounded reads avoid materializing entire recordings as JavaScript arrays.
  for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer());
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function storeZip(entries) {
  requireValue(entries.length < ZIP_COUNT_MAX, 'ZIP64 is not supported: too many ZIP entries (maximum 65534)');
  let offset = 0;
  let centralSize = 0;
  const records = entries.map(({ name, blob }) => {
    const filename = encoder.encode(name);
    requireValue(filename.length <= 0xffff, 'ZIP filename exceeds 65535 UTF-8 bytes');
    requireValue(Number.isSafeInteger(blob.size) && blob.size < ZIP_MAX, 'ZIP64 is not supported: entry size exceeds ZIP32 limits');
    const record = { filename, blob, offset };
    offset += 30 + filename.length + blob.size;
    centralSize += 46 + filename.length;
    return record;
  });
  requireValue(offset + centralSize + 22 < ZIP_MAX, 'ZIP64 is not supported: archive exceeds ZIP32 limits');
  const localParts = [];
  const centralParts = [];
  for (const record of records) {
    const crc = await crc32(record.blob);
    const local = new Uint8Array(30);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true); // UTF-8, STORE, no data descriptor.
    view.setUint16(12, 0x0021, true); // DOS date: 1980-01-01, deterministic archive.
    view.setUint32(14, crc, true);
    view.setUint32(18, record.blob.size, true);
    view.setUint32(22, record.blob.size, true);
    view.setUint16(26, record.filename.length, true);
    localParts.push(local, record.filename, record.blob);

    const central = new Uint8Array(46);
    const directory = new DataView(central.buffer);
    directory.setUint32(0, 0x02014b50, true);
    directory.setUint16(4, 20, true);
    central.set(local.subarray(4, 30), 6);
    directory.setUint32(42, record.offset, true);
    centralParts.push(central, record.filename);
  }
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

/** Export supplied recordings only. Blob contents/codecs must be verified by the recording layer. */
export async function buildExport(session, segments, clips, incidents = []) {
  const manifest = buildManifest(session, segments, clips, incidents);
  const root = `session-${safeId(manifest.session.id)}/`;
  const entries = [];
  const add = (name, value, type) => entries.push({ name: root + name, blob: value instanceof Blob ? value : new Blob([value], { type }) });
  add('index.html', buildHtml(manifest), 'text/html;charset=utf-8');
  add('session.json', JSON.stringify(manifest, null, 2), 'application/json');
  add('transcription.fr.txt', buildText(manifest), 'text/plain;charset=utf-8');
  for (let index = 0; index < clips.length; index++) {
    const source = clips[index];
    const clip = manifest.clips[index];
    requireValue(source.blob instanceof Blob && source.blob.size > 0, `clip ${clip.id} requires a nonempty recording Blob`);
    requireValue(!source.blob.type || source.blob.type.split(';', 1)[0].trim().toLowerCase() === clip.mimeType,
      `clip ${clip.id} Blob MIME type does not match metadata`);
    add(clip.file, source.blob);
    add(clip.subtitleFile, buildSrt(manifest, clip.id), 'application/x-subrip;charset=utf-8');
  }
  return storeZip(entries);
}

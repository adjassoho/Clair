import http from 'node:http';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import WebSocket, { WebSocketServer } from 'ws';
import { createTranslator, createGeminiTranslator, createGeminiLiveProvider, createDeepgramProvider } from './providers.js';
import { detectFfmpeg, processUnifiedVideo } from './video.js';
import { generateDetailedSynthesis } from './synthesis.js';

const DEFAULT_LIMITS = {
  maxConnections: 8, maxPayload: 4 * 1024 * 1024, maxTextLength: 8000,
  maxQueuedRequests: 64, maxQueuedText: 512 * 1024, maxSessionRequests: 64,
  maxSessionText: 10_000_000, translationConcurrency: 1,
  translationTimeoutMs: 45_000, authTimeoutMs: 10_000, audioConnectTimeoutMs: 20_000,
  finishTimeoutMs: 5000, closeTimeoutMs: 1000, sessionTimeoutMs: 4 * 60 * 60 * 1000,
  maxBufferedBytes: 4 * 1024 * 1024, messagesPerSecond: 500, bytesPerSecond: 2 * 1024 * 1024,
};
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validTime = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const digest = (value) => createHash('sha256').update(value).digest();

export function validOrigin(origin, extensionId) {
  return typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)
    && (!extensionId || origin === `chrome-extension://${extensionId}`);
}

export function validateCaption(message, maxTextLength = 8000) {
  return isObject(message) && message.type === 'caption' && message.status === 'final'
    && typeof message.id === 'string' && message.id.length > 0 && message.id.length <= 128
    && validTime(message.startMs) && validTime(message.endMs) && message.endMs >= message.startMs
    && typeof message.sourceText === 'string' && message.sourceText.trim().length > 0
    && message.sourceText.length <= maxTextLength
    && (message.speakerName === null || (typeof message.speakerName === 'string'
      && message.speakerName.trim().length > 0 && message.speakerName.length <= 200));
}

export function joinSentenceFragments(fragments) {
  let result = '';
  for (let frag of fragments) {
    frag = (frag || '').trim();
    if (!frag) continue;
    if (!result) {
      result = frag;
    } else {
      if (/^[,\.\?!:;'\-]/.test(frag)) {
        result += frag;
      } else {
        result += ' ' + frag;
      }
    }
  }
  return result;
}

// The timeout also settles non-cooperative injected providers; AbortSignal stops real fetches.
function bounded(operation, timeoutMs, controller) {
  return new Promise((resolve, reject) => {
    let timer;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Operation cancelled.'));
    };
    controller.signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    if (timer.unref) timer.unref();

    Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) throw new Error('Operation cancelled.');
        return operation();
      })
      .then((value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      });
  });
}

export function createGateway({ env = process.env, translate, audioProvider, limits: overrides = {} } = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid limit: ${name}`);
  }
  const config = {
    token: env.GATEWAY_TOKEN || '', extensionId: env.EXTENSION_ID || '',
    geminiKey: env.GEMINI_API_KEY || '', geminiModel: env.GEMINI_MODEL || 'gemini-3.6-flash',
    geminiLiveModel: env.GEMINI_LIVE_MODEL || 'gemini-3.5-live-translate-preview',
    openaiKey: env.OPENAI_API_KEY || '', deepgramKey: env.DEEPGRAM_API_KEY || '',
    model: env.TRANSLATION_MODEL || 'gpt-4o-mini',
  };
  if (config.extensionId && !/^[a-p]{32}$/.test(config.extensionId)) throw new Error('Invalid EXTENSION_ID.');
  const tokenHash = digest(config.token);
  const translator = translate
    || (config.geminiKey ? createGeminiTranslator({ apiKey: config.geminiKey, model: config.geminiModel })
    : (config.openaiKey ? createTranslator({ apiKey: config.openaiKey, model: config.model }) : null));
  const audioMode = env.AUDIO_PROVIDER || (config.deepgramKey ? 'deepgram' : (config.geminiKey ? 'gemini' : 'none'));
  const resolvedAudioProvider = audioProvider || (audioMode === 'deepgram' && config.deepgramKey
    ? (opts) => createDeepgramProvider({ ...opts, apiKey: config.deepgramKey })
    : (audioMode === 'gemini' && config.geminiKey
      ? (opts) => createGeminiLiveProvider({
          ...opts,
          apiKey: config.geminiKey, model: config.geminiLiveModel,
        })
      : (config.deepgramKey
        ? (opts) => createDeepgramProvider({ ...opts, apiKey: config.deepgramKey })
        : (config.geminiKey
          ? (opts) => createGeminiLiveProvider({
              ...opts,
              apiKey: config.geminiKey, model: config.geminiLiveModel,
            })
          : null))));
  const sessions = new Set();
  const queue = [];
  let active = 0;
  let queuedText = 0;
  let outstanding = 0;
  let shuttingDown = false;
  const downloadFiles = new Map();
  const exportMetaMap = new Map();
  const server = http.createServer({ maxHeaderSize: 8 * 1024 * 1024 }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-clair-token, x-clair-export-id, x-clair-session, x-clair-segments, x-clair-srt, x-clair-synthesis-mode');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      const ffmpeg = await detectFfmpeg();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        gatewayConfigured: Boolean(config.token),
        translationConfigured: Boolean(config.geminiKey || config.openaiKey),
        provider: config.geminiKey ? 'gemini' : (config.openaiKey ? 'openai' : 'none'),
        audioConfigured: Boolean(config.deepgramKey || config.geminiKey),
        audioProvider: audioMode === 'deepgram' ? 'deepgram (nova-3)' : (config.geminiKey ? config.geminiLiveModel : 'none'),
        extensionRestricted: Boolean(config.extensionId),
        ffmpegAvailable: Boolean(ffmpeg),
      }));
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/download/')) {
      const id = url.pathname.slice('/api/download/'.length);
      const fileInfo = downloadFiles.get(id);
      if (!fileInfo) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Fichier introuvable ou expiré.' }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': fileInfo.mimeType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileInfo.filename)}"`,
      });
      fs.createReadStream(fileInfo.filePath).pipe(res);
      return;
    }

    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const defaultToken = 'clair-local-session-secret-token-2026';
    const expectedToken = config.token || defaultToken;

    if (req.method === 'POST' && url.pathname === '/api/export-meta') {
      let bodyStr = '';
      req.on('data', chunk => {
        bodyStr += chunk;
        if (bodyStr.length > 50 * 1024 * 1024) req.destroy();
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(bodyStr || '{}');
          const token = bearerToken || data.token || req.headers['x-clair-token'] || '';
          const isAuth = !expectedToken || token === expectedToken
            || (tokenHash.length === digest(token).length && timingSafeEqual(tokenHash, digest(token)));
          if (!isAuth) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Jeton invalide.' }));
            return;
          }
          const exportId = randomUUID();
          exportMetaMap.set(exportId, {
            session: data.session || {},
            segments: Array.isArray(data.segments) ? data.segments : [],
            srtContent: data.srtContent || '',
            synthesisMode: data.synthesisMode || 'meeting',
            createdAt: Date.now(),
          });
          const now = Date.now();
          for (const [k, v] of exportMetaMap.entries()) {
            if (now - v.createdAt > 20 * 60 * 1000) exportMetaMap.delete(k);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, exportId }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/export-full') {
      const isBinaryStream = req.headers['content-type']?.includes('video/')
        || req.headers['content-type']?.includes('application/octet-stream');

      const exportDir = path.join(os.tmpdir(), `clair-export-${randomUUID()}`);
      await fsp.mkdir(exportDir, { recursive: true });

      const parseHeaderJson = (headerVal, fallback = null) => {
        if (!headerVal) return fallback;
        try {
          return JSON.parse(Buffer.from(headerVal, 'base64').toString('utf-8'));
        } catch {
          try {
            return JSON.parse(decodeURIComponent(headerVal));
          } catch {
            return fallback;
          }
        }
      };

      const parseHeaderText = (headerVal, fallback = '') => {
        if (!headerVal) return fallback;
        try {
          return Buffer.from(headerVal, 'base64').toString('utf-8');
        } catch {
          try {
            return decodeURIComponent(headerVal);
          } catch {
            return headerVal;
          }
        }
      };

      if (isBinaryStream) {
        const token = bearerToken || req.headers['x-clair-token'] || url.searchParams.get('token') || '';
        const isAuth = !expectedToken || token === expectedToken
          || (tokenHash.length === digest(token).length && timingSafeEqual(tokenHash, digest(token)));
        if (!isAuth) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Jeton invalide.' }));
          return;
        }

        const exportId = url.searchParams.get('exportId') || req.headers['x-clair-export-id'] || '';
        const savedMeta = exportId ? exportMetaMap.get(exportId) : null;
        if (savedMeta) exportMetaMap.delete(exportId);

        const tempInput = path.join(exportDir, `input-${Date.now()}.webm`);
        const fileStream = fs.createWriteStream(tempInput);
        let totalBytes = 0;
        const MAX_UPLOAD = 800 * 1024 * 1024;

        req.on('data', chunk => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_UPLOAD) {
            req.destroy(new Error('Payload trop volumineux.'));
          }
        });

        req.pipe(fileStream);

        fileStream.on('error', err => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `Erreur écriture flux: ${err.message}` }));
        });

        fileStream.on('finish', async () => {
          try {
            const session = savedMeta?.session || parseHeaderJson(req.headers['x-clair-session'], {});
            const segments = (savedMeta?.segments && savedMeta.segments.length) ? savedMeta.segments : parseHeaderJson(req.headers['x-clair-segments'], []);
            const srtContent = savedMeta?.srtContent || parseHeaderText(req.headers['x-clair-srt'], '');
            const synthesisMode = savedMeta?.synthesisMode || req.headers['x-clair-synthesis-mode'] || 'meeting';

            let synthesisResult = null;
            if (config.geminiKey) {
              try {
                const segmentsToSynthesize = (segments && segments.length) ? segments : [
                  { startMs: 0, endMs: session?.durationMs || 10000, speakerName: 'Session Clair', translatedText: 'Session Clair enregistrée.' }
                ];
                synthesisResult = await generateDetailedSynthesis({
                  segments: segmentsToSynthesize,
                  session: session || {},
                  mode: synthesisMode,
                  apiKey: config.geminiKey,
                  model: config.geminiModel,
                });
              } catch (synthErr) {
                console.warn('Erreur synthèse Gemini:', synthErr.message);
              }
            }

            let htmlDownloadId = null;
            let mdDownloadId = null;
            if (synthesisResult) {
              const htmlPath = path.join(exportDir, 'synthese_reunion.html');
              const mdPath = path.join(exportDir, 'synthese_reunion.md');
              await fsp.writeFile(htmlPath, synthesisResult.html, 'utf-8');
              await fsp.writeFile(mdPath, synthesisResult.markdown, 'utf-8');
              htmlDownloadId = randomUUID();
              mdDownloadId = randomUUID();
              downloadFiles.set(htmlDownloadId, { filePath: htmlPath, mimeType: 'text/html; charset=utf-8', filename: 'synthese_reunion.html' });
              downloadFiles.set(mdDownloadId, { filePath: mdPath, mimeType: 'text/markdown; charset=utf-8', filename: 'synthese_reunion.md' });
            }

            let videoResult = null;
            let videoDownloadId = null;
            if (totalBytes > 0) {
              const dateTag = session?.startedAt ? session.startedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
              videoResult = await processUnifiedVideo({
                inputFilePath: tempInput,
                srtContent,
                outputDir: exportDir,
                baseName: `reunion-${dateTag}`,
              });
              videoDownloadId = randomUUID();
              downloadFiles.set(videoDownloadId, {
                filePath: videoResult.filePath,
                mimeType: videoResult.mimeType,
                filename: videoResult.filename,
              });
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              synthesis: synthesisResult ? {
                markdown: synthesisResult.markdown,
                html: synthesisResult.html,
                htmlUrl: `/api/download/${htmlDownloadId}`,
                mdUrl: `/api/download/${mdDownloadId}`,
              } : null,
              video: videoResult ? {
                format: videoResult.format,
                filename: videoResult.filename,
                ffmpegUsed: videoResult.ffmpegUsed,
                note: videoResult.note || null,
                downloadUrl: `/api/download/${videoDownloadId}`,
              } : null,
            }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
        return;
      }

      // Format JSON existant (avec buffer ou base64)
      const chunks = [];
      let totalLength = 0;
      const MAX_UPLOAD = 400 * 1024 * 1024;
      req.on('data', chunk => {
        totalLength += chunk.length;
        if (totalLength > MAX_UPLOAD) {
          req.destroy(new Error('Payload trop volumineux.'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          const token = bearerToken || body.token || req.headers['x-clair-token'] || '';
          const isAuth = !expectedToken || token === expectedToken
            || (tokenHash.length === digest(token).length && timingSafeEqual(tokenHash, digest(token)));
          if (!isAuth) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Jeton invalide.' }));
            return;
          }

          let synthesisResult = null;
          if (config.geminiKey) {
            try {
              const segmentsToSynthesize = (body.segments && body.segments.length) ? body.segments : [
                { startMs: 0, endMs: body.session?.durationMs || 10000, speakerName: 'Session de test', translatedText: 'Session de test Clair sans prise de parole détectée.' }
              ];
              synthesisResult = await generateDetailedSynthesis({
                segments: segmentsToSynthesize,
                session: body.session || {},
                mode: body.synthesisMode || 'course',
                apiKey: config.geminiKey,
                model: config.geminiModel,
              });
            } catch (synthErr) {
              console.warn('Erreur synthèse Gemini:', synthErr.message);
            }
          }

          let htmlDownloadId = null;
          let mdDownloadId = null;
          if (synthesisResult) {
            const htmlPath = path.join(exportDir, 'synthese_reunion.html');
            const mdPath = path.join(exportDir, 'synthese_reunion.md');
            await fsp.writeFile(htmlPath, synthesisResult.html, 'utf-8');
            await fsp.writeFile(mdPath, synthesisResult.markdown, 'utf-8');
            htmlDownloadId = randomUUID();
            mdDownloadId = randomUUID();
            downloadFiles.set(htmlDownloadId, { filePath: htmlPath, mimeType: 'text/html; charset=utf-8', filename: 'synthese_reunion.html' });
            downloadFiles.set(mdDownloadId, { filePath: mdPath, mimeType: 'text/markdown; charset=utf-8', filename: 'synthese_reunion.md' });
          }

          let videoResult = null;
          let videoDownloadId = null;
          if (body.videoBase64) {
            const videoBuffer = Buffer.from(body.videoBase64, 'base64');
            const dateTag = body.session?.startedAt ? body.session.startedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
            videoResult = await processUnifiedVideo({
              videoBuffer,
              srtContent: body.srtContent || '',
              outputDir: exportDir,
              baseName: `reunion-${dateTag}`,
            });
            videoDownloadId = randomUUID();
            downloadFiles.set(videoDownloadId, {
              filePath: videoResult.filePath,
              mimeType: videoResult.mimeType,
              filename: videoResult.filename,
            });
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            synthesis: synthesisResult ? {
              markdown: synthesisResult.markdown,
              html: synthesisResult.html,
              htmlUrl: `/api/download/${htmlDownloadId}`,
              mdUrl: `/api/download/${mdDownloadId}`,
            } : null,
            video: videoResult ? {
              format: videoResult.format,
              filename: videoResult.filename,
              ffmpegUsed: videoResult.ffmpegUsed,
              note: videoResult.note || null,
              downloadUrl: `/api/download/${videoDownloadId}`,
            } : null,
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxPayload, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (shuttingDown || req.url !== '/' || !validOrigin(req.headers.origin, config.extensionId)
      || sessions.size >= limits.maxConnections) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  function pump() {
    while (active < limits.translationConcurrency) {
      const index = queue.findIndex((job) => !job.session.running);
      if (index < 0) return;
      const job = queue.splice(index, 1)[0];
      const session = job.session;
      active++;
      session.running = job;
      bounded(() => translator(job.segment.sourceText, { signal: job.controller.signal, context: session.recentHistory || [] }),
        limits.translationTimeoutMs, job.controller)
        .then((translatedText) => {
          if (typeof translatedText !== 'string' || !translatedText.trim() || translatedText.length > 32_000) {
            throw new Error('Invalid translation.');
          }
          if (!session.recentHistory) session.recentHistory = [];
          session.recentHistory.push(job.segment.sourceText);
          if (session.recentHistory.length > 5) session.recentHistory.shift();
          if (!session.closed) {
            console.log(`[Gateway] Segment traduit (${job.segment.id}): "${translatedText}"`);
            session.send({ type: 'segment', segment: { ...job.segment, translatedText, status: 'final' } });
          }
        }).catch((err) => {
          console.warn(`[Gateway] Échec traduction (${job.segment.id}):`, err?.message || err);
          if (!session.closed) {
            console.log(`[Gateway] Envoi fallback sourceText (${job.segment.id}): "${job.segment.sourceText}"`);
            session.send({ type: 'segment', segment: { ...job.segment, translatedText: job.segment.sourceText, status: 'final' } });
          }
        }).finally(() => {
          active--;
          outstanding--;
          queuedText -= job.segment.sourceText.length;
          session.pending--;
          session.running = null;
          session.checkFinish();
          pump();
        });
    }
  }

  wss.on('connection', (ws) => {
    const session = { closed: false, finishing: false, pending: 0, running: null, incomplete: false, recentHistory: [] };
    sessions.add(session);
    let state = 'auth';
    let mode;
    let audio;
    let audioDone = true;
    let audioOffsetMs = 0;
    let audioId = 0;
    let totalText = 0;
    let finishTimer;
    let closeTimer;
    let messageTokens = limits.messagesPerSecond * 2;
    let byteTokens = limits.bytesPerSecond * 2;
    let rateTime = performance.now();
    let pendingSentence = null;
    let sentenceFlushTimer = null;
    const providerController = new AbortController();
    const authTimer = setTimeout(() => fatal('AUTH_TIMEOUT', 'Authentication timed out.'), limits.authTimeoutMs);
    const lifetimeTimer = setTimeout(() => {
      session.error('SESSION_LIMIT', 'Session time limit reached.');
      finish();
    }, limits.sessionTimeoutMs);
    lifetimeTimer.unref();

    function flushCurrentSentence() {
      if (sentenceFlushTimer) {
        clearTimeout(sentenceFlushTimer);
        sentenceFlushTimer = null;
      }
      if (!pendingSentence || !pendingSentence.fragments.length) return;
      const sentenceToFlush = pendingSentence;
      pendingSentence = null;

      let combinedText = joinSentenceFragments(sentenceToFlush.fragments);
      if (!combinedText) return;

      if (combinedText.length > 0 && /^[a-z]/.test(combinedText)) {
        combinedText = combinedText.charAt(0).toUpperCase() + combinedText.slice(1);
      }

      const segment = {
        id: `audio-${++audioId}`,
        startMs: sentenceToFlush.startMs,
        endMs: Math.max(sentenceToFlush.startMs + 800, sentenceToFlush.endMs),
        speakerName: sentenceToFlush.speakerName,
        speakerStatus: sentenceToFlush.speakerName ? 'identified' : 'unknown',
        status: 'final',
      };

      console.log(`[Gateway] STT phrase consolidée (${segment.id}, ${segment.startMs}-${segment.endMs}ms): "${combinedText}"`);

      if (!session.closed) {
        session.send({ type: 'interim', text: '' });
        session.send({
          type: 'segment',
          segment: {
            ...segment,
            sourceText: combinedText,
            translatedText: combinedText,
            status: 'provisional',
          },
        });
      }

      if (validateCaption({ type: 'caption', ...segment, sourceText: combinedText }, limits.maxTextLength)) {
        enqueue({ ...segment, sourceText: combinedText });
      }
    }

    session.send = (message) => {
      if (session.closed || ws.readyState !== WebSocket.OPEN) return false;
      if (ws.bufferedAmount > limits.maxBufferedBytes) {
        session.incomplete = true;
        ws.close(1013, 'Client cannot keep up; session incomplete.');
        cleanup();
        armClose();
        return false;
      }
      ws.send(JSON.stringify(message));
      return true;
    };
    session.error = (code, message) => {
      console.warn(`[Gateway] Session error (${code}): ${message}`);
      session.incomplete = true;
      session.send({ type: 'error', code, message });
    };
    function armClose() {
      closeTimer = setTimeout(() => ws.terminate(), limits.closeTimeoutMs);
      closeTimer.unref();
    }
    function cleanup() {
      if (session.closed) return;
      session.closed = true;
      if (sentenceFlushTimer) {
        clearTimeout(sentenceFlushTimer);
        sentenceFlushTimer = null;
      }
      pendingSentence = null;
      clearTimeout(authTimer);
      clearTimeout(lifetimeTimer);
      clearTimeout(finishTimer);
      providerController.abort();
      audio?.close();
      session.running?.controller.abort();
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].session !== session) continue;
        queuedText -= queue[i].segment.sourceText.length;
        outstanding--;
        session.pending--;
        queue.splice(i, 1);
      }
      sessions.delete(session);
    }
    session.shutdown = () => { ws.close(1001, 'Gateway stopping.'); cleanup(); armClose(); };
    function fatal(code, message, closeCode = 1008) {
      console.warn(`[Gateway] Fatal closing connection (${code}): ${message}`);
      session.error(code, message);
      ws.close(closeCode, code);
      cleanup();
      armClose();
    }
    function complete() {
      if (session.closed) return;
      session.send({ type: 'finished', incomplete: session.incomplete });
      ws.close(1000, 'Session finished.');
      cleanup();
      armClose();
    }
    session.checkFinish = () => {
      if (session.finishing && audioDone && session.pending === 0) complete();
    };
    function finish() {
      if (session.finishing || session.closed) return;
      session.finishing = true;
      flushCurrentSentence();
      clearTimeout(authTimer);
      finishTimer = setTimeout(() => {
        session.error('FINALIZATION_TIMEOUT', 'Finalization timed out; session is incomplete.');
        complete();
      }, limits.finishTimeoutMs);
      if (mode === 'audio' && audio) {
        Promise.resolve().then(() => audio.finish()).catch(() => {
          if (!session.closed) session.error('AUDIO_FAILED', 'Audio finalization failed.');
        }).finally(() => { audioDone = true; session.checkFinish(); });
      } else if (state === 'starting') {
        session.error('NOT_READY', 'Session ended before the provider was ready.');
        audioDone = true;
      }
      session.checkFinish();
    }
    function enqueue(segment) {
      if (session.closed) return;
      if (outstanding >= limits.maxQueuedRequests || session.pending >= limits.maxSessionRequests
        || queuedText + segment.sourceText.length > limits.maxQueuedText
        || totalText + segment.sourceText.length > limits.maxSessionText) {
        session.error('OVERLOADED', 'Translation budget exceeded; segment was not processed.');
        return;
      }
      totalText += segment.sourceText.length;
      queuedText += segment.sourceText.length;
      outstanding++;
      session.pending++;
      queue.push({ session, segment, controller: new AbortController() });
      pump();
    }
    async function start(message) {
      if (!config.token || typeof message.token !== 'string' || message.token.length > 4096
        || !timingSafeEqual(digest(message.token), tokenHash)) {
        fatal('UNAUTHORIZED', 'Authentication failed.');
        return;
      }
      const rawOffset = message.audioOffsetMs !== undefined ? Number(message.audioOffsetMs) : 0;
      if (!['captions', 'audio'].includes(message.mode) || !['en', 'multi', 'fr'].includes(message.sourceLanguage)
        || message.targetLanguage !== 'fr' || !validTime(rawOffset)) {
        fatal('INVALID_START', 'Expected audio or captions mode and en to fr languages.');
        return;
      }
      if ((!translate && !config.geminiKey && !config.openaiKey) || (message.mode === 'audio' && !audioProvider && !config.geminiKey && !config.deepgramKey)) {
        fatal('NOT_CONFIGURED', 'Required language provider is not configured.');
        return;
      }
      clearTimeout(authTimer);
      state = 'starting';
      mode = message.mode;
      audioOffsetMs = Math.round(rawOffset);
      if (mode === 'audio') {
        audioDone = false;
        try {
          audio = await bounded(() => resolvedAudioProvider({
            apiKey: audioMode === 'deepgram' ? config.deepgramKey : (config.geminiKey || config.deepgramKey),
            signal: providerController.signal,
            language: message.sourceLanguage || 'en',
            enableAudioOut: Boolean(message.enableAudioOut),
            onError: (err) => {
              console.warn('[Gateway] Erreur provider audio:', err?.message || err);
              if (!session.closed) {
                session.error('AUDIO_FAILED', 'Audio provider connection failed.');
                audioDone = true;
                finish();
              }
            },
            onAudioOut: (audioData) => {
              if (!session.closed) session.send({ type: 'audio-out', data: audioData });
            },
            onInterim: (text) => {
              if (session.closed || !text) return;
              const combined = pendingSentence?.fragments?.length
                ? joinSentenceFragments([...pendingSentence.fragments, text])
                : text;
              session.send({ type: 'interim', text: combined });
            },
            onResult: ({ sourceText, translatedText, start, duration, speakerIndex }) => {
              if (translatedText) {
                flushCurrentSentence();
                const estStart = typeof start === 'number' ? Math.max(0, Math.round(start * 1000) + audioOffsetMs) : audioOffsetMs;
                const estDuration = typeof duration === 'number' ? Math.round(duration * 1000) : 3000;
                const fallbackSpeaker = typeof speakerIndex === 'number' ? `Intervenant ${speakerIndex + 1}` : null;
                const segment = {
                  id: `audio-${++audioId}`,
                  startMs: estStart,
                  endMs: estStart + estDuration,
                  speakerName: fallbackSpeaker,
                  speakerStatus: fallbackSpeaker ? 'identified' : 'unknown',
                  status: 'final',
                };
                console.log(`[Gateway] Segment direct reçu (${segment.id}): "${translatedText}"`);
                if (!session.closed) {
                  session.send({ type: 'interim', text: '' });
                  session.send({
                    type: 'segment',
                    segment: { ...segment, translatedText, status: 'final' },
                  });
                }
              } else if (sourceText) {
                const estStart = typeof start === 'number' ? Math.max(0, Math.round(start * 1000) + audioOffsetMs) : audioOffsetMs;
                const estDuration = typeof duration === 'number' ? Math.round(duration * 1000) : 1500;
                const fallbackSpeaker = typeof speakerIndex === 'number' ? `Intervenant ${speakerIndex + 1}` : null;
                const cleanText = sourceText.trim();
                if (!cleanText) return;

                const danglingConnectorRegex = /\b(and|or|so|if|that|which|who|whom|whose|because|but|to|for|with|as|at|by|from|in|into|of|on|off|out|over|under|until|up|while|although|though|we|i|you|he|she|they|it|the|a|an|is|are|was|were|be|been|have|has|had|do|does|did|will|would|can|could|should|my|your|his|her|its|our|their|et|ou|donc|or|ni|car|mais|si|que|qui|quoi|dont|où|qu'|parce|puisque|comme|pour|avec|sans|sous|sur|dans|de|du|des|d'|en|au|aux|à|par|vers|chez|mon|ma|mes|ton|ta|tes|son|sa|ses|notre|nos|votre|vos|leur|leurs|je|j'|tu|il|elle|on|nous|vous|ils|elles|ce|cet|cette|ces|le|la|les|un|une|est|suis|es|sommes|êtes|sont|été|ai|as|a|avons|avez|ont|nom)\s*[.,?!]*$/i;

                if (pendingSentence && pendingSentence.speakerIndex !== speakerIndex) {
                  const currentPendingText = joinSentenceFragments(pendingSentence.fragments);
                  const pendingWords = currentPendingText.split(/\s+/).filter(Boolean).length;
                  const isPendingDangling = danglingConnectorRegex.test(currentPendingText) || pendingWords < 4;
                  if (!isPendingDangling) {
                    flushCurrentSentence();
                  }
                }

                if (!pendingSentence) {
                  pendingSentence = {
                    startMs: estStart,
                    endMs: estStart + estDuration,
                    speakerIndex,
                    speakerName: fallbackSpeaker,
                    fragments: [cleanText],
                  };
                } else {
                  pendingSentence.endMs = Math.max(pendingSentence.endMs, estStart + estDuration);
                  pendingSentence.fragments.push(cleanText);
                }

                const fullText = joinSentenceFragments(pendingSentence.fragments);
                const wordCount = fullText.split(/\s+/).filter(Boolean).length;

                const isDangling = danglingConnectorRegex.test(cleanText) || danglingConnectorRegex.test(fullText);

                const hasTerminalPunct = wordCount >= 5 && /[.?!]$/.test(cleanText) && !isDangling;
                const hasClauseBreak = wordCount >= 12 && /[,;:]$/.test(cleanText) && !isDangling;
                const isTooLong = wordCount >= 20 || fullText.length >= 135;

                if (hasTerminalPunct || hasClauseBreak || isTooLong) {
                  flushCurrentSentence();
                } else {
                  if (!session.closed) {
                    session.send({ type: 'interim', text: fullText });
                  }
                  if (sentenceFlushTimer) clearTimeout(sentenceFlushTimer);
                  const silenceDelay = isDangling ? 3200 : (wordCount < 4 ? 2800 : 1800);
                  sentenceFlushTimer = setTimeout(() => {
                    flushCurrentSentence();
                  }, silenceDelay);
                }
              }
            },
          }), limits.audioConnectTimeoutMs, providerController);
        } catch (err) {
          console.error('[Gateway] Échec connexion au fournisseur audio:', err);
          if (!session.closed) fatal('AUDIO_FAILED', `Audio provider could not connect: ${err.message || 'unknown'}`, 1011);
          return;
        }
        if (session.closed) { audio.close(); return; }
      }
      if (!session.finishing) { state = 'ready'; session.send({ type: 'ready' }); }
    }
    ws.on('message', (data, binary) => {
      if (session.closed) return;
      const now = performance.now();
      const elapsed = (now - rateTime) / 1000;
      rateTime = now;
      messageTokens = Math.min(limits.messagesPerSecond * 2, messageTokens + elapsed * limits.messagesPerSecond) - 1;
      byteTokens = Math.min(limits.bytesPerSecond * 2, byteTokens + elapsed * limits.bytesPerSecond) - data.length;
      if (messageTokens < 0 || byteTokens < 0) { fatal('RATE_LIMIT', 'Message rate limit exceeded.'); return; }
      if (binary) {
        if (state !== 'ready' || mode !== 'audio' || session.finishing || !data.length || data.length % 2 !== 0) {
          session.error('INVALID_AUDIO', 'Expected PCM16 audio in an active audio session.');
          return;
        }
        try {
          audio.send(data);
        } catch (err) {
          console.warn('[Gateway] Warning on audio.send:', err.message);
        }
        return;
      }
      let message;
      try { message = JSON.parse(data.toString('utf8')); } catch { fatal('INVALID_JSON', 'Expected a JSON message.'); return; }
      if (!isObject(message)) { fatal('INVALID_MESSAGE', 'Expected a JSON object.'); return; }
      if (state === 'auth') {
        if (message.type !== 'start') fatal('START_REQUIRED', 'The first message must authenticate with start.');
        else void start(message);
        return;
      }
      if (message.type === 'finish') { finish(); return; }
      if (message.type === 'copilot-ask') {
        if (typeof message.query === 'string' && message.query.trim()) {
          try {
            audio?.sendPrompt?.(message.query.trim());
          } catch {
            session.error('COPILOT_FAILED', 'Le copilote n’est pas disponible.');
          }
        }
        return;
      }
      if (message.type === 'visual-frame') {
        if (typeof message.data === 'string' && message.data.length < 500000) {
          try {
            audio?.sendFrame?.(message.data);
          } catch {}
        }
        return;
      }
      if (state !== 'ready' || session.finishing) { session.error('NOT_READY', 'Session is not accepting new input.'); return; }
      if (mode !== 'captions' || !validateCaption(message, limits.maxTextLength)) {
        session.error('INVALID_CAPTION', 'Expected a valid final caption with timestamps and speakerName.');
        return;
      }
      enqueue({ id: message.id, startMs: message.startMs, endMs: message.endMs,
        sourceText: message.sourceText, speakerName: message.speakerName,
        speakerStatus: message.speakerName === null ? 'unknown' : 'identified', status: 'final' });
    });
    ws.on('error', (error) => {
      console.warn('[Gateway] WebSocket client error:', error.message);
      session.error(error.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH' ? 'MESSAGE_TOO_LARGE' : 'CONNECTION_ERROR',
        'Connection failed; session is incomplete.');
      cleanup();
      armClose();
    });
    ws.on('close', (code, reason) => {
      console.log(`[Gateway] WebSocket client disconnected (code: ${code}, reason: ${reason?.toString() || 'none'})`);
      cleanup();
      clearTimeout(closeTimer);
    });
  });

  return {
    server,
    listen(port = Number(env.PORT || 8787)) {
      if (!Number.isInteger(port) || port < 0 || port > 65535) return Promise.reject(new Error('Invalid PORT.'));
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address()); });
      });
    },
    async close() {
      shuttingDown = true;
      for (const session of sessions) session.shutdown();
      await Promise.all([
        new Promise((resolve) => wss.close(resolve)),
        new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); }),
      ]);
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const gateway = createGateway();
  try {
    const address = await gateway.listen();
    console.log(`Language gateway listening on http://127.0.0.1:${address.port}`);
    const shutdown = () => { void gateway.close(); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch {
    console.error('Language gateway could not start. Check local configuration and port availability.');
    process.exitCode = 1;
  }
}

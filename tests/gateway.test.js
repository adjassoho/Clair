import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGateway } from '../server/index.js';
import { createGeminiTranslator } from '../server/providers.js';

test('createGeminiTranslator formats request and parses candidate text', async () => {
  let requestUrl;
  let requestBody;
  const mockFetch = async (url, options) => {
    requestUrl = url;
    requestBody = JSON.parse(options.body);
    const responsePayload = JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: 'Bonjour, ceci est un test de réunion.' }],
            role: 'model',
          },
          finishReason: 'STOP',
        },
      ],
    });
    return {
      ok: true,
      body: {
        getReader() {
          let readOnce = false;
          return {
            read: async () => {
              if (readOnce) return { done: true };
              readOnce = true;
              return { done: false, value: Buffer.from(responsePayload) };
            },
            cancel: async () => {},
            releaseLock: () => {},
          };
        },
      },
    };
  };

  const translator = createGeminiTranslator({
    apiKey: 'test-gemini-key',
    model: 'gemini-2.0-flash',
    fetchImpl: mockFetch,
  });

  const result = await translator('Hello, this is a meeting test.');
  assert.equal(result, 'Bonjour, ceci est un test de réunion.');
  assert.match(requestUrl, /models\/gemini-2\.0-flash:generateContent\?key=test-gemini-key/);
  assert.equal(requestBody.contents[0].parts[0].text, 'Hello, this is a meeting test.');
  assert.match(requestBody.systemInstruction.parts[0].text, /French translation/);
});

test('createGeminiTranslator handles API error and rejects cleanly', async () => {
  const mockFetch = async () => ({
    ok: false,
    body: { cancel: async () => {} },
  });

  const translator = createGeminiTranslator({
    apiKey: 'bad-key',
    fetchImpl: mockFetch,
  });

  await assert.rejects(
    () => translator('Hello'),
    /Gemini translation provider rejected the request/
  );
});

test('createGateway /health endpoint reports Gemini and Gemini Live configuration', async () => {
  const gateway = createGateway({
    env: {
      GATEWAY_TOKEN: '1234567890123456',
      GEMINI_API_KEY: 'test-gemini-key',
      GEMINI_LIVE_MODEL: 'gemini-3.8-live',
      PORT: '0',
    },
  });

  const address = await gateway.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.gatewayConfigured, true);
    assert.equal(data.translationConfigured, true);
    assert.equal(data.provider, 'gemini');
    assert.equal(data.audioConfigured, true);
    assert.equal(data.audioProvider, 'gemini-3.8-live');
  } finally {
    await gateway.close();
  }
});

test('createGateway connects via WebSocket, authenticates and processes caption with mock translator', async () => {
  const mockTranslate = async (text) => `Traduction: ${text}`;
  const gateway = createGateway({
    env: {
      GATEWAY_TOKEN: 'secret-token-12345678',
      PORT: '0',
    },
    translate: mockTranslate,
  });

  const address = await gateway.listen(0);
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}`, {
      headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' },
    });

    const messages = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    await new Promise((resolve) => ws.once('open', resolve));

    // Authentification
    ws.send(JSON.stringify({
      type: 'start',
      token: 'secret-token-12345678',
      mode: 'captions',
      sourceLanguage: 'en',
      targetLanguage: 'fr',
    }));

    // Attendre ready
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (messages.some((m) => m.type === 'ready')) {
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    // Envoi d'un segment de sous-titre
    ws.send(JSON.stringify({
      type: 'caption',
      id: 'cap-1',
      startMs: 1000,
      endMs: 3000,
      sourceText: 'Welcome everyone to the sprint review.',
      speakerName: 'Sarah Martin',
      status: 'final',
    }));

    // Attendre la traduction du segment
    const segmentMsg = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout en attente du segment traduit')), 4000);
      const check = setInterval(() => {
        const found = messages.find((m) => m.type === 'segment');
        if (found) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve(found);
        }
      }, 20);
    });

    assert.equal(segmentMsg.segment.id, 'cap-1');
    assert.equal(segmentMsg.segment.speakerName, 'Sarah Martin');
    assert.equal(segmentMsg.segment.speakerStatus, 'identified');
    assert.equal(segmentMsg.segment.translatedText, 'Traduction: Welcome everyone to the sprint review.');

    ws.close();
  } finally {
    await gateway.close();
  }
});

test('createGateway handles audio mode with direct translation, copilot and visual frames', async () => {
  let promptReceived = null;
  let frameReceived = null;
  let pcmChunks = 0;

  const mockLiveProvider = async ({ onResult, onAudioOut }) => {
    return {
      send(pcm) {
        pcmChunks++;
        // Simulate immediate live translated output from Gemini 3.8 Live
        onResult({
          translatedText: 'Traduction directe en temps réel.',
          start: 0,
          duration: 2,
        });
        onAudioOut?.('base64audio');
      },
      sendFrame(frame) {
        frameReceived = frame;
      },
      sendPrompt(query) {
        promptReceived = query;
      },
      finish() {},
      close() {},
    };
  };

  const gateway = createGateway({
    env: {
      GATEWAY_TOKEN: 'secret-token-12345678',
      GEMINI_API_KEY: 'test-key',
      PORT: '0',
    },
    audioProvider: mockLiveProvider,
    translate: async (text) => text,
  });

  const address = await gateway.listen(0);
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}`, {
      headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' },
    });

    const messages = [];
    ws.on('message', (data, isBinary) => {
      if (!isBinary) messages.push(JSON.parse(data.toString()));
    });

    await new Promise((resolve) => ws.once('open', resolve));

    ws.send(JSON.stringify({
      type: 'start',
      token: 'secret-token-12345678',
      mode: 'audio',
      sourceLanguage: 'en',
      targetLanguage: 'fr',
    }));

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout en attente du ready message')), 4000);
      const check = setInterval(() => {
        if (messages.some((m) => m.type === 'ready')) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    // Envoi d'un chunk audio binaire (PCM16)
    const fakePcm = Buffer.alloc(3200); // 100ms de PCM16
    ws.send(fakePcm);

    // Envoi d'une frame visuelle
    ws.send(JSON.stringify({
      type: 'visual-frame',
      data: 'fake_jpeg_base64_data',
    }));

    // Envoi d'une question copilote
    ws.send(JSON.stringify({
      type: 'copilot-ask',
      query: 'Qui a pris la parole ?',
    }));

    // Attendre le segment et l'audio-out
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout en attente des retours audio/copilote')), 4000);
      const check = setInterval(() => {
        const hasSegment = messages.some((m) => m.type === 'segment');
        const hasAudioOut = messages.some((m) => m.type === 'audio-out');
        if (hasSegment && hasAudioOut && promptReceived && frameReceived) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    assert.equal(pcmChunks, 1);
    assert.equal(frameReceived, 'fake_jpeg_base64_data');
    assert.equal(promptReceived, 'Qui a pris la parole ?');
    const segment = messages.find((m) => m.type === 'segment');
    assert.equal(segment.segment.translatedText, 'Traduction directe en temps réel.');
    const audioOut = messages.find((m) => m.type === 'audio-out');
    assert.equal(audioOut.data, 'base64audio');

    ws.close();
  } finally {
    await gateway.close();
  }
});

test('createGateway /api/export-full processes synthesis and serves downloads', async () => {
  const gateway = createGateway({
    env: {
      GATEWAY_TOKEN: '1234567890123456',
      PORT: '0',
    },
  });

  const address = await gateway.listen(0);
  try {
    const payload = {
      token: '1234567890123456',
      session: {
        id: 'test-session',
        startedAt: '2026-09-16T10:00:00Z',
        durationMs: 30000,
      },
      segments: [
        { startMs: 1000, endMs: 5000, speakerName: 'Prof', translatedText: 'Voici le cours sur les algorithmes.' },
      ],
      videoBase64: Buffer.from('TEST_VIDEO_BYTES_FOR_EXPORT').toString('base64'),
      srtContent: '1\n00:00:01,000 --> 00:00:05,000\nVoici le cours.\n',
      synthesisMode: 'course',
    };

    const res = await fetch(`http://127.0.0.1:${address.port}/api/export-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(data.video, 'video object should be present');
    assert.ok(data.video.downloadUrl, 'video download URL should be present');

    // Téléchargement du fichier vidéo
    const videoRes = await fetch(`http://127.0.0.1:${address.port}${data.video.downloadUrl}`);
    assert.equal(videoRes.status, 200);
    const videoBuffer = await videoRes.arrayBuffer();
    assert.ok(videoBuffer.byteLength > 0, 'Downloaded video should not be empty');
  } finally {
    await gateway.close();
  }
});

test('createGateway /api/export-meta and binary /api/export-full handles large session metadata without header limits', async () => {
  const gateway = createGateway({
    env: {
      GATEWAY_TOKEN: '1234567890123456',
      PORT: '0',
    },
  });

  const address = await gateway.listen(0);
  try {
    const metaPayload = {
      token: '1234567890123456',
      session: {
        id: 'discrete-session-123',
        startedAt: '2026-09-18T14:00:00Z',
        durationMs: 45000,
      },
      segments: [
        { startMs: 500, endMs: 4000, speakerName: 'Directeur', translatedText: 'Bonjour à tous pour ce point discret.' },
        { startMs: 4500, endMs: 8000, speakerName: 'Directeur', translatedText: 'Les résultats sont excellents ce trimestre.' },
      ],
      srtContent: '1\n00:00:00,500 --> 00:00:04,000\nDirecteur : Bonjour à tous pour ce point discret.\n\n2\n00:00:04,500 --> 00:00:08,000\nDirecteur : Les résultats sont excellents ce trimestre.\n',
      synthesisMode: 'meeting',
    };

    const metaRes = await fetch(`http://127.0.0.1:${address.port}/api/export-meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaPayload),
    });

    assert.equal(metaRes.status, 200);
    const metaJson = await metaRes.json();
    assert.equal(metaJson.ok, true);
    assert.ok(metaJson.exportId, 'exportId must be returned');

    // Envoi du flux vidéo binaire avec exportId
    const fakeVideoBuffer = Buffer.from('DISCRETE_SESSION_VIDEO_STREAM_BYTES');
    const uploadRes = await fetch(`http://127.0.0.1:${address.port}/api/export-full?exportId=${encodeURIComponent(metaJson.exportId)}`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer 1234567890123456',
        'Content-Type': 'video/webm',
      },
      body: fakeVideoBuffer,
    });

    assert.equal(uploadRes.status, 200);
    const uploadJson = await uploadRes.json();
    assert.equal(uploadJson.ok, true);
    assert.ok(uploadJson.video, 'video object must be returned');
    assert.ok(uploadJson.video.downloadUrl, 'download URL must be present');

    const dlRes = await fetch(`http://127.0.0.1:${address.port}${uploadJson.video.downloadUrl}`);
    assert.equal(dlRes.status, 200);
    const dlBuf = await dlRes.arrayBuffer();
    assert.ok(dlBuf.byteLength > 0);
  } finally {
    await gateway.close();
  }
});

test('createGateway streams interim audio results and delivers provisional then final translated segments', async () => {
  let interimSent = false;
  let resultSent = false;

  const mockAudioProvider = async ({ onInterim, onResult }) => {
    return {
      send(pcm) {
        if (!interimSent) {
          interimSent = true;
          onInterim?.('Hello everyone');
        } else if (!resultSent) {
          resultSent = true;
          onResult({
            sourceText: 'Hello everyone, welcome.',
            start: 0,
            duration: 2,
          });
        }
      },
      finish() {},
      close() {},
    };
  };

  const gateway = createGateway({
    env: {
      GATEWAY_TOKEN: 'secret-token-12345678',
      GEMINI_API_KEY: 'test-key',
      PORT: '0',
    },
    audioProvider: mockAudioProvider,
    translate: async (text) => `Bonjour: ${text}`,
  });

  const address = await gateway.listen(0);
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}`, {
      headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' },
    });

    const messages = [];
    ws.on('message', (data, isBinary) => {
      if (!isBinary) messages.push(JSON.parse(data.toString()));
    });

    await new Promise((resolve) => ws.once('open', resolve));

    ws.send(JSON.stringify({
      type: 'start',
      token: 'secret-token-12345678',
      mode: 'audio',
      sourceLanguage: 'en',
      targetLanguage: 'fr',
    }));

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout en attente du ready message')), 4000);
      const check = setInterval(() => {
        if (messages.some((m) => m.type === 'ready')) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    // Envoi du premier chunk -> déclenche interim
    ws.send(Buffer.alloc(3200));

    // Attendre message interim
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout interim')), 4000);
      const check = setInterval(() => {
        const found = messages.find((m) => m.type === 'interim' && m.text === 'Hello everyone');
        if (found) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    // Envoi du second chunk -> déclenche segment final STT
    ws.send(Buffer.alloc(3200));

    // Attendre segment provisoire ET segment final traduit
    const { provisional, final } = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout segments')), 4000);
      const check = setInterval(() => {
        const prov = messages.find((m) => m.type === 'segment' && m.segment.status === 'provisional');
        const fin = messages.find((m) => m.type === 'segment' && m.segment.status === 'final');
        if (prov && fin) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve({ provisional: prov, final: fin });
        }
      }, 20);
    });

    assert.equal(provisional.segment.sourceText, 'Hello everyone, welcome.');
    assert.equal(provisional.segment.translatedText, 'Hello everyone, welcome.');
    assert.equal(final.segment.translatedText, 'Bonjour: Hello everyone, welcome.');
    assert.equal(provisional.segment.id, final.segment.id);

    ws.close();
  } finally {
    await gateway.close();
  }
});

test('createGateway attributes fallback speaker from speakerIndex when audio provider supplies it', async () => {
  const mockAudioProvider = async ({ onResult }) => {
    return {
      send(pcm) {
        onResult({
          sourceText: 'Good morning, this is speaker two.',
          start: 0,
          duration: 3,
          speakerIndex: 1,
        });
      },
      finish() {},
      close() {},
    };
  };

  const gateway = createGateway({
    env: {
      GATEWAY_TOKEN: 'secret-token-12345678',
      GEMINI_API_KEY: 'test-key',
      PORT: '0',
    },
    audioProvider: mockAudioProvider,
    translate: async (text) => `Bonjour: ${text}`,
  });

  const address = await gateway.listen(0);
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}`, {
      headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' },
    });
    const messages = [];
    ws.on('message', (data, isBinary) => {
      if (!isBinary) messages.push(JSON.parse(data.toString()));
    });
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({
      type: 'start',
      token: 'secret-token-12345678',
      mode: 'audio',
      sourceLanguage: 'en',
      targetLanguage: 'fr',
    }));

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout ready')), 4000);
      const check = setInterval(() => {
        if (messages.some((m) => m.type === 'ready')) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    ws.send(Buffer.alloc(3200));

    const final = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout segment')), 4000);
      const check = setInterval(() => {
        const found = messages.find((m) => m.type === 'segment' && m.segment.status === 'final');
        if (found) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve(found);
        }
      }, 20);
    });

    assert.equal(final.segment.speakerName, 'Intervenant 2');
    assert.equal(final.segment.speakerStatus, 'identified');
    assert.equal(final.segment.translatedText, 'Bonjour: Good morning, this is speaker two.');

    ws.close();
  } finally {
    await gateway.close();
  }
});

test('createGateway aggregates sentence fragments into one coherent sentence before translation', async () => {
  let emitCount = 0;
  let savedOnResult = null;

  const mockAudioProvider = async ({ onResult }) => {
    savedOnResult = onResult;
    return {
      send(pcm) {
        emitCount++;
        if (emitCount === 1) {
          savedOnResult({ sourceText: 'Artificial', start: 0, duration: 1 });
        } else if (emitCount === 2) {
          savedOnResult({ sourceText: 'intelligence is the use of computers to make automated', start: 1, duration: 2 });
        } else if (emitCount === 3) {
          savedOnResult({ sourceText: 'decisions or predictions.', start: 3, duration: 1.5 });
        }
      },
      finish() {},
      close() {},
    };
  };

  const gateway = createGateway({
    env: {
      GATEWAY_TOKEN: 'secret-token-12345678',
      GEMINI_API_KEY: 'test-key',
      PORT: '0',
    },
    audioProvider: mockAudioProvider,
    translate: async (text) => `Bonjour: ${text}`,
  });

  const address = await gateway.listen(0);
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}`, {
      headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' },
    });
    const messages = [];
    ws.on('message', (data, isBinary) => {
      if (!isBinary) messages.push(JSON.parse(data.toString()));
    });

    await new Promise((resolve) => ws.once('open', resolve));

    ws.send(JSON.stringify({
      type: 'start',
      token: 'secret-token-12345678',
      mode: 'audio',
      sourceLanguage: 'en',
      targetLanguage: 'fr',
    }));

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout ready')), 4000);
      const check = setInterval(() => {
        if (messages.some((m) => m.type === 'ready')) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    // Envoyer les 3 chunks
    ws.send(Buffer.alloc(3200));
    ws.send(Buffer.alloc(3200));
    ws.send(Buffer.alloc(3200));

    // Attendre le segment final
    const final = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout segment agrégé')), 4000);
      const check = setInterval(() => {
        const found = messages.find((m) => m.type === 'segment' && m.segment.status === 'final');
        if (found) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve(found);
        }
      }, 20);
    });

    const finalSegments = messages.filter((m) => m.type === 'segment' && m.segment.status === 'final');
    assert.equal(finalSegments.length, 1, 'Should produce exactly 1 aggregated final segment, not 3 fragmented ones');
    assert.equal(final.segment.sourceText, 'Artificial intelligence is the use of computers to make automated decisions or predictions.');
    assert.equal(final.segment.translatedText, 'Bonjour: Artificial intelligence is the use of computers to make automated decisions or predictions.');
    assert.equal(final.segment.startMs, 0);
    assert.equal(final.segment.endMs, 4500);

    ws.close();
  } finally {
    await gateway.close();
  }
});


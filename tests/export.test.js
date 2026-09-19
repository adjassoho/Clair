import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildExport, buildManifest, buildSrt, buildText } from '../extension/export.js';

const session = {
  id: 'demo', startedAt: '2026-09-16T14:00:00Z', durationMs: 30000,
  sourceLanguage: 'en', targetLanguage: 'fr', status: 'complete',
};

function segment(id, startMs, endMs, overrides = {}) {
  return {
    id, startMs, endMs, sourceText: 'SOURCE_ENGLISH_MUST_NOT_LEAK',
    translatedText: 'Bonjour, voici le tableau.', speakerName: 'Sarah Martin',
    speakerStatus: 'identified', status: 'final', ...overrides,
  };
}

// These bytes are ZIP fixtures, not playable recordings or evidence of capture support.
function clip(id, startMs, endMs, overrides = {}) {
  return {
    id, sessionStartMs: startMs, sessionEndMs: endMs, durationMs: endMs - startMs,
    width: 1280, height: 720, hasAudio: true, mimeType: 'video/webm;codecs=vp9,opus',
    status: 'complete', blob: new Blob(['123456789'], { type: 'video/webm' }), ...overrides,
  };
}

function fixture() {
  return {
    segments: [
      segment('early', 1000, 2000),
      segment('boundary', 4000, 7000),
      segment('overlap', 6000, 8000, { speakerName: 'David' }),
      segment('gap', 10000, 20000, { speakerName: 'Do not invent this name', speakerStatus: 'unknown' }),
      segment('spanning', 9000, 22000),
      segment('second', 20000, 23000, { speakerName: null }),
      segment('after', 25000, 26000),
    ],
    clips: [clip('a', 5000, 10000), clip('b', 20000, 25000)],
  };
}

// Independent bitwise implementation, intentionally not the exporter's table algorithm.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function unzipStored(blob) {
  assert.equal(blob.type, 'application/zip');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 4, true), 0);
  assert.equal(view.getUint16(end + 6, true), 0);
  assert.equal(view.getUint16(end + 20, true), 0);
  const count = view.getUint16(end + 10, true);
  assert.equal(view.getUint16(end + 8, true), count);
  const centralSize = view.getUint32(end + 12, true);
  const centralStart = view.getUint32(end + 16, true);
  assert.equal(centralStart + centralSize, end);
  let directory = centralStart;
  let localEnd = 0;
  const files = new Map();
  for (let index = 0; index < count; index++) {
    assert.equal(view.getUint32(directory, true), 0x02014b50);
    assert.equal(view.getUint16(directory + 6, true), 20);
    assert.equal(view.getUint16(directory + 8, true), 0x0800);
    assert.equal(view.getUint16(directory + 10, true), 0);
    assert.equal(view.getUint16(directory + 12, true), 0);
    assert.equal(view.getUint16(directory + 14, true), 0x21);
    const crc = view.getUint32(directory + 16, true);
    const size = view.getUint32(directory + 20, true);
    assert.equal(view.getUint32(directory + 24, true), size);
    const nameLength = view.getUint16(directory + 28, true);
    assert.equal(view.getUint16(directory + 30, true), 0);
    assert.equal(view.getUint16(directory + 32, true), 0);
    assert.equal(view.getUint16(directory + 34, true), 0);
    const offset = view.getUint32(directory + 42, true);
    assert.equal(offset, localEnd);
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    assert.equal(view.getUint16(offset + 4, true), 20);
    assert.equal(view.getUint16(offset + 6, true), 0x0800);
    assert.equal(view.getUint16(offset + 8, true), 0);
    assert.equal(view.getUint32(offset + 14, true), crc);
    assert.equal(view.getUint32(offset + 18, true), size);
    assert.equal(view.getUint32(offset + 22, true), size);
    assert.equal(view.getUint16(offset + 26, true), nameLength);
    assert.equal(view.getUint16(offset + 28, true), 0);
    const nameBytes = bytes.subarray(directory + 46, directory + 46 + nameLength);
    assert.deepEqual(bytes.subarray(offset + 30, offset + 30 + nameLength), nameBytes);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    assert.match(name, /^session-[A-Za-z0-9_-]+\/(?:index\.html|session\.json|transcription\.fr\.txt|videos\/clip-\d+\.(?:webm|mp4|ogv)|sous-titres\/clip-\d+\.fr\.srt)$/);
    assert.equal(files.has(name), false);
    const contents = bytes.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
    assert.equal(crc32(contents), crc, `CRC for ${name}`);
    files.set(name, { contents, crc, text: () => new TextDecoder().decode(contents) });
    localEnd = offset + 30 + nameLength + size;
    directory += 46 + nameLength;
  }
  assert.equal(directory, end);
  assert.equal(localEnd, centralStart);
  return files;
}

function embedded(html) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2, 'Exactly one JSON block and one static script');
  return { manifest: JSON.parse(scripts[0][1]), json: scripts[0][1], script: scripts[1][1] };
}

test('manifest follows section 15 and derives half-open intersections across a recording gap', () => {
  const { segments, clips } = fixture();
  const manifest = buildManifest(session, segments, clips);
  assert.equal(manifest.schemaVersion, '1.0');
  assert.equal(manifest.session.platform, 'microsoft-teams-web');
  assert.equal(manifest.session.status, 'complete');
  assert.deepEqual(manifest.speakers, [
    { id: 'speaker-001', displayName: 'Sarah Martin' },
    { id: 'speaker-002', displayName: 'David' },
  ]);
  for (const id of ['gap', 'second']) {
    const item = manifest.segments.find((entry) => entry.id === id);
    assert.equal(item.speakerId, null);
    assert.equal(item.speakerStatus, 'unknown');
  }
  assert.deepEqual(manifest.mediaLinks, [
    { segmentId: 'boundary', clipId: 'a', sessionStartMs: 5000, sessionEndMs: 7000, mediaStartMs: 0, mediaEndMs: 2000 },
    { segmentId: 'overlap', clipId: 'a', sessionStartMs: 6000, sessionEndMs: 8000, mediaStartMs: 1000, mediaEndMs: 3000 },
    { segmentId: 'spanning', clipId: 'a', sessionStartMs: 9000, sessionEndMs: 10000, mediaStartMs: 4000, mediaEndMs: 5000 },
    { segmentId: 'spanning', clipId: 'b', sessionStartMs: 20000, sessionEndMs: 22000, mediaStartMs: 0, mediaEndMs: 2000 },
    { segmentId: 'second', clipId: 'b', sessionStartMs: 20000, sessionEndMs: 23000, mediaStartMs: 0, mediaEndMs: 3000 },
  ]);
  assert.equal(JSON.stringify(manifest).includes('sourceText'), false);
  assert.equal(JSON.stringify(manifest).includes('SOURCE_ENGLISH_MUST_NOT_LEAK'), false);
  assert.equal(JSON.stringify(manifest).includes('Do not invent this name'), false);
  assert.equal('blob' in manifest.clips[0], false);
  assert.equal(manifest.clips[0].mimeType, 'video/webm');
  assert.equal(manifest.clips[0].file, 'videos/clip-001.webm');
});

test('manifest normalizes speakers and sorts segments without mutating caller data', () => {
  const first = Object.freeze(segment('first', 0, 1000, { speakerName: '  Sarah Martin  ' }));
  const second = Object.freeze(segment('second', 1000, 2000));
  const segments = Object.freeze([second, first]);
  const manifest = buildManifest(Object.freeze({ ...session }), segments, Object.freeze([]));
  assert.deepEqual(manifest.segments.map((item) => item.id), ['first', 'second']);
  assert.equal(manifest.speakers.length, 1);
  assert.equal(manifest.segments[0].speakerId, manifest.segments[1].speakerId);
  manifest.segments[0].translatedText = 'Modification';
  assert.equal(first.translatedText, 'Bonjour, voici le tableau.');
  assert.equal(segments[0], second);
});

test('TXT uses session times; SRT uses bounded per-clip times and normalized speakers', () => {
  const { segments, clips } = fixture();
  const manifest = buildManifest(session, segments, clips);
  const text = buildText(manifest);
  assert.match(text, /\[00:00:04\.000 --> 00:00:07\.000\]\nSarah Martin : Bonjour/);
  assert.match(text, /\[00:00:10\.000 --> 00:00:20\.000\]\nIntervenant inconnu/);
  assert.doesNotMatch(text, /SOURCE_ENGLISH|sourceText/);
  assert.equal(buildSrt(manifest, 'a'),
    '1\n00:00:00,000 --> 00:00:02,000\nSarah Martin : Bonjour, voici le tableau.\n\n'
    + '2\n00:00:01,000 --> 00:00:03,000\nDavid : Bonjour, voici le tableau.\n\n'
    + '3\n00:00:04,000 --> 00:00:05,000\nSarah Martin : Bonjour, voici le tableau.\n\n');
  assert.match(buildSrt(manifest, 'b'), /00:00:00,000 --> 00:00:03,000\nIntervenant inconnu/);
  assert.throws(() => buildSrt(manifest, 'missing'), /Unknown clip reference/);
  assert.equal(buildSrt(buildManifest(session, [], clips), 'a'), '');
});

test('SRT safely handles markup, multiline text, Unicode, millisecond carry and long sessions', () => {
  const durationMs = 100 * 3600000;
  const start = 99 * 3600000 + 59999.6;
  const manifest = buildManifest({ ...session, durationMs }, [segment('long', start, start + 1000, {
    translatedText: '<b>\u00c9t\u00e9</b> & amis\n\n2\n00:00:00,000 --> 00:00:01,000\nTexte',
  })], [clip('long', 0, durationMs)]);
  const srt = buildSrt(manifest, 'long');
  assert.match(srt, /99:01:00,000 --> 99:01:01,000/);
  assert.match(srt, /&lt;b&gt;\u00c9t\u00e9&lt;\/b&gt; &amp; amis 2/);
  assert.equal(srt.trim().split('\n').length, 3);
  assert.doesNotMatch(srt, /<b>/);
});

test('incomplete session, clips, provisional segments and missing translations propagate', () => {
  const final = segment('s', 0, 1000);
  const completeClip = clip('c', 0, 1000);
  const variants = [
    [{ ...session, status: 'recording' }, [final], [completeClip]],
    [session, [{ ...final, status: 'provisional' }], [completeClip]],
    [session, [{ ...final, status: 'incomplete' }], [completeClip]],
    [session, [{ ...final, translatedText: ' ' }], [completeClip]],
    [session, [final], [{ ...completeClip, status: 'incomplete' }]],
  ];
  for (const args of variants) {
    const manifest = buildManifest(...args);
    assert.equal(manifest.session.status, 'incomplete');
    assert.match(buildText(manifest), /Etat : incomplet/);
  }
  const manifest = buildManifest(session, [{ ...final, status: 'incomplete' }], [{ ...completeClip, status: 'incomplete' }]);
  assert.equal(manifest.segments[0].status, 'incomplete');
  assert.equal(manifest.clips[0].status, 'incomplete');
  assert.match(buildText(manifest), /\[incomplet\]/);
});

test('incident allowlist removes arbitrary messages, provider details and secrets', () => {
  const incidents = [
    { type: 'translation-error', startMs: 1, endMs: 2, message: 'Bearer SECRET', token: 'SECRET', sourceText: 'ENGLISH' },
    { type: 'https://SECRET', startMs: 3, endMs: 4, message: '</script><script>SECRET</script>' },
  ];
  const manifest = buildManifest({ ...session, token: 'SECRET' }, [], [], incidents);
  assert.deepEqual(manifest.incidents, [
    { type: 'translation-error', startMs: 1, endMs: 2, message: "Une traduction n'a pas pu etre finalisee." },
    { type: 'other', startMs: 3, endMs: 4, message: 'Un incident a ete signale pendant la session.' },
  ]);
  assert.equal(manifest.session.status, 'incomplete');
  assert.doesNotMatch(JSON.stringify(manifest), /SECRET|ENGLISH|Bearer|token/);
  assert.equal(buildManifest(session, [], [], [{ type: 'pause', startMs: 1, endMs: 2 }]).session.status, 'complete');
});

test('rejects malformed times, identities, metadata and duration mismatches', () => {
  for (const value of [-1, NaN, Infinity, -Infinity, '100', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildManifest({ ...session, durationMs: value }, [], []), /millisecond/);
    assert.throws(() => buildManifest(session, [segment('s', value, 1000)], []));
    assert.throws(() => buildManifest(session, [], [clip('c', 0, 1000, { durationMs: value })]));
  }
  for (const [start, end] of [[1000, 1000], [2000, 1000], [0, 30001], [0, Infinity]]) {
    assert.throws(() => buildManifest(session, [segment('s', start, end)], []));
    assert.throws(() => buildManifest(session, [], [clip('c', start, end)]));
  }
  for (const id of ['', ' ', null, 123]) assert.throws(() => buildManifest({ ...session, id }, [], []));
  assert.throws(() => buildManifest(session, [segment('s', 0, 1000), segment('s', 1000, 2000)], []), /Duplicate segment/);
  assert.throws(() => buildManifest(session, [], [clip('c', 0, 1000), clip('c', 1000, 2000)]), /Duplicate clip/);
  assert.throws(() => buildManifest(session, [], [clip('c', 0, 1000, { durationMs: 999 })]), /exactly match/);
  for (const overrides of [{ width: 0 }, { height: 1.5 }, { hasAudio: false }, { mimeType: 'text/html' }, { status: 'recording' }]) {
    assert.throws(() => buildManifest(session, [], [clip('c', 0, 1000, overrides)]));
  }
  for (const overrides of [{ translatedText: null }, { speakerName: {} }, { speakerStatus: 'guess' }, { status: 'guess' }]) {
    assert.throws(() => buildManifest(session, [segment('s', 0, 1000, overrides)], []));
  }
  assert.throws(() => buildManifest({ ...session, startedAt: 'invalid' }, [], []), /startedAt/);
  assert.throws(() => buildManifest({ ...session, targetLanguage: 'de' }, [], []), /en to fr/);
  assert.throws(() => buildManifest(session, [], [], [{ startMs: 1, endMs: 1 }]), /start < end/);
  assert.throws(() => buildManifest(session, null, []), /arrays/);
});

test('export ZIP has matching local/central headers, CRC, UTF-8 contents and actual supplied Blob bytes', async () => {
  const { segments, clips } = fixture();
  segments[0].translatedText = '\u00c9t\u00e9, fran\u00e7ais et \u6771\u4eac';
  const blob = await buildExport(session, segments, clips);
  const files = await unzipStored(blob);
  assert.equal(files.size, 7);
  const manifest = JSON.parse(files.get('session-demo/session.json').text());
  assert.deepEqual(manifest, buildManifest(session, segments, clips));
  assert.equal(files.get('session-demo/transcription.fr.txt').text(), buildText(manifest));
  for (const entry of manifest.clips) {
    assert.equal(files.get(`session-demo/${entry.file}`).text(), '123456789');
    assert.equal(files.get(`session-demo/${entry.file}`).crc, 0xcbf43926);
    assert.equal(files.get(`session-demo/${entry.subtitleFile}`).text(), buildSrt(manifest, entry.id));
  }
  const html = files.get('session-demo/index.html').text();
  assert.deepEqual(embedded(html).manifest, manifest);
  assert.doesNotMatch(html, /fetch\s*\(|https?:\/\/|<script[^>]+src=|<link\b|<track\b|innerHTML|document\.write/);
  assert.match(html, /<video[^>]*controls/);
  assert.match(html, /@media\(max-width:800px\)/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /textContent/);
  assert.match(html, /Media absent/);
  assert.match(html, /Sans video/);
});

test('embedded JSON resists closing-script injection and all archive paths are generated', async () => {
  const injection = '</script><script>globalThis.pwned=true</script><img src=x onerror=alert(1)>&\u2028\u2029';
  const unsafeSession = { ...session, id: '../\\evil:session?\u00e9' };
  const segments = [segment(injection, 0, 1000, { translatedText: injection, speakerName: injection })];
  const clips = [clip(injection, 0, 1000, {
    file: '../../index.html', subtitleFile: 'https://example.invalid/evil', path: '/etc/passwd',
  })];
  const files = await unzipStored(await buildExport(unsafeSession, segments, clips));
  const html = [...files].find(([name]) => name.endsWith('/index.html'))[1].text();
  const data = embedded(html);
  assert.equal(data.manifest.segments[0].translatedText, injection);
  assert.equal(data.manifest.speakers[0].displayName, injection);
  assert.doesNotMatch(data.json, /[<>&\u2028\u2029]/);
  assert.doesNotMatch(html, /example\.invalid|\/etc\/passwd/);
  assert.equal(data.manifest.clips[0].file, 'videos/clip-001.webm');
  new vm.Script(data.script);
});

test('empty session and transcript-only sessions export without fabricated recordings', async () => {
  const emptySession = { ...session, durationMs: 0 };
  const manifest = buildManifest(emptySession, [], []);
  assert.deepEqual(manifest.mediaLinks, []);
  assert.deepEqual(manifest.speakers, []);
  assert.equal(manifest.session.status, 'complete');
  const files = await unzipStored(await buildExport(emptySession, [], []));
  assert.equal(files.size, 3);
  assert.equal([...files.keys()].some((name) => name.includes('/videos/')), false);
  const onlyText = buildManifest(session, [segment('s', 0, 1000)], []);
  assert.equal(onlyText.segments.length, 1);
  assert.deepEqual(onlyText.mediaLinks, []);
});

test('export refuses absent, empty, duck-typed and mismatched recording Blobs', async () => {
  for (const blob of [undefined, null, {}, { size: 123, arrayBuffer() {} }, new Blob([])]) {
    await assert.rejects(buildExport(session, [], [clip('c', 0, 1000, { blob })]), /nonempty recording Blob/);
  }
  await assert.rejects(buildExport(session, [], [clip('c', 0, 1000, {
    blob: new Blob(['not video'], { type: 'text/html' }),
  })]), /MIME type/);
  const files = await unzipStored(await buildExport(session, [], [clip('c', 0, 1000, {
    mimeType: 'video/mp4', blob: new Blob(['fixture'], { type: 'video/mp4' }),
  })]));
  assert.equal(files.has('session-demo/videos/clip-001.mp4'), true);
});

test('ZIP32 entry and total-size limits reject before reading oversized Blob fixtures', async () => {
  class OversizedFixture extends Blob {
    constructor(size) { super(['fixture']); this.reportedSize = size; }
    get size() { return this.reportedSize; }
    slice() { assert.fail('Oversized ZIP input must not be read'); }
  }
  await assert.rejects(buildExport(session, [], [clip('c', 0, 1000, {
    blob: new OversizedFixture(0xffffffff),
  })]), /ZIP64.*entry size/);
  await assert.rejects(buildExport(session, [], [
    clip('a', 0, 1000, { blob: new OversizedFixture(0x80000000) }),
    clip('b', 2000, 3000, { blob: new OversizedFixture(0x80000000) }),
  ]), /ZIP64.*archive/);
});

test('CRC processing crosses one-megabyte chunk boundaries without flattening the source Blob', async () => {
  class ChunkedFixture extends Blob {
    arrayBuffer() { assert.fail('Do not read the whole recording at once'); }
    slice(start, end) {
      assert.ok(end - start <= 1024 * 1024);
      return super.slice(start, end);
    }
  }
  const bytes = Uint8Array.from({ length: 1024 * 1024 + 73 }, (_, index) => index % 251);
  const files = await unzipStored(await buildExport(session, [], [clip('c', 0, 1000, {
    blob: new ChunkedFixture([bytes], { type: 'video/webm' }),
  })]));
  assert.deepEqual(files.get('session-demo/videos/clip-001.webm').contents, bytes);
});

// Minimal DOM/media double: verifies script behavior, not browser decoding or file:// support.
function playerHarness(html) {
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.events = new Map();
      this.textContent = '';
      this.classes = new Set();
      this.classList = {
        toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name),
        remove: (name) => this.classes.delete(name),
      };
      this.readyState = 0;
      this.currentTime = 0;
      this.playCalls = 0;
    }
    append(...elements) { this.children.push(...elements); }
    addEventListener(event, listener) {
      if (!this.events.has(event)) this.events.set(event, []);
      this.events.get(event).push(listener);
    }
    emit(event) { for (const listener of this.events.get(event) || []) listener(); }
    pause() {}
    load() { this.readyState = 0; this.currentTime = 0; }
    play() {
      this.playCalls += 1;
      return this.rejectPlay ? Promise.reject(new Error('autoplay blocked')) : Promise.resolve();
    }
  }
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new Element('div')]));
  const data = embedded(html);
  elements.get('session-data').textContent = data.json;
  const context = vm.createContext({
    document: { getElementById: (id) => elements.get(id), createElement: (tag) => new Element(tag) },
  });
  vm.runInContext(data.script, context);
  return { elements, manifest: data.manifest, context };
}

test('offline player waits for metadata, seeks correct clips, highlights all overlaps and responds to manual seeking', async () => {
  const { segments, clips } = fixture();
  const files = await unzipStored(await buildExport(session, segments, clips));
  const { elements, manifest } = playerHarness(files.get('session-demo/index.html').text());
  const video = elements.get('video');
  const transcript = elements.get('transcript');
  const rows = new Map(manifest.segments.map((entry, index) => [entry.id, transcript.children[index]]));
  const mediaButtons = (id) => rows.get(id).children[2].children;
  assert.equal(video.src, 'videos/clip-001.webm');
  assert.equal(video.playCalls, 0);
  assert.equal(mediaButtons('gap')[0].textContent, 'Sans video');
  assert.equal(mediaButtons('spanning').length, 2);
  mediaButtons('overlap')[0].emit('click');
  assert.equal(video.currentTime, 0, 'Seek waits for loadedmetadata');
  video.readyState = 1;
  video.emit('loadedmetadata');
  assert.equal(video.currentTime, 1);
  assert.equal(video.playCalls, 1);
  assert.equal(rows.get('boundary').classes.has('active'), true);
  assert.equal(rows.get('overlap').classes.has('active'), true);
  assert.equal(rows.get('gap').classes.has('active'), false);
  video.currentTime = 2;
  video.emit('seeking');
  assert.equal(rows.get('boundary').classes.has('active'), false, 'End is exclusive');
  assert.equal(rows.get('overlap').classes.has('active'), true);
  mediaButtons('spanning')[1].emit('click');
  assert.equal(video.src, 'videos/clip-002.webm');
  assert.equal(rows.get('overlap').classes.has('active'), false);
  video.readyState = 1;
  video.emit('loadedmetadata');
  assert.equal(video.currentTime, 0);
  assert.equal(rows.get('spanning').classes.has('active'), true);
  assert.equal(rows.get('second').classes.has('active'), true);
  assert.match(elements.get('position').textContent, /Session 00:00:20/);
  assert.equal(elements.get('download-video').href, 'videos/clip-002.webm');
  assert.equal(elements.get('download-srt').href, 'sous-titres/clip-002.fr.srt');
  video.currentTime = 5;
  video.emit('ended');
  assert.equal([...rows.values()].some((row) => row.classes.has('active')), false);
  const selector = elements.get('clip-selector');
  selector.value = 'a';
  selector.emit('change');
  video.readyState = 1;
  video.emit('loadedmetadata');
  assert.equal(video.src, 'videos/clip-001.webm');
  assert.equal(video.currentTime, 0);
  video.rejectPlay = true;
  mediaButtons('overlap')[0].emit('click');
  await Promise.resolve();
  assert.match(elements.get('notice').textContent, /Appuyez sur Lecture/);
  video.error = { code: 4 };
  video.emit('error');
  assert.match(elements.get('notice').textContent, /Media absent.*codec/);
  assert.equal([...rows.values()].some((row) => row.classes.has('active')), false);
});

test('player uses literal text for injection strings and shows empty/incomplete states', async () => {
  const injection = '</script><script>globalThis.pwned=true</script>';
  const files = await unzipStored(await buildExport({ ...session, status: 'incomplete' }, [
    segment('s', 0, 1000, { translatedText: injection, speakerName: injection, status: 'provisional' }),
  ], []));
  const { elements, context } = playerHarness(files.get('session-demo/index.html').text());
  assert.equal(context.pwned, undefined);
  const content = elements.get('transcript').children[0].children[1];
  assert.equal(content.children[0].textContent, injection);
  assert.equal(content.children[1].textContent, injection);
  assert.equal(content.children[2].textContent, 'Traduction provisoire');
  assert.equal(elements.get('state').textContent, 'Session incomplete');
  assert.equal(elements.get('media-panel').hidden, true);
  assert.match(elements.get('notice').textContent, /Aucun enregistrement video/);
  const empty = await unzipStored(await buildExport({ ...session, durationMs: 0 }, [], []));
  const emptyPlayer = playerHarness(empty.get('session-demo/index.html').text());
  assert.match(emptyPlayer.elements.get('transcript').children[0].textContent, /Aucune transcription/);
});

test('rapid clip changes only apply the latest requested seek', async () => {
  const { segments, clips } = fixture();
  const files = await unzipStored(await buildExport(session, segments, clips));
  const { elements, manifest } = playerHarness(files.get('session-demo/index.html').text());
  const rows = new Map(manifest.segments.map((entry, index) => [entry.id, elements.get('transcript').children[index]]));
  rows.get('spanning').children[2].children[1].emit('click');
  rows.get('overlap').children[2].children[0].emit('click');
  const video = elements.get('video');
  video.readyState = 1;
  video.emit('loadedmetadata');
  assert.equal(video.src, 'videos/clip-001.webm');
  assert.equal(video.currentTime, 1);
  assert.equal(video.playCalls, 1);
});

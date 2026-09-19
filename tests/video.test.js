import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { detectFfmpeg, processUnifiedVideo, _resetFfmpegCache } from '../server/video.js';

test('detectFfmpeg correctly detects ffmpeg on this machine', async () => {
  _resetFfmpegCache();
  const ffmpegPath = await detectFfmpeg();
  assert.ok(ffmpegPath, 'FFmpeg should be detected on the system');
  assert.match(ffmpegPath, /ffmpeg$/);
});

test('processUnifiedVideo writes fallback file when no ffmpeg is available', async () => {
  const tmpDir = path.join(os.tmpdir(), `test-video-fallback-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  const originalPath = process.env.PATH;
  try {
    // Simuler absence de ffmpeg en altérant le PATH temporairement
    process.env.PATH = '/empty-path';
    _resetFfmpegCache();

    const dummyVideo = Buffer.from('FAKE_WEBM_VIDEO_DATA_FOR_FALLBACK');
    const result = await processUnifiedVideo({
      videoBuffer: dummyVideo,
      outputDir: tmpDir,
      baseName: 'fallback-session',
    });

    assert.equal(result.success, true);
    assert.equal(result.format, 'webm');
    assert.equal(result.ffmpegUsed, false);
    assert.ok(result.note.includes('sans FFmpeg'));

    const fileContents = await fs.readFile(result.filePath);
    assert.deepEqual(fileContents, dummyVideo);
  } finally {
    process.env.PATH = originalPath;
    _resetFfmpegCache();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('processUnifiedVideo encodes MP4 with audio and burned-in subtitles when FFmpeg is available', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  const tmpDir = path.join(os.tmpdir(), `test-video-mp4-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  const tempWebm = path.join(tmpDir, 'input.webm');
  try {
    // Générer 2 secondes de vidéo WebM avec audio de test
    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2',
      '-c:v', 'libvpx',
      '-c:a', 'libopus',
      tempWebm
    ]);

    const videoBuffer = await fs.readFile(tempWebm);
    const srtContent = '1\n00:00:00,200 --> 00:00:01,800\nIntervenant : Bonjour, ceci est la traduction française.\n';

    _resetFfmpegCache();
    const result = await processUnifiedVideo({
      videoBuffer,
      srtContent,
      outputDir: tmpDir,
      baseName: 'test-meeting-subtitled',
    });

    assert.equal(result.success, true);
    assert.equal(result.format, 'mp4');
    assert.equal(result.ffmpegUsed, true);
    assert.ok(result.filename.endsWith('.mp4'));

    const stat = await fs.stat(result.filePath);
    assert.ok(stat.size > 1000, 'MP4 file should have reasonable size');
  } finally {
    _resetFfmpegCache();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

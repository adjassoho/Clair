/**
 * Module de traitement et conversion vidéo pour Clair
 * Détecte automatiquement FFmpeg et effectue le transcodage MP4 haute compatibilité
 * ou applique un fallback universel sans dépendance si FFmpeg est absent.
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

let cachedFfmpegPath = null;
let ffmpegChecked = false;

/**
 * Détecte si FFmpeg est disponible dans le système hôte
 */
export async function detectFfmpeg() {
  if (ffmpegChecked) return cachedFfmpegPath;
  try {
    const { stdout } = await execFileAsync('which', ['ffmpeg']);
    const resolvedPath = stdout.trim();
    if (resolvedPath) {
      cachedFfmpegPath = resolvedPath;
    }
  } catch {
    cachedFfmpegPath = null;
  }
  if (!cachedFfmpegPath) {
    for (const p of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/bin/ffmpeg', '/snap/bin/ffmpeg']) {
      try {
        await fs.access(p);
        cachedFfmpegPath = p;
        break;
      } catch {}
    }
  }
  ffmpegChecked = true;
  return cachedFfmpegPath;
}

/**
 * Réinitialise le cache pour les tests unitaires
 */
export function _resetFfmpegCache() {
  cachedFfmpegPath = null;
  ffmpegChecked = false;
}

/**
 * Traite les fragments vidéo de la réunion pour produire le fichier unifié.
 * Transcode en MP4 H.264/AAC si FFmpeg est présent, ou assemble en conteneur universel en fallback.
 */
export async function processUnifiedVideo({
  videoBuffer,
  inputFilePath = null,
  srtContent = '',
  outputDir = os.tmpdir(),
  baseName = 'reunion',
}) {
  const ffmpegPath = await detectFfmpeg();
  await fs.mkdir(outputDir, { recursive: true });

  if (ffmpegPath) {
    const tempInput = inputFilePath || path.join(outputDir, `temp-${Date.now()}.webm`);
    const tempSrt = srtContent && srtContent.trim() ? path.join(outputDir, `temp-${Date.now()}.srt`) : null;
    const outputMp4 = path.join(outputDir, `${baseName}.mp4`);

    try {
      if (videoBuffer && !inputFilePath) {
        await fs.writeFile(tempInput, videoBuffer);
      }
      if (tempSrt) {
        await fs.writeFile(tempSrt, srtContent, 'utf-8');
      }

      const runFfmpeg = (args, timeoutMs = 75000) => new Promise((resolve, reject) => {
        const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        let timer = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch {}
          reject(new Error('Délai dépassé lors de l\'encodage FFmpeg (timeout).'));
        }, timeoutMs);
        proc.stderr.on('data', chunk => { stderr += chunk; });
        proc.on('close', code => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg a échoué avec le code ${code}: ${stderr.slice(-400)}`));
        });
        proc.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      let conversionDone = false;
      const t0 = performance.now();

      // Tentative 1 : avec sous-titres incrustés
      if (tempSrt) {
        try {
          console.log('[FFmpeg] Encodage MP4 accéléré avec sous-titres incrustés...');
          const srtEscaped = tempSrt.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
          const argsWithSubs = [
            '-y',
            '-err_detect', 'ignore_err',
            '-fflags', '+genpts+igndts',
            '-avoid_negative_ts', 'make_zero',
            '-i', tempInput,
            '-vf', `subtitles='${srtEscaped}':force_style='FontSize=18,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=3,Outline=1,MarginV=25'`,
            '-r', '25',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-max_muxing_queue_size', '2048',
            '-preset', 'ultrafast',
            '-crf', '23',
            '-threads', '0',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            outputMp4,
          ];
          await runFfmpeg(argsWithSubs);
          conversionDone = true;
          console.log(`[FFmpeg] Encodage MP4 avec sous-titres terminé en ${Math.round(performance.now() - t0)}ms`);
        } catch (subErr) {
          console.warn('[FFmpeg] Incrustation des sous-titres impossible, repli sur MP4 direct sans sous-titres:', subErr.message);
        }
      }

      // Tentative 2 : sans sous-titres si tempSrt n'était pas fourni ou si le filtre subtitles a échoué
      if (!conversionDone) {
        console.log('[FFmpeg] Encodage MP4 accéléré direct...');
        const argsDirect = [
          '-y',
          '-err_detect', 'ignore_err',
          '-fflags', '+genpts+igndts',
          '-avoid_negative_ts', 'make_zero',
          '-i', tempInput,
          '-r', '25',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-max_muxing_queue_size', '2048',
          '-preset', 'ultrafast',
          '-crf', '23',
          '-threads', '0',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          outputMp4,
        ];
        await runFfmpeg(argsDirect);
        conversionDone = true;
        console.log(`[FFmpeg] Encodage MP4 direct terminé en ${Math.round(performance.now() - t0)}ms`);
      }

      if (conversionDone) {
        return {
          success: true,
          format: 'mp4',
          filename: `${baseName}.mp4`,
          filePath: outputMp4,
          ffmpegUsed: true,
          mimeType: 'video/mp4',
        };
      }
    } catch (err) {
      console.warn('Erreur FFmpeg, bascule automatique sur le fallback universel:', err.message);
    } finally {
      if (!inputFilePath) await fs.unlink(tempInput).catch(() => {});
      if (tempSrt) await fs.unlink(tempSrt).catch(() => {});
    }
  }

  // Fallback sécurisé sans FFmpeg : conservation directe du conteneur WebM
  const outputFallback = path.join(outputDir, `${baseName}.webm`);
  if (videoBuffer) {
    await fs.writeFile(outputFallback, videoBuffer);
  } else if (inputFilePath) {
    await fs.copyFile(inputFilePath, outputFallback);
  }

  return {
    success: true,
    format: 'webm',
    filename: `${baseName}.webm`,
    filePath: outputFallback,
    ffmpegUsed: false,
    mimeType: 'video/webm',
    note: 'Vidéo exportée en mode haute compatibilité (sans FFmpeg sur la machine). Lisible directement dans tout navigateur web ou VLC.',
  };
}

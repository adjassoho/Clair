import { test, expect } from '@playwright/test';
import { buildManifest } from '../../extension/export.js';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

test.describe('Lecteur hors-ligne exporté', () => {
  const session = {
    id: 'e2e-demo',
    startedAt: '2026-09-16T15:00:00Z',
    durationMs: 60000,
    sourceLanguage: 'en',
    targetLanguage: 'fr',
    status: 'complete',
  };

  const segments = [
    {
      id: 'seg-1',
      startMs: 2000,
      endMs: 6000,
      translatedText: 'Bienvenue à tous dans cette présentation.',
      speakerName: 'Sarah Martin',
      speakerStatus: 'identified',
      status: 'final',
    },
    {
      id: 'seg-2',
      startMs: 8000,
      endMs: 14000,
      translatedText: 'Voici le tableau de bord de notre application.',
      speakerName: 'David Dupont',
      speakerStatus: 'identified',
      status: 'final',
    },
  ];

  const clips = [
    {
      id: 'clip-1',
      sessionStartMs: 5000,
      sessionEndMs: 25000,
      durationMs: 20000,
      width: 1280,
      height: 720,
      hasAudio: true,
      mimeType: 'video/webm',
      status: 'complete',
    },
  ];

  test('affiche les segments traduits et synchronise les liens médias', async ({ page }) => {
    // Construction du manifeste et de l'HTML embarqué
    const manifest = buildManifest(session, segments, clips);

    // Extraction du code buildHtml via un helper ou exécution
    const exportModule = await import('../../extension/export.js');
    // On peut utiliser buildExport ou simuler la page HTML
    const blob = await exportModule.buildExport(session, segments, [
      { ...clips[0], blob: new Blob(['fake_video'], { type: 'video/webm' }) },
    ]);

    // Extraction du index.html de l'archive ZIP
    const buffer = Buffer.from(await blob.arrayBuffer());
    const zipString = new TextDecoder('utf-8').decode(buffer);
    const indexHtmlStart = zipString.indexOf('<!doctype html>');
    const indexHtmlEnd = zipString.indexOf('</html>') + 7;
    const html = zipString.substring(indexHtmlStart, indexHtmlEnd);

    await page.setContent(html);

    // Vérifier les éléments principaux
    await expect(page.locator('h1')).toHaveText('Le fil de la session');
    await expect(page.locator('#state')).toHaveText('Session complete');
    await expect(page.locator('#transcript article')).toHaveCount(2);

    // Vérifier le premier segment (Sarah Martin)
    const firstSegment = page.locator('#transcript article').first();
    await expect(firstSegment.locator('h3')).toHaveText('Sarah Martin');
    await expect(firstSegment.locator('p')).toHaveText('Bienvenue à tous dans cette présentation.');
    // Le premier segment commence à 2s, le clip commence à 5s -> intersection de 5s à 6s (Extrait 1, 00:00)
    await expect(firstSegment.locator('button')).toHaveText(/Extrait 1/);

    // Vérifier le second segment (David Dupont)
    const secondSegment = page.locator('#transcript article').nth(1);
    await expect(secondSegment.locator('h3')).toHaveText('David Dupont');
    await expect(secondSegment.locator('p')).toHaveText('Voici le tableau de bord de notre application.');
  });
});

test.describe('Interface du panneau latéral (Panel)', () => {
  test('affiche les contrôles et mentionne la marque Clair', async ({ page }) => {
    const panelPath = pathToFileURL(process.cwd() + '/dist/extension/panel.html').href;
    await page.goto(panelPath);

    // Vérifier le titre et le statut initial
    await expect(page.locator('#status')).toHaveText('Pret');

    // Vérifier le formulaire de configuration
    await expect(page.locator('#mode')).toBeVisible();
    await expect(page.locator('#consent')).toBeVisible();
    await expect(page.locator('label.consent')).toContainText('Clair');

    // Changement de mode vers 'audio'
    await page.selectOption('#mode', 'audio');
    await expect(page.locator('#mode-help')).toContainText('Audio direct');

    // Vérifier le sélecteur de format de synthèse
    await expect(page.locator('#synthesis-mode')).toBeVisible();
    await page.selectOption('#synthesis-mode', 'course');
    await expect(page.locator('#synthesis-mode')).toHaveValue('course');

    // Vérifier le basculement en Mode Discret
    const toggleDiscrete = page.locator('#toggle-discrete');
    await expect(toggleDiscrete).toBeVisible();
    await expect(toggleDiscrete).toHaveText('Mode Discret');
    await toggleDiscrete.click();
    await expect(page.locator('main')).toHaveClass(/discrete-mode/);
    await expect(toggleDiscrete).toHaveText('Mode Normal');
    await toggleDiscrete.click();
    await expect(page.locator('main')).not.toHaveClass(/discrete-mode/);

    // Vérifier les options d'exportation nettes (Vidéo complète et Transcriptions seules)
    await expect(page.locator('#download-full-video')).toBeAttached();
    await expect(page.locator('#download-transcript-txt')).toBeAttached();
    await expect(page.locator('#download-transcript-srt')).toBeAttached();

    // Vérifier l'élimination des anciens boutons parasites
    await expect(page.locator('#export-unified')).toHaveCount(0);
    await expect(page.locator('#export-synthesis-html')).toHaveCount(0);
    await expect(page.locator('#export-synthesis-md')).toHaveCount(0);
  });
});

/**
 * VERSION DE DÉBOGAGE de l'adaptateur Teams pour l'extension Clair.
 * Cette version inclut des logs détaillés pour diagnostiquer les problèmes de capture de sous-titres.
 *
 * COMMENT L'UTILISER :
 * 1. Remplacez temporairement teams-content.js par ce fichier
 * 2. Rebuild l'extension : npm run build
 * 3. Rechargez l'extension dans Chrome
 * 4. Ouvrez la console DevTools dans l'onglet Teams
 * 5. Lancez une session de transcription en mode "captions"
 * 6. Observez les logs préfixés par [CLAIR-DEBUG]
 */

(() => {
  if (window.__clair_teams_adapter_initialized) return;
  window.__clair_teams_adapter_initialized = true;

  const DEBUG = true; // Mettre à false pour désactiver les logs
  const log = (...args) => DEBUG && console.log('[CLAIR-DEBUG]', ...args);
  const warn = (...args) => DEBUG && console.warn('[CLAIR-DEBUG]', ...args);
  const error = (...args) => console.error('[CLAIR-DEBUG]', ...args);

  let sessionOrigin = 0;
  let sessionMode = null;
  let captionObserver = null;
  let resizeObserver = null;
  let activeCaptionIds = new Set();
  let captionCounter = 0;
  let lastContentDimensions = null;
  let statusCheckTimer = null;
  let diagnosticInterval = null;

  const epoch = () => performance.timeOrigin + performance.now();
  const sessionNow = () => Math.max(0, Math.round(epoch() - sessionOrigin));

  function notifyWorker(type, data = {}) {
    try {
      if (!chrome.runtime?.id) {
        warn('Chrome runtime non disponible pour notifier:', type);
        return Promise.resolve();
      }
      log('📤 Envoi au worker:', type, data);
      return chrome.runtime.sendMessage({ target: 'worker', type, ...data }).catch((err) => {
        warn('Erreur lors de l\'envoi au worker:', err);
      });
    } catch (e) {
      error('Exception lors de la notification worker:', e);
      return Promise.resolve();
    }
  }

  // ---- F-04 : EXTRACTION DES SOUS-TITRES & LOCUTEURS TEAMS (VERSION DEBUG) ----

  function findCaptionsContainer() {
    log('🔍 Recherche du conteneur de sous-titres...');

    // Liste élargie de sélecteurs à essayer
    const selectors = [
      // Sélecteurs originaux
      '[data-tid="closed-captions"]',
      '[class*="closed-captions"]',
      '[class*="captions-container"]',
      'div[class*="caption-banner"]',
      'div[class*="ui-chat__item"]',

      // Nouveaux sélecteurs possibles (Teams change souvent)
      '[class*="ts-caption"]',
      '[class*="live-caption"]',
      '[class*="captions-window"]',
      '[class*="subtitle"]',
      '[data-tid*="caption"]',
      'div[class*="fui-"][class*="caption"]', // Fluent UI
      'div[aria-live="polite"]',
      'div[aria-live="assertive"]',
      'div[role="log"]'
    ];

    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          log(`✅ Conteneur trouvé avec: ${selector}`);
          log('   Element:', element);
          log('   Classes:', element.className);
          log('   ID:', element.id);
          log('   Contenu:', element.textContent.substring(0, 100));
          return element;
        }
      } catch (e) {
        warn(`Erreur avec sélecteur ${selector}:`, e);
      }
    }

    warn('❌ Aucun conteneur de sous-titres trouvé avec les sélecteurs connus');
    warn('   Sélecteurs testés:', selectors);
    return null;
  }

  function extractSpeakerAndText(element) {
    log('📝 Extraction du texte depuis:', element);

    // Tentatives d'extraction de l'auteur/intervenant
    const authorSelectors = [
      '[data-tid="author"]',
      '[class*="author"]',
      '[class*="speaker"]',
      '[class*="name"]',
      'h4',
      'h5',
      'strong',
      '.fui-caption-author',
      '[class*="caption-speaker"]'
    ];

    let authorEl = null;
    for (const selector of authorSelectors) {
      authorEl = element.querySelector(selector);
      if (authorEl) {
        log(`  👤 Auteur trouvé avec: ${selector}`);
        break;
      }
    }

    // Tentatives d'extraction du texte
    const textSelectors = [
      '[data-tid="caption-text"]',
      '[class*="caption-text"]',
      '[class*="subtitle-text"]',
      'p',
      'span[dir="auto"]',
      '.fui-caption-text',
      '[class*="text-content"]'
    ];

    let textEl = null;
    for (const selector of textSelectors) {
      textEl = element.querySelector(selector);
      if (textEl) {
        log(`  💬 Texte trouvé avec: ${selector}`);
        break;
      }
    }

    const rawSpeaker = authorEl?.textContent?.trim() || null;
    const rawText = textEl?.textContent?.trim() || (!authorEl ? element.textContent?.trim() : null);

    log(`  📤 Résultat - Intervenant: "${rawSpeaker}" | Texte: "${rawText?.substring(0, 50)}"`);

    return {
      speakerName: rawSpeaker,
      sourceText: rawText || '',
    };
  }

  function observeCaptions() {
    log('🎬 Démarrage de l\'observation des sous-titres...');
    stopCaptionObserver();

    function scanCaptions() {
      const scanStart = Date.now();
      log('🔄 Scan des sous-titres (appel #' + (captionCounter + 1) + ')...');

      const container = findCaptionsContainer();
      if (!container) {
        warn('⚠️ Conteneur de sous-titres introuvable');
        notifyWorker('adapter-status', {
          message: 'Activez les sous-titres anglais dans Teams (Bouton Autres ... -> Langue et parole -> Activer les sous-titres en direct).',
          available: false,
          timing: Date.now(),
        });
        return;
      }

      log('✅ Conteneur actif:', container);
      notifyWorker('adapter-status', {
        message: 'Sous-titres Teams actifs avec détection des intervenants.',
        available: true,
        timing: Date.now(),
      });

      // Liste élargie de sélecteurs pour les items de sous-titres
      const itemSelectors = [
        '[data-tid="closed-caption-item"]',
        '[class*="caption-item"]',
        '[class*="subtitle-item"]',
        '[class*="ts-caption"]',
        '.fui-caption-item',
        'div' // Fallback
      ];

      let items = [];
      for (const selector of itemSelectors) {
        const found = container.querySelectorAll(selector);
        if (found.length > 0) {
          log(`  📋 Trouvé ${found.length} items avec: ${selector}`);
          items = Array.from(found);
          break;
        }
      }

      if (items.length === 0) {
        warn('  ⚠️ Aucun item de sous-titre trouvé dans le conteneur');
        log('  Contenu du conteneur:', container.innerHTML.substring(0, 500));
      } else {
        log(`  📊 Traitement de ${items.length} item(s)...`);
      }

      let processedCount = 0;
      let skippedCount = 0;
      let sentCount = 0;

      for (const item of items) {
        if (item.dataset.clairProcessed) {
          skippedCount++;
          continue;
        }

        processedCount++;
        const { speakerName, sourceText } = extractSpeakerAndText(item);

        if (!sourceText || sourceText.length < 2) {
          log(`  ⏭️ Item ignoré (texte trop court): "${sourceText}"`);
          continue;
        }

        item.dataset.clairProcessed = 'true';
        const startMs = sessionNow();
        const estimatedDurationMs = Math.max(1500, Math.min(8000, sourceText.split(/\s+/).length * 350));
        const endMs = startMs + estimatedDurationMs;
        const id = `caption-${++captionCounter}-${startMs}`;

        if (!activeCaptionIds.has(id)) {
          activeCaptionIds.add(id);
          sentCount++;

          const segment = {
            id,
            startMs,
            endMs,
            sourceText,
            speakerName,
            status: 'final',
          };

          log(`  ✉️ Envoi du segment #${captionCounter}:`, segment);
          notifyWorker('caption', { segment });
        } else {
          log(`  ⏭️ Segment déjà envoyé: ${id}`);
        }
      }

      const scanDuration = Date.now() - scanStart;
      log(`📊 Scan terminé en ${scanDuration}ms: ${items.length} items trouvés, ${processedCount} nouveaux, ${skippedCount} déjà traités, ${sentCount} envoyés`);
    }

    const container = findCaptionsContainer() || document.body;
    log('👀 Installation du MutationObserver sur:', container);

    captionObserver = new MutationObserver((mutations) => {
      log(`🔔 ${mutations.length} mutation(s) détectée(s)`);
      scanCaptions();
    });

    captionObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Scan périodique toutes les 3 secondes
    statusCheckTimer = setInterval(() => {
      log('⏰ Scan périodique (toutes les 3s)');
      scanCaptions();
    }, 3000);

    // Scan initial
    scanCaptions();

    // Diagnostic périodique toutes les 10 secondes
    if (DEBUG) {
      diagnosticInterval = setInterval(() => {
        log('📈 État du système:');
        log('  - Session active:', !!sessionOrigin);
        log('  - Mode:', sessionMode);
        log('  - Sous-titres capturés:', captionCounter);
        log('  - IDs actifs:', activeCaptionIds.size);
        log('  - Observer actif:', !!captionObserver);

        // Vérifier si le conteneur existe toujours
        const currentContainer = findCaptionsContainer();
        if (!currentContainer) {
          warn('  ⚠️ Le conteneur de sous-titres a disparu!');
        } else {
          log('  ✅ Conteneur toujours présent');
        }
      }, 10000);
    }
  }

  function stopCaptionObserver() {
    log('🛑 Arrêt de l\'observation des sous-titres');

    if (captionObserver) {
      captionObserver.disconnect();
      captionObserver = null;
      log('  ✅ MutationObserver déconnecté');
    }

    if (statusCheckTimer) {
      clearInterval(statusCheckTimer);
      statusCheckTimer = null;
      log('  ✅ Timer de scan arrêté');
    }

    if (diagnosticInterval) {
      clearInterval(diagnosticInterval);
      diagnosticInterval = null;
      log('  ✅ Diagnostic arrêté');
    }

    activeCaptionIds.clear();
    log('  ✅ IDs actifs effacés');
  }

  // ---- F-08 : DÉTECTION DES CHANGEMENTS DE DISPOSITION ----

  function startLayoutObserver() {
    log('📐 Démarrage de l\'observation de la disposition');
    stopLayoutObserver();

    const contentArea = document.querySelector('[data-tid="meeting-stage"]')
      || document.querySelector('[class*="meeting-stage"]')
      || document.querySelector('main')
      || document.body;

    if (!contentArea) {
      warn('Zone de contenu introuvable pour l\'observation de layout');
      return;
    }

    log('  Zone observée:', contentArea);

    resizeObserver = new ResizeObserver(() => {
      const dims = contentArea.getBoundingClientRect();
      const newDims = { width: Math.round(dims.width), height: Math.round(dims.height) };

      if (!lastContentDimensions ||
          lastContentDimensions.width !== newDims.width ||
          lastContentDimensions.height !== newDims.height) {
        log('📏 Changement de disposition détecté:', lastContentDimensions, '→', newDims);
        lastContentDimensions = newDims;
        notifyWorker('invalidate', { reason: 'layout-change' });
      }
    });

    resizeObserver.observe(contentArea);
  }

  function stopLayoutObserver() {
    if (resizeObserver) {
      log('🛑 Arrêt de l\'observation de la disposition');
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    lastContentDimensions = null;
  }

  // ---- ROUTAGE DES MESSAGES PROVENANT DU WORKER ----

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.target !== 'teams') return;

    log('📨 Message reçu du worker:', message.type);

    switch (message.type) {
      case 'observe':
        sessionOrigin = message.sessionOriginEpochMs || epoch();
        sessionMode = message.mode;
        log('🎯 Démarrage de l\'observation:', { sessionOrigin, sessionMode });

        startLayoutObserver();

        if (sessionMode === 'captions') {
          log('🎤 Mode sous-titres activé');
          observeCaptions();
        } else {
          log('🎵 Mode audio direct (pas d\'observation de sous-titres)');
        }

        reply({ ok: true });
        break;

      case 'select':
        log('🖱️ Demande de sélection de zone');
        // Code de sélection de zone (non modifié pour le débogage)
        reply({ ok: false, error: 'Sélection de zone non implémentée dans la version debug' });
        break;

      case 'stop-observe':
        log('⏹️ Arrêt de l\'observation demandé');
        stopLayoutObserver();
        stopCaptionObserver();
        reply({ ok: true });
        break;

      default:
        warn('❓ Type de commande inconnu:', message.type);
        reply({ ok: false, error: `Type de commande Teams inconnu: ${message.type}` });
    }
  });

  log('✅ Adaptateur Teams (version debug) initialisé');
  log('   Pour voir les logs, gardez la console DevTools ouverte dans l\'onglet Teams');
  log('   Pour désactiver les logs, éditez cette ligne en haut du fichier: const DEBUG = false;');
})();

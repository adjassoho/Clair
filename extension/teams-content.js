/**
 * Adaptateur Teams pour l'extension Clair.
 * Gère la sélection de zone au curseur (F-06), la détection des changements de disposition (F-08)
 * et la capture des sous-titres/locuteurs natifs de Microsoft Teams (F-04).
 */

(() => {
  // Détection d'invalidation de contexte d'extension (après rechargement)
  if (window.__clair_teams_adapter_initialized) {
    try {
      if (window.__clair_extension_id === chrome.runtime?.id && chrome.runtime?.id) {
        return;
      }
    } catch {}
    // Ancien script orphelin ou extension rechargée : nettoyer les anciens nœuds DOM
    document.getElementById('clair-subtitles-host')?.remove();
    document.getElementById('clair-selector-host')?.remove();
  }
  window.__clair_teams_adapter_initialized = true;
  window.__clair_extension_id = chrome.runtime?.id || '';

  let sessionOrigin = 0;
  let sessionMode = null;
  let captionObserver = null;
  let resizeObserver = null;
  let activeCaptionIds = new Set();
  let captionCounter = 0;
  let lastContentDimensions = null;
  let statusCheckTimer = null;
  let isCustomCropActive = false;
  let lastSegmentReceived = null;

  const epoch = () => performance.timeOrigin + performance.now();
  const sessionNow = () => Math.max(0, Math.round(epoch() - sessionOrigin));

  function notifyWorker(type, data = {}) {
    try {
      if (!chrome.runtime?.id) return Promise.resolve();
      return chrome.runtime.sendMessage({ target: 'worker', type, ...data }).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  }

  // Notifier immédiatement le worker que cet onglet Teams est actif et prêt
  notifyWorker('register-teams-tab');

  // ---- F-06 : SÉLECTION DE ZONE RECTANGULAIRE AU CURSEUR ----

  function launchAreaSelector() {
    return new Promise((resolve) => {
      // Nettoyer toute sélection précédente éventuelle
      document.getElementById('clair-selector-host')?.remove();

      const host = document.createElement('div');
      host.id = 'clair-selector-host';
      host.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:auto;';

      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = `
        :host { all: initial; }
        .overlay {
          position: fixed; inset: 0; background: rgba(15, 23, 20, 0.45);
          cursor: crosshair; user-select: none; -webkit-user-select: none;
        }
        .banner {
          position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
          background: #172822; color: #f6f4ee; padding: 10px 20px; border-radius: 8px;
          font: 14px/1.4 system-ui, -apple-system, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
          border: 1px solid #215f50; pointer-events: none; text-align: center;
        }
        .banner strong { color: #52b79a; }
        .box {
          position: absolute; border: 2px dashed #21c095; background: rgba(33, 192, 149, 0.12);
          box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45); pointer-events: none;
          box-sizing: border-box;
        }
        .tag {
          position: absolute; bottom: -28px; right: 0; background: #172822; color: #21c095;
          padding: 2px 8px; font: 12px monospace; border-radius: 4px; border: 1px solid #215f50;
          white-space: nowrap;
        }
        .actions {
          position: absolute; top: calc(100% + 10px); left: 50%; transform: translateX(-50%);
          display: flex; gap: 8px; pointer-events: auto; background: #172822; padding: 6px;
          border-radius: 8px; border: 1px solid #215f50; box-shadow: 0 6px 20px rgba(0,0,0,0.4);
        }
        button {
          font: 13px system-ui, sans-serif; padding: 6px 14px; border-radius: 5px; cursor: pointer;
          border: 1px solid #215f50; transition: all 0.15s; font-weight: 500;
        }
        .btn-confirm { background: #215f50; color: #f6f4ee; }
        .btn-confirm:hover { background: #2a7966; }
        .btn-retry { background: #203732; color: #ccd7cd; }
        .btn-retry:hover { background: #2b4943; }
        .btn-cancel { background: transparent; color: #ff8c7a; border-color: #59302b; }
        .btn-cancel:hover { background: rgba(255, 140, 122, 0.15); }
      `;

      const overlay = document.createElement('div');
      overlay.className = 'overlay';

      const banner = document.createElement('div');
      banner.className = 'banner';
      banner.innerHTML = 'Tracez un rectangle avec le curseur sur la zone à enregistrer.<br><small>Échap pour annuler · Entrée pour confirmer</small>';

      const box = document.createElement('div');
      box.className = 'box';
      box.hidden = true;

      const tag = document.createElement('div');
      tag.className = 'tag';
      box.append(tag);

      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.hidden = true;

      const btnConfirm = document.createElement('button');
      btnConfirm.className = 'btn-confirm';
      btnConfirm.textContent = 'Confirmer cette zone';

      const btnRetry = document.createElement('button');
      btnRetry.className = 'btn-retry';
      btnRetry.textContent = 'Recommencer';

      const btnCancel = document.createElement('button');
      btnCancel.className = 'btn-cancel';
      btnCancel.textContent = 'Annuler';

      actions.append(btnConfirm, btnRetry, btnCancel);
      box.append(actions);

      overlay.append(banner, box);
      shadow.append(style, overlay);
      document.body.append(host);

      let isDrawing = false;
      let startX = 0;
      let startY = 0;
      let currentRect = null;

      function updateBox(x, y, width, height) {
        const left = Math.min(x, x + width);
        const top = Math.min(y, y + height);
        const w = Math.abs(width);
        const h = Math.abs(height);

        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${w}px`;
        box.style.height = `${h}px`;
        box.hidden = false;
        tag.textContent = `${Math.round(w)} × ${Math.round(h)} px`;
        currentRect = { x: left, y: top, width: w, height: h };
      }

      function finish(result) {
        window.removeEventListener('keydown', onKeyDown, true);
        host.remove();
        resolve(result);
      }

      function onMouseDown(e) {
        if (actions.contains(e.target)) return;
        isDrawing = true;
        startX = e.clientX;
        startY = e.clientY;
        actions.hidden = true;
        updateBox(startX, startY, 0, 0);
      }

      function onMouseMove(e) {
        if (!isDrawing) return;
        updateBox(startX, startY, e.clientX - startX, e.clientY - startY);
      }

      function onMouseUp() {
        if (!isDrawing) return;
        isDrawing = false;
        if (currentRect && currentRect.width > 20 && currentRect.height > 20) {
          actions.hidden = false;
        } else {
          box.hidden = true;
          currentRect = null;
        }
      }

      function onKeyDown(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          finish({ ok: false, error: 'Sélection annulée.' });
        } else if (e.key === 'Enter' && currentRect) {
          e.preventDefault();
          btnConfirm.click();
        }
      }

      btnConfirm.addEventListener('click', () => {
        if (!currentRect) return;
        isCustomCropActive = true;
        finish({
          ok: true,
          rect: {
            ...currentRect,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          },
        });
      });

      btnRetry.addEventListener('click', () => {
        box.hidden = true;
        actions.hidden = true;
        currentRect = null;
      });

      btnCancel.addEventListener('click', () => {
        finish({ ok: false, error: 'Sélection annulée.' });
      });

      overlay.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('keydown', onKeyDown, true);
    });
  }

  // ---- F-08 : DÉTECTION DES CHANGEMENTS DE DISPOSITION ----

  function findTeamsStageElement() {
    return document.querySelector('[data-tid="video-player"]')
      || document.querySelector('[data-tid="calling-screen-share"]')
      || document.querySelector('.stage-content')
      || document.querySelector('video')
      || document.body;
  }

  function startLayoutObserver() {
    stopLayoutObserver();
    const stage = findTeamsStageElement();
    const checkDimensions = () => {
      const rect = stage.getBoundingClientRect();
      const current = { width: Math.round(rect.width), height: Math.round(rect.height) };
      if (isCustomCropActive && lastContentDimensions) {
        const deltaW = Math.abs(current.width - lastContentDimensions.width);
        const deltaH = Math.abs(current.height - lastContentDimensions.height);
        if (deltaW > 25 || deltaH > 25) {
          isCustomCropActive = false;
          notifyWorker('crop-invalid', { reason: 'La disposition de l’écran Teams a changé. Vérifiez le cadrage.' });
        }
      }
      lastContentDimensions = current;
    };

    checkDimensions();
    resizeObserver = new ResizeObserver(checkDimensions);
    resizeObserver.observe(stage);
    window.addEventListener('resize', checkDimensions);
  }

  function stopLayoutObserver() {
    isCustomCropActive = false;
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    lastContentDimensions = null;
  }

  // ---- F-04 : EXTRACTION DES SOUS-TITRES & LOCUTEURS TEAMS ----

  function findCaptionsContainer() {
    return document.querySelector('[data-tid="closed-captions"]')
      || document.querySelector('[class*="closed-captions"]')
      || document.querySelector('[class*="captions-container"]')
      || document.querySelector('div[class*="caption-banner"]')
      || document.querySelector('div[class*="ui-chat__item"]')?.parentElement;
  }

  function extractSpeakerAndText(element) {
    const authorEl = element.querySelector('[data-tid="author"]')
      || element.querySelector('[class*="author"]')
      || element.querySelector('[class*="speaker"]')
      || element.querySelector('h4')
      || element.querySelector('strong');

    const textEl = element.querySelector('[data-tid="caption-text"]')
      || element.querySelector('[class*="caption-text"]')
      || element.querySelector('p')
      || element.querySelector('span[dir="auto"]');

    const rawSpeaker = authorEl?.textContent?.trim() || null;
    const rawText = textEl?.textContent?.trim() || (!authorEl ? element.textContent?.trim() : null);

    return {
      speakerName: rawSpeaker,
      sourceText: rawText || '',
    };
  }

  function observeCaptions() {
    stopCaptionObserver();

    function scanCaptions() {
      const container = findCaptionsContainer();
      if (!container) {
        notifyWorker('adapter-status', {
          message: 'Activez les sous-titres anglais dans Teams (Bouton Autres ... -> Langue et parole -> Activer les sous-titres en direct).',
          available: false,
          timing: Date.now(),
        });
        return;
      }

      notifyWorker('adapter-status', {
        message: 'Sous-titres Teams actifs avec détection des intervenants.',
        available: true,
        timing: Date.now(),
      });

      const items = container.querySelectorAll('[data-tid="closed-caption-item"], [class*="caption-item"], div');
      for (const item of items) {
        if (item.dataset.clairProcessed) continue;
        const { speakerName, sourceText } = extractSpeakerAndText(item);
        if (!sourceText || sourceText.length < 2) continue;

        item.dataset.clairProcessed = 'true';
        const startMs = sessionNow();
        const estimatedDurationMs = Math.max(1500, Math.min(8000, sourceText.split(/\s+/).length * 350));
        const endMs = startMs + estimatedDurationMs;
        const id = `caption-${++captionCounter}-${startMs}`;

        if (!activeCaptionIds.has(id)) {
          activeCaptionIds.add(id);
          if (speakerName) {
            lastReportedSpeaker = speakerName;
            lastReportedTime = Date.now();
            notifyWorker('active-speaker', { speakerName, source: 'teams-caption' });
          }
          notifyWorker('caption', {
            segment: {
              id,
              startMs,
              endMs,
              sourceText,
              speakerName,
              status: 'final',
            },
          });
        }
      }
    }

    const container = findCaptionsContainer() || document.body;
    captionObserver = new MutationObserver(scanCaptions);
    captionObserver.observe(container, { childList: true, subtree: true, characterData: true });

    statusCheckTimer = setInterval(scanCaptions, 3000);
    scanCaptions();
  }

  function stopCaptionObserver() {
    if (captionObserver) {
      captionObserver.disconnect();
      captionObserver = null;
    }
    if (statusCheckTimer) {
      clearInterval(statusCheckTimer);
      statusCheckTimer = null;
    }
    activeCaptionIds.clear();
  }

  // ---- DÉTECTION DU LOCUTEUR ACTIF TEAMS (MÉTHODES 1 & 2) ----

  let activeSpeakerObserver = null;
  let activeSpeakerTimer = null;
  let lastReportedSpeaker = null;
  let lastReportedTime = 0;

  function cleanSpeakerName(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let name = raw.replace(/\s*\((?:Invité|Externe|Guest|External|Présentateur|Organisateur)\)\s*/gi, '').trim();
    name = name.replace(/\s*\(Moi\)\s*/gi, '').trim();
    if (name.length < 2 || name.length > 60 || /^(mute|unmute|micro|audio|son|partage|vidéo)$/i.test(name)) return null;
    return name;
  }

  function detectActiveSpeaker() {
    // Priorité 1 (Méthode 2) : Sous-titres natifs Teams si présents
    const captionAuthor = document.querySelector('[data-tid="author"], [class*="closed-captions"] [class*="speaker"], [class*="caption-banner"] strong, [class*="caption-item"] [data-tid="author"]');
    const captionName = captionAuthor?.textContent?.trim();
    if (captionName) {
      const cleaned = cleanSpeakerName(captionName);
      if (cleaned) return { name: cleaned, source: 'teams-caption' };
    }

    // Priorité 2 (Méthode 1) : Vignette ou halo vocal de l'intervenant actif
    const speakingSelectors = [
      '[data-tid*="active-speaker"]',
      '[class*="speaking"]',
      '[class*="isSpeaking"]',
      '[class*="active-speaker"]',
      '[aria-label*="parle"]',
      '[aria-label*="speaking"]',
      '[aria-label*="is speaking"]',
      '[data-tid*="audio-indicator"]',
      '[data-tid*="speaking-indicator"]',
    ];

    for (const sel of speakingSelectors) {
      const activeEl = document.querySelector(sel);
      if (activeEl) {
        const tile = activeEl.closest('[data-tid="calling-participant-stream"], [data-tid="participant-stream"], [data-tid="participant-tile"], [class*="participant-tile"], [class*="participant-stream"]') || activeEl;
        const nameEl = tile.querySelector('[data-tid="participant-name"], [class*="participant-name"], [class*="displayName"], h4, strong') || tile;
        const text = nameEl?.textContent?.trim();
        if (text) {
          const cleaned = cleanSpeakerName(text);
          if (cleaned) return { name: cleaned, source: 'teams-tile' };
        }
      }
    }

    // Priorité 2b : Liste des participants (Roster) si ouverte
    const rosterSpeaking = document.querySelector('[data-tid="roster-participant-item"] [data-tid*="speaking"], [class*="roster-item"] [class*="speaking"]');
    if (rosterSpeaking) {
      const item = rosterSpeaking.closest('[data-tid="roster-participant-item"], [class*="roster-item"]');
      const nameEl = item?.querySelector('[data-tid="participant-name"], [class*="name"], [class*="displayName"]');
      const text = nameEl?.textContent?.trim();
      if (text) {
        const cleaned = cleanSpeakerName(text);
        if (cleaned) return { name: cleaned, source: 'teams-roster' };
      }
    }

    return null;
  }

  function scanActiveSpeaker() {
    const found = detectActiveSpeaker();
    if (!found) return;
    const now = Date.now();
    if (found.name !== lastReportedSpeaker || (now - lastReportedTime) > 3500) {
      lastReportedSpeaker = found.name;
      lastReportedTime = now;
      notifyWorker('active-speaker', { speakerName: found.name, source: found.source });
      if (isDiscreteActive && subtitleSpeaker) {
        subtitleSpeaker.textContent = found.name;
        subtitleSpeaker.style.display = 'block';
      }
    }
  }

  function startSpeakerObserver() {
    stopSpeakerObserver();
    scanActiveSpeaker();
    activeSpeakerTimer = setInterval(scanActiveSpeaker, 600);
    try {
      activeSpeakerObserver = new MutationObserver(scanActiveSpeaker);
      activeSpeakerObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-label', 'data-tid'] });
    } catch {}
  }

  function stopSpeakerObserver() {
    if (activeSpeakerObserver) {
      activeSpeakerObserver.disconnect();
      activeSpeakerObserver = null;
    }
    if (activeSpeakerTimer) {
      clearInterval(activeSpeakerTimer);
      activeSpeakerTimer = null;
    }
    lastReportedSpeaker = null;
    lastReportedTime = 0;
  }

  // ---- F-09 : SOUS-TITRES EN DIRECT / MODE DISCRET (INCRUSTATION FLOTTANTE) ----

  let subtitleHost = null;
  let subtitleShadow = null;
  let subtitleContainer = null;
  let subtitleSpeaker = null;
  let subtitleText = null;
  let subtitleInterim = null;
  let subtitleFadeTimer = null;
  let isDiscreteActive = false;

  let isOverlayDockedTop = false;
  let isOverlayCompact = false;

  function saveOverlayPosition() {
    try {
      if (globalThis.chrome?.storage?.session && subtitleHost) {
        chrome.storage.session.set({
          discreteOverlayPos: {
            top: subtitleHost.style.top,
            bottom: subtitleHost.style.bottom,
            left: subtitleHost.style.left,
            transform: subtitleHost.style.transform,
            isDockedTop: isOverlayDockedTop,
            isCompact: isOverlayCompact,
          },
        }).catch(() => {});
      }
    } catch {}
  }

  function restoreOverlayPosition(bar, compactBtn) {
    try {
      if (globalThis.chrome?.storage?.session && subtitleHost) {
        chrome.storage.session.get('discreteOverlayPos').then((res) => {
          const pos = res?.discreteOverlayPos;
          if (!pos) return;
          if (pos.isDockedTop !== undefined) isOverlayDockedTop = pos.isDockedTop;
          if (pos.isCompact !== undefined) {
            isOverlayCompact = pos.isCompact;
            bar.classList.toggle('compact', isOverlayCompact);
            if (compactBtn) compactBtn.textContent = isOverlayCompact ? '＋' : '—';
          }
          if (pos.left) subtitleHost.style.left = pos.left;
          if (pos.top) subtitleHost.style.top = pos.top;
          if (pos.bottom) subtitleHost.style.bottom = pos.bottom;
          if (pos.transform) subtitleHost.style.transform = pos.transform;
        }).catch(() => {});
      }
    } catch {}
  }

  function ensureSubtitleOverlay() {
    if (subtitleHost && document.body.contains(subtitleHost)) return;

    subtitleHost = document.createElement('div');
    subtitleHost.id = 'clair-subtitles-host';
    subtitleHost.style.cssText = 'all:initial;position:fixed;z-index:2147483647;bottom:85px;left:50%;transform:translateX(-50%);pointer-events:auto;user-select:none;';

    subtitleShadow = subtitleHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      .clair-bar {
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 14px;
        box-shadow: 0 14px 40px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.1);
        padding: 14px 22px;
        min-width: 420px;
        max-width: min(920px, 92vw);
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        transition: opacity 0.3s ease, transform 0.2s ease, box-shadow 0.2s ease;
        user-select: none;
      }
      .clair-bar.hidden {
        opacity: 0;
        pointer-events: none;
        transform: translateY(12px);
      }
      .clair-bar.dragging {
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.85), 0 0 0 2px #38bdf8 !important;
        cursor: grabbing !important;
        opacity: 0.95;
      }
      .clair-bar.compact {
        padding: 8px 16px;
        min-width: 320px;
        max-width: min(650px, 90vw);
      }
      .clair-bar.compact .clair-header {
        margin-bottom: 2px;
      }
      .clair-bar.compact .clair-text {
        font-size: 14px;
        line-height: 1.35;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .clair-bar.compact .clair-interim {
        display: none !important;
      }
      .clair-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
        cursor: grab;
      }
      .clair-header:active {
        cursor: grabbing;
      }
      .clair-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .pulse-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #10b981;
        box-shadow: 0 0 8px #10b981;
      }
      .drag-grip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px dashed rgba(255, 255, 255, 0.3);
        padding: 2px 7px;
        border-radius: 5px;
        font-size: 10px;
        letter-spacing: 0.5px;
        color: #cbd5e1;
        cursor: grab;
        transition: all 0.15s ease;
      }
      .drag-grip:hover {
        background: rgba(56, 189, 248, 0.2);
        border-color: #38bdf8;
        color: #38bdf8;
      }
      .clair-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .clair-btn {
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #e2e8f0;
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
        font-weight: 500;
      }
      .clair-btn:hover {
        background: rgba(255, 255, 255, 0.24);
        color: white;
      }
      .clair-speaker {
        font-size: 13px;
        font-weight: 700;
        color: #38bdf8;
        margin-bottom: 4px;
        letter-spacing: 0.3px;
      }
      .clair-text {
        font-size: 18px;
        font-weight: 600;
        line-height: 1.48;
        color: #ffffff;
        word-break: break-word;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
      }
      .clair-interim {
        font-size: 16px;
        font-weight: 400;
        color: #94a3b8;
        font-style: italic;
        margin-top: 4px;
      }
    `;

    const bar = document.createElement('div');
    bar.className = 'clair-bar';

    const header = document.createElement('div');
    header.className = 'clair-header';

    const badge = document.createElement('div');
    badge.className = 'clair-badge';
    badge.innerHTML = `
      <span class="pulse-dot"></span>
      <span>Clair</span>
      <span class="drag-grip" title="Cliquez et glissez pour déplacer librement ce bandeau n'importe où sur l'écran">⠿ Déplacer</span>
    `;

    const actions = document.createElement('div');
    actions.className = 'clair-actions';

    // Bouton pour basculer instantanément entre Haut et Bas de l'écran (idéal en partage d'écran)
    const dockBtn = document.createElement('button');
    dockBtn.className = 'clair-btn';
    dockBtn.textContent = '↕️ Haut/Bas';
    dockBtn.title = 'Basculer en haut ou en bas de l’écran pour ne pas masquer les diapositives';
    dockBtn.onclick = () => {
      isOverlayDockedTop = !isOverlayDockedTop;
      subtitleHost.style.left = '50%';
      subtitleHost.style.transform = 'translateX(-50%)';
      if (isOverlayDockedTop) {
        subtitleHost.style.top = '70px';
        subtitleHost.style.bottom = 'auto';
      } else {
        subtitleHost.style.top = 'auto';
        subtitleHost.style.bottom = '85px';
      }
      saveOverlayPosition();
    };

    // Bouton pour mode compact / réduit
    const compactBtn = document.createElement('button');
    compactBtn.className = 'clair-btn';
    compactBtn.textContent = '—';
    compactBtn.title = 'Mode compact (réduire la hauteur pour libérer l’écran)';
    compactBtn.onclick = () => {
      isOverlayCompact = !isOverlayCompact;
      bar.classList.toggle('compact', isOverlayCompact);
      compactBtn.textContent = isOverlayCompact ? '＋' : '—';
      saveOverlayPosition();
    };

    const reopenBtn = document.createElement('button');
    reopenBtn.className = 'clair-btn';
    reopenBtn.textContent = 'Panneau';
    reopenBtn.title = 'Rouvrir la barre latérale Clair';
    reopenBtn.onclick = () => {
      notifyWorker('reopen-panel');
      setDiscreteOverlay(false);
    };

    const closeBtn = document.createElement('button');
    closeBtn.className = 'clair-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Masquer le bandeau';
    closeBtn.onclick = () => setDiscreteOverlay(false);

    actions.append(dockBtn, compactBtn, reopenBtn, closeBtn);
    header.append(badge, actions);

    subtitleSpeaker = document.createElement('div');
    subtitleSpeaker.className = 'clair-speaker';
    if (lastSegmentReceived?.speakerName) {
      subtitleSpeaker.textContent = lastSegmentReceived.speakerName;
      subtitleSpeaker.style.display = 'block';
    } else {
      subtitleSpeaker.style.display = 'none';
    }

    subtitleText = document.createElement('div');
    subtitleText.className = 'clair-text';
    const initialText = (lastSegmentReceived?.translatedText || lastSegmentReceived?.sourceText || '').trim();
    subtitleText.textContent = initialText || 'Mode discret actif. La traduction apparaîtra ici en temps réel.';

    subtitleInterim = document.createElement('div');
    subtitleInterim.className = 'clair-interim';
    subtitleInterim.style.display = 'none';

    bar.append(header, subtitleSpeaker, subtitleText, subtitleInterim);
    subtitleShadow.append(style, bar);
    document.body.append(subtitleHost);

    subtitleContainer = bar;
    restoreOverlayPosition(bar, compactBtn);
    makeDraggable(header, subtitleHost);
  }

  function makeDraggable(handle, element) {
    let startX = 0, startY = 0, initLeft = 0, initTop = 0;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
      e.preventDefault();
      const rect = element.getBoundingClientRect();
      element.style.bottom = 'auto';
      element.style.transform = 'none';
      element.style.left = `${rect.left}px`;
      element.style.top = `${rect.top}px`;
      startX = e.clientX;
      startY = e.clientY;
      initLeft = rect.left;
      initTop = rect.top;
      subtitleContainer?.classList.add('dragging');

      const onMouseMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const targetLeft = Math.max(10, Math.min(window.innerWidth - rect.width - 10, initLeft + dx));
        const targetTop = Math.max(10, Math.min(window.innerHeight - rect.height - 10, initTop + dy));
        element.style.left = `${targetLeft}px`;
        element.style.top = `${targetTop}px`;
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        subtitleContainer?.classList.remove('dragging');
        saveOverlayPosition();
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  function displaySubtitleSegment(segment) {
    lastSegmentReceived = segment;
    if (!isDiscreteActive) {
      try {
        if (globalThis.chrome?.storage?.session) {
          chrome.storage.session.get('discreteMode').then(res => {
            if (res?.discreteMode) {
              setDiscreteOverlay(true);
              displaySubtitleSegment(segment);
            }
          }).catch(() => {});
        }
      } catch {}
      return;
    }
    ensureSubtitleOverlay();
    subtitleContainer?.classList.remove('hidden');

    if (segment.speakerName && subtitleSpeaker) {
      subtitleSpeaker.textContent = segment.speakerName;
      subtitleSpeaker.style.display = 'block';
    } else if (subtitleSpeaker) {
      subtitleSpeaker.style.display = 'none';
    }

    const text = (segment.translatedText || segment.sourceText || '').trim();
    if (text && subtitleText) {
      subtitleText.textContent = text;
      subtitleText.style.opacity = '1';
      subtitleText.style.fontStyle = 'normal';
    }
    if (subtitleInterim) {
      subtitleInterim.style.display = 'none';
      subtitleInterim.textContent = '';
    }

    clearTimeout(subtitleFadeTimer);
    subtitleFadeTimer = setTimeout(() => {
      if (subtitleContainer) subtitleContainer.classList.add('hidden');
    }, 14000);
  }

  function displaySubtitleInterim(text) {
    if (!isDiscreteActive) {
      try {
        if (globalThis.chrome?.storage?.session) {
          chrome.storage.session.get('discreteMode').then(res => {
            if (res?.discreteMode) {
              setDiscreteOverlay(true);
              displaySubtitleInterim(text);
            }
          }).catch(() => {});
        }
      } catch {}
      return;
    }
    ensureSubtitleOverlay();
    subtitleContainer?.classList.remove('hidden');

    const clean = (text || '').trim();
    if (clean) {
      if (subtitleText) {
        subtitleText.textContent = clean;
        subtitleText.style.opacity = '0.88';
        subtitleText.style.fontStyle = 'italic';
      }
      if (subtitleInterim) {
        subtitleInterim.textContent = '... (traduction en cours)';
        subtitleInterim.style.display = isOverlayCompact ? 'none' : 'block';
      }
    } else {
      if (subtitleInterim) {
        subtitleInterim.style.display = 'none';
        subtitleInterim.textContent = '';
      }
    }

    clearTimeout(subtitleFadeTimer);
    subtitleFadeTimer = setTimeout(() => {
      if (subtitleContainer) subtitleContainer.classList.add('hidden');
    }, 14000);
  }

  function setDiscreteOverlay(enabled) {
    isDiscreteActive = Boolean(enabled);
    if (isDiscreteActive) {
      ensureSubtitleOverlay();
      subtitleContainer?.classList.remove('hidden');
      if (lastSegmentReceived) {
        displaySubtitleSegment(lastSegmentReceived);
      }
    } else if (subtitleContainer) {
      subtitleContainer.classList.add('hidden');
    }
  }

  // Synchronisation proactive avec le stockage de session
  try {
    if (globalThis.chrome?.storage?.session) {
      chrome.storage.session.get(['discreteMode', 'liveSegments', 'liveInterimText']).then(res => {
        if (res?.discreteMode) {
          setDiscreteOverlay(true);
        }
        if (res?.liveSegments && res.liveSegments.length) {
          const segs = res.liveSegments;
          const lastSeg = segs[segs.length - 1];
          if (lastSeg) displaySubtitleSegment(lastSeg);
        } else if (res?.liveInterimText) {
          displaySubtitleInterim(res.liveInterimText);
        }
      }).catch(() => {});
    }
    if (globalThis.chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'session') {
          if (changes.discreteMode !== undefined) {
            setDiscreteOverlay(Boolean(changes.discreteMode.newValue));
          }
          if (changes.liveSegments && Array.isArray(changes.liveSegments.newValue) && changes.liveSegments.newValue.length) {
            const segs = changes.liveSegments.newValue;
            const lastSeg = segs[segs.length - 1];
            if (lastSeg) displaySubtitleSegment(lastSeg);
          }
          if (changes.liveInterimText) {
            displaySubtitleInterim(changes.liveInterimText.newValue || '');
          }
        }
      });
    }
  } catch {}

  // ---- ROUTAGE DES MESSAGES PROVENANT DU WORKER ----

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.target !== 'teams' && message?.target !== 'worker-relay') return;

    switch (message.type) {
      case 'observe':
        sessionOrigin = message.sessionOriginEpochMs || epoch();
        sessionMode = message.mode;
        startLayoutObserver();
        startSpeakerObserver();
        if (sessionMode === 'captions' || findCaptionsContainer()) observeCaptions();
        reply({ ok: true });
        break;

      case 'set-discrete-mode':
        setDiscreteOverlay(message.enabled);
        reply({ ok: true });
        break;

      case 'segment':
        if (message.segment) displaySubtitleSegment(message.segment);
        reply?.({ ok: true });
        break;

      case 'interim':
        if (message.text !== undefined) displaySubtitleInterim(message.text);
        reply?.({ ok: true });
        break;

      case 'select':
        launchAreaSelector().then(reply, (error) => reply({ ok: false, error: error.message }));
        return true; // Asynchrone

      case 'stop-observe':
        stopLayoutObserver();
        stopCaptionObserver();
        stopSpeakerObserver();
        setDiscreteOverlay(false);
        reply({ ok: true });
        break;

      default:
        reply({ ok: false, error: `Type de commande Teams inconnu: ${message.type}` });
    }
  });
})();

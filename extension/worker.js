if (chrome.storage?.session?.setAccessLevel) {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});
}

const teamsHosts = new Set(['teams.microsoft.com', 'teams.cloud.microsoft', 'teams.live.com']);
let opening;
const downloadUrls = new Map();
function isTeams(url) {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && teamsHosts.has(parsed.hostname); }
  catch { return false; }
}
async function hasOffscreen() {
  if (chrome.offscreen?.hasDocument) {
    try {
      return await chrome.offscreen.hasDocument();
    } catch {}
  }
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return Boolean(contexts && contexts.length > 0);
  } catch {
    return false;
  }
}

async function offscreen() {
  if (await hasOffscreen()) return;
  if (!opening) {
    opening = (async () => {
      if (await hasOffscreen()) return;
      try {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['USER_MEDIA', 'BLOBS'],
          justification: 'Capture autorisee, recadrage local et conservation des exports de reunion.',
        });
      } catch (err) {
        if (!err?.message?.includes('Only a single offscreen')) {
          throw err;
        }
      }
    })().finally(() => {
      opening = null;
    });
  }
  await opening;
}

async function media(type, data = {}, retries = 6) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await offscreen();
      const result = await chrome.runtime.sendMessage({ target: 'offscreen', type, ...data });
      if (result && typeof result === 'object') {
        if (result.ok) {
          return result;
        }
        if (result.error) {
          throw new Error(result.error);
        }
      }
      lastError = new Error('Le moteur de capture ne repond pas.');
    } catch (err) {
      const msg = err?.message || '';
      const isTransient = msg.includes('Receiving end does not exist')
        || msg.includes('Could not establish connection')
        || msg.includes('moteur de capture ne repond pas');

      if (isTransient && attempt < retries) {
        if (attempt === 3 && chrome.offscreen?.closeDocument) {
          try { await chrome.offscreen.closeDocument(); } catch {}
        }
        await new Promise((r) => setTimeout(r, attempt * 60));
        continue;
      }
      throw err;
    }

    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, attempt * 60));
    }
  }
  throw lastError || new Error('Le moteur de capture ne repond pas.');
}
async function target() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && isTeams(activeTab.url)) {
      await chrome.storage.session.set({ targetTabId: activeTab.id });
      await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['teams-content.js'] }).catch(() => {});
      return activeTab;
    }
  } catch {}
  const { targetTabId } = await chrome.storage.session.get('targetTabId');
  if (Number.isInteger(targetTabId)) {
    try {
      const tab = await chrome.tabs.get(targetTabId);
      if (isTeams(tab.url)) return tab;
    } catch {}
  }
  try {
    const tabs = await chrome.tabs.query({});
    const teamsTab = tabs.find(t => isTeams(t.url));
    if (teamsTab) {
      await chrome.storage.session.set({ targetTabId: teamsTab.id });
      await chrome.scripting.executeScript({ target: { tabId: teamsTab.id }, files: ['teams-content.js'] }).catch(() => {});
      return teamsTab;
    }
  } catch {}
  throw new Error("Ouvrez Teams puis cliquez sur l'icône de l'extension.");
}
async function page(tabId, type, data = {}) {
  const response = await chrome.tabs.sendMessage(tabId, { target: 'teams', type, ...data });
  if (!response?.ok) throw new Error(response?.error || "Adaptateur Teams indisponible. Recliquez sur l'icone.");
  return response;
}
chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  (async () => {
    const state = await media('status');
    if (state.active) return;
    if (!isTeams(tab.url)) throw new Error('Rejoignez Teams web avant de lancer une session.');
    await chrome.storage.session.set({ targetTabId: tab.id });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['teams-content.js'] });
  })().catch(error => chrome.runtime.sendMessage({ target: 'panel', type: 'error', message: error.message }).catch(() => {}));
});
async function command(message) {
  switch (message.type) {
    case 'status': return media('status');
    case 'start': {
      if (!message.consent) throw new Error('Confirmez les informations de confidentialite.');
      if (!['audio', 'captions'].includes(message.mode)) throw new Error('Mode invalide.');
      const tab = await target();
      if ((await media('status')).active) throw new Error('Une session est deja active.');
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      try {
        const started = await media('start', { streamId, tabId: tab.id, token: message.token, mode: message.mode, enableAudioOut: message.enableAudioOut, enableMic: message.enableMic });
        await chrome.storage.session.set({ activeTabId: tab.id });
        await page(tab.id, 'observe', { sessionOriginEpochMs: started.sessionOriginEpochMs, mode: message.mode });
        const { discreteMode } = await chrome.storage.session.get('discreteMode');
        if (discreteMode) {
          await page(tab.id, 'set-discrete-mode', { enabled: true }).catch(() => {});
        }
        return started;
      } catch (error) {
        await media('finish').catch(() => {});
        await chrome.storage.session.remove('activeTabId');
        throw error;
      }
    }
    case 'select': {
      const { activeTabId } = await chrome.storage.session.get('activeTabId');
      if (!activeTabId) throw new Error('Demarrez la session avant de selectionner une zone.');
      await media('stop-clip');
      const selected = await page(activeTabId, 'select');
      return media('preview', { rect: selected.rect });
    }
    case 'record': return media('record');
    case 'stop-clip': return media('stop-clip');
    case 'copilot-ask': return media('copilot-ask', { query: message.query });
    case 'finish': {
      const { activeTabId } = await chrome.storage.session.get('activeTabId');
      if (activeTabId) await page(activeTabId, 'stop-observe').catch(() => {});
      const result = await media('finish');
      await chrome.storage.session.remove('activeTabId');
      return result;
    }
    case 'reset':
    case 'delete': return media(message.type);
    case 'export': {
      const { url, filename } = await media('export');
      try {
        const id = await chrome.downloads.download({ url, filename, saveAs: true });
        downloadUrls.set(id, url);
        return { ok: true };
      } catch (error) { await media('revoke', { url }); throw error; }
    }
    case 'export-full': return media('export-full', { token: message.token, synthesisMode: message.synthesisMode, segments: message.segments });
    case 'get-transcript': return media('get-transcript');
    case 'set-discrete-mode': {
      await chrome.storage.session.set({ discreteMode: Boolean(message.enabled) });
      const { activeTabId, targetTabId } = await chrome.storage.session.get(['activeTabId', 'targetTabId']);
      const targetTabs = new Set([activeTabId, targetTabId].filter(Boolean));
      try {
        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
          if (t.id && isTeams(t.url)) targetTabs.add(t.id);
        }
      } catch {}
      for (const tid of targetTabs) {
        chrome.tabs.sendMessage(tid, { target: 'teams', type: 'set-discrete-mode', enabled: Boolean(message.enabled) }).catch(() => {});
      }
      return { ok: true };
    }
    default: throw new Error('Commande inconnue.');
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target === 'worker-relay') {
    (async () => {
      try {
        const { activeTabId, targetTabId } = await chrome.storage.session.get(['activeTabId', 'targetTabId']);
        const targetTabs = new Set([activeTabId, targetTabId].filter(Boolean));
        try {
          const tabs = await chrome.tabs.query({});
          for (const t of tabs) {
            if (t.id && isTeams(t.url)) targetTabs.add(t.id);
          }
        } catch {}
        if (message.type === 'segment' || message.type === 'interim') {
          for (const tid of targetTabs) {
            chrome.tabs.sendMessage(tid, { target: 'teams', type: message.type, ...message }).catch(() => {});
          }
        }
      } catch {}
      chrome.runtime.sendMessage({ ...message, target: 'panel' }).catch(() => {});
      return { ok: true };
    })().then(reply).catch(() => reply?.({ ok: false }));
    return true;
  }
  if (message?.target !== 'worker' || sender.id !== chrome.runtime.id) return;
  (async () => {
    // Si la requête provient d'une page interne de l'extension (panel.html, offscreen.html)
    if (sender.url?.startsWith(chrome.runtime.getURL(''))) {
      if (message.type === 'heartbeat') return { ok: true };
      return command(message);
    }
    // Sinon, si la requête provient d'un onglet Teams (content-script)
    if (sender.tab) {
      if (message.type === 'reopen-panel') {
        await chrome.storage.session.set({ discreteMode: false });
        if (sender.tab.id) {
          await page(sender.tab.id, 'set-discrete-mode', { enabled: false }).catch(() => {});
        }
        if (sender.tab.windowId) {
          chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
        }
        return { ok: true };
      }
      const { activeTabId } = await chrome.storage.session.get('activeTabId');
      if (sender.tab.id !== activeTabId || sender.frameId !== 0 || !isTeams(sender.url)) throw new Error('Source Teams non autorisee.');
      if (message.type === 'caption') return media('caption', { segment: message.segment });
      if (message.type === 'active-speaker') return media('active-speaker', { speakerName: message.speakerName, source: message.source });
      if (message.type === 'crop-invalid') return media('invalidate', { reason: message.reason });
      if (message.type === 'adapter-status') return media('adapter-status', { message: message.message, available: message.available, timing: message.timing });
      throw new Error('Commande de page non autorisee.');
    }
    throw new Error('Commande non autorisee.');
  })().then(reply, error => reply({ ok: false, error: error.message }));
  return true;
});
chrome.downloads.onChanged.addListener(delta => {
  if (!['complete', 'interrupted'].includes(delta.state?.current)) return;
  const url = downloadUrls.get(delta.id);
  if (url) { downloadUrls.delete(delta.id); media('revoke', { url }).catch(() => {}); }
});
chrome.tabs.onRemoved.addListener(async tabId => {
  const { activeTabId } = await chrome.storage.session.get('activeTabId');
  if (activeTabId === tabId) {
    await media('invalidate', { reason: 'Onglet Teams ferme.' }).catch(() => {});
    await media('finish').catch(() => {});
    await chrome.storage.session.remove('activeTabId');
  }
});

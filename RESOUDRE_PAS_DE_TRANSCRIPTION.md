# 🔧 Résoudre : Pas de transcription en mode Audio Direct

## ⚡ Solution Rapide (5 minutes)

### Étape 1 : Vérifier le Backend

```bash
# Le serveur tourne-t-il ?
curl http://127.0.0.1:8787/health
```

**Résultat attendu** :
```json
{
  "ok": true,
  "audioProvider": "gemini-3.5-live-translate-preview",
  "gatewayConfigured": true
}
```

✅ Si OK → Passez à l'Étape 2  
❌ Si erreur → Le serveur n'est pas lancé, lancez-le :

```bash
cd /home/ff/Public/MTT
npm start
```

### Étape 2 : Ouvrir les Logs de l'Extension

1. **Chrome** → `chrome://extensions/`
2. **Mode développeur** → Activé (coin supérieur droit)
3. Trouvez **"Clair - Teams en francais"**
4. **Inspecter les vues** → Cliquez sur **"offscreen.html"** ou **"service worker"**
5. DevTools s'ouvre → Onglet **Console**
6. **Laissez cette fenêtre ouverte**

### Étape 3 : Activer le Mode Debug

Dans la console DevTools de l'extension, **collez ce code** et appuyez sur Entrée :

```javascript
const originalWebSocket = WebSocket;
window.WebSocket = function(url, protocols) {
  console.log('🔌 Connexion WebSocket:', url);
  const ws = new originalWebSocket(url, protocols);
  ws.addEventListener('open', () => console.log('✅ WebSocket ouvert'));
  ws.addEventListener('message', (e) => {
    try { console.log('📨 Reçu:', JSON.parse(e.data)); }
    catch { console.log('📨 Binaire:', e.data.byteLength, 'octets'); }
  });
  ws.addEventListener('error', (e) => console.error('❌ Erreur WS:', e));
  ws.addEventListener('close', (e) => console.log('🔌 Fermé:', e.code, e.reason));
  const originalSend = ws.send;
  ws.send = function(data) {
    if (typeof data === 'string') {
      try { console.log('📤 Envoi:', JSON.parse(data)); }
      catch { console.log('📤 Texte:', data.substring(0, 50)); }
    } else {
      console.log('📤 Audio:', data.byteLength, 'octets');
    }
    return originalSend.apply(this, arguments);
  };
  return ws;
};
console.log('✅ Debug activé');
```

### Étape 4 : Lancer une Session

1. **Ouvrez Teams** dans un nouvel onglet
2. **Rejoignez une réunion** (ou créez-en une)
3. **Ouvrez le panneau Clair** (icône extension)
4. **Mode** : "Audio direct (Google Gemini 3.8 Live)"
5. **Token** : `clair-local-session-secret-token-2026`
6. Cliquez sur **"Démarrer la session"**

### Étape 5 : Observer les Logs

Retournez dans la console DevTools de l'extension.

#### ✅ Si ça fonctionne, vous verrez :

```
🔌 Connexion WebSocket: ws://127.0.0.1:8787
✅ WebSocket ouvert
📤 Envoi: { type: 'start', token: '...', mode: 'audio' }
📨 Reçu: { type: 'ready', ok: true }
📤 Audio: 2048 octets
📤 Audio: 2048 octets
... (flux continu d'audio)
📨 Reçu: { type: 'segment', segment: { translatedText: '...' } }
```

Si vous voyez tout ça **mais que le panneau reste vide** → Problème d'affichage (voir Section Dépannage)

#### ❌ Scénarios d'erreur

**Scénario A : WebSocket ne se connecte pas**
```
🔌 Connexion WebSocket: ws://127.0.0.1:8787
❌ Erreur WS: Event
🔌 Fermé: 1006
```

➡️ **Solution** : Le serveur refuse la connexion. C'est **NORMAL** si vous testez depuis DevTools. La vraie connexion doit venir de l'extension.

**Vérification** : Dans le terminal où `npm start` tourne, vous devriez voir :
```
[Gateway] WebSocket connection from chrome-extension://...
```

Si vous ne voyez **aucune ligne** avec "WebSocket connection" → L'extension n'essaie jamais de se connecter.

**Scénario B : WebSocket ouvert mais pas de 'ready'**
```
🔌 Connexion WebSocket: ws://127.0.0.1:8787
✅ WebSocket ouvert
📤 Envoi: { type: 'start', ... }
(plus rien)
```

➡️ **Solution** : Regardez les logs du serveur backend. Vous devriez y voir une erreur.

**Causes possibles** :
- Token invalide → Vérifiez `.env` : `GATEWAY_TOKEN=clair-local-session-secret-token-2026`
- Clé Gemini invalide → Vérifiez `.env` : `GEMINI_API_KEY=...`
- Modèle invalide → Vérifiez `.env` : `GEMINI_LIVE_MODEL=gemini-3.5-live-translate-preview`

**Scénario C : 'ready' reçu mais pas d'audio**
```
✅ WebSocket ouvert
📤 Envoi: { type: 'start', ... }
📨 Reçu: { type: 'ready', ok: true }
(pas de "📤 Audio: ...")
```

➡️ **Solution** : L'extension ne capture pas l'audio de Teams.

**Vérifications** :

1. L'onglet Teams est-il actif/visible ?
2. Chrome a-t-il la permission de capturer l'onglet ?
3. Testez manuellement :

```javascript
// Dans la console de l'extension
chrome.tabCapture.getMediaStreamId({ targetTabId: chrome.tabs.TAB_ID_HERE })
  .then(id => console.log('✅ Capture OK, stream ID:', id))
  .catch(err => console.error('❌ Capture refusée:', err));
```

**Scénario D : Audio envoyé mais pas de segments**
```
📤 Audio: 2048 octets
📤 Audio: 2048 octets
... (des centaines de lignes)
(mais jamais de "📨 Reçu: { type: 'segment' }")
```

➡️ **Solution** : L'API Gemini ne transcrit pas.

**Causes possibles** :

1. **Personne ne parle** → Parlez vous-même ou faites parler quelqu'un
2. **Audio silencieux** → Vérifiez que le micro Teams n'est pas muté
3. **Mauvais format audio** → Vérifiez les logs du serveur backend
4. **Clé API épuisée** → Vérifiez votre quota Google Cloud

Dans les logs du serveur, vous devriez voir :
```
[Gemini Live] Text received: "Hello everyone"
[Gateway] Broadcasting segment
```

Si vous voyez **"Text received"** → Le serveur reçoit bien la transcription.
Si vous ne voyez **rien** → L'API Gemini ne répond pas (vérifiez la clé).

## 🔍 Diagnostic Approfondi

Si les étapes ci-dessus ne suffisent pas, consultez :

- 📖 **GUIDE_DEBUG_EXTENSION.md** - Guide complet avec tous les scénarios
- 📖 **DIAGNOSTIC_AUDIO_DIRECT.md** - Diagnostic technique détaillé
- 📖 **GUIDE_DIAGNOSTIC_SOUS-TITRES.md** - Pour le mode sous-titres

## 🎯 Checklist Finale

Avant de demander de l'aide, vérifiez que vous avez fait :

- [ ] Serveur backend lancé (`npm start`)
- [ ] Health check OK (`curl http://127.0.0.1:8787/health`)
- [ ] Extension chargée dans Chrome (`chrome://extensions/`)
- [ ] Mode développeur activé
- [ ] DevTools de l'extension ouvert (offscreen.html)
- [ ] Script de debug exécuté dans la console
- [ ] Réunion Teams active
- [ ] Session démarrée dans le panneau Clair
- [ ] Quelqu'un parle dans la réunion
- [ ] Logs de la console copiés
- [ ] Logs du serveur backend copiés

## 💡 Astuce : Test Sans Teams

Pour vérifier que le système fonctionne sans avoir besoin d'une vraie réunion :

1. Installez un logiciel de synthèse vocale (ex: `espeak` sur Linux)
2. Faites parler votre ordinateur pendant que Teams est ouvert
3. La transcription devrait apparaître

```bash
# Sur Linux
espeak "Hello everyone, this is a test of the transcription system"

# Sur Mac
say "Hello everyone, this is a test"

# Sur Windows (PowerShell)
Add-Type -AssemblyName System.Speech
$speak = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speak.Speak("Hello everyone")
```

## 🆘 Aide Rapide

### Le panneau reste vide

**Si les logs montrent que des segments sont reçus** mais que le panneau reste vide :

1. Ouvrez aussi les DevTools du **panneau** (clic droit sur le panneau Clair → Inspecter)
2. Dans sa console, tapez :

```javascript
chrome.runtime.onMessage.addListener((msg) => {
  console.log('[PANEL] Message:', msg);
});
```

3. Si vous ne voyez aucun message → Le routage est cassé
4. Si vous voyez des messages mais rien ne s'affiche → Problème de rendu React

### Erreur "Failed to execute 'getUserMedia'"

```bash
# Vérifiez les permissions de l'extension
cat dist/extension/manifest.json | grep -A 5 permissions
```

Doit contenir : `"tabCapture"`, `"audioCapture"`

Si manquant :
```bash
npm run build
# Rechargez l'extension dans chrome://extensions/
```

### Erreur 403 dans les logs serveur

C'est **normal** si vous testez depuis Node.js ou curl. Le serveur n'accepte que les connexions depuis l'extension Chrome (origin: `chrome-extension://...`).

La vraie connexion depuis l'extension ne devrait pas avoir ce problème.

## 📊 Résumé des Composants

```
┌─────────────────────┐
│   Teams (onglet)    │  Parole
└──────────┬──────────┘
           │ chrome.tabCapture
           ↓
┌─────────────────────┐
│ Extension offscreen │  Capture audio + PCM
│   (offscreen.js)    │
└──────────┬──────────┘
           │ WebSocket ws://127.0.0.1:8787
           ↓
┌─────────────────────┐
│  Serveur Node.js    │  Relay
│   (server/index.js) │
└──────────┬──────────┘
           │ WebSocket API Gemini
           ↓
┌─────────────────────┐
│   Google Gemini     │  Transcription
│  (gemini-3.5-live)  │
└──────────┬──────────┘
           │ Text + Translation
           ↓
┌─────────────────────┐
│  Serveur Node.js    │  Broadcast
└──────────┬──────────┘
           │ WebSocket
           ↓
┌─────────────────────┐
│ Extension offscreen │  Sauvegarde segments
└──────────┬──────────┘
           │ chrome.runtime.sendMessage
           ↓
┌─────────────────────┐
│   Panel (React)     │  Affichage UI
└─────────────────────┘
```

**Le problème peut être à n'importe quelle étape**. Les logs vous diront où.

---

## ✅ Validation Finale

Si après tout ça vous voyez dans les logs :

```
📨 Reçu: { 
  type: 'segment', 
  segment: { 
    translatedText: 'Bonjour tout le monde',
    sourceText: 'Hello everyone',
    startMs: 1234,
    endMs: 5678
  } 
}
```

**MAIS que le panneau reste vide** → Le problème est dans l'affichage, pas dans la transcription.

Dans ce cas, ouvrez une issue avec :
- Les logs de l'extension
- Les logs du serveur
- Un screenshot du panneau vide
- La mention "Les segments sont reçus mais pas affichés"

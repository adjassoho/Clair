# Guide de Débogage de l'Extension Chrome

## 🎯 Objectif

Identifier pourquoi aucune transcription n'apparaît lorsque vous utilisez le mode "Audio direct" dans une réunion Teams.

## 📋 Étapes de Diagnostic

### Étape 1 : Ouvrir les DevTools de l'Extension

1. **Ouvrez Chrome** et allez sur `chrome://extensions/`
2. **Activez le mode développeur** (coin supérieur droit)
3. Trouvez l'extension **"Clair - Teams en francais"**
4. Cliquez sur **"Inspecter les vues"** → **"offscreen.html"** (ou "service worker" si offscreen n'apparaît pas)
5. Une fenêtre DevTools s'ouvre → Allez dans l'onglet **Console**

### Étape 2 : Activer les Logs de Débogage

Dans la console DevTools de l'extension, collez et exécutez ce code :

```javascript
// Active les logs détaillés
window.DEBUG_CLAIR = true;

// Intercepte tous les messages WebSocket
const originalWebSocket = WebSocket;
window.WebSocket = function(url, protocols) {
  console.log('🔌 [DEBUG] Tentative de connexion WebSocket:', url);
  const ws = new originalWebSocket(url, protocols);
  
  ws.addEventListener('open', () => {
    console.log('✅ [DEBUG] WebSocket connecté:', url);
  });
  
  ws.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('📨 [DEBUG] Message reçu du serveur:', data);
    } catch (e) {
      console.log('📨 [DEBUG] Message binaire reçu:', event.data);
    }
  });
  
  ws.addEventListener('error', (error) => {
    console.error('❌ [DEBUG] Erreur WebSocket:', error);
  });
  
  ws.addEventListener('close', (event) => {
    console.log('🔌 [DEBUG] WebSocket fermé - Code:', event.code, 'Raison:', event.reason);
  });
  
  // Intercepte les envois
  const originalSend = ws.send;
  ws.send = function(data) {
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        console.log('📤 [DEBUG] Envoi au serveur:', parsed);
      } catch {
        console.log('📤 [DEBUG] Envoi texte:', data.substring(0, 100));
      }
    } else {
      console.log('📤 [DEBUG] Envoi binaire:', data.byteLength, 'octets');
    }
    return originalSend.apply(this, arguments);
  };
  
  return ws;
};

console.log('✅ [DEBUG] Logs activés - Lancez maintenant une session');
```

### Étape 3 : Lancer une Session Teams

1. **Ouvrez un onglet Teams** : `https://teams.microsoft.com`
2. **Rejoignez une réunion** (ou créez-en une de test)
3. **Ouvrez le panneau de l'extension** (cliquez sur l'icône Clair)
4. **Sélectionnez** "Audio direct (Google Gemini 3.8 Live)"
5. **Token** : `clair-local-session-secret-token-2026`
6. Cliquez sur **"Démarrer la session"**

### Étape 4 : Analyser les Logs

Retournez dans la console DevTools de l'extension et observez les messages.

#### ✅ Cas de succès (si tout fonctionne)

Vous devriez voir :

```
🔌 [DEBUG] Tentative de connexion WebSocket: ws://127.0.0.1:8787
✅ [DEBUG] WebSocket connecté: ws://127.0.0.1:8787
📤 [DEBUG] Envoi au serveur: {
  type: 'start',
  token: 'clair-local-session-secret-token-2026',
  mode: 'audio',
  sourceLanguage: 'en',
  targetLanguage: 'fr',
  audioOffsetMs: 0,
  enableAudioOut: false
}
📨 [DEBUG] Message reçu du serveur: { type: 'ready', ok: true, sessionOriginEpochMs: ... }
📤 [DEBUG] Envoi binaire: 2048 octets
📤 [DEBUG] Envoi binaire: 2048 octets
... (flux audio continu)
📨 [DEBUG] Message reçu du serveur: { type: 'segment', segment: { translatedText: '...' } }
```

#### ❌ Problème 1 : WebSocket ne se connecte jamais

```
🔌 [DEBUG] Tentative de connexion WebSocket: ws://127.0.0.1:8787
❌ [DEBUG] Erreur WebSocket: ...
🔌 [DEBUG] WebSocket fermé - Code: 1006
```

**Cause** : Le serveur backend n'est pas joignable.

**Solution** :
```bash
# Vérifiez que le serveur tourne
ps aux | grep 'node.*server'

# Si rien n'apparaît, relancez-le
cd /home/ff/Public/MTT
npm start
```

#### ❌ Problème 2 : WebSocket se connecte mais aucun message 'ready'

```
✅ [DEBUG] WebSocket connecté: ws://127.0.0.1:8787
📤 [DEBUG] Envoi au serveur: { type: 'start', ... }
(rien ne se passe)
```

**Cause** : Le serveur refuse le token ou ne répond pas.

**Solution** :
1. Vérifiez le fichier `.env` :
```bash
cat /home/ff/Public/MTT/.env | grep GATEWAY_TOKEN
# Doit afficher: GATEWAY_TOKEN=clair-local-session-secret-token-2026
```

2. Regardez les logs du serveur dans le terminal où vous avez lancé `npm start`

#### ❌ Problème 3 : 'ready' reçu mais pas d'audio envoyé

```
✅ [DEBUG] WebSocket connecté
📤 [DEBUG] Envoi au serveur: { type: 'start', ... }
📨 [DEBUG] Message reçu: { type: 'ready', ok: true }
(pas de "Envoi binaire" après)
```

**Cause** : L'extension ne capture pas l'audio de Teams.

**Solution** : Vérifiez les permissions :

```javascript
// Dans la console de l'extension
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(() => console.log('✅ Permission audio OK'))
  .catch(err => console.error('❌ Permission audio refusée:', err));
```

Si refusé :
1. Allez dans `chrome://settings/content/microphone`
2. Vérifiez que Chrome a accès au microphone
3. Rechargez l'extension

#### ❌ Problème 4 : Audio envoyé mais pas de segments reçus

```
📤 [DEBUG] Envoi binaire: 2048 octets
📤 [DEBUG] Envoi binaire: 2048 octets
... (beaucoup de lignes)
(mais aucun "Message reçu" avec type: 'segment')
```

**Cause** : L'API Gemini ne répond pas ou refuse les requêtes.

**Solution** :

1. Vérifiez la clé API :
```bash
cat /home/ff/Public/MTT/.env | grep GEMINI_API_KEY
```

2. Testez la clé manuellement :
```bash
curl -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}' \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=VOTRE_CLE_ICI"
```

Si erreur 403 ou 401 → La clé API est invalide ou expirée.

3. Regardez les logs du serveur backend pour voir les erreurs Gemini

#### ❌ Problème 5 : Segments reçus mais ne s'affichent pas

```
📨 [DEBUG] Message reçu: { type: 'segment', segment: { translatedText: 'Bonjour' } }
```

**Cause** : Le panneau ne reçoit pas les mises à jour.

**Solution** : Ouvrez aussi les DevTools du panneau (panel.html) :

1. Faites un **clic droit sur le panneau Clair**
2. **Inspecter**
3. Dans la console, ajoutez :

```javascript
chrome.runtime.onMessage.addListener((msg) => {
  console.log('📨 [PANEL] Message reçu:', msg);
});
```

Si vous ne voyez aucun message → Le routage entre offscreen et panel est cassé.

### Étape 5 : Vérifier le Flux Audio

Pour s'assurer que l'audio de Teams est bien capturé :

```javascript
// Dans la console de l'extension (offscreen.html)
navigator.mediaDevices.enumerateDevices().then(devices => {
  console.log('🎤 Devices disponibles:', devices);
});

// Vérifier si un stream audio est actif
setInterval(() => {
  if (window.stream) {
    const audioTracks = window.stream.getAudioTracks();
    console.log('🔊 Tracks audio actifs:', audioTracks.length);
    audioTracks.forEach(track => {
      console.log('  -', track.label, 'enabled:', track.enabled, 'muted:', track.muted);
    });
  }
}, 2000);
```

## 🔍 Checklist Complète

- [ ] Serveur backend actif (`ps aux | grep node`)
- [ ] Port 8787 ouvert (`ss -tlnp | grep 8787`)
- [ ] Fichier `.env` correct (GATEWAY_TOKEN, GEMINI_API_KEY, GEMINI_LIVE_MODEL)
- [ ] Extension chargée dans Chrome (`chrome://extensions/`)
- [ ] DevTools de l'extension ouvert (offscreen.html)
- [ ] Logs de débogage activés (script ci-dessus)
- [ ] Onglet Teams ouvert avec une réunion active
- [ ] Quelqu'un parle dans la réunion (ou vous parlez)
- [ ] WebSocket se connecte (`✅ WebSocket connecté`)
- [ ] Message 'ready' reçu
- [ ] Audio PCM envoyé (`📤 Envoi binaire`)
- [ ] Segments reçus (`📨 type: 'segment'`)
- [ ] Panneau affiche les transcriptions

## 🐛 Problèmes Courants

### "Failed to execute 'getUserMedia'"

**Cause** : L'extension n'a pas la permission de capturer l'onglet.

**Solution** :
1. Vérifiez que l'extension a bien `tabCapture` dans `manifest.json`
2. Rechargez l'extension
3. Redémarrez Chrome si nécessaire

### "WebSocket connection to 'ws://127.0.0.1:8787' failed"

**Cause** : Serveur backend pas lancé ou firewall bloque le port.

**Solution** :
```bash
# Relancer le serveur
cd /home/ff/Public/MTT
npm start

# Vérifier le firewall
sudo ufw status
# Si actif, autoriser le port :
sudo ufw allow 8787/tcp
```

### "AudioContext was not allowed to start"

**Cause** : Chrome bloque l'autoplay audio.

**Solution** : Interagissez avec la page (cliquez quelque part) avant de démarrer la session.

### Segments vides ou "undefined"

**Cause** : L'API Gemini reçoit de l'audio silencieux ou mal formaté.

**Solution** :
1. Vérifiez que des gens parlent **vraiment** dans Teams
2. Vérifiez que le micro Teams n'est pas coupé
3. Vérifiez le niveau audio dans le visualiseur de l'extension

## 📞 Rapport de Bug

Si après avoir suivi toutes ces étapes le problème persiste, créez un rapport avec :

1. **Logs de la console extension** (copier/coller les 50 dernières lignes)
2. **Logs du serveur backend** (terminal `npm start`)
3. **Configuration** :
   - Version de Chrome : `chrome://version/`
   - Système d'exploitation : Linux, Windows, Mac
   - Version de Teams : Web ou Desktop
4. **Ce qui se passe exactement** :
   - WebSocket se connecte ? (Oui/Non)
   - Message 'ready' reçu ? (Oui/Non)
   - Audio envoyé ? (Oui/Non)
   - Segments reçus ? (Oui/Non)
   - Erreurs dans les logs ? (Lesquelles)

## ✅ Test Rapide de Validation

Pour vérifier que tout l'environnement fonctionne :

```bash
cd /home/ff/Public/MTT

# 1. Serveur OK ?
curl http://127.0.0.1:8787/health
# Attendu: { "ok": true, "audioProvider": "gemini-3.5-live-translate-preview" }

# 2. Extension buildée ?
ls -lh dist/extension/manifest.json
# Attendu: fichier existe

# 3. Extension chargée dans Chrome ?
# Ouvrir chrome://extensions/ et vérifier visuellement
```

Si les 3 passent, le problème est dans la séquence de démarrage ou les permissions.

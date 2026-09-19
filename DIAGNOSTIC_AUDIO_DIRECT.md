# Diagnostic : Pas de transcription en mode Audio Direct

## 🎯 Problème

Lorsque vous lancez une session en mode "Audio direct (Gemini Live)" et que quelqu'un parle en anglais, **aucune transcription n'apparaît** dans le panneau.

## 🔍 Points de vérification

### 1. Le serveur backend fonctionne ✅

```bash
# Vérifier que le serveur tourne
ps aux | grep 'node.*server'
# ✅ PID 7743 actif

# Vérifier la santé du serveur
curl http://127.0.0.1:8787/health
# ✅ audioProvider: "gemini-3.5-live-translate-preview"
```

### 2. La configuration est correcte ✅

```bash
cat .env
# ✅ GATEWAY_TOKEN configuré
# ✅ GEMINI_API_KEY configuré
# ✅ GEMINI_LIVE_MODEL=gemini-3.5-live-translate-preview
```

### 3. Le flux de données (à vérifier)

Voici le chemin que doivent suivre les données :

```
🎤 Audio Teams
    ↓
📹 chrome.tabCapture (extension/offscreen.js)
    ↓
🔊 AudioContext + PCM Worklet (extension/pcm-worklet.js)
    ↓
🌐 WebSocket → ws://127.0.0.1:8787/live (extension/offscreen.js)
    ↓
🖥️ Serveur Node.js (server/index.js)
    ↓
🤖 Google Gemini API WebSocket (server/providers.js)
    ↓
📝 Transcription reçue (server/providers.js onResult)
    ↓
🌐 WebSocket → Extension (server/index.js)
    ↓
📊 Affichage dans panel.js
```

**Un problème à n'importe quelle étape = pas de transcription**

## 🔧 Tests de diagnostic

### Test 1 : Vérifier que le WebSocket serveur accepte les connexions

```bash
cd /home/ff/Public/MTT
node << 'EOF'
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:8787/live');

ws.on('open', () => {
  console.log('✅ Connexion WebSocket établie');
  
  // Envoyer un message d'initialisation
  ws.send(JSON.stringify({
    type: 'start',
    token: 'clair-local-session-secret-token-2026',
    enableAudioOut: false,
    enableMic: false
  }));
  
  console.log('📤 Message start envoyé');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('📨 Message reçu du serveur:', msg);
});

ws.on('error', (err) => {
  console.error('❌ Erreur WebSocket:', err.message);
});

ws.on('close', (code, reason) => {
  console.log('🔌 Connexion fermée:', code, reason.toString());
  process.exit(0);
});

setTimeout(() => {
  console.log('⏱️ Test terminé après 5 secondes');
  ws.close();
}, 5000);
EOF
```

**Résultat attendu** :
- ✅ "Connexion WebSocket établie"
- ✅ Message reçu avec `{ ok: true, sessionOriginEpochMs: ... }`

### Test 2 : Envoyer de l'audio PCM au serveur

```bash
cd /home/ff/Public/MTT
node << 'EOF'
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:8787/live');

let started = false;

ws.on('open', () => {
  console.log('✅ Connexion établie');
  ws.send(JSON.stringify({
    type: 'start',
    token: 'clair-local-session-secret-token-2026',
    enableAudioOut: false,
    enableMic: false
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('📨 Reçu:', msg.type || msg);
  
  if (msg.ok && !started) {
    started = true;
    console.log('🎤 Session démarrée, envoi d\'audio silencieux...');
    
    // Envoyer 3 secondes d'audio silencieux (pour tester le flux)
    const sampleRate = 16000;
    const samplesPerChunk = 1024;
    const chunks = Math.floor((sampleRate * 3) / samplesPerChunk);
    
    for (let i = 0; i < chunks; i++) {
      const pcm = Buffer.alloc(samplesPerChunk * 2); // Silence (zeros)
      ws.send(pcm);
    }
    
    console.log(`📤 ${chunks} chunks d'audio envoyés`);
    console.log('⚠️ Audio silencieux = pas de transcription (normal)');
    console.log('   Mais le flux doit passer sans erreur');
  }
  
  if (msg.type === 'segment') {
    console.log('✅ SEGMENT REÇU:', msg.translatedText);
  }
});

ws.on('error', (err) => {
  console.error('❌ Erreur:', err.message);
});

setTimeout(() => {
  console.log('\n📊 Test terminé');
  ws.close();
  process.exit(0);
}, 8000);
EOF
```

**Résultat attendu** :
- ✅ Connexion établie
- ✅ Session démarrée
- ✅ Audio envoyé sans erreur
- ⚠️ Pas de segment reçu (normal car audio silencieux)

### Test 3 : Vérifier les logs du serveur en temps réel

Dans un terminal séparé, relancez le serveur avec des logs détaillés :

```bash
# Arrêter le serveur actuel
killall node

# Relancer avec logs verbeux
cd /home/ff/Public/MTT
DEBUG=* npm start
```

Puis lancez une session depuis l'extension et observez les logs. Vous devriez voir :

```
[Gateway] WebSocket connection from extension
[Gateway] Session start requested
[Gemini Live] Connecting to Gemini API...
[Gemini Live] Connected, sending setup
[Gemini Live] Setup acknowledged
[Gateway] Forwarding PCM audio to Gemini...
[Gemini Live] Text received: "..."
[Gateway] Broadcasting segment to extension
```

Si vous ne voyez **aucun de ces logs**, le problème est dans l'extension.

## 🐛 Points de blocage possibles

### Blocage 1 : L'extension ne capture pas l'audio

**Symptôme** : Le serveur ne reçoit jamais de PCM

**Vérification** : Ouvrez l'extension, cliquez sur "Inspecter" (clic droit sur le panneau), regardez la console.

Cherchez :
```javascript
// Dans la console de l'extension
chrome.storage.session.get(['activeTabId'], (result) => {
  console.log('Active tab:', result.activeTabId);
});
```

Si `activeTabId` est `undefined` → La session n'a jamais été démarrée correctement.

### Blocage 2 : Le WebSocket ne se connecte pas

**Symptôme** : Erreur de connexion dans les logs de l'extension

**Causes possibles** :
1. CORS non configuré (mais le serveur est en `127.0.0.1`, donc pas de CORS)
2. Token invalide
3. Port 8787 bloqué par un firewall

**Test** :
```bash
# Vérifier que le port 8787 est bien ouvert
ss -tlnp | grep 8787
```

### Blocage 3 : L'audio PCM est mal formaté

**Symptôme** : Le serveur reçoit les données mais Gemini ne répond pas

**Le format attendu** :
- Sample rate : 16000 Hz
- Format : PCM 16-bit little-endian
- Mono (1 canal)

**Vérification dans le code** :
```bash
cat extension/offscreen.js | grep -A 5 'sampleRate'
```

Doit afficher `16000`.

### Blocage 4 : L'extension n'affiche pas les segments reçus

**Symptôme** : Le serveur envoie des segments mais le panneau reste vide

**Vérification** : Dans la console de l'extension (panel.js) :

```javascript
// Écoutez les messages du worker
chrome.runtime.onMessage.addListener((msg) => {
  console.log('Message reçu dans panel:', msg);
});
```

Si vous voyez `{ type: 'state', state: { segments: [...] } }` → Le problème est dans le rendu UI.
Si vous ne voyez rien → Le problème est dans le routing des messages.

## 🎯 Checklist de diagnostic rapide

Exécutez ceci dans l'ordre :

1. **[ ]** Le serveur tourne : `curl http://127.0.0.1:8787/health`
2. **[ ]** Test WebSocket simple (Test 1 ci-dessus)
3. **[ ]** Extension chargée dans Chrome : `chrome://extensions/`
4. **[ ]** Onglet Teams ouvert dans le navigateur
5. **[ ]** Panel de l'extension ouvert (icône dans la barre)
6. **[ ]** Mode "Audio direct" sélectionné
7. **[ ]** Token correct : `clair-local-session-secret-token-2026`
8. **[ ]** Bouton "Démarrer la session" cliqué
9. **[ ]** Status devient "Transcription active"
10. **[ ]** Quelqu'un parle dans Teams (en anglais de préférence)
11. **[ ]** Logs du serveur montrent de l'activité
12. **[ ]** Console de l'extension (F12) ne montre pas d'erreurs

## 🔍 Commande de diagnostic automatique

Exécutez ce script pour un diagnostic complet :

```bash
cd /home/ff/Public/MTT
cat > diagnostic.sh << 'SCRIPT'
#!/bin/bash

echo "=== DIAGNOSTIC COMPLET ==="

echo "\n1️⃣ Vérification du serveur..."
if curl -s http://127.0.0.1:8787/health > /dev/null; then
  echo "  ✅ Serveur actif"
  curl -s http://127.0.0.1:8787/health | jq .
else
  echo "  ❌ Serveur injoignable"
  exit 1
fi

echo "\n2️⃣ Vérification de la configuration..."
if [ -f .env ]; then
  echo "  ✅ Fichier .env trouvé"
  grep -E '^(GATEWAY_TOKEN|GEMINI_LIVE_MODEL)=' .env
else
  echo "  ❌ Fichier .env manquant"
  exit 1
fi

echo "\n3️⃣ Vérification de l'extension..."
if [ -d dist/extension ]; then
  echo "  ✅ Extension buildée"
  ls -lh dist/extension/manifest.json
else
  echo "  ⚠️ Extension non buildée"
  echo "  Exécutez: npm run build"
fi

echo "\n4️⃣ Test de connexion WebSocket..."
node << 'EOF'
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:8787/live');
let success = false;

ws.on('open', () => {
  console.log('  ✅ Connexion WebSocket OK');
  success = true;
  ws.send(JSON.stringify({ type: 'start', token: 'clair-local-session-secret-token-2026' }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.ok) {
    console.log('  ✅ Serveur a accepté la session');
  }
});

ws.on('error', (err) => {
  console.error('  ❌ Erreur WebSocket:', err.message);
});

setTimeout(() => {
  if (!success) console.log('  ❌ Timeout de connexion');
  ws.close();
  process.exit(success ? 0 : 1);
}, 3000);
EOF

if [ $? -eq 0 ]; then
  echo "\n✅ DIAGNOSTIC OK - Le backend fonctionne"
  echo "\n📌 Prochaine étape :"
  echo "   1. Ouvrez Chrome et allez sur chrome://extensions/"
  echo "   2. Vérifiez que l'extension Clair est chargée"
  echo "   3. Ouvrez DevTools sur l'extension (Inspecter)"
  echo "   4. Lancez une session et regardez les logs"
else
  echo "\n❌ DIAGNOSTIC ÉCHOUÉ - Vérifiez les logs ci-dessus"
fi
SCRIPT

chmod +x diagnostic.sh
./diagnostic.sh
```

## 📝 Prochaines étapes

Si le diagnostic backend passe (serveur + WebSocket OK), le problème est **dans l'extension**.

Il faut alors :
1. Activer les logs debug dans `extension/offscreen.js`
2. Vérifier que `chrome.tabCapture` fonctionne
3. Vérifier que l'audio PCM est bien envoyé au serveur
4. Vérifier que les segments reçus sont bien affichés dans `panel.js`

Voulez-vous que je crée une version debug de `offscreen.js` avec des logs détaillés ?

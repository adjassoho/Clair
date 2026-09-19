# 🚀 Commencez Ici - Problème de Transcription

## Votre Problème

❌ **Aucune transcription n'apparaît** quand quelqu'un parle dans Teams, même en mode "Audio direct".

## Solution en 3 Étapes

### 1️⃣ Vérifier le Serveur (30 secondes)

```bash
curl http://127.0.0.1:8787/health
```

**Résultat attendu** : `{"ok":true,"audioProvider":"gemini-3.5-live-translate-preview"}`

✅ Si OK → Étape 2  
❌ Si erreur → Lancez le serveur :

```bash
cd /home/ff/Public/MTT
npm start
```

### 2️⃣ Activer les Logs Debug (1 minute)

1. Chrome → `chrome://extensions/`
2. Mode développeur → ON
3. Extension "Clair - Teams en francais" → **Inspecter les vues** → **offscreen.html**
4. Dans la console qui s'ouvre, **collez et exécutez** :

```javascript
const originalWebSocket = WebSocket;
window.WebSocket = function(url, protocols) {
  console.log('🔌 WS:', url);
  const ws = new originalWebSocket(url, protocols);
  ws.addEventListener('open', () => console.log('✅ Ouvert'));
  ws.addEventListener('message', (e) => {
    try { console.log('📨', JSON.parse(e.data)); }
    catch { console.log('📨 Audio:', e.data.byteLength); }
  });
  ws.addEventListener('error', (e) => console.error('❌', e));
  ws.addEventListener('close', (e) => console.log('🔌 Fermé:', e.code));
  const originalSend = ws.send;
  ws.send = function(data) {
    if (typeof data === 'string') {
      try { console.log('📤', JSON.parse(data)); }
      catch { console.log('📤 Texte'); }
    } else { console.log('📤 Audio:', data.byteLength); }
    return originalSend.apply(this, arguments);
  };
  return ws;
};
console.log('✅ Debug ON');
```

### 3️⃣ Lancer une Session et Observer (2 minutes)

1. **Ouvrez Teams** et rejoignez une réunion
2. **Panneau Clair** → Mode "Audio direct" → Token `clair-local-session-secret-token-2026` → **Démarrer**
3. **Quelqu'un parle** (ou parlez vous-même)
4. **Regardez la console** de l'étape 2

## Que Chercher dans les Logs ?

### ✅ Tout va bien :

```
🔌 WS: ws://127.0.0.1:8787
✅ Ouvert
📤 { type: 'start', token: '...' }
📨 { type: 'ready', ok: true }
📤 Audio: 2048
📤 Audio: 2048
... (flux continu)
📨 { type: 'segment', segment: { translatedText: '...' } }
```

➡️ **Si vous voyez ça MAIS que le panneau est vide** : Le problème est dans l'affichage UI, pas dans la transcription. Contactez-moi avec ces logs.

### ❌ Problème A : WebSocket ne s'ouvre pas

```
🔌 WS: ws://127.0.0.1:8787
❌ Event {}
🔌 Fermé: 1006
```

➡️ **Solution** : Le serveur refuse. C'est **normal** si vous testez depuis DevTools. L'extension doit se connecter toute seule.

**Vérification** : Dans le terminal `npm start`, voyez-vous :
```
[Gateway] WebSocket connection from chrome-extension://...
```

Si NON → L'extension n'essaie jamais de se connecter. Rechargez l'extension (`chrome://extensions/` → ⟳)

### ❌ Problème B : Ouvert mais pas de 'ready'

```
✅ Ouvert
📤 { type: 'start', ... }
(plus rien)
```

➡️ **Solution** : Token ou clé API invalide. Vérifiez `.env` :

```bash
cat .env
# Doit contenir :
# GATEWAY_TOKEN=clair-local-session-secret-token-2026
# GEMINI_API_KEY=VOTRE_CLE_GEMINI_ICI
# GEMINI_LIVE_MODEL=gemini-3.5-live-translate-preview
```

Si un paramètre manque, corrigez et relancez `npm start`.

### ❌ Problème C : 'ready' reçu mais pas d'audio

```
✅ Ouvert
📨 { type: 'ready', ok: true }
(pas de "📤 Audio")
```

➡️ **Solution** : L'extension ne capture pas l'audio Teams.

**Causes** :
1. L'onglet Teams n'est pas actif
2. Chrome n'a pas la permission
3. Extension mal chargée

**Test** : Rechargez l'extension (`chrome://extensions/` → ⟳) et relancez la session.

### ❌ Problème D : Audio envoyé mais pas de segments

```
📤 Audio: 2048
📤 Audio: 2048
... (beaucoup de lignes)
(mais jamais de "📨 { type: 'segment' }")
```

➡️ **Solution** : L'API Gemini ne transcrit pas.

**Vérifications** :
1. Quelqu'un parle-t-il **vraiment** ? (essayez de parler vous-même)
2. Le micro Teams est-il muté ?
3. Regardez les logs du serveur backend (terminal `npm start`)

**Dans les logs serveur**, vous devriez voir :
```
[Gemini Live] Text received: "..."
```

Si vous ne voyez **rien** → Problème avec l'API Gemini (clé invalide/épuisée).

## 📚 Documentation Complète

Si les étapes ci-dessus ne suffisent pas :

1. **RESOUDRE_PAS_DE_TRANSCRIPTION.md** ← Guide détaillé avec tous les scénarios
2. **GUIDE_DEBUG_EXTENSION.md** ← Debugging avancé de l'extension
3. **DIAGNOSTIC_AUDIO_DIRECT.md** ← Tests techniques approfondis
4. **GUIDE_DIAGNOSTIC_SOUS-TITRES.md** ← Pour le mode sous-titres Teams

## 🆘 Besoin d'Aide ?

Si après avoir suivi ce guide le problème persiste, fournissez :

1. **Logs de la console extension** (les 30 dernières lignes)
2. **Logs du serveur** (terminal `npm start`, les 30 dernières lignes)
3. **Réponse à ces questions** :
   - WebSocket s'ouvre ? (Oui/Non)
   - Message 'ready' reçu ? (Oui/Non)
   - Audio envoyé ? (Oui/Non)
   - Segments reçus ? (Oui/Non)
   - Panneau vide ? (Oui/Non)

## ⚡ Test Rapide

Pour valider que tout fonctionne sans Teams :

```bash
# 1. Serveur OK ?
curl http://127.0.0.1:8787/health | jq

# 2. Extension buildée ?
ls dist/extension/manifest.json

# 3. Voir les logs serveur en temps réel
tail -f /tmp/clair-server.log  # Si vous loguez dans un fichier
# OU gardez le terminal npm start visible
```

## 🎯 Checklist Ultra-Rapide

- [ ] `npm start` lancé
- [ ] `curl http://127.0.0.1:8787/health` OK
- [ ] Extension visible dans `chrome://extensions/`
- [ ] DevTools extension ouvert (offscreen.html)
- [ ] Script debug collé et exécuté
- [ ] Session démarrée dans le panneau
- [ ] Quelqu'un parle dans Teams
- [ ] Logs observés

---

**Note** : Le serveur refuse les connexions WebSocket qui ne viennent PAS d'une extension Chrome (mesure de sécurité). C'est pourquoi tester avec `node` ou `curl` retourne 403. C'est normal.

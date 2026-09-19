# Diagnostic du projet Clair - Teams en français

Date : 2026-09-17

## ✅ COMPOSANTS FONCTIONNELS

### 1. Build de l'extension
- **Status** : ✅ Opérationnel
- Le script `npm run build` fonctionne correctement
- Tous les fichiers sont générés dans `dist/extension/` :
  - ✅ `manifest.json`
  - ✅ `worker.js` (service worker)
  - ✅ `panel.js` et `panel.html` (interface utilisateur)
  - ✅ `panel.css` (styles)
  - ✅ `offscreen.js` et `offscreen.html` (capture média)
  - ✅ `teams-content.js` (script de contenu)
  - ✅ `pcm-worklet.js` (traitement audio)

### 2. Serveur Backend
- **Status** : ✅ Opérationnel
- Port : `8787`
- Processus actif : PID 42482
- Endpoint `/health` répond correctement :
  ```json
  {
    "ok": true,
    "gatewayConfigured": true,
    "translationConfigured": true,
    "provider": "gemini",
    "audioConfigured": true,
    "audioProvider": "gemini-3.8-live",
    "extensionRestricted": false,
    "ffmpegAvailable": true
  }
  ```

### 3. Configuration
- **Status** : ✅ Configuré
- Fichier `.env` présent avec :
  - ✅ `GATEWAY_TOKEN` configuré
  - ✅ `GEMINI_API_KEY` configuré (valide)
  - ✅ `GEMINI_MODEL` : gemini-3.6-flash
  - ✅ `GEMINI_LIVE_MODEL` : gemini-3.8-live
  - ✅ `PORT` : 8787

### 4. API Gemini
- **Status** : ✅ Opérationnel
- Connexion WebSocket réussie
- Setup complet reçu
- Session de reprise disponible

## 🔍 PROCHAINES ÉTAPES POUR TESTER L'EXTENSION

### Chargement de l'extension dans Chrome/Edge

1. **Ouvrir Chrome ou Edge**

2. **Accéder à la page des extensions**
   - Chrome : `chrome://extensions/`
   - Edge : `edge://extensions/`

3. **Activer le mode développeur**
   - Basculer l'interrupteur "Mode développeur" en haut à droite

4. **Charger l'extension non empaquetée**
   - Cliquer sur "Charger l'extension non empaquetée"
   - Sélectionner le dossier : `/home/ff/Public/MTT/dist/extension`

5. **Vérifier le chargement**
   - L'extension "Clair - Teams en français" devrait apparaître
   - Vérifier qu'il n'y a pas d'erreurs affichées

### Test de l'extension

1. **Ouvrir Microsoft Teams**
   - Aller sur `https://teams.microsoft.com/`
   - Rejoindre ou créer une réunion de test

2. **Activer l'extension**
   - Cliquer sur l'icône de l'extension dans la barre d'outils
   - Le panneau latéral devrait s'ouvrir

3. **Configurer la session**
   - Mode : "Audio direct (Google Gemini 3.8 Live)"
   - Jeton : `clair-local-session-secret-token-2026`
   - Cocher "J'ai informé les participants..."
   - Cliquer sur "Démarrer la session"

## 🐛 PROBLÈMES POTENTIELS À VÉRIFIER

Si l'extension ne fonctionne pas après le chargement :

### 1. Erreurs dans la console du service worker
- Ouvrir la page des extensions
- Cliquer sur "Afficher les journaux" ou "Inspecter les vues : service worker"
- Vérifier les erreurs JavaScript

### 2. Erreurs dans la console du panneau
- Ouvrir le panneau de l'extension
- Clic droit > Inspecter
- Vérifier les erreurs dans la console

### 3. Problèmes de permissions
- Vérifier que toutes les permissions sont accordées
- L'extension demande :
  - `activeTab`, `scripting`, `tabCapture`, `audioCapture`
  - `offscreen`, `sidePanel`, `storage`, `downloads`

### 4. Problèmes de connexion au serveur
- Vérifier que le serveur est toujours actif : `curl http://127.0.0.1:8787/health`
- Vérifier les logs du serveur dans le terminal

### 5. Problèmes de capture audio/vidéo
- Teams doit être dans un onglet actif
- Les permissions de capture d'écran/audio doivent être accordées
- Le navigateur doit supporter l'API `tabCapture`

## 📝 COMMANDES UTILES

```bash
# Rebuilder l'extension après modifications
cd /home/ff/Public/MTT
npm run build

# Redémarrer le serveur
npm start

# Vérifier l'état du serveur
curl http://127.0.0.1:8787/health

# Lancer les tests
npm test
npm run test:browser
```

## 🎯 ARCHITECTURE DU PROJET

```
MTT/
├── extension/          # Code source de l'extension
│   ├── manifest.json   # Configuration de l'extension
│   ├── worker.js       # Service worker (background)
│   ├── panel.js/html   # Interface utilisateur
│   ├── offscreen.js    # Capture média
│   └── teams-content.js # Script injecté dans Teams
├── server/            # Serveur backend Node.js
│   ├── index.js       # Point d'entrée du serveur
│   ├── providers.js   # Intégration Gemini/Deepgram
│   ├── synthesis.js   # Génération de synthèses
│   └── video.js       # Traitement vidéo
├── dist/              # Fichiers compilés
│   └── extension/     # Extension prête à charger
└── tests/             # Tests unitaires et e2e
```

## 🔐 SÉCURITÉ

- ✅ Token d'authentification configuré
- ✅ Connexion locale uniquement (127.0.0.1)
- ✅ Validation des origines WebSocket
- ✅ Aucune donnée envoyée à des serveurs tiers (sauf Gemini pour la traduction)
- ⚠️ La clé API Gemini est dans `.env` (ne pas committer)

## 📊 PERFORMANCES

- Latence de traduction : ~1-2 secondes
- Connexion Gemini Live : Temps réel
- Capture vidéo : Dépend de la résolution sélectionnée
- Limite de session : 4 heures maximum

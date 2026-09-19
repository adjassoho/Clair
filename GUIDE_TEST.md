# 🧪 Guide de Test - Extension Clair

## ✅ Statut Actuel du Projet

**Tous les composants sont OPÉRATIONNELS** :
- ✅ Extension construite (`dist/extension/`)
- ✅ Serveur backend en cours d'exécution (port 8787)
- ✅ API Gemini configurée et fonctionnelle
- ✅ Configuration `.env` valide

## 📋 Checklist de Test Complète

### Étape 1 : Chargement de l'extension ⚙️

1. **Ouvrir Chrome/Edge/Brave**
   ```
   URL : chrome://extensions/
   ```

2. **Activer le mode développeur**
   - Toggle en haut à droite de la page

3. **Charger l'extension**
   - Bouton "Charger l'extension non empaquetée"
   - Chemin : `/home/ff/Public/MTT/dist/extension`

4. **Vérifier l'absence d'erreurs**
   - L'icône de l'extension devrait apparaître
   - Aucun badge rouge d'erreur
   - Nom : "Clair - Teams en français"
   - Version : 0.1.0

### Étape 2 : Vérification du Service Worker 🔧

1. **Inspecter le service worker**
   - Sur la page `chrome://extensions/`
   - Sous l'extension, cliquer "service worker" (texte bleu)
   - Console DevTools s'ouvre

2. **Vérifier l'absence d'erreurs**
   - Pas d'erreurs rouges dans la console
   - Le worker devrait être "active"

3. **Tester la connexion au serveur** (dans la console)
   ```javascript
   fetch('http://127.0.0.1:8787/health').then(r => r.json()).then(console.log)
   ```
   Résultat attendu :
   ```json
   {
     "ok": true,
     "gatewayConfigured": true,
     "translationConfigured": true,
     "provider": "gemini",
     "audioConfigured": true,
     "audioProvider": "gemini-3.8-live"
   }
   ```

### Étape 3 : Test de l'Interface Utilisateur 🎨

1. **Ouvrir Microsoft Teams**
   ```
   URL : https://teams.microsoft.com/
   ```
   - Se connecter avec un compte Microsoft
   - Rejoindre ou créer une réunion de test

2. **Ouvrir le panneau de l'extension**
   - Cliquer sur l'icône de l'extension dans la barre d'outils
   - Le panneau latéral devrait s'ouvrir à droite

3. **Vérifier l'interface**
   - ✅ Header avec "clair."
   - ✅ Formulaire de configuration visible
   - ✅ Options : Mode audio / sous-titres
   - ✅ Champ "Jeton du service local"
   - ✅ Checkbox de consentement
   - ✅ Bouton "Démarrer la session"

4. **Inspecter la console du panneau**
   - Clic droit dans le panneau > Inspecter
   - Vérifier l'absence d'erreurs JavaScript

### Étape 4 : Démarrage d'une Session 🚀

1. **Remplir le formulaire**
   - Mode : "Audio direct (Google Gemini 3.8 Live - Recommandé)"
   - Capturer le micro : ✅ Coché
   - Type de synthèse : "Fiche de cours approfondie"
   - Jeton : `clair-local-session-secret-token-2026`
   - Consentement : ✅ Coché

2. **Cliquer sur "Démarrer la session"**

3. **Vérifier les permissions**
   - Le navigateur peut demander la permission de capturer l'onglet
   - Autoriser la capture

4. **Vérifier le changement d'interface**
   - Le formulaire devrait disparaître
   - La section "Capture sélective" devrait apparaître
   - Status : "Transcription active"
   - Durée : démarrer à 00:00 et progresser

### Étape 5 : Test de Capture Audio 🎤

1. **Vérifier les logs du serveur**
   Dans le terminal où le serveur tourne :
   ```bash
   # Devrait afficher des connexions WebSocket
   [Gateway] WebSocket client connected
   ```

2. **Parler dans le microphone**
   - Dire quelques phrases en anglais
   - Ex: "Hello, this is a test of the Clair extension"

3. **Vérifier la transcription**
   - Dans la section "Le fil de la réunion"
   - Les phrases devraient apparaître traduites en français
   - Format : `[HH:MM:SS] Texte traduit`

### Étape 6 : Test de Capture Vidéo 📹

1. **Cliquer sur "Encadrer une zone"**
   - Une boîte de sélection devrait apparaître sur Teams
   - Redimensionner la zone pour capturer l'écran partagé

2. **Vérifier l'aperçu**
   - Une miniature de la zone sélectionnée devrait s'afficher

3. **Cliquer sur "Enregistrer la zone"**
   - Bouton devient actif après la sélection
   - L'enregistrement démarre

4. **Attendre quelques secondes**

5. **Cliquer sur "Arrêter l'extrait"**
   - Le compteur d'extraits devrait s'incrémenter
   - Ex: "1 extrait(s)"

### Étape 7 : Finalisation et Export 📦

1. **Cliquer sur "Terminer la session"**
   - Status passe à "Finalisation"
   - Puis "Session terminée"

2. **Vérifier la section d'export**
   - Section "Votre session est terminée" visible
   - Boutons d'export disponibles :
     - "Télécharger Réunion (MP4) + Synthèse (HTML/PDF)"
     - "Synthèse HTML (Imprimable)"
     - "Synthèse Markdown"

3. **Tester un export**
   - Cliquer sur "Synthèse HTML (Imprimable)"
   - Un fichier HTML devrait se télécharger
   - Ouvrir le fichier pour vérifier la synthèse

### Étape 8 : Test du Copilote Gemini 🤖

*(Pendant une session active)*

1. **Localiser la section Copilote**
   - "Copilote Gemini 3.8 Live"
   - Champ de saisie visible

2. **Poser une question**
   - Ex: "Résume ce qui a été dit jusqu'à présent"
   - Cliquer sur "Demander"

3. **Vérifier la réponse**
   - Une réponse devrait apparaître sous le champ

## 🐛 Problèmes Courants et Solutions

### Problème 1 : L'extension ne se charge pas
**Symptômes** :
- Badge d'erreur rouge
- "Erreur de manifest"

**Solutions** :
```bash
# Reconstruire l'extension
cd /home/ff/Public/MTT
npm run build

# Recharger dans chrome://extensions/
```

### Problème 2 : "Le moteur de capture ne répond pas"
**Symptômes** :
- Erreur au démarrage de la session
- Message dans le panneau

**Solutions** :
```bash
# Vérifier le serveur
curl http://127.0.0.1:8787/health

# Si pas de réponse, redémarrer le serveur
pkill -f 'node.*server'
cd /home/ff/Public/MTT
npm start
```

### Problème 3 : Pas de transcription
**Symptômes** :
- La session démarre
- Mais aucun texte n'apparaît

**Solutions** :
1. Vérifier les logs du serveur (terminal)
2. Vérifier la console du service worker
3. Vérifier que le microphone fonctionne
4. Tester la clé API Gemini :
   ```bash
   cd /home/ff/Public/MTT
   node scratch/test_gemini_audio.js
   ```

### Problème 4 : "Jeton invalide"
**Symptômes** :
- Erreur à l'authentification

**Solutions** :
1. Vérifier le fichier `.env` :
   ```bash
   cat /home/ff/Public/MTT/.env | grep GATEWAY_TOKEN
   ```
2. Utiliser exactement : `clair-local-session-secret-token-2026`

### Problème 5 : Capture vidéo ne fonctionne pas
**Symptômes** :
- Impossible de sélectionner une zone
- Erreur "Adaptateur Teams indisponible"

**Solutions** :
1. Vérifier que vous êtes bien sur `teams.microsoft.com`
2. Recharger la page Teams (F5)
3. Relancer l'extension

## 📊 Logs de Débogage

### Activer les logs détaillés dans le serveur

Modifier `.env` :
```bash
DEBUG=*
NODE_DEBUG=ws
```

Redémarrer le serveur :
```bash
npm start
```

### Logs de la console Chrome

**Service Worker** :
```javascript
// Dans chrome://extensions/ > service worker
chrome.storage.session.get().then(console.log)
```

**Panel** :
```javascript
// Clic droit > Inspecter dans le panneau
console.log('Test du panneau');
```

## 🎯 Critères de Succès

Une installation réussie doit passer tous ces tests :

- [ ] Extension chargée sans erreur
- [ ] Service worker actif
- [ ] Connexion au serveur réussie
- [ ] Interface du panneau s'affiche
- [ ] Session démarre sans erreur
- [ ] Audio capturé et transcrit
- [ ] Traduction en français visible
- [ ] Zone vidéo sélectionnable
- [ ] Enregistrement d'extrait fonctionne
- [ ] Session se termine proprement
- [ ] Export génère des fichiers
- [ ] Copilote répond aux questions

## 🔄 Après Modifications du Code

```bash
# 1. Rebuilder
npm run build

# 2. Recharger l'extension
# Dans chrome://extensions/, cliquer l'icône de rechargement ↻

# 3. Recharger les pages ouvertes
# F5 sur Teams et le panneau de l'extension
```

## 📝 Tests Automatisés

```bash
# Tests unitaires
npm test

# Tests E2E avec Playwright
npm run test:browser
```

## 🎬 Vidéo de Démonstration

Pour enregistrer une démo :
1. Utiliser OBS Studio ou SimpleScreenRecorder
2. Capturer l'écran avec Teams + le panneau
3. Montrer tout le flux : démarrage → transcription → export

## 📞 Support

Si vous rencontrez des problèmes persistants :
1. Vérifier les logs du serveur
2. Vérifier la console du service worker
3. Vérifier la console du panneau
4. Tester la connexion Gemini
5. Consulter `DIAGNOSTIC.md`

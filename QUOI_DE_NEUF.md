# 🎉 Nouvelle Version Debug Automatique

## Ce Qui a Changé

J'ai **instrumenté le code source** de l'extension avec des logs de debug permanents. Plus besoin de coller du script dans la console à chaque fois !

## Fichiers Modifiés

### `extension/offscreen.js` (rebuild automatique)

Ajout de logs `[DEBUG]` aux points critiques :

1. **Connexion WebSocket**
   - Quand `connectGateway()` est appelé
   - État du WebSocket à la création
   - Message `start` envoyé au serveur

2. **Réception des messages serveur**
   - Chaque message reçu (type + contenu)
   - Message `ready` confirmé
   - Erreurs serveur détaillées

3. **Capture audio**
   - Premier chunk audio capturé (avec offset et taille)
   - Audio offset calculé
   - Nombre de chunks bufferisés envoyés
   - Chaque envoi PCM au serveur
   - Erreurs de transmission

4. **Réception et stockage des segments**
   - Chaque segment reçu (avec contenu)
   - Segments invalides rejetés
   - Nombre total de segments stockés
   - Publication vers le panneau

### `dist/extension/offscreen.js`

L'extension a été automatiquement rebuild avec `npm run build` — les logs sont maintenant actifs.

## Nouveaux Fichiers de Documentation

### `DEBUG_SIMPLE.md` ⭐ NOUVEAU

Guide ultra-simple en 4 étapes :
1. Recharger l'extension
2. Ouvrir la console debug
3. Lancer une réunion
4. Lire les logs

Inclut un diagnostic pas-à-pas selon ce que vous voyez dans les logs.

### `LISEZMOI.txt` (mis à jour)

Pointe maintenant vers `DEBUG_SIMPLE.md` comme point de départ.

## Comment Utiliser Cette Version

### Étape 1 : Recharger l'extension

1. Ouvrez `chrome://extensions/`
2. Trouvez "Teams FR Companion"
3. Cliquez sur 🔄 (recharger)

### Étape 2 : Ouvrir la console debug

1. Sur `chrome://extensions/`, sous l'extension
2. Cliquez sur **"Inspect views: offscreen.html"**
3. DevTools s'ouvre → onglet **Console**
4. Laissez cette fenêtre visible à côté

### Étape 3 : Lancer votre réunion

1. Rejoignez Teams
2. Ouvrez le panneau de l'extension
3. Cliquez "Démarrer" en mode "Suivre le direct"
4. Parlez ou attendez que quelqu'un parle

### Étape 4 : Observer les logs en temps réel

Vous devriez voir défiler :

```
[DEBUG] connectGateway appelé - mode: audio token: mtft-xxxxx...
[DEBUG] WebSocket créé, état: 0
[DEBUG] WebSocket ouvert, envoi message start: {...}
[DEBUG] Message reçu du serveur: ready {...}
[DEBUG] Gateway ready, résolution de la promesse
[DEBUG] Premier chunk audio reçu, offset: 123 taille: 3200
[DEBUG] Audio offset calculé: 123 ms
[DEBUG] Gateway connecté, envoi de 5 chunks audio bufferisés
[DEBUG] Envoi audio PCM au serveur, taille: 3200
[DEBUG] Message reçu du serveur: segment {...}
[DEBUG] receiveSegment appelé avec: {...}
[DEBUG] Segment sauvegardé, total segments: 1
[DEBUG] Segment publié vers le panel
```

## Diagnostic Selon les Logs

### ✅ Rien du tout
→ L'extension n'a pas démarré → Vérifiez que vous avez cliqué "Démarrer"

### ✅ `connectGateway` mais rien après
→ WebSocket ne s'ouvre pas → Le serveur ne tourne pas (`npm start`)

### ✅ `WebSocket ouvert` mais pas de `ready`
→ Le serveur refuse → Vérifiez les logs serveur (terminal)

### ✅ `Gateway ready` mais pas de `Premier chunk audio`
→ Audio non capturé → Vérifiez que Teams est l'onglet actif et que quelqu'un parle

### ✅ `Envoi audio PCM` mais pas de `segment`
→ Gemini ne répond pas → Problème de clé API (logs serveur)

### ✅ `Segment publié` mais rien visible dans le panneau
→ Problème d'affichage → Debug le panneau (voir DEBUG_SIMPLE.md)

## Avantages de Cette Approche

✅ **Permanent** : Les logs restent actifs même après rechargement
✅ **Automatique** : Plus besoin de coller du code
✅ **Complet** : Tous les points critiques sont instrumentés
✅ **Production-ready** : Facile à désactiver (commenter les `console.log`)
✅ **Précis** : Les logs montrent les vraies valeurs (token, taille, offset...)

## Pour Désactiver les Logs (Plus Tard)

Quand vous aurez résolu le problème :

```bash
# Rechercher et commenter tous les console.log de debug
cd /home/ff/Public/MTT
sed -i 's/console.log("\[DEBUG\]/\/\/ console.log("[DEBUG]/g' extension/offscreen.js
npm run build
```

Ou utilisez un outil de recherche/remplacement dans votre éditeur.

## Prochaines Étapes

1. **Lisez `DEBUG_SIMPLE.md`** (5 minutes)
2. **Rechargez l'extension** dans Chrome
3. **Lancez une réunion** et observez les logs
4. **Identifiez où ça bloque** (les logs vous le diront)
5. **Appliquez la solution** correspondante (voir `RESOUDRE_PAS_DE_TRANSCRIPTION.md`)

## Besoin d'Aide ?

Si après avoir suivi ces étapes le problème persiste, donnez-moi :

1. Screenshot ou copie des logs de la console offscreen.html
2. Logs du terminal serveur (npm start)
3. Réponses aux 4 questions du diagnostic

Je pourrai alors identifier le problème exact en quelques secondes.

---

**Bonne chance ! 🚀** Le système est maintenant entièrement instrumenté, vous allez voir exactement où ça bloque.

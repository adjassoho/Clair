# 🔍 Guide Debug Ultra-Simple

## ✅ Ce Que J'ai Fait

J'ai ajouté des logs de debug directement dans le code de l'extension. Plus besoin de coller du code dans la console !

## 📋 Étapes à Suivre

### 1. Recharger l'extension dans Chrome

1. Ouvrez Chrome
2. Allez dans `chrome://extensions/`
3. Trouvez "Teams FR Companion"
4. Cliquez sur l'icône de rechargement 🔄

### 2. Ouvrir la Console de Debug

1. Sur la page `chrome://extensions/`, cliquez sur **"Inspect views: offscreen.html"** sous l'extension
2. Ça ouvre les DevTools de l'extension
3. Allez dans l'onglet **Console**
4. Laissez cette fenêtre ouverte à côté

### 3. Lancer une Réunion Teams

1. Rejoignez votre réunion Teams
2. Ouvrez le panneau de l'extension (icône dans Chrome)
3. Cliquez sur "Démarrer" en mode **"Suivre le direct"**
4. **Parlez dans la réunion ou attendez que quelqu'un parle**

### 4. Lire les Logs

Dans la console, vous devriez voir apparaître en temps réel :

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

## 🎯 Où Chercher le Problème

### Si vous voyez :

#### ✅ Rien du tout dans la console
→ **Problème** : L'extension n'a même pas démarré
→ **Solution** : Vérifiez que vous avez bien cliqué sur "Démarrer" dans le panneau

#### ✅ `connectGateway appelé` mais RIEN après
→ **Problème** : Le WebSocket ne s'ouvre pas
→ **Solution** : Vérifiez que le serveur tourne (`npm start` dans un terminal)

#### ✅ `WebSocket ouvert` mais PAS de `Message reçu: ready`
→ **Problème** : Le serveur refuse la connexion ou le token est invalide
→ **Solution** : Vérifiez les logs du serveur (terminal `npm start`)

#### ✅ `Gateway ready` mais PAS de `Premier chunk audio`
→ **Problème** : L'audio n'est pas capturé depuis Teams
→ **Solution** : 
  - Vérifiez que Teams est bien l'onglet actif
  - Vérifiez que quelqu'un parle dans la réunion
  - Vérifiez que l'audio n'est pas coupé (microphone/haut-parleurs)

#### ✅ `Envoi audio PCM` mais PAS de `Message reçu: segment`
→ **Problème** : Le serveur reçoit l'audio mais Gemini ne répond pas
→ **Solution** : Vérifiez les logs du serveur — probable problème de clé API Gemini

#### ✅ `Message reçu: segment` mais PAS de `receiveSegment appelé`
→ **Problème** : Le format du segment est incorrect
→ **Solution** : Copiez-collez le contenu complet du log `Message reçu: segment` ici

#### ✅ `Segment publié vers le panel` mais RIEN dans le panneau visible
→ **Problème** : Le panneau (panel.js) ne reçoit pas ou n'affiche pas les segments
→ **Solution** : Ouvrir la console du panneau (voir ci-dessous)

## 🔧 Debug du Panneau (si segments publiés mais invisibles)

Si vous voyez `Segment publié vers le panel` dans la console offscreen mais rien ne s'affiche :

1. **Clic droit** sur le panneau de l'extension (la fenêtre popup)
2. Sélectionnez **"Inspecter"**
3. Ça ouvre une AUTRE console DevTools (celle du panel)
4. Regardez s'il y a des erreurs
5. Tapez dans la console : `chrome.storage.local.get(['session', 'segments'], console.log)`
6. Ça vous montrera si les segments sont bien stockés

## 📤 Partager les Résultats

Si le problème persiste, faites une capture d'écran ou copiez-collez :

1. **Les 30-50 dernières lignes** de la console offscreen.html (celle avec les `[DEBUG]`)
2. **Les 30-50 dernières lignes** du terminal serveur (npm start)
3. **Répondez à ces questions** :
   - Le WebSocket s'ouvre-t-il ? (cherchez `WebSocket ouvert`)
   - Le message `ready` arrive-t-il ? (cherchez `Message reçu: ready`)
   - L'audio est-il envoyé ? (cherchez `Envoi audio PCM`)
   - Des segments arrivent-ils ? (cherchez `Message reçu: segment`)

Avec ces infos, je pourrai diagnostiquer en quelques secondes.

---

**Astuce** : Pour filtrer uniquement les logs debug, tapez `-"[DEBUG]"` dans la barre de filtrage de la console Chrome.

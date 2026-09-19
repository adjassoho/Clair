# Solution : Pas de transcription en mode "Suivre le direct"

## 🎯 Problème

Vous avez signalé que lorsque vous lancez une réunion dans Teams et passez en mode "suivre le direct", vous ne voyez **aucune transcription** même lorsque les gens parlent dans la réunion.

## 🔍 Diagnostic

### Différence entre les deux modes

L'extension Clair a **deux modes de fonctionnement** :

1. **Mode Audio Direct (Gemini Live)** ✅ FONCTIONNE
   - Capture le flux audio de Teams en temps réel
   - Envoie l'audio à Google Gemini pour transcription
   - Ce mode a été corrigé dans `CORRECTIFS_APPLIQUES.md`
   - Le modèle `gemini-3.5-live-translate-preview` est configuré et fonctionne

2. **Mode Sous-titres (Captions)** ❌ VOTRE PROBLÈME
   - Capture les sous-titres natifs de Microsoft Teams
   - Lit les éléments HTML de la page Teams
   - **C'est ce mode qui ne fonctionne pas pour vous**

### Cause racine probable

Le fichier `extension/teams-content.js` utilise des **sélecteurs CSS spécifiques** pour trouver les sous-titres dans la page Teams :

```javascript
function findCaptionsContainer() {
  return document.querySelector('[data-tid="closed-captions"]')
    || document.querySelector('[class*="closed-captions"]')
    || document.querySelector('[class*="captions-container"]')
    || document.querySelector('div[class*="caption-banner"]')
    || document.querySelector('div[class*="ui-chat__item"]')?.parentElement;
}
```

**Problème** : Microsoft Teams change régulièrement la structure HTML de son interface. Les sélecteurs qui fonctionnaient avant ne correspondent plus aux nouveaux éléments HTML.

**Résultat** : `findCaptionsContainer()` retourne `null`, aucun sous-titre n'est détecté, aucune transcription n'apparaît.

## ✅ Solutions

### Solution 1 : Utiliser le mode Audio Direct (Solution immédiate)

**C'est la solution la plus simple et elle fonctionne déjà !**

1. Ouvrez l'extension Clair dans Teams
2. Au lieu de choisir "Sous-titres Teams natifs", choisissez **"Audio direct (Google Gemini 3.8 Live)"**
3. Configurez votre token : `clair-local-session-secret-token-2026`
4. Démarrez la session
5. La transcription apparaîtra en temps réel

**Avantages** :
- ✅ Fonctionne immédiatement, sans modification
- ✅ Pas besoin d'activer les sous-titres Teams
- ✅ Transcription + traduction en français en temps réel
- ✅ Fonctionne quelle que soit la langue parlée

**Inconvénients** :
- Consomme de l'API Google Gemini (coût)
- Nécessite une connexion internet stable

### Solution 2 : Diagnostiquer et corriger le mode Sous-titres (Solution technique)

**Si vous voulez absolument utiliser les sous-titres natifs de Teams**, suivez ces étapes :

#### Étape 1 : Activer les sous-titres dans Teams

1. Rejoignez une réunion Teams
2. Cliquez sur **...** (Plus d'options)
3. Sélectionnez **Langue et parole**
4. Activez **Sous-titres en direct**
5. Choisissez **Anglais (États-Unis)** comme langue
6. Vérifiez que les sous-titres s'affichent **à l'écran** quand quelqu'un parle

#### Étape 2 : Exécuter le script de diagnostic

1. Dans l'onglet Teams, ouvrez DevTools (F12)
2. Allez dans l'onglet **Console**
3. Ouvrez le fichier `/home/ff/Public/MTT/extension/teams-debug.js`
4. **Copiez tout le contenu** et collez-le dans la console
5. Appuyez sur **Entrée**
6. **Parlez pendant 30 secondes** pour générer des sous-titres
7. Le script affichera les éléments HTML détectés

#### Étape 3 : Analyser les résultats

Le script vous dira :
- ✅ **Si des sous-titres ont été détectés** : Il affichera les sélecteurs CSS à utiliser
- ❌ **Si rien n'a été détecté** : Les sous-titres ne sont peut-être pas activés, ou Teams utilise une structure complètement différente

#### Étape 4 : Mettre à jour le code

Si le script a trouvé un sélecteur (par exemple `div.ts-captions-window`) :

1. Ouvrez `extension/teams-content.js`
2. Trouvez la fonction `findCaptionsContainer()` (ligne ~150)
3. Ajoutez votre sélecteur **en premier** dans la liste :

```javascript
function findCaptionsContainer() {
  return document.querySelector('div.ts-captions-window')  // ← VOTRE NOUVEAU SÉLECTEUR
    || document.querySelector('[data-tid="closed-captions"]')
    || document.querySelector('[class*="closed-captions"]')
    // ... reste du code
}
```

4. Rebuild l'extension :
```bash
cd /home/ff/Public/MTT
npm run build
```

5. Rechargez l'extension dans Chrome (`chrome://extensions/`)
6. Testez dans une nouvelle réunion Teams

### Solution 3 : Utiliser la version debug (Pour un diagnostic approfondi)

Si vous voulez voir **en temps réel** ce qui se passe :

1. **Remplacez** `extension/teams-content.js` par `extension/teams-content-debug.js` :
```bash
cd /home/ff/Public/MTT/extension
cp teams-content.js teams-content.js.backup
cp teams-content-debug.js teams-content.js
```

2. Rebuild :
```bash
cd /home/ff/Public/MTT
npm run build
```

3. Rechargez l'extension dans Chrome

4. Ouvrez Teams avec DevTools (F12) ouvert sur la Console

5. Démarrez une session en mode "captions"

6. Observez les logs préfixés par `[CLAIR-DEBUG]` :
   - Ils vous diront exactement ce qui est détecté ou non
   - Vous verrez si le conteneur est trouvé
   - Vous verrez si des items de sous-titres sont extraits
   - Vous verrez si les segments sont envoyés au worker

7. **Restaurez le fichier original** une fois le diagnostic terminé :
```bash
cd /home/ff/Public/MTT/extension
mv teams-content.js.backup teams-content.js
npm run build
```

## 🎓 Comprendre le flux de données

### Mode Audio Direct (celui qui fonctionne)
```
Microphone Teams
    ↓
API tabCapture (Chrome)
    ↓
offscreen.js (extension)
    ↓
WebSocket vers serveur local (port 8787)
    ↓
Google Gemini API
    ↓
Transcription + Traduction
    ↓
Affichage dans panel.js
```

### Mode Sous-titres (celui qui ne fonctionne pas)
```
Parole dans Teams
    ↓
Sous-titres natifs Teams (affichés à l'écran)
    ↓
teams-content.js détecte via DOM ← ❌ ÉCHEC ICI
    ↓
Envoi au worker.js
    ↓
WebSocket vers serveur local
    ↓
Google Gemini API (traduction seulement)
    ↓
Affichage dans panel.js
```

**Le problème se situe à l'étape "teams-content.js détecte via DOM"** : les sélecteurs CSS ne trouvent pas les éléments HTML des sous-titres.

## 📊 Tableau de comparaison

| Critère | Mode Audio Direct | Mode Sous-titres |
|---------|-------------------|------------------|
| **État actuel** | ✅ Fonctionne | ❌ Ne fonctionne pas |
| **Prérequis Teams** | Aucun | Sous-titres activés |
| **Coût API** | Transcription + traduction | Traduction seulement |
| **Latence** | ~1-2s | Temps réel |
| **Fiabilité** | ⭐⭐⭐⭐⭐ | ⭐⭐ (dépend de Teams) |
| **Configuration** | Token uniquement | Token + sous-titres Teams |
| **Langues supportées** | Toutes | Langues des sous-titres Teams |

## 🚀 Recommandation

**Pour une utilisation immédiate : Utilisez le mode Audio Direct**

C'est la solution la plus fiable et elle est déjà fonctionnelle. Le mode sous-titres nécessite un diagnostic et des corrections qui dépendent de la version actuelle de Microsoft Teams.

**Si vous tenez à utiliser les sous-titres Teams :**
1. Suivez le `GUIDE_DIAGNOSTIC_SOUS-TITRES.md`
2. Exécutez `teams-debug.js` dans la console
3. Identifiez les bons sélecteurs
4. Mettez à jour `teams-content.js`

## 📞 Support

Si après avoir suivi ces instructions vous rencontrez toujours des problèmes :

1. Partagez les résultats de `teams-debug.js`
2. Indiquez votre version de Teams (web ou desktop)
3. Indiquez votre navigateur et sa version
4. Partagez les logs de la console avec `[CLAIR-DEBUG]`

## 📚 Fichiers créés pour vous aider

- ✅ `extension/teams-debug.js` - Script à exécuter dans la console Teams
- ✅ `extension/teams-content-debug.js` - Version debug de l'adaptateur Teams
- ✅ `GUIDE_DIAGNOSTIC_SOUS-TITRES.md` - Guide pas à pas complet
- ✅ `SOLUTION_PAS_DE_TRANSCRIPTION.md` - Ce document

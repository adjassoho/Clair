# Guide de Diagnostic des Sous-titres Teams

## 🎯 Objectif

Ce guide vous aide à identifier pourquoi les sous-titres Teams n'apparaissent pas dans l'extension Clair lorsque vous êtes en mode "suivre le direct".

## ⚠️ Prérequis

1. **Une réunion Teams active** (peut être une réunion de test avec vous seul)
2. **Les sous-titres activés dans Teams** :
   - Pendant la réunion, cliquez sur **...** (Plus d'options)
   - Sélectionnez **Langue et parole**
   - Activez **Sous-titres en direct**
   - Choisissez **Anglais (États-Unis)** comme langue source
3. **Chrome ou Edge** avec DevTools accessible

## 📋 Étapes du Diagnostic

### Étape 1 : Rejoindre une réunion Teams

1. Ouvrez Microsoft Teams dans votre navigateur
2. Créez une réunion de test ou rejoignez une réunion existante
3. **IMPORTANT** : Activez les sous-titres (voir Prérequis ci-dessus)
4. Vérifiez que les sous-titres s'affichent à l'écran quand quelqu'un parle

### Étape 2 : Ouvrir la Console DevTools

1. Dans l'onglet Teams, appuyez sur **F12** ou **Ctrl+Shift+I** (Cmd+Option+I sur Mac)
2. Cliquez sur l'onglet **Console**
3. Assurez-vous qu'aucune erreur rouge n'apparaît

### Étape 3 : Charger le Script de Diagnostic

1. Ouvrez le fichier `/home/ff/Public/MTT/extension/teams-debug.js`
2. **Copiez TOUT le contenu** du fichier
3. **Collez-le dans la console DevTools** et appuyez sur **Entrée**

### Étape 4 : Observer pendant 30 secondes

Le script va maintenant observer les changements dans la page pendant 30 secondes :

```
🚀 Lancement du diagnostic...

⚠️ IMPORTANT:
   1. Assurez-vous que les sous-titres sont ACTIVÉS dans Teams
   2. Configurez les sous-titres en ANGLAIS (ou votre langue source)
   3. Parlez ou faites parler quelqu'un pendant les 30 prochaines secondes

1️⃣ Recherche avec sélecteurs connus...
2️⃣ Recherche heuristique d'éléments avec texte dynamique...
3️⃣ Installation d'un observateur de mutations (30 secondes)...
   👉 Parlez dans Teams maintenant pour générer des sous-titres!
```

**Pendant ces 30 secondes** :
- Parlez dans votre micro (même si vous êtes seul)
- OU utilisez un outil de synthèse vocale
- OU faites lire du texte par votre ordinateur
- Le but est de **générer des sous-titres visibles à l'écran**

### Étape 5 : Récupérer les Résultats

Après 30 secondes, le script affichera :

```
4️⃣ Observation terminée.
   Total de mutations détectées: 42

   📊 Éléments les plus actifs:
      15x: div.ts-caption-container > div.caption-item
      8x: div.ts-caption-container > div.caption-item > span.caption-text
      ...

=== RÉSUMÉ DU DIAGNOSTIC ===
Résultats complets: { ... }
```

### Étape 6 : Analyser les Résultats

#### Cas 1 : ✅ "Total de mutations détectées: XX" (nombre > 0)

**C'est bon signe !** Le script a détecté où apparaissent les sous-titres.

Regardez la section "📊 Éléments les plus actifs" :
- Ces chemins indiquent où Teams affiche les sous-titres
- Copiez le chemin le plus fréquent

**Action** : Testez ce sélecteur avec :
```javascript
window.clairDebug.testSelector("div.ts-caption-container")
```

#### Cas 2 : ⚠️ "Aucune mutation détectée"

**Problème** : Le script n'a rien détecté. Causes possibles :

1. **Les sous-titres ne sont pas activés**
   - Vérifiez dans Teams : Menu ... > Langue et parole > Sous-titres en direct
   - Les sous-titres doivent être **visibles à l'écran**

2. **Personne n'a parlé pendant les 30 secondes**
   - Relancez le diagnostic : `window.clairDebug.findCaptions()`
   - Parlez immédiatement dans votre micro

3. **Teams utilise une technologie différente** (Canvas, Shadow DOM, iframe)
   - Regardez la section "1️⃣ Recherche avec sélecteurs connus"
   - Y a-t-il des éléments trouvés ?

### Étape 7 : Tester un Sélecteur Spécifique

Si vous avez identifié un sélecteur prometteur (par exemple `div[class*="ts-caption"]`) :

```javascript
window.clairDebug.testSelector('div[class*="ts-caption"]')
```

Cela affichera :
- Combien d'éléments correspondent
- Leur contenu texte
- Leurs attributs HTML

### Étape 8 : Copier les Résultats Complets

Pour une analyse approfondie :

```javascript
copy(window.clairDebug.results)
```

Cela copie les résultats dans votre presse-papiers. Collez-les dans un fichier texte ou envoyez-les pour analyse.

## 🔧 Correction du Code

Une fois que vous avez identifié le bon sélecteur, il faut mettre à jour `extension/teams-content.js` :

### Exemple : Si le sélecteur trouvé est `div.ts-captions-window`

```javascript
// ANCIEN CODE (ligne ~150)
function findCaptionsContainer() {
  return document.querySelector('[data-tid="closed-captions"]')
    || document.querySelector('[class*="closed-captions"]')
    // ...
}

// NOUVEAU CODE (ajouter votre sélecteur EN PREMIER)
function findCaptionsContainer() {
  return document.querySelector('div.ts-captions-window')  // ← VOTRE SÉLECTEUR ICI
    || document.querySelector('[data-tid="closed-captions"]')
    || document.querySelector('[class*="closed-captions"]')
    // ...
}
```

### Rebuild et Test

```bash
cd /home/ff/Public/MTT
npm run build
# Rechargez l'extension dans Chrome
# Testez dans une réunion Teams
```

## 🐛 Problèmes Courants

### Problème 1 : "ReferenceError: copy is not defined"

Utilisez plutôt :
```javascript
console.log(JSON.stringify(window.clairDebug.results, null, 2))
```
Puis copiez manuellement depuis la console.

### Problème 2 : "Le script ne fait rien"

1. Vérifiez qu'il n'y a pas d'erreur rouge dans la console
2. Essayez de coller le script ligne par ligne
3. Vérifiez que vous êtes bien dans l'onglet Teams (pas dans DevTools d'une autre page)

### Problème 3 : "Les sous-titres apparaissent mais le script ne les trouve pas"

Teams utilise peut-être un Shadow DOM ou un iframe :

```javascript
// Chercher dans tous les iframes
Array.from(document.querySelectorAll('iframe')).forEach((iframe, idx) => {
  try {
    console.log(`Iframe ${idx}:`, iframe.contentDocument.body.innerHTML);
  } catch (e) {
    console.log(`Iframe ${idx}: Accès refusé (cross-origin)`);
  }
});

// Chercher dans tous les Shadow DOMs
Array.from(document.querySelectorAll('*')).forEach(el => {
  if (el.shadowRoot) {
    console.log('Shadow root trouvé:', el, el.shadowRoot.innerHTML);
  }
});
```

## 📊 Cas d'Usage Réels

### Teams Desktop vs Teams Web

Le HTML peut être différent :
- **Teams Web** : Classes plus stables (`ts-caption-*`)
- **Teams Desktop** : Peut utiliser Electron avec une structure différente

### Langue des Sous-titres

Le sélecteur peut changer selon la langue :
- Testez avec **Anglais** en premier (langue par défaut)
- Puis testez avec votre langue cible

### Mises à Jour de Teams

Microsoft met à jour Teams fréquemment. Si le diagnostic fonctionnait et ne fonctionne plus :
1. Relancez le diagnostic
2. Comparez les nouveaux sélecteurs avec les anciens
3. Mettez à jour `teams-content.js`

## 📞 Besoin d'Aide ?

Si après avoir suivi ce guide vous n'arrivez toujours pas à identifier les sous-titres :

1. **Capturez une capture d'écran** de la console avec les résultats
2. **Copiez les résultats complets** avec `copy(window.clairDebug.results)`
3. **Notez votre configuration** :
   - Version de Teams (web ou desktop)
   - Navigateur et version
   - Langue des sous-titres configurée
4. **Partagez ces informations** pour obtenir de l'aide

## ✅ Checklist de Diagnostic

- [ ] Réunion Teams active
- [ ] Sous-titres activés et **visibles à l'écran**
- [ ] DevTools ouvert (onglet Console)
- [ ] Script de diagnostic collé et exécuté
- [ ] Parole générée pendant les 30 secondes d'observation
- [ ] Résultats récupérés et analysés
- [ ] Sélecteur identifié et testé
- [ ] Code `teams-content.js` mis à jour
- [ ] Extension rebuild avec `npm run build`
- [ ] Extension rechargée dans le navigateur
- [ ] Test final dans une réunion Teams

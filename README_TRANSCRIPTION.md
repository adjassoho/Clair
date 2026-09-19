# 🔧 Pas de transcription ? Voici la solution !

## ⚡ Solution Rapide (Fonctionne immédiatement)

Votre problème : **Aucune transcription n'apparaît en mode "suivre le direct"**

### Solution : Utilisez le mode Audio Direct à la place

1. Ouvrez l'extension Clair dans Teams
2. Choisissez **"Audio direct (Google Gemini 3.8 Live)"** au lieu de "Sous-titres Teams"
3. Token : `clair-local-session-secret-token-2026`
4. Cliquez sur "Démarrer la session"
5. ✅ **La transcription apparaîtra en temps réel !**

**C'est tout !** Ce mode fonctionne déjà et ne nécessite aucune configuration supplémentaire.

---

## 🤔 Pourquoi ça ne marchait pas ?

### Les deux modes de l'extension

**1. Mode Audio Direct** ✅ FONCTIONNE
- Capture l'audio directement depuis Teams
- Google Gemini transcrit + traduit en français
- **Pas besoin d'activer les sous-titres Teams**

**2. Mode Sous-titres** ❌ NE FONCTIONNE PAS ACTUELLEMENT
- Lit les sous-titres natifs de Teams à l'écran
- Nécessite que les sous-titres Teams soient activés
- **Problème** : Les sélecteurs CSS dans le code ne trouvent plus les sous-titres (Teams a changé son HTML)

---

## 🛠️ Vous voulez quand même corriger le mode Sous-titres ?

### Étape 1 : Activer les sous-titres Teams

1. Dans Teams, cliquez sur **...** (Autres options)
2. **Langue et parole** → **Activer les sous-titres en direct**
3. Langue : **Anglais (États-Unis)**
4. Vérifiez qu'ils s'affichent quand quelqu'un parle

### Étape 2 : Exécuter le diagnostic

1. Dans Teams, ouvrez la console (F12)
2. Copiez tout le contenu de `extension/teams-debug.js`
3. Collez dans la console et appuyez sur Entrée
4. **Parlez pendant 30 secondes**
5. Le script affichera les éléments HTML détectés

### Étape 3 : Lire les résultats

Le script vous dira :
- ✅ Quels sélecteurs CSS fonctionnent pour trouver les sous-titres
- ❌ Ou si rien n'a été détecté

### Étape 4 : Corriger le code (si des sélecteurs trouvés)

Ouvrez `extension/teams-content.js` ligne ~150 et ajoutez votre sélecteur :

```javascript
function findCaptionsContainer() {
  return document.querySelector('VOTRE_SELECTEUR_ICI')  // ← Ajoutez en premier
    || document.querySelector('[data-tid="closed-captions"]')
    || document.querySelector('[class*="closed-captions"]')
    // ...
}
```

Puis rebuild :
```bash
npm run build
```

Rechargez l'extension dans Chrome et testez !

---

## 📚 Documentation complète

Pour plus de détails, consultez :
- 📖 `GUIDE_DIAGNOSTIC_SOUS-TITRES.md` - Guide pas à pas complet
- 🔍 `SOLUTION_PAS_DE_TRANSCRIPTION.md` - Explication technique détaillée
- 🐛 `extension/teams-content-debug.js` - Version debug pour voir ce qui se passe

---

## 💡 Notre Recommandation

**Utilisez le mode Audio Direct.** Il est :
- ✅ Déjà fonctionnel
- ✅ Plus fiable (ne dépend pas de l'interface Teams)
- ✅ Plus précis (transcription temps réel)
- ✅ Fonctionne avec toutes les langues

Le mode sous-titres nécessite un diagnostic et des corrections qui peuvent être complexes selon votre version de Teams.

---

## 🎯 Checklist Rapide

- [ ] J'ai lancé le serveur : `npm start`
- [ ] L'extension est chargée dans Chrome
- [ ] J'ai rejoint une réunion Teams
- [ ] J'ai choisi **"Audio direct"** dans l'extension
- [ ] J'ai mis le token : `clair-local-session-secret-token-2026`
- [ ] J'ai cliqué sur "Démarrer la session"
- [ ] Quelqu'un parle dans la réunion
- [ ] ✅ Je vois la transcription apparaître !

Si ça ne marche toujours pas, vérifiez :
- Le serveur tourne bien sur le port 8787 : `curl http://127.0.0.1:8787/health`
- La console DevTools de l'extension (pas d'erreurs rouges)
- Votre clé API Gemini dans `.env` est valide

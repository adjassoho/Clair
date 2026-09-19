/**
 * Script de diagnostic pour identifier la structure HTML des sous-titres Teams
 * À exécuter dans la console DevTools pendant une réunion Teams avec sous-titres actifs
 */

console.log('=== DIAGNOSTIC DES SOUS-TITRES TEAMS ===');

// Fonction pour explorer tous les éléments qui pourraient contenir des sous-titres
function findAllPossibleCaptionElements() {
  const results = {
    timestamp: new Date().toISOString(),
    foundElements: [],
    suggestions: []
  };

  // Liste élargie de sélecteurs possibles pour les sous-titres Teams
  const selectors = [
    // Sélecteurs actuels dans le code
    '[data-tid="closed-captions"]',
    '[data-tid="closed-caption-item"]',
    '[data-tid="author"]',
    '[data-tid="caption-text"]',
    '[class*="closed-captions"]',
    '[class*="captions-container"]',
    '[class*="caption-banner"]',
    '[class*="caption-item"]',
    '[class*="ui-chat__item"]',

    // Nouveaux sélecteurs à essayer (Teams change souvent)
    '[class*="caption"]',
    '[class*="subtitle"]',
    '[class*="transcription"]',
    '[class*="live-caption"]',
    '[class*="captions-window"]',
    '[class*="captions-panel"]',
    '[data-tid*="caption"]',
    '[data-tid*="subtitle"]',
    '[aria-live="polite"]',
    '[aria-live="assertive"]',
    '[role="log"]',

    // Sélecteurs par structure
    'div[class*="ts-"]',  // Teams utilise souvent des classes ts-*
    'div[id*="caption"]',
    'div[id*="subtitle"]'
  ];

  console.log('\n1️⃣ Recherche avec sélecteurs connus...');
  selectors.forEach(selector => {
    try {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        console.log(`  ✅ Trouvé ${elements.length} élément(s) avec: ${selector}`);
        elements.forEach((el, idx) => {
          const info = {
            selector,
            index: idx,
            tagName: el.tagName,
            id: el.id,
            className: el.className,
            textContent: el.textContent.substring(0, 100),
            attributes: Array.from(el.attributes).map(attr => `${attr.name}="${attr.value}"`),
            innerHTML: el.innerHTML.substring(0, 200)
          };
          results.foundElements.push(info);
        });
      }
    } catch (e) {
      console.log(`  ⚠️ Erreur avec sélecteur ${selector}: ${e.message}`);
    }
  });

  // Recherche heuristique : éléments avec beaucoup de texte qui changent fréquemment
  console.log('\n2️⃣ Recherche heuristique d\'éléments avec texte dynamique...');
  const allDivs = document.querySelectorAll('div');
  const textElements = [];

  allDivs.forEach(div => {
    const text = div.textContent?.trim();
    if (text && text.length > 5 && text.length < 500) {
      // Vérifier si l'élément a des classes ou IDs intéressants
      const className = div.className || '';
      const id = div.id || '';
      const hasInterestingClass = /caption|subtitle|transcription|live|chat|message/i.test(className + id);

      if (hasInterestingClass) {
        textElements.push({
          element: div,
          text: text.substring(0, 100),
          className,
          id,
          path: getElementPath(div)
        });
      }
    }
  });

  if (textElements.length > 0) {
    console.log(`  ✅ Trouvé ${textElements.length} élément(s) potentiel(s) avec texte:`);
    textElements.forEach((item, idx) => {
      console.log(`    ${idx + 1}. ${item.path}`);
      console.log(`       Texte: "${item.text}"`);
      results.suggestions.push(item);
    });
  } else {
    console.log('  ❌ Aucun élément de texte dynamique trouvé');
  }

  // Surveillance des mutations pour détecter le contenu qui change
  console.log('\n3️⃣ Installation d\'un observateur de mutations (30 secondes)...');
  console.log('   👉 Parlez dans Teams maintenant pour générer des sous-titres!');

  const mutationLog = [];
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      if (mutation.type === 'characterData' || mutation.type === 'childList') {
        const target = mutation.target.nodeType === 3 ? mutation.target.parentElement : mutation.target;
        if (target && target.textContent && target.textContent.length > 5) {
          const entry = {
            type: mutation.type,
            timestamp: Date.now(),
            text: target.textContent.substring(0, 100),
            element: getElementPath(target),
            className: target.className,
            id: target.id
          };
          mutationLog.push(entry);
          console.log(`    🔄 Mutation détectée: ${entry.element}`);
          console.log(`       Texte: "${entry.text}"`);
        }
      }
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    characterDataOldValue: true
  });

  // Arrêter l'observation après 30 secondes
  setTimeout(() => {
    observer.disconnect();
    console.log('\n4️⃣ Observation terminée.');
    console.log(`   Total de mutations détectées: ${mutationLog.length}`);

    if (mutationLog.length > 0) {
      // Analyser les patterns les plus fréquents
      const elementCounts = {};
      mutationLog.forEach(entry => {
        const key = entry.element;
        elementCounts[key] = (elementCounts[key] || 0) + 1;
      });

      const sortedElements = Object.entries(elementCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      console.log('\n   📊 Éléments les plus actifs:');
      sortedElements.forEach(([path, count]) => {
        console.log(`      ${count}x: ${path}`);
      });

      results.mutations = {
        total: mutationLog.length,
        topElements: sortedElements
      };
    } else {
      console.log('   ⚠️ Aucune mutation détectée. Les sous-titres sont-ils activés dans Teams?');
    }

    console.log('\n=== RÉSUMÉ DU DIAGNOSTIC ===');
    console.log('Résultats complets:', results);
    console.log('\n💾 Copiez l\'objet ci-dessus et envoyez-le pour analyse.');
    console.log('\n📋 Pour tester un sélecteur spécifique, utilisez:');
    console.log('   document.querySelectorAll("VOTRE_SELECTEUR")');
  }, 30000);

  return results;
}

// Fonction helper pour obtenir le chemin CSS d'un élément
function getElementPath(element) {
  if (!element) return '';

  const path = [];
  let current = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector += `#${current.id}`;
    } else if (current.className) {
      const classes = current.className.toString().split(/\s+/).filter(c => c).slice(0, 2);
      if (classes.length > 0) {
        selector += '.' + classes.join('.');
      }
    }

    // Ajouter data-tid si présent
    const dataTid = current.getAttribute('data-tid');
    if (dataTid) {
      selector += `[data-tid="${dataTid}"]`;
    }

    path.unshift(selector);
    current = current.parentElement;

    // Limiter la profondeur pour la lisibilité
    if (path.length > 4) break;
  }

  return path.join(' > ');
}

// Fonction pour tester un sélecteur spécifique
function testSelector(selector) {
  console.log(`\n🔍 Test du sélecteur: ${selector}`);
  try {
    const elements = document.querySelectorAll(selector);
    console.log(`  Trouvé: ${elements.length} élément(s)`);
    elements.forEach((el, idx) => {
      console.log(`\n  Élément ${idx + 1}:`);
      console.log(`    Tag: ${el.tagName}`);
      console.log(`    ID: ${el.id || '(aucun)'}`);
      console.log(`    Classes: ${el.className || '(aucune)'}`);
      console.log(`    Texte: "${el.textContent.substring(0, 100)}"`);
      console.log(`    HTML:`, el);
    });
    return elements;
  } catch (e) {
    console.error(`  ❌ Erreur: ${e.message}`);
    return [];
  }
}

// Lancer le diagnostic
console.log('\n🚀 Lancement du diagnostic...');
console.log('\n⚠️ IMPORTANT:');
console.log('   1. Assurez-vous que les sous-titres sont ACTIVÉS dans Teams');
console.log('   2. Configurez les sous-titres en ANGLAIS (ou votre langue source)');
console.log('   3. Parlez ou faites parler quelqu\'un pendant les 30 prochaines secondes');
console.log('');

const diagnosticResults = findAllPossibleCaptionElements();

// Exposer les fonctions pour usage manuel
window.clairDebug = {
  findCaptions: findAllPossibleCaptionElements,
  testSelector: testSelector,
  results: diagnosticResults
};

console.log('\n✅ Fonctions disponibles:');
console.log('   window.clairDebug.findCaptions()  - Relancer le diagnostic');
console.log('   window.clairDebug.testSelector("SELECTEUR")  - Tester un sélecteur');
console.log('   window.clairDebug.results  - Voir les derniers résultats');

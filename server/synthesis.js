/**
 * Module de synthèse approfondie pour Clair
 * Exploite Google Gemini pour produire des synthèses exhaustives et pédagogiques
 * adaptées aux cours magistraux, formations et réunions d'affaires.
 */

function formatTimestamp(ms) {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function buildSynthesisPrompt({ segments = [], session = {}, mode = 'course' }) {
  const isCourse = mode === 'course';
  
  const transcriptLines = segments.map((seg) => {
    const speaker = seg.speakerName || 'Intervenant inconnu';
    const time = formatTimestamp(seg.startMs || 0);
    return `[${time}] ${speaker} : ${seg.translatedText || seg.sourceText || ''}`;
  }).join('\n');

  const roleInstruction = isCourse
    ? `Tu es un expert pédagogique de haut niveau chargé de rédiger la fiche de cours et le résumé de synthèse exhaustif d'un cours magistral / d'une formation dispensée en anglais et traduite en français.`
    : `Tu es un secrétaire général et conseiller stratégique de direction chargé de rédiger le compte-rendu officiel exhaustif d'une réunion professionnelle.`;

  const structureRequirements = isCourse
    ? `Rédige un document complet, clair et richement développé comprenant impérativement les sections suivantes :
1. **Fiche synthétique du cours** : Titre du cours, Date estimée, Intervenants/Enseignants, Objectifs pédagogiques fondamentaux.
2. **Plan détaillé de la séance** : Découpage thématique chronologique avec les temps clés identifiés ([MM:SS]).
3. **Développement approfondi des concepts et notions clés** :
   - Développe chaque concept abordé de manière limpide et pédagogique (ne te contente pas d'un résumé en quelques lignes, explique le fond des notions comme dans un manuel de cours de qualité).
   - Définis rigoureusement les termes techniques, acronymes, formules ou méthodologies mentionnés.
   - Si des schémas, graphiques ou diapositives ont été commentés, détaille leur interprétation.
4. **Questions soulevées & Réponses du formateur** : Recense les questions posées par les participants ou étudiants et les explications précises fournies.
5. **Exercices, devoirs & Prochaines étapes** : Liste claire des travaux pratiques, lectures recommandées ou échéances mentionnées.
6. **Fiche mémo de révision (L'essentiel en 5 minutes)** : Les points cardinaux à maîtriser pour les examens ou la mise en pratique.`
    : `Rédige un compte-rendu exécutif de réunion complet et structuré comprenant impérativement les sections suivantes :
1. **Fiche signalétique** : Titre de la réunion, Participants identifiés, Contexte et ordre du jour.
2. **Synthèse exécutive** : Vue d'ensemble des discussions et des enjeux clés.
3. **Plan détaillé des débats & Thématiques abordées** : Reprise chronologique des sujets avec horodatages ([MM:SS]).
4. **Décisions actées & Consensus** : Tout ce qui a été officiellement validé ou approuvé.
5. **Plan d'actions détaillé (Qui fait Quoi pour Quand)** : Tableau ou liste des actions à mener, personnes responsables et échéances mentionnées.
6. **Points en suspens & Prochaines étapes** : Sujets reportés ou nécessitant une réunion de suivi.`;

  return `
${roleInstruction}

Directives strictes :
- Rédige en français soigné, clair, accessible et professionnel.
- Ne fais PAS un résumé simpliste de 5 lignes : la personne a besoin d'un document complet, structuré et exploitable.
- Sois fidèle aux propos tenus sans inventer de faits non mentionnés, mais explicite clairement les concepts abordés.
- Utilise une mise en page soignée en Markdown (titres, listes à puces, texte en gras, tableaux si pertinent).

${structureRequirements}

--- TRANSCRIPTION COMPLÈTE DE LA SESSION ---
${transcriptLines || '[Aucune transcription disponible]'}
--- FIN DE LA TRANSCRIPTION ---
`.trim();
}

/**
 * Génère une synthèse de secours soignée en local si les serveurs distants sont indisponibles
 */
export function generateFallbackSynthesis({ segments = [], session = {}, mode = 'course' }) {
  const isCourse = mode === 'course';
  const title = isCourse ? 'Fiche de Synthèse du Cours' : 'Compte-Rendu de Réunion';
  const dateStr = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const speakers = [...new Set(segments.map(s => s.speakerName).filter(Boolean))];
  const speakersList = speakers.length ? speakers.join(', ') : 'Participants de la réunion';

  let md = `# ${title}\n\n`;
  md += `> **Information :** Synthèse structurée générée à partir des échanges de la session.\n\n`;
  md += `## 1. Fiche Signalétique\n\n`;
  md += `- **Date :** ${dateStr}\n`;
  md += `- **Participants identifiés :** ${speakersList}\n`;
  md += `- **Durée de session :** ${Math.round((session.durationMs || 0) / 1000)} secondes\n`;
  md += `- **Nombre d'interventions transcrites :** ${segments.length}\n\n`;

  md += `## 2. Déroulé Chronologique des Débats & Points Clés\n\n`;
  if (!segments.length) {
    md += `*Aucun passage de parole spécifique n'a été enregistré durant cette session.*\n\n`;
  } else {
    for (const seg of segments) {
      const time = formatTimestamp(seg.startMs || 0);
      const speaker = seg.speakerName || 'Intervenant';
      md += `### [${time}] ${speaker}\n`;
      if (seg.translatedText) md += `**Français :** ${seg.translatedText}\n\n`;
      if (seg.sourceText && seg.sourceText !== seg.translatedText) md += `*Original :* ${seg.sourceText}\n\n`;
    }
  }

  md += `## 3. Synthèse des Échanges & Prochaines Étapes\n\n`;
  md += `- **Revue :** Les différents points abordés ci-dessus ont été archivés pour suivi.\n`;
  md += `- **Actions :** Consulter les enregistrements vidéo synchronisés si des démonstrations visuelles ont été capturées.\n`;

  const html = renderSynthesisHtml({
    markdown: md,
    title,
    date: dateStr,
    mode,
  });

  return { markdown: md, html };
}

/**
 * Appelle l'API Google Gemini pour générer la synthèse approfondie (avec relances automatiques et fallback)
 */
export async function generateDetailedSynthesis({ segments = [], session = {}, mode = 'course', apiKey, model = 'gemini-3.5-flash-lite' }) {
  if (!apiKey) {
    return generateFallbackSynthesis({ segments, session, mode });
  }

  const prompt = buildSynthesisPrompt({ segments, session, mode });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  };

  let response;
  let lastError = null;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) break;

      const errorText = await response.text();
      lastError = new Error(`Échec de l'appel Gemini Synthesis (${response.status}): ${errorText}`);

      if ((response.status === 503 || response.status === 429) && attempt < maxRetries) {
        console.warn(`[Gemini Synthesis] Statut ${response.status} (tentative ${attempt}/${maxRetries}), nouvelle tentative dans ${attempt * 1000}ms...`);
        await new Promise(r => setTimeout(r, attempt * 1000));
        continue;
      }
      break;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt * 1000));
      }
    }
  }

  if (!response || !response.ok) {
    console.warn('[Gemini Synthesis] Indisponibilité temporaire des serveurs Gemini, activation du fallback local:', lastError?.message);
    return generateFallbackSynthesis({ segments, session, mode });
  }

  try {
    const json = await response.json();
    const markdownContent = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!markdownContent) {
      return generateFallbackSynthesis({ segments, session, mode });
    }

    const htmlContent = renderSynthesisHtml({
      markdown: markdownContent,
      title: mode === 'course' ? 'Fiche de Cours & Synthèse Approfondie' : 'Compte-Rendu de Réunion',
      date: new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      mode,
    });

    return {
      markdown: markdownContent,
      html: htmlContent,
    };
  } catch (err) {
    console.warn('[Gemini Synthesis] Erreur parsing réponse Gemini, bascule sur fallback:', err.message);
    return generateFallbackSynthesis({ segments, session, mode });
  }
}

/**
 * Convertit simplement le Markdown en HTML avec styles CSS élégants et adaptés à l'impression/PDF
 */
export function renderSynthesisHtml({ markdown, title, date, mode }) {
  let bodyHtml = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*\*(.*?)\*\*\*/gim, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gms, '<ul>$1</ul>')
    .split(/\n\n+/)
    .map(p => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<ol')) return trimmed;
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | Clair</title>
  <style>
    :root {
      --bg: #ffffff;
      --text: #1a202c;
      --primary: #1e3a8a;
      --accent: #2563eb;
      --border: #e2e8f0;
      --card: #f8fafc;
      --muted: #64748b;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f172a;
        --text: #f1f5f9;
        --primary: #60a5fa;
        --accent: #3b82f6;
        --border: #334155;
        --card: #1e293b;
        --muted: #94a3b8;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.7;
      padding: 40px 20px;
    }
    .container {
      max-width: 880px;
      margin: 0 auto;
    }
    header {
      border-bottom: 3px solid var(--accent);
      padding-bottom: 24px;
      margin-bottom: 36px;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      background: var(--accent);
      color: white;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 12px;
    }
    h1 {
      font-size: 32px;
      color: var(--primary);
      margin: 8px 0;
      line-height: 1.25;
    }
    .date {
      color: var(--muted);
      font-size: 15px;
    }
    h2 {
      font-size: 22px;
      color: var(--primary);
      border-left: 4px solid var(--accent);
      padding-left: 12px;
      margin-top: 36px;
      margin-bottom: 16px;
    }
    h3 {
      font-size: 18px;
      margin-top: 24px;
      margin-bottom: 10px;
    }
    p { margin: 12px 0; font-size: 16px; }
    ul { padding-left: 24px; margin: 12px 0; }
    li { margin-bottom: 8px; }
    strong { color: var(--primary); font-weight: 600; }
    .print-bar {
      margin-bottom: 24px;
      display: flex;
      justify-content: flex-end;
    }
    .btn-print {
      padding: 8px 18px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-print:hover {
      background: var(--border);
    }
    footer {
      margin-top: 60px;
      border-top: 1px solid var(--border);
      padding-top: 20px;
      text-align: center;
      color: var(--muted);
      font-size: 13px;
    }
    @media print {
      body { padding: 0; background: white; color: black; }
      .print-bar { display: none; }
      h2 { border-color: #000; color: #000; page-break-after: avoid; }
      footer { page-break-after: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="print-bar">
      <button class="btn-print" onclick="window.print()">Imprimer ou Enregistrer en PDF</button>
    </div>
    <header>
      <span class="badge">${mode === 'course' ? 'Fiche de Cours Approfondie' : 'Compte-Rendu Exécutif'}</span>
      <h1>${title}</h1>
      <div class="date">${date} &bull; Document généré par Clair AI</div>
    </header>
    <main>
      ${bodyHtml}
    </main>
    <footer>
      Document généré automatiquement à partir de la transcription bilingue et des captures d'écran de la session Teams.
    </footer>
  </div>
</body>
</html>`;
}

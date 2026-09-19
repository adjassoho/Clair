import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSynthesisPrompt, renderSynthesisHtml, generateFallbackSynthesis } from '../server/synthesis.js';

test('buildSynthesisPrompt creates structured pedagogical course prompt', () => {
  const segments = [
    { startMs: 1000, endMs: 5000, speakerName: 'Prof. Laurent', translatedText: 'Bienvenue au cours sur les réseaux de neurones.' },
    { startMs: 6000, endMs: 12000, speakerName: 'Prof. Laurent', translatedText: 'Nous allons explorer la rétropropagation du gradient.' },
    { startMs: 15000, endMs: 20000, speakerName: 'Étudiant Marc', translatedText: 'Quelle est la différence avec la descente de gradient stochastique ?' },
  ];

  const prompt = buildSynthesisPrompt({ segments, mode: 'course' });
  assert.match(prompt, /expert pédagogique de haut niveau/);
  assert.match(prompt, /Fiche synthétique du cours/);
  assert.match(prompt, /Plan détaillé de la séance/);
  assert.match(prompt, /Développement approfondi des concepts et notions clés/);
  assert.match(prompt, /Questions soulevées & Réponses du formateur/);
  assert.match(prompt, /Fiche mémo de révision/);
  assert.match(prompt, /Prof\. Laurent/);
  assert.match(prompt, /Étudiant Marc/);
});

test('buildSynthesisPrompt creates structured executive meeting prompt', () => {
  const segments = [
    { startMs: 1000, endMs: 5000, speakerName: 'Alice', translatedText: 'Ouverture du comité de direction trimestriel.' },
    { startMs: 6000, endMs: 12000, speakerName: 'Bob', translatedText: 'Les résultats Q3 sont en hausse de 15%.' },
  ];

  const prompt = buildSynthesisPrompt({ segments, mode: 'meeting' });
  assert.match(prompt, /secrétaire général et conseiller stratégique/);
  assert.match(prompt, /Synthèse exécutive/);
  assert.match(prompt, /Décisions actées & Consensus/);
  assert.match(prompt, /Plan d'actions détaillé \(Qui fait Quoi pour Quand\)/);
});

test('renderSynthesisHtml generates standalone printable HTML document', () => {
  const markdown = `# Introduction au Machine Learning
## 1. Définition
Le Machine Learning est une branche de l'intelligence artificielle.

- Apprentissage supervisé
- Apprentissage non-supervisé

### Formule mathématique
Perte quadratique moyenne : MSE = sum((y - y_hat)^2) / n
`;

  const html = renderSynthesisHtml({
    markdown,
    title: 'Cours IA',
    date: '16 septembre 2026',
    mode: 'course',
  });

  assert.match(html, /<!doctype html>/);
  assert.match(html, /<title>Cours IA \| Clair<\/title>/);
  assert.match(html, /Fiche de Cours Approfondie/);
  assert.match(html, /<h1>Introduction au Machine Learning<\/h1>/);
  assert.match(html, /<h2>1\. Définition<\/h2>/);
  assert.match(html, /<li>Apprentissage supervisé<\/li>/);
  assert.match(html, /window\.print\(\)/);
  assert.match(html, /@media print/);
});

test('generateFallbackSynthesis generates clean documents when API is unavailable', () => {
  const segments = [
    { startMs: 1000, endMs: 3000, speakerName: 'Alice', translatedText: 'Bonjour tout le monde', sourceText: 'Hello everyone' },
  ];
  const { markdown, html } = generateFallbackSynthesis({ segments, mode: 'meeting' });
  assert.match(markdown, /Compte-Rendu de Réunion/);
  assert.match(markdown, /Alice/);
  assert.match(markdown, /Bonjour tout le monde/);
  assert.match(html, /<!doctype html>/);
});

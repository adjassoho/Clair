# Cahier des charges technique

## Extension de traduction et de capture pour Microsoft Teams

| Information | Valeur |
|---|---|
| Version | 1.1 |
| Date | 16 septembre 2026 |
| Statut | Exigences du challenge, architecture à valider par prototype |
| Public cible | Participants francophones à des réunions et formations en anglais |
| Plateforme prioritaire | Microsoft Teams ; hypothèse d'intégration : version web dans Chrome |
| Langue source | Anglais |
| Langue de restitution | Français |

## 1. Contexte et objectifs

Les participants francophones à des programmes organisés en anglais peuvent rencontrer des difficultés à suivre les échanges et les démonstrations. L'extension doit leur permettre de comprendre les interventions en français, de savoir qui parle et de conserver les contenus utiles après la réunion.

Les objectifs du MVP sont les suivants :

- Afficher progressivement en français les interventions prononcées en anglais.
- Associer automatiquement les interventions au nom du participant, avec gestion explicite des exceptions d'identification.
- Conserver un texte traduit, structuré et horodaté.
- Permettre à l'utilisateur de sélectionner au curseur la zone du partage d'écran à enregistrer.
- Enregistrer uniquement cette zone dans les fichiers vidéo produits.
- Permettre le téléchargement des contenus après une courte finalisation, sans retraitement intégral de la réunion.
- Relier automatiquement chaque passage traduit au moment correspondant de l'enregistrement vidéo avec audio, dès que le segment est disponible.

**Distinction fonctionnelle :** le passage de la parole anglaise à un texte français correspond à une transcription suivie d'une traduction. Le français doit restituer fidèlement le sens, mais ne constitue pas une reproduction mot pour mot des propos originaux. Une exactitude absolue ne peut pas être garantie.

### 1.1. Exigences obligatoires du challenge

La transcription/traduction en direct, les noms des intervenants, la sélection au curseur, l'enregistrement limité à cette sélection, la restitution française, le téléchargement en fin de session et la liaison texte/audio/vidéo sont des exigences obligatoires, et non des options à supprimer en cas de difficulté technique.

Le prototype sert à choisir une architecture qui les respecte. Si une exigence n'est pas réalisable dans l'environnement retenu, le blocage doit être signalé et l'architecture réévaluée. Un résultat dégradé ne doit pas être présenté comme une livraison conforme. La mention « Intervenant non identifié » reste une gestion d'exception, pas un remplacement permanent de l'identification.

## 2. Périmètre du MVP

| Domaine | Inclus |
|---|---|
| Navigateur | Chrome sur ordinateur, version de référence à fixer pendant le prototype |
| Application | Microsoft Teams web dans un onglet du navigateur, hypothèse à confirmer pour le challenge |
| Traitement linguistique | Reconnaissance de l'anglais parlé et traduction vers le français |
| Intervenants | Attribution automatique des noms, obligatoire avec gestion des exceptions |
| Interface | Panneau en français intégré à la page Teams |
| Vidéo | Sélection manuelle rectangulaire et enregistrement recadré |
| Exports | Dossier ZIP avec lecteur HTML synchronisé, manifeste JSON, TXT, SRT et clips vidéo avec audio |
| Conservation | Stockage temporaire local, sans bibliothèque cloud |
| Compte utilisateur | Non requis par défaut ; à réévaluer si un service distant impose une authentification |

L'extension fonctionne pour son utilisateur. Les autres participants n'ont pas besoin de l'installer. Aucun contenu n'est automatiquement diffusé à la réunion.

**Limite d'architecture :** une extension Chrome ne s'intègre pas directement à l'application de bureau Teams. Teams web est l'hypothèse de travail, pas une confirmation de l'environnement du challenge. Si l'application de bureau est imposée, une architecture complémentaire devra être étudiée avant développement ; la compatibilité ne doit pas être déclarée acquise.

**Format retenu :** chaque clip comprend la zone vidéo sélectionnée et l'audio original de la réunion. La traduction française est reliée automatiquement au clip et affichée dans le lecteur exporté, sans être incrustée définitivement dans les images.

## 3. Parcours utilisateur

1. L'utilisateur installe l'extension et rejoint une réunion Microsoft Teams web.
2. Il ouvre le panneau de l'extension.
3. Il vérifie les langues : anglais en entrée, français en sortie.
4. Il autorise les captures nécessaires et prend connaissance des informations de confidentialité et de consentement.
5. Il clique sur « Démarrer la transcription ».
6. Les interventions apparaissent progressivement avec un horaire, un locuteur et un texte français.
7. Lors d'un partage d'écran, il clique sur « Sélectionner une zone » et trace un rectangle avec son curseur.
8. Il vérifie l'aperçu, confirme la sélection et démarre l'enregistrement.
9. Il peut arrêter la vidéo sans interrompre la transcription.
10. Il termine la session et télécharge le dossier de consultation synchronisée, sans association manuelle entre les vidéos et le texte.

## 4. Exigences fonctionnelles

### F-01. Configuration linguistique

- Afficher la langue parlée et la langue de restitution avant le démarrage.
- Pour le MVP, le couple anglais vers français peut être fixe, mais doit rester visible.
- Préparer une structure de configuration permettant l'ajout ultérieur de langues sans les inclure dans le périmètre initial.

### F-02. Capture audio

- Capturer l'audio de l'onglet Teams après une action et une autorisation explicites.
- Vérifier la présence de la source et afficher un indicateur d'activité sonore.
- Signaler une absence de son, une permission refusée ou une interruption.
- Préserver l'écoute normale de la réunion par l'utilisateur pendant la capture.
- Ne jamais activer le microphone local sans autorisation spécifique.

La voix de l'utilisateur lui-même n'est pas nécessairement présente dans l'audio de l'onglet. Son inclusion devra être testée séparément. Si une capture microphone est nécessaire, prévoir une source distincte et éviter les doublons ou les effets d'écho.

### F-03. Transcription et traduction en direct

- Envoyer l'audio au moteur de reconnaissance de manière progressive.
- Traduire les segments anglais en français sans attendre la fin de la réunion.
- Distinguer les segments provisoires des segments stabilisés.
- Mettre à jour un segment provisoire sans créer de doublons.
- Conserver l'ordre temporel des interventions.
- Signaler les passages inaudibles ou manquants au lieu de produire un texte supposé.

Chaque segment affiché comporte un horodatage relatif à la session, un locuteur ou une mention d'incertitude, et le texte français.

**Cible indicative de latence :** premier affichage sous 2 à 5 secondes dans de bonnes conditions réseau et audio. Le délai de stabilisation peut être supérieur. Ces objectifs doivent être mesurés et confirmés pendant le prototype.

### F-04. Identification des intervenants

- Exploiter uniquement les informations accessibles et autorisées dans Microsoft Teams.
- Vérifier la possibilité de corréler les indices de locuteur actif ou de sous-titrage avec les segments audio.
- Ne pas considérer qu'un indicateur visuel de locuteur constitue à lui seul une preuve suffisante d'attribution.
- Afficher « Intervenant non identifié » si l'attribution est incertaine.
- Ne pas attribuer arbitrairement un nom lors d'interventions simultanées.

La diarisation distingue des voix ; elle ne permet pas, à elle seule, d'obtenir le nom réel des participants. L'accès à des noms et leur synchronisation avec l'audio constituent un point de faisabilité prioritaire.

Les possibilités d'intégration Teams doivent être vérifiées dans le tenant du challenge : politiques administrateur, autorisations, disponibilité des sous-titres et accès aux données de réunion. Ni une transcription récupérée après la réunion ni la seule liste des participants ne prouvent une identification en direct. Aucun accès temps réel via une API Microsoft ne doit être supposé sans validation documentaire et essai autorisé.

Exemple d'affichage :

> **[00:12:08] Sarah Martin**  
> Pour cette étape, ouvrez votre tableau de bord et sélectionnez votre projet.

### F-05. Consultation du texte

- Défilement automatique pendant le suivi en direct.
- Suspension du défilement automatique lorsque l'utilisateur consulte l'historique.
- Bouton de retour au direct.
- Copie du texte.
- Réduction du panneau pour libérer l'espace visuel.

### F-06. Sélection de la zone vidéo

- Permettre le tracé d'un rectangle dans la surface visible de l'onglet Teams.
- Afficher une bordure, un aperçu et des commandes de confirmation, d'annulation et de nouvelle sélection.
- Refuser une sélection vide ou hors de la surface capturable.
- Convertir correctement les coordonnées de l'interface en coordonnées de la vidéo capturée, en tenant compte du zoom et des dimensions réelles du flux.
- Exclure les commandes de sélection et le panneau de l'extension de la vidéo exportée, y compris s'ils chevauchent la zone choisie.

### F-07. Enregistrement recadré

- Proposer un démarrage et un arrêt explicites.
- Afficher un indicateur permanent et la durée enregistrée.
- Recadrer les images localement avant encodage, sauvegarde ou éventuelle transmission.
- Ne pas conserver de vidéo non recadrée.
- Produire un fichier distinct pour chaque séquence enregistrée dans le MVP.

Le navigateur peut imposer l'autorisation de capturer une surface plus large que le rectangle choisi. Cette contrainte doit être expliquée : le flux source peut être plus large, mais le fichier conservé doit contenir uniquement la sélection.

### F-08. Changements de disposition

- Suspendre la capture visuelle lorsqu'un changement détecté de dimensions, de zoom ou de disposition risque d'invalider la sélection.
- Demander une nouvelle validation avant la reprise.
- Permettre à la transcription audio de continuer indépendamment.
- Informer l'utilisateur que le suivi automatique du contenu partagé n'est pas inclus.

La détection fiable des changements de disposition doit être testée. Si elle n'est pas suffisante, le périmètre de configurations supportées doit être restreint avant livraison plutôt que de garantir un cadrage non maîtrisé.

### F-09. Exports texte et sous-titres

| Format | Exigences |
|---|---|
| TXT | Texte français en UTF-8, noms disponibles et horodatages de session |
| SRT | Sous-titres français ordonnés et horodatés, noms inclus dans le texte si disponibles |

- Le TXT couvre toute la session de transcription.
- Un SRT associé à un clip utilise des horodatages relatifs au début de ce clip.
- Les segments qui chevauchent les limites d'un clip sont bornés à sa durée.
- Toute coupure de capture doit être prise en compte dans la synchronisation ; un nouveau clip peut être créé pour éviter une chronologie ambiguë.
- Les derniers segments doivent être stabilisés, ou explicitement signalés comme incomplets en cas d'échec, avant l'export final.

### F-10. Export vidéo

- Utiliser un format et des codecs réellement supportés par le navigateur ; WebM est le choix initial envisagé.
- Vérifier le support du type MIME à l'exécution.
- Ne pas imposer de conversion MP4 dans le MVP.
- Fournir un nom de fichier explicite comprenant la date et le numéro du clip.
- Afficher l'avancement de la finalisation si elle n'est pas instantanée.

**Disponibilité attendue :** quelques secondes après l'arrêt dans les conditions de référence, à confirmer par des essais de durée. Aucun traitement intégral différé de la réunion ne doit être nécessaire.

### F-11. Liaison automatique entre texte, audio et vidéo

- Construire la liaison pendant la session, dès que les bornes temporelles d'un segment transcrit sont connues, sans attendre l'export.
- Utiliser le moment où les paroles ont été capturées, et non le moment où leur transcription ou traduction arrive du service distant.
- Mettre à jour la traduction sans perdre le lien vers les médias.
- Conserver les références aux segments dans chaque clip concerné.
- Permettre au lecteur exporté de surligner les interventions correspondant au temps de lecture.
- Permettre un clic sur une intervention pour ouvrir le clip associé et positionner la vidéo au bon instant ; la vidéo contient déjà l'audio correspondant.
- Afficher « Aucun enregistrement vidéo pour ce passage » lorsqu'une intervention se situe hors des périodes enregistrées.
- Ne pas associer artificiellement un passage à la vidéo la plus proche.

« Immédiatement relié » signifie que la correspondance est calculée automatiquement dès la disponibilité du texte. Cela ne supprime pas la latence de reconnaissance et de traduction. Une liaison provisoire est recalculée si les bornes temporelles sont corrigées, puis stabilisée avec le segment.

### F-12. Dossier de consultation autonome

- Fournir un bouton « Télécharger la session complète » produisant une archive ZIP.
- Inclure le lecteur HTML, les données et les médias décrits dans le template de la section 15.
- Permettre la consultation hors ligne après extraction du ZIP dans le navigateur de référence, sans compte, extension installée ni serveur à démarrer.
- Conserver des téléchargements individuels pour les utilisateurs souhaitant seulement le TXT, le SRT ou un clip.
- Signaler les contenus incomplets ou fichiers absents ; ne pas déclarer l'export complet si un média requis manque.
- Construire le paquet à partir des contenus déjà traités. L'assemblage du ZIP ne doit pas déclencher une nouvelle transcription ou un réencodage complet des vidéos.

## 5. Architecture technique envisagée

Les technologies ci-dessous sont des orientations à valider par prototype, et non des dépendances définitivement arrêtées.

| Composant | Responsabilité et orientation |
|---|---|
| Extension Manifest V3 | Déclaration des permissions, point d'entrée et cycle de vie |
| Script de contenu Teams | Interface, sélection de zone et collecte des indices de locuteur accessibles |
| Service worker d'extension | Coordination et échanges entre composants, sans dépendre de son maintien permanent en mémoire |
| Document hors écran, si nécessaire | Hébergement des traitements média de longue durée compatibles avec les API Chrome retenues |
| Capture audio/vidéo | Évaluation de `chrome.tabCapture` et des API de capture autorisées selon le parcours retenu |
| Reconnaissance vocale | Service prenant en charge le streaming anglais, les résultats intermédiaires et les horodatages |
| Traduction | Service de traduction progressive vers le français, avec contexte limité |
| Attribution | Corrélation temporelle des segments et indices de locuteur |
| Recadrage local | Évaluation du recadrage natif lorsque disponible ou d'un rendu recadré dans un canvas |
| Encodage | `MediaRecorder` ou solution équivalente validée sur la configuration cible |
| Stockage temporaire | IndexedDB ou stockage local adapté aux volumes vidéo |
| Générateur d'export local | Assemblage du lecteur autonome, du manifeste et des médias dans une archive ZIP |
| Backend minimal | Protection des secrets fournisseurs, authentification technique et limites d'usage si services externes |

Flux logique :

```text
Audio Teams -> Reconnaissance anglaise -> Traduction française -> Panneau et exports
Indices de locuteur -----------------> Attribution temporelle des segments

Surface Teams -> Recadrage local -> Encodage avec audio -> Clips téléchargeables
```

Le chemin exact de transport audio, direct vers le prestataire avec un jeton temporaire ou via un backend, devra être choisi selon les exigences de sécurité, de latence et de coût.

Les clés secrètes des fournisseurs ne doivent jamais être embarquées dans l'extension distribuée.

## 6. Données et synchronisation

### 6.1. Session

Une session conserve au minimum :

- Identifiant local unique.
- Date de début et durée.
- Langue source et langue cible.
- État de la session.
- Liste des segments, clips et incidents.

### 6.2. Segment de transcription

| Champ | Description |
|---|---|
| `id` | Identifiant stable permettant les mises à jour sans duplication |
| `startMs` / `endMs` | Bornes temporelles relatives à la session |
| `sourceText` | Texte anglais utilisé pour la traduction ; conservation temporaire limitée au besoin |
| `translatedText` | Texte français |
| `speakerId` | Identifiant local du participant si disponible, sinon valeur absente |
| `speakerName` | Nom affichable si l'attribution est fiable |
| `speakerStatus` | Attribution connue ou inconnue |
| `status` | Résultat provisoire, final ou incomplet |

### 6.3. Clip vidéo

Chaque clip conserve son identifiant, ses bornes dans la session, ses dimensions, son type MIME, la référence aux données locales et son état de finalisation.

Une base de temps monotone commune doit permettre de corréler l'audio, les interventions, les indices de locuteur et les clips. L'heure civile sert au nommage et à l'affichage de la date, pas au calcul des durées.

### 6.4. Correspondances média

Une correspondance référence un segment et un clip avec des bornes dans la session et dans le fichier média. Les temps sont stockés en millisecondes. Les intervalles suivent la convention `[début, fin[` : le début est inclus et la fin exclue.

Un segment peut référencer zéro, un ou plusieurs clips. Pour un clip continu sans dérive, commençant à `clipStartMs` dans la session et à zéro dans le fichier :

```text
intersectionStartMs = max(segment.startMs, clip.sessionStartMs)
intersectionEndMs   = min(segment.endMs, clip.sessionEndMs)

Si intersectionStartMs < intersectionEndMs :
    mediaStartMs = intersectionStartMs - clipStartMs
    mediaEndMs   = intersectionEndMs - clipStartMs
Sinon : aucune correspondance.
```

Exemple : un clip commence à 02:00 dans la session ; les paroles commencent à 02:08. Le clic sur leur texte positionne le lecteur à 00:08 dans ce clip, même si la traduction n'est arrivée qu'à 02:12.

Les horodatages audio fournis par le moteur doivent être ramenés à la base de temps de session, y compris après une reconnexion. Les horodatages média réellement produits doivent servir à valider le décalage audio/vidéo et une éventuelle dérive ; la seule heure d'appel à la commande d'enregistrement n'est pas une référence assez précise.

Une pause, une interruption ou un nouveau cadrage ferme le clip courant. La reprise produit un nouveau clip avec sa propre origine temporelle. Si l'encodeur introduit des discontinuités internes, elles doivent être représentées par des plages de correspondance distinctes, ou le clip doit être signalé comme non conforme, plutôt que d'appliquer un décalage unique incorrect.

## 7. Interface et états

L'interface est en français et doit rester utilisable sans masquer les informations essentielles de Teams.

Écrans nécessaires :

- Préparation : langues, permissions et informations sur les données.
- Suivi : transcription, locuteurs et état de connexion.
- Capture : sélection, aperçu et commandes d'enregistrement.
- Fin : état de finalisation, téléchargements et suppression des données temporaires.

La transcription et la vidéo ont des états distincts. Arrêter la vidéo ne doit pas arrêter implicitement la transcription.

États visibles : « Prêt », « Transcription active », « Enregistrement actif », « Capture suspendue », « Connexion interrompue », « Finalisation » et « Fichiers disponibles ».

Les commandes principales doivent être accessibles au clavier. Les états importants ne doivent pas dépendre uniquement d'une couleur.

## 8. Confidentialité et sécurité

- Exiger une action explicite avant toute capture.
- Informer l'utilisateur des données capturées, transmises et conservées.
- Rappeler les obligations d'information et de consentement applicables à la réunion ; une simple confirmation dans l'interface ne remplace pas ces obligations.
- Limiter les permissions Chrome au strict nécessaire et aux domaines utiles.
- Chiffrer les échanges avec les services distants.
- Ne pas transmettre la vidéo à un service distant pour le MVP.
- Éviter les journaux contenant les propos de réunion ou des données personnelles.
- Ne pas utiliser les contenus pour entraîner des modèles sans accord explicite.
- Vérifier les conditions de conservation et de traitement de chaque prestataire.
- Fournir une suppression explicite des données temporaires et documenter la durée de récupération locale retenue.
- Ne pas supprimer les seuls fichiers récupérables avant que l'utilisateur ait pu les exporter.

Le stockage local des exports ne signifie pas un fonctionnement hors ligne : l'audio et le texte peuvent être traités par des services externes. Leurs rôles et lieux de traitement devront être documentés.

La conformité RGPD et les obligations relatives à l'enregistrement doivent être évaluées selon les utilisateurs, les pays et le mode de commercialisation.

## 9. Fiabilité, performance et erreurs

- Sauvegarder progressivement les segments et les données vidéo afin d'éviter de conserver toute la réunion en mémoire.
- Surveiller les limites de stockage et prévenir l'utilisateur avant une saturation.
- Détecter l'arrêt des pistes média, la fermeture de la source et la révocation des autorisations.
- Conserver les données déjà acquises lors d'une coupure réseau.
- Signaler les périodes non transcrites et ne pas les présenter comme couvertes.
- Prévoir une reconnexion contrôlée sans duplication des segments.
- Préserver les clips et textes déjà disponibles lorsqu'un service externe échoue.
- Tester la récupération après fermeture accidentelle ; les blocs vidéo partiels ne doivent pas être supposés lisibles sans validation technique.

Une session de 60 minutes constitue le scénario minimal de test prolongé. La configuration matérielle de référence, la résolution, la cadence vidéo et le budget de stockage seront fixés après mesures.

Mesures à collecter pendant le prototype : délai de premier texte, délai de stabilisation, qualité de traduction, qualité d'attribution, dérive audio/sous-titres, consommation mémoire et coût par heure.

## 10. Critères de recette

| ID | Scénario | Résultat attendu |
|---|---|---|
| R-01 | Un participant parle en anglais | Un texte français apparaît progressivement |
| R-02 | Un segment provisoire est corrigé | Le même segment est mis à jour sans doublon |
| R-03 | Deux participants identifiables parlent successivement dans le scénario nominal Teams | Les interventions sont séparées et attribuées automatiquement aux bons noms ; une absence systématique de noms échoue à la recette |
| R-04 | L'identité est incertaine | Aucun nom n'est attribué arbitrairement |
| R-05 | Un passage est inaudible | Une incertitude ou une lacune est signalée |
| R-06 | L'utilisateur sélectionne une zone | L'aperçu correspond au rectangle choisi |
| R-07 | Le clip est exporté | Aucun contenu extérieur à la sélection ni commande de l'extension n'apparaît |
| R-08 | Le cadrage devient invalide après un changement détecté | La capture visuelle est suspendue et une validation est demandée |
| R-09 | L'utilisateur arrête la vidéo | La transcription continue si elle est active |
| R-10 | Le réseau est interrompu | Une alerte apparaît et les données acquises restent disponibles |
| R-11 | La session est terminée | Le ZIP avec lecteur synchronisé, le TXT, les SRT et les clips enregistrés sont téléchargeables |
| R-12 | Un SRT est lu avec son clip | Les horodatages sont relatifs au clip et correspondent aux interventions |
| R-13 | Une session dure 60 minutes | Aucun blocage ni perte majeure sur la configuration de référence |
| R-14 | Une permission est refusée | Un message explique le blocage sans lancer de capture cachée |
| R-15 | L'utilisateur supprime les données temporaires | Les données locales concernées sont supprimées |
| R-16 | Un segment est reçu après plusieurs secondes de traitement | Le lien utilise le temps des paroles, pas celui de réception du texte |
| R-17 | L'utilisateur clique sur une intervention liée à un clip | Le bon clip est chargé au temps correspondant, avec son audio original |
| R-18 | La vidéo est lue ou déplacée manuellement | Les interventions correspondant au temps courant sont mises en évidence |
| R-19 | Une intervention traverse le début ou la fin d'un clip | La correspondance est bornée à la partie réellement enregistrée |
| R-20 | La capture s'arrête puis reprend | Les clips ont des origines distinctes et aucun lien ne vise la période non enregistrée |
| R-21 | Un passage n'a pas été enregistré en vidéo | Le texte reste consultable, avec une mention explicite d'absence de vidéo |
| R-22 | Le ZIP est extrait puis ouvert hors ligne | Le lecteur fonctionne avec les chemins relatifs, sans serveur ni accès réseau |
| R-23 | Un texte contient des balises ou du script | Il s'affiche comme du texte et n'exécute aucun code dans le lecteur |
| R-24 | La session ne contient aucun clip | Le dossier affiche la transcription complète sans inventer de vidéo |

La qualité linguistique et l'attribution devront être évaluées sur un corpus représentatif : accents variés, vocabulaire du programme, noms propres, changements rapides de locuteur, chevauchements et bruit. Les seuils chiffrés de recette devront être arrêtés après le prototype, avant l'engagement de livraison.

## 11. Stratégie de tests

- Tests unitaires : gestion des segments, horodatages, conversion des coordonnées, intersections segment/clip, génération TXT et SRT.
- Tests d'intégration : capture média, fournisseur de transcription, traduction et persistance locale.
- Tests de bout en bout : session Teams autorisée dans le tenant cible avec plusieurs intervenants, partage d'écran et exports.
- Tests de robustesse : réseau interrompu, permission révoquée, zoom, redimensionnement et espace disque limité.
- Tests prolongés : mémoire, synchronisation et finalisation après 60 minutes.
- Vérifications de confidentialité : permissions, absence de secrets embarqués et absence de vidéo non recadrée conservée.
- Tests d'export : cohérence des identifiants JSON, chemins des fichiers, lecture hors ligne, changement de clip au clic, segments chevauchants et absence d'exécution du texte de réunion.

Les essais utilisant de vraies réunions doivent être réalisés avec les autorisations nécessaires. Les tests automatisés doivent privilégier des contenus synthétiques ou autorisés.

## 12. Hors périmètre

- Google Meet, Zoom et navigateurs mobiles.
- Application de bureau Teams dans l'architecture d'extension seule ; si elle est imposée par le challenge, revoir l'architecture, pas l'exigence Teams.
- Traduction vocale ou doublage audio en français.
- Résumés, comptes rendus et listes d'actions automatiques.
- Bibliothèque cloud et partage public des enregistrements.
- Gestion d'équipes, facturation et abonnements.
- Suivi automatique de la zone de partage.
- Fusion et montage automatique des clips.
- Conversion MP4 obligatoire.
- Incrustation permanente des sous-titres dans la vidéo.
- Garantie d'identification parfaite lors de prises de parole simultanées.

## 13. Phases et livrables

| Phase | Livrable |
|---|---|
| 1. Faisabilité | Prototype de capture, attribution, recadrage et export avec mesures et limites connues |
| 2. Compréhension en direct | Reconnaissance anglaise, traduction française et panneau de lecture |
| 3. Attribution | Association temporelle des participants et gestion explicite des incertitudes |
| 4. Capture et téléchargement | Sélection de zone, clips avec audio, TXT, SRT et ZIP avec lecteur HTML synchronisé |
| 5. Stabilisation | Tests de durée, interruptions, récupération et confidentialité |
| 6. Pilote | Essai auprès d'un petit groupe de participants francophones |

Livrables de fin de MVP :

- Code source de l'extension et du backend éventuel.
- Procédure de construction, installation et configuration.
- Configuration des prestataires sans secrets dans le dépôt.
- Rapport de tests et liste des limites connues.
- Documentation des données traitées et des règles de conservation.
- Version installable pour le groupe pilote.
- Exemple d'export complet suivant le template de la section 15, avec des médias de test autorisés et des liens vérifiables.

La publication sur le Chrome Web Store nécessite une vérification des règles applicables et n'est pas assimilée à la seule livraison du prototype.

## 14. Points à valider avant chiffrage définitif

| Point | Enjeu |
|---|---|
| Noms des intervenants | Faisabilité et fiabilité de la corrélation avec l'audio |
| Capture de la voix locale | Inclusion éventuelle du microphone et prévention des doublons |
| Recadrage et changements de disposition | Garantie de ne conserver que la zone validée |
| Moteurs linguistiques | Qualité, latence, coût et confidentialité |
| Sessions longues | Stockage, consommation mémoire et délai de finalisation |
| Récupération après incident | Exploitabilité réelle des données partielles |
| Distribution | Installation pilote, permissions et règles du Chrome Web Store |

Le budget et le calendrier doivent être établis après cette validation. Les principaux coûts sont le traitement audio, la traduction, l'infrastructure éventuelle et la maintenance face aux évolutions de Microsoft Teams.

**Priorité technique :** valider en premier l'environnement Teams du challenge, la récupération des noms et leur association aux interventions. Si l'architecture envisagée ne satisfait pas ces exigences, documenter le blocage et étudier une autre intégration sans supprimer silencieusement la fonctionnalité obligatoire.

## 15. Template de l'export synchronisé

Cette section définit le modèle de livraison attendu. Elle constitue une spécification ; le lecteur et le générateur d'archives ne sont pas encore implémentés.

### 15.1. Structure du dossier

```text
session-teams-2026-09-16-001.zip
└── session-teams-2026-09-16-001/
    ├── index.html
    ├── session.json
    ├── transcription.fr.txt
    ├── videos/
    │   ├── clip-001.webm
    │   └── clip-002.webm
    └── sous-titres/
        ├── clip-001.fr.srt
        └── clip-002.fr.srt
```

- `index.html` : page d'entrée avec lecteur vidéo/audio, transcription interactive et liste des clips.
- `session.json` : manifeste versionné contenant les métadonnées, segments, clips, correspondances et incidents.
- `transcription.fr.txt` : transcription française complète, y compris les passages sans vidéo.
- `videos/` : uniquement les clips recadrés contenant l'audio original des mêmes périodes.
- `sous-titres/` : un SRT français par clip, aligné sur sa chronologie.

Le nombre de clips varie. Sans enregistrement, la liste est vide et le lecteur présente uniquement le texte. Aucun fichier audio complet de la réunion n'est ajouté implicitement : les périodes sans vidéo restent textuelles, sauf exigence future explicite de conservation audio séparée.

### 15.2. Présentation du lecteur

```text
SESSION TEAMS | 16/09/2026 | Anglais -> Français
Durée : 45:00 | 2 extraits vidéo | État : complet / incomplet

[Liste des extraits : Extrait 1, Extrait 2]

[Vidéo recadrée avec son audio original]
[Lecture / Pause] [Temps courant / Durée] [Volume]

TRANSCRIPTION FRANÇAISE
Heure session   Intervenant       Intervention                  Média
00:01:42        Sarah Martin      Présentation de l'exercice.    Sans vidéo
00:02:08        Sarah Martin      Ouvrez le tableau de bord.     Extrait 1, 00:08
00:02:15        David             Choisissez votre projet.      Extrait 1, 00:15

[Texte actif mis en évidence pendant la lecture]
[Télécharger le texte] [Télécharger le clip] [Télécharger le SRT]
```

Chaque référence média est cliquable. Un clic charge le bon fichier, attend ses métadonnées, règle `currentTime`, puis lance la lecture si le navigateur l'autorise ; sinon, un bouton de lecture reste visible. La sélection des interventions actives fonctionne aussi après un déplacement manuel dans la vidéo. Plusieurs interventions peuvent être actives en cas de chevauchement.

Un passage associé à plusieurs clips présente plusieurs liens explicites. Le lecteur ne masque pas les passages sans vidéo et ne confond pas heure dans la session et temps dans le clip.

### 15.3. Exemple de manifeste JSON

Exemple réduit illustratif : une session de trois minutes, un clip de trente secondes et une intervention liée à ce clip. Une véritable exportation contient tous les segments de la session.

```json
{
  "schemaVersion": "1.0",
  "session": {
    "id": "session-001",
    "platform": "microsoft-teams-web",
    "startedAt": "2026-09-16T14:00:00Z",
    "durationMs": 180000,
    "sourceLanguage": "en",
    "targetLanguage": "fr",
    "status": "complete"
  },
  "speakers": [
    { "id": "speaker-001", "displayName": "Sarah Martin" }
  ],
  "segments": [
    {
      "id": "segment-001",
      "startMs": 128000,
      "endMs": 132000,
      "speakerId": "speaker-001",
      "speakerStatus": "identified",
      "translatedText": "Ouvrez le tableau de bord.",
      "status": "final"
    }
  ],
  "clips": [
    {
      "id": "clip-001",
      "file": "videos/clip-001.webm",
      "mimeType": "video/webm",
      "sessionStartMs": 120000,
      "sessionEndMs": 150000,
      "durationMs": 30000,
      "width": 1280,
      "height": 720,
      "hasAudio": true,
      "subtitleFile": "sous-titres/clip-001.fr.srt",
      "status": "complete"
    }
  ],
  "mediaLinks": [
    {
      "segmentId": "segment-001",
      "clipId": "clip-001",
      "sessionStartMs": 128000,
      "sessionEndMs": 132000,
      "mediaStartMs": 8000,
      "mediaEndMs": 12000
    }
  ],
  "incidents": []
}
```

Règles du manifeste :

- Les identifiants sont uniques dans leur collection et les références doivent exister.
- Les temps sont des nombres finis, positifs ou nuls ; chaque fin est strictement supérieure à son début.
- Chaque lien est borné à l'intersection du segment et du clip ; ses temps média ne dépassent pas la durée du fichier.
- Un segment non identifié utilise `speakerId: null` et `speakerStatus: "unknown"`.
- `mediaLinks` est vide pour les passages sans vidéo ; aucune référence factice n'est générée.
- Le texte anglais n'est pas exporté par défaut. Il peut rester temporairement disponible au moteur pour la traduction selon la politique de conservation.
- `incidents` contient, le cas échéant, des entrées avec `type`, `startMs`, `endMs` et `message`, sans secrets ni détails techniques sensibles.
- `complete` signifie que la production s'est terminée sans manque détecté ; ce statut ne certifie pas une exactitude linguistique absolue.

### 15.4. Exemple SRT correspondant

```srt
1
00:00:08,000 --> 00:00:12,000
Sarah Martin : Ouvrez le tableau de bord.
```

Les mêmes données alimentent le SRT et le lecteur HTML pour éviter deux calculs de synchronisation divergents. Le SRT est un format d'échange ; le lien interactif repose sur les identifiants et horodatages du manifeste, pas sur un simple nom de fichier similaire.

### 15.5. Contraintes de consultation locale

- Embarquer les styles, le code du lecteur et une copie des données du manifeste dans `index.html`, sans CDN ni dépendance réseau.
- Ne pas dépendre d'un `fetch()` de `session.json` en contexte `file://`, qui peut être restreint par le navigateur. Le JSON séparé reste disponible pour la réutilisation des données.
- Générer le JSON externe et sa copie embarquée depuis le même objet validé.
- Charger les vidéos via des chemins relatifs locaux après extraction du ZIP ; vérifier ce fonctionnement sur le navigateur de référence.
- Sérialiser les données embarquées de manière sûre, notamment les séquences de fermeture de balise, et afficher noms et transcriptions comme du texte, jamais comme du HTML interprété.
- Générer et valider les chemins de fichiers ; refuser les URL externes et les remontées de répertoire dans un manifeste importé.
- Afficher les traductions synchronisées depuis les données embarquées. Ne pas dépendre du chargement d'un SRT comme piste HTML native.
- Prévoir un message explicite si un média est absent ou son codec non pris en charge.
- Tester le positionnement dans les WebM exportés : un fichier lisible mais non navigable temporellement ne satisfait pas l'exigence de clic sur la transcription.

### 15.6. Recette du template

Le livrable de démonstration doit inclure deux clips séparés par une période sans capture, plusieurs locuteurs, un segment traversant une limite de clip et une traduction reçue en retard. La démonstration doit prouver la navigation texte vers vidéo, le suivi vidéo vers texte et le maintien de la synchronisation après interruption.

Le seuil acceptable de décalage entre les paroles et la mise en évidence du segment doit être fixé avant la recette à partir des mesures du prototype. La liaison est obligatoire ; le fait que son seuil de précision reste à mesurer ne rend pas cette fonctionnalité optionnelle.

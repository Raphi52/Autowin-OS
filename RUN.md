status: open
session: local-scout-2026-07-21
regime: standard
signal: un test de rendu Workflows couvre un RUN complet et un RUN incomplet ; `npm test` et `npm run typecheck` sortent à 0 ; une capture CDP fraîche montre le sommaire de sections, les compteurs Journal/Défauts et un contenu Markdown sans débordement horizontal.
signal-cmd: npm test && npm run typecheck
gate: preuve terminale = signal-cmd vert + assertion DOM et capture CDP relues dans ce run

## Besoin

Rendre la vue **Workflows** utilisable pour comprendre un run sans lire un bloc Markdown brut : état, avancement, phases, journal, défauts et reprise doivent être repérables en quelques secondes.

Périmètre IN : détail d’un RUN.md dans `src/renderer/src/components/ChatView.tsx`, ses données déjà exposées par `parseRun`, la trace de sous-agents et les tests/captures de cette vue.

Périmètre OUT : modification du format de RUN.md, orchestration, persistance des traces, logique métier, scripts d’empreinte et code applicatif hors Workflows.

Faits observés :

- `src/renderer/src/components/ChatView.tsx:1950-1989` n’affiche sur la carte que statut et DoD, puis le détail est `StepThread` ou un `<pre>` brut du RUN.md.
- `src/main/dashboards/runs.ts:4-93` extrait déjà statut, régime, DoD, nombre d’événements du Journal et défauts ; les deux derniers ne sont pas affichés sur la carte Workflows.
- `src/renderer/src/components/ChatView.parts.tsx:19-57` ne distingue que `exec`, `judge` et `gate` ; il ne représente pas les sections du RUN ni toutes les phases du pipeline.
- `src/renderer/src/components/BrainMarkdown.tsx:1-32` fournit déjà un rendu Markdown sûr avec frontmatter et GFM ; le candidat doit le réutiliser, pas créer un second renderer.

### Candidats scoutés

| # | Impact | Effort | Type | What | Why | How |
|---|---|---|---|---|---|
| 1 | 🟢 | 🟡 | 🆕 new | Inspecteur RUN structuré : synthèse, navigation de sections et contenu Markdown lisible. | Le détail actuel force la lecture d’un `<pre>` alors que les signaux de santé existent déjà. | Prototyper dans `ChatView` à partir de `parseRun` et réemployer `BrainMarkdown`; vérifier par test de rendu et capture CDP. |
| 2 | 🟡 | 🟢 | 🔧 fix | Afficher événements Journal et défauts sur chaque carte de run. | `parseRun` les calcule mais `ChatView` ne montre que la DoD (`ChatView.tsx:1925-1963`). | Ajouter deux compteurs et un test qui rend un run avec journal/défaut. |
| 3 | 🟡 | 🟡 | 🆕 new | Timeline de phases avec état courant et verdict. | La trace montre les appels, mais `STEP_META` ne présente que trois rôles techniques. | Définir un modèle de phase stable dans `chat-view-model.ts`, puis le rendre dans le détail. |
| 4 | 🟢 | 🔴 | 🆕 new | Vue « prochain geste » : synthèse de Reprise, bloqueurs et preuves récentes, au-dessus du journal. | Elle réduit le coût de reprise d’un run interrompu. | Étendre le parseur à `## Reprise`, puis définir les règles de priorité des signaux. |

Décision de cadrage : **#1, Inspecteur RUN structuré**, avec les compteurs de #2 comme exigence minimale. #3 reste une extension si les données de phase deviennent stables ; #4 exige un contrat de données supplémentaire et reste hors premier incrément.

**Critères de succès (DoD vérifiable)** :

- [ ] Un RUN.md contenant Besoin, Contraintes, Options, SOP, Journal, Défauts et Reprise s’ouvre dans Workflows avec une synthèse et une navigation de sections ; preuve : test de rendu ciblé vert.
- [ ] La carte d’un run affiche statut, DoD, événements Journal et défauts sans dégrader les runs attachés ou sans trace ; preuve : test de composant avec les deux cas.
- [ ] Le contenu Markdown reste lisible dans le panneau, sans débordement horizontal ; preuve : capture CDP fraîche relue et assertion DOM.
- [ ] `npm test` et `npm run typecheck` sont verts après implémentation ; preuve : exit code 0.

Hypothèses : le format de sections `##` reste la source de vérité ; les RUN.md externes peuvent omettre certaines sections et doivent alors recevoir un état vide explicite.

Devis terrain : 8 à 12 tours, un seul chantier de code, puis une passe de validation ; ordre de grandeur 45 à 90 minutes. Régime standard retenu : le comportement est visuel et demande une preuve CDP en plus des tests.

Risques :

- Élevé — un RUN externe peut avoir un Markdown inattendu ; mitigation : parser tolérant et fallback « section absente », jamais une erreur de rendu.
- Moyen — le panneau étroit peut nuire à la lisibilité ; mitigation : validation à la largeur minimale persistée et capture CDP.
- Moyen — une timeline peut suggérer des phases non observées ; mitigation : ne l’inclure que si la trace fournit des états fiables.

Points à vérifier pendant l’implémentation : accessibilité clavier de la navigation ; quantité de contenu à replier par défaut ; cohérence entre `Fil des sous-agents` et les sections du RUN.

## Contraintes

- HARD — ne pas modifier le format ni la persistance des RUN.md ; source : périmètre utilisateur. Violation : incompatibilité avec runs existants et attachés.
- HARD — ne pas modifier de code applicatif dans ce cadrage ; source : demande utilisateur. Violation : sortie du périmètre.
- HARD — réutiliser le renderer Markdown existant si un rendu est ajouté ; source : `BrainMarkdown.tsx`. Violation : doublon de capacité.
- SOFT — conserver le panneau Workflows compact et redimensionnable ; source : `ChatView.tsx:449-453`. Violation : lisibilité réduite dans la vue principale.

## Options

| Option | Impact | Effort | Couverture | Limite |
|---|---|---|---|---|
| A — Inspecteur structuré réutilisant `BrainMarkdown` + sommaire de sections + indicateurs de santé | 🟢 | 🟡 | Besoin, Contraintes, Options, SOP, Journal, Défauts, Reprise et lecture complète | Demande un modèle de sections testé. |
| B — Enrichir seulement la carte (Journal, Défauts, régime) | 🟡 | 🟢 | Observabilité de liste | Ne résout pas la lecture du RUN ni la reprise. |
| C — Timeline de phases à partir de la trace | 🟡 | 🟡 | Lisibilité de l’exécution live et passée | Ne couvre pas les sections du RUN ; phases métier incomplètes. |
| D — Vue « prochain geste » issue de Reprise et Défauts | 🟢 | 🔴 | Reprise d’un run bloqué | Nécessite de normaliser des contenus aujourd’hui libres. |

Décision : **A**. Elle répond au besoin réel avec les données et le renderer déjà présents ; elle absorbe B sans inventer de contrat de phase. C et D restent des incréments ultérieurs conditionnés par leurs données.

## SOP

| Étape | Action | Commande / outil | Signal attendu hors-modèle | Fallback / arrêt |
|---|---|---|---|---|
| 1 | Établir un exemple de RUN complet et un RUN externe incomplet. | Lire `src/main/dashboards/runs.test.ts` et `src/main/runs/conv-runs.test.ts`. | Cas de test reproductibles, sections et absences identifiées. | Si le format réel diverge, ajouter le cas minimal avant toute UI. |
| 2 | Définir le modèle de sections tolérant et les états vides. | Tests Vitest ciblés du modèle/composant. | Test rouge sur section absente, puis vert après le modèle. | Arrêter si le modèle exige d’écrire dans RUN.md : hors périmètre. |
| 3 | Construire l’inspecteur et les compteurs de carte en réutilisant `BrainMarkdown`. | Édition ciblée de `ChatView.tsx`, composant dédié si nécessaire, CSS associé. | Test de rendu : sections navigables, compteurs Journal/Défauts et fallback sans trace. | Revenir au détail Markdown existant si la réutilisation casse un RUN attaché. |
| 4 | Vérifier le comportement dans l’application. | `npm test`; `npm run typecheck`; script CDP existant adapté à Workflows ; lecture de la capture. | Exit code 0, assertions DOM positives, capture fraîche lisible. | ⛔ Bloqué si l’app/CDP n’est pas lançable : conserver les tests verts et consigner le blocage. |
| 5 | Vérifier la non-régression à largeur minimale. | Capture CDP avec panneau à `CHAT_PANE_LIMITS.workflows.min`. | Aucun débordement horizontal du détail ; capture relue. | Corriger le CSS avant livraison. |

### Exécution prévue

- 1 → 2 → 3 → 4 → 5 : séquence unique ; les étapes 2 et 3 partagent le modèle et le composant, donc pas de travail concurrent.
- Ressource partagée : application Electron et port CDP ; un seul pilote CDP à la fois.
- Point de retour : l'état Git courant, inspecté avant le premier changement, est le dernier instantané connu. Ne jamais écraser les modifications locales d’autrui ; un échec confirmé revient au dernier changement vert propre au chantier.
- Plafond : 12 tours ; arrêt dur après 3 tours sans test devenu vert ni nouvelle preuve CDP. Toute opération destructive ou hors Workflows exige confirmation.
- Après la preuve fonctionnelle : nettoyer les seuls résidus attribuables, rejouer `npm test && npm run typecheck`, puis soumettre le diff et ce RUN à une revue indépendante. Aucun skill réutilisable : besoin non récurrent.

## Journal

[2026-07-21] Cadrage créé : reconnaissance de `ChatView`, `parseRun`, `conv-runs` et `BrainMarkdown`.
[2026-07-21] Candidat #1 retenu : inspecteur RUN structuré ; aucune modification de code applicatif.
[2026-07-21] Cadrage relu : six sections requises, quatre options et la décision A confirmées par contrôle PowerShell.
[2026-07-21] Terrain : signal rejouable fixé à `npm test && npm run typecheck`; CDP présent via `scripts/autowin-headless.ps1` et scripts Workflows, à adapter au futur inspecteur.
[2026-07-21] Terrain : exécution séquentielle, plafond de 12 tours, point de retour = état Git inspecté avant le chantier. RUN reste ouvert.
[2026-07-21] Driver : non armé — cette session Codex ne fournit pas de commande `/goal`; le stop-gate et le signal-cmd restent la référence de clôture.

## Défauts

- Aucun défaut applicatif modifié : cette phase livre uniquement le cadrage.

## Reprise

- Goal : implémenter l’option A, inspecteur RUN structuré avec compteurs Journal/Défauts dans Workflows.
- Hypothèse : `parseRun` fournit déjà les indicateurs de santé et `BrainMarkdown` permet le rendu sans nouveau parseur Markdown.
- Tried : reconnaissance du code et des scripts CDP ; aucun code applicatif modifié.
- Next : localiser le test de composant Workflows le plus proche, écrire le cas rouge RUN complet/incomplet, puis suivre le SOP.
- Blockers : aucun. L’app Electron/CDP devra être lancée pour la preuve visuelle finale.
- Compteur : terrain terminé ; build non commencé ; 0/12 tours de build consommés.

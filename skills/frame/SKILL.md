---
name: frame
description: >-
  Étape 1 du pipeline (frame → terrain → build → clean → judge). CADRE un besoin en profondeur ET,
  si le besoin cadré laisse un choix d'approche ouvert, EXPLORE les options. Point d'entrée par
  défaut du travail substantiel : déclenche-toi SANS attendre le mot « frame », (a) dès qu'une
  demande est formulée en SOLUTION (« crée X », « ajoute Y », « mets en place Z ») ou qu'un besoin est vague sur une tâche
  DÉJÀ choisie, et (b) sur le COMMENT de cette tâche — « quelle approche / architecture /
  bibliothèque », « compare les approches ». Deux hard-gates PRIMENT (§ Quand la déclencher) : une
  question CONSULTATIVE reçoit une réponse DIRECTE, une forme encore OUVERTE reste
  conversationnelle. NE PAS utiliser pour préparer l'exécution autonome (→ `terrain`), juger un
  livrable fini (→ `judge`), trouver QUOI faire quand aucune tâche n'est choisie (→ `scout`), ni
  jouer le protocole lourd sur un one-shot trivial déjà précis.
---

# frame — deux passes, une skill : cadrer le besoin, puis (si ouvert) explorer les options

## À quoi ça sert
**Comprendre le besoin à 100 % — y compris ce que l'utilisateur n'a PAS écrit.** Cadrer le vrai PROBLÈME (pas la solution demandée) et faire remonter activement l'**implicite** : contraintes tacites, présupposés cachés, et les **angles morts que l'utilisateur n'a jamais formulés** — pour que rien de non-demandé ne coule le travail en aval. Tout ce qui suit est le COMMENT : les questions-archétypes tirent l'implicite dehors, le balayage d'angles morts chasse ce qu'aucune question n'a touché, le filtre de remontée répond tout seul à l'évident et ne remonte à l'humain que ce qui l'exige vraiment.

**Cadrer sous audit anticipé (un levier)** : le `judge` Fidèle REMONTERA chaque affirmation du besoin à un critère (un besoin périmé ou contredit = un défaut qu'il peut signaler) — produire pour cette inspection falsifiable resserre le besoin ; ça aiguise le cadreur, jamais le juge.

## Quand la déclencher — et quand NON
**(a) CADRAGE** : demande formulée en SOLUTION (« crée X », « ajoute Y », « fais le script Z », « mets en place… » — mais préparer la BOUCLE autonome d'un besoin déjà cadré → `terrain`) · besoin vague **sur une tâche déjà choisie** (vague sur QUELLE tâche prendre → `scout` d'abord) · « définis / cadre le besoin ». Inclut EXPLICITEMENT la création d'un doc/README/`AGENTS.md`/config : on déclenche pour VÉRIFIER qu'il n'existe pas déjà et pour cadrer son contenu — créer un fichier qui existe déjà (ou qui rate son vrai contenu) est le piège coûteux classique.
**(b) CHOIX D'APPROCHE** : le COMMENT d'une tâche DÉJÀ choisie — « quelle approche / architecture / bibliothèque pour X », « explore les options », « compare les approches », « génère plein de solutions et fais-les voter », « aide-moi à choisir entre plusieurs designs ».
**DEUX HARD-GATES de la constitution (`src/main/constitution.ts`), prioritaires sur tout ce qui précède** : une question purement CONSULTATIVE (« quelle est la meilleure X / vaut-il mieux / pourquoi », qui attend une réponse directe) → répondre DIRECTEMENT, AUCUN cadrage · une forme/prémisse encore OUVERTE (« je sais pas si X ou juste Y ? », un doute sur la FORME elle-même) → rester conversationnel et converger la forme D'ABORD, sans router ni sortir un QCM qui présuppose une forme choisie.

## Procédure

### 0. Fichier RUN
Ouvre ou complète l'**unique** `RUN.md` vivant : `~\.claude\runs\<session_id>\<subject>-workspace\RUN.md` (slug en kebab-case ; en-tête `session:` ; portée de session + repli historique → **ENGINE ch.3 (détails RUN) + fondation §1**). Pose `regime:` (disposable | standard | critical) dès l'entrée. Un one-shot `disposable` peut se passer de fichier RUN (proportionnalité). Écris `## Besoin`, `## Contraintes` et (s'il est atteint) `## Options` ICI — jamais dans des fichiers séparés.

### Passe A — le besoin (toujours)

**0. Refléter la demande — ANCRER, jamais REMPLACER** (premier geste ; validé en A/B le 2026-06-30). Le message de l'utilisateur reste la SOURCE DE VÉRITÉ — ne le réécris jamais en un prompt généré sur lequel tout le reste du travail tournerait ensuite (cela enterre silencieusement TON interprétation comme si c'était la sienne). Ouvre en redisant l'intention comprise avec tes mots **+ ce que tu supposerais — mais chaque supposition reste une QUESTION** (« ⚠️ je lis ça comme X — corrige-moi »), JAMAIS une cause / direction / portée déduite AFFIRMÉE comme un fait.
- **Le piège (A/B cas C3, le contre-intuitif)** : une « reformulation » qui dit *« c'est probablement un margin:auto manquant »* sur un bug que tu n'as pas reproduit est PIRE que de rester agnostique — elle engage le travail sur une fausse piste avec un ton d'autorité. Donc une CAUSE (bug) = une hypothèse à **MESURER** (reproduire/lire d'abord), jamais injectée comme contexte établi ; une PORTÉE (permissions/sécurité/droits) = **remontée pour validation**, jamais intégrée en silence.
- **Objectif OUVERT** (design / « magnifique » / « améliore » / « nouvelle vision » / toute demande esthétique ou de direction) → ne cadre PAS une spec. Force la **DIVERGENCE d'abord** — 2-3 options distinctes parmi lesquelles l'utilisateur choisit (visuel → `draft` ; sinon passe B), parce qu'imposer une spec entière inventée sur un objectif ouvert est la pire dérive (A/B cas C1). Cela se compose avec le hard-gate de forme encore OUVERTE de la constitution (converger la forme avant de router).

**1. Pré-contrôles — avant toute question :**
- **Solution déguisée** — « crée/ajoute/fais X » est une réponse, pas un problème. Remonte au problème sous-jacent ; impact d'un saut ≥ 80 → remonte-le. Ne cadre jamais l'artefact avant que le problème soit nommé.
- **Vérifier l'EXISTANT d'abord** — une seule salve de reconnaissance en parallèle (ENGINE ch.1 generate) avant de cadrer quoi que ce soit, surtout pour un doc/README/config : existe-t-il, que couvre-t-il. Cite des faits.
- **Surface d'impact (rayon de souffle)** — CARTOGRAPHIE ce que le besoin va TOUCHER : fichiers/modules/configs/appelants/docs/tests qu'il touche, casse ou avec lesquels il doit rester cohérent, plus ce qui le CONTRAINT (dépendances amont, limites de plateforme, politiques). Une seule salve de reconnaissance, en parallèle ; cite `file:line`. Alimente le hors-périmètre (ce qui reste INTACT) + le critère de succès ; une carte vide est un constat (changement isolé). **Rejoue-la (en écrasant) si quoi que ce soit avant `## Besoin` déplace le besoin** — nouvel acteur/sortie, contrainte renversée, ou support de livraison changé.
- **Sortie de secours triviale** — manifestement trivial + jetable + déjà précis → dis que le cadrage est surdimensionné, propose l'implémentation directe. Ne joue pas le protocole lourd.

**2. EXTRACTION vs ANALYSE** — deux natures de questions, jamais confondues. L'EXTRACTION tire ce que l'utilisateur détient déjà (intention, contraintes, goût) → demande-lui. L'ANALYSE tranche ce que seule l'investigation peut trancher (ce qui existe, ce qui est faisable, ce que ça coûte) → tu vas le chercher, tu ne le sous-traites jamais. Ne déguise jamais une question d'analyse en faux-QCM auquel l'utilisateur ne peut pas répondre.

**3. Phase de questions** — réservoir de générateurs-archétypes via ENGINE ch.1 (Naïf · Casseur · Contradicteur · Perfectionniste · Diplomate · Explorateur · Pragmatique · Émotionnel), générés en parallèle (un seul message). **Le Naïf ouvre** (décompose chaque terme, fait remonter chaque présupposé) ; les questions sont notées au mérite (impact × confiance-en-autonomie). **Le filtre de remontée** répond tout seul à l'évident sous forme d'hypothèses énoncées (« je suppose X, d'après <fait> — corrige-moi », jamais en silence), et ne remonte à l'humain QUE le strictement privé / à fort impact / vraiment incertain. **Priorité fort impact** : impact ≥ 80 → remonte quelle que soit la confiance (seule exception : un « pourquoi » qu'il a déjà énoncé). Arrête quand le meilleur impact brut passe sous 30, quand le filtre est épuisé, ou au plafond de tours.

**Discipline (non négociable) :**
- QCM d'abord — des choix concrets avant de la prose ouverte ; **une question à la fois**, jamais un mur. Un QCM SEULEMENT quand l'espace d'intention est BORNÉ (par un artefact : log / diff / reproduction / contrainte énoncée). Espace encore OUVERT → question ouverte, jamais un QCM — un QCM enferme alors l'utilisateur dans TES catégories. **Au moment où l'utilisateur rejette ou détourne un QCM = tes catégories sont fausses** : abandonne les options, reviens à la question ouverte ; ne repropose PAS les mêmes choix reformulés. **Les catégories doivent COUVRIR l'espace AVANT émission (kaizen)** : quand un artefact existant est dans le périmètre, le jeu d'options DOIT contenir une branche « remplacer / refonte / repartir de zéro » (pas seulement des branches additives), et toute PRÉMISSE porteuse d'une option (un état du système, l'existence ou la valeur d'un fichier) se vérifie par un contrôle cité AVANT émission — passe la prémisse du QCM au filtre de remontée (réflexe 1).
- Refuse le vague — « trois-riens » (rien / aucune idée / peu importe à la suite) → recadre, n'accepte jamais le brouillard.
- **Aucune solution pendant le cadrage** — proposer un COMMENT est interdit. À l'instant où une solution est sur la table, tu es passé de la PRODUCTION (tu mènes) à la RÉACTION (tu défends un artefact) — reviens au problème.
- Anti-dérive à l'ouverture : décompose chaque terme et ses présupposés plutôt que d'élargir le périmètre.

**4. Balayage d'angles morts** (inspiré de Fusion — *ce qu'aucune question n'a touché*) — avant d'écrire le besoin : quelle facette n'a été sondée par AUCUN archétype ni AUCUNE question **et n'est déjà couverte par aucune hypothèse énoncée du filtre** ? Ce sont les **NON-DEMANDÉS** (inconnues inconnues), DISTINCTS des questions ouvertes (inconnues connues reportées à `terrain`). **Boucle, ne fais pas un seul passage** — rebalaye, chaque tour utilisant un archétype DIFFÉRENT comme lentille de couverture (Casseur = mode de panne non sondé ; Naïf = présupposé non examiné — son usage d'analyse, pas de génération de questions). Arrête quand un tour ne trouve rien de neuf (aucune facette d'impact ≥ 30 non déjà listée). **Plafond par régime** : disposable = 1 passe · standard = 2 tours max · critical = jusqu'à 2 tours à vide, 3 max. Nomme les angles morts pour qu'ils remontent ; un angle mort à fort impact → pose-le maintenant plutôt que de le reporter.

**4 bis. Cas limites d'entree — ENUMERE-LES DANS L'ENONCE, ne les laisse pas a l'executant.**
Des que le besoin touche une entree (drapeau CLI, argument, option, champ de formulaire, requete,
variable d'environnement), `## Besoin` porte une rubrique **`### Cas limites d'entree`** listant au
minimum **3 cas**, chacun avec le comportement attendu : absente · vide · mal typee · hors bornes
(zero, negatif, enorme) · repetee · nominale. Si le besoin n'a aucune entree utilisateur, la
rubrique n'a pas lieu d'etre ; si elle est volontairement omise malgre une entree, ecris la dispense
en clair — `Cas limites : sans objet — <raison>`.
**Ce n'est pas du zele : c'est le seul facteur du kit dont l'effet soit MESURE hors du bruit.**
Banc `arena-bench-ax3` (2026-09-07, 3 repliques par bras, une vague, meme tache, meme critere de 30
assertions comportementales) : enonce SANS cas limites = **0 vert sur 3** — les 3 repliques avalent
un drapeau repete en silence, 2 sur 3 jettent une pile Node sur une valeur hors plage ; enonce AVEC
la liste = **3 verts sur 3**. Separation parfaite (p = 0,10, plancher a n=3).
**Garde-fou deterministe** : `node scripts/frame-cas-limites-check.mjs <RUN.md>` — exit 1 tant que le
besoin decrit une entree sans enumerer ses cas limites. Passe-le AVANT de rendre la main a `terrain`.

**5. Passe risques** — avant d'écrire le besoin, liste les **menaces sur le critère de succès** : ce qui pourrait le faire ÉCHOUER (dépendance pas prête, plafond de perf/échelle, perte de données / irréversibilité, une hypothèse énoncée qui se révèle fausse, blocage externe, dérive de périmètre). Chacune = **gravité** (probabilité × impact) + une ligne de **mitigation/surveillance**. DISTINCT des angles morts (facettes non sondées) et de la surface d'impact (existant affecté) : un risque est une menace CONNUE que tu peux déjà nommer. Risque à forte gravité sans mitigation → remonte-le (un besoin n'est pas cadré tant qu'un risque fatal n'a pas de propriétaire).

**6. Écris `## Besoin` + `## Contraintes`** (en mots simples que l'utilisateur lit — aucun label interne) : `## Besoin` porte le vrai problème (pas la solution demandée) · périmètre dedans/dehors · un **critère de succès vérifiable sous forme de liste cochable** (conditions de sortie `- [ ]`, chacune nommant une PREUVE — **format + règles : voir `RUN-template.md`, la source unique** ; `disposable` peut garder un critère d'une ligne — proportionnalité) · décisions délibérées · hypothèses énoncées · **surface d'impact** (existant affecté, cité) · **risques** (menaces sur le succès : gravité + mitigation) · **angles morts** (les inconnues inconnues du balayage de passe A) · questions ouvertes laissées à `terrain`. `## Contraintes` ne porte que les bornes de solution, chacune classée `HARD` ou `SOFT` avec sa source et la conséquence d'une violation ; ne duplique pas le `Scope OUT` du gabarit. **Petite rétro** : quels signaux sont apparus ce run → ajuste les seuils pour que la prochaine fois morde plus tôt.

**7. Registre de confiance — rien de porteur ne sort de cette skill sans vérification** (garde anti-hallucination ; DERNIER geste de la passe A, après que `## Besoin` est écrit). Liste chaque affirmation sur laquelle le besoin cadré **REPOSE** : ce qui existe, le nom d'un fichier / d'une API / d'un drapeau / d'une table, le comportement actuel de quelque chose, ce qu'une contrainte dit vraiment. Marque chacune avec exactement une valeur :
- **VÉRIFIÉE** — NOMME l'artefact hors-modèle qui l'établit, ouvert ou exécuté **cette session** : un `file:line` que tu as réellement lu, une commande + son code de sortie, un résultat de requête. Un chemin cité sans l'avoir ouvert n'est pas vérifié.
- **DE L'UTILISATEUR** — il l'a énoncée. Elle porte son autorité, pas la tienne ; si elle se révèle fausse, c'est une correction visible, pas une correction silencieuse.
- **NON VÉRIFIÉE** — déduite, remémorée ou supposée. Inclut tout ce qu'une note de mémoire ou un run passé t'a dit (une preuve datée prouve ce qui était vrai À SA DATE).

Ensuite **résous, n'annote pas** : chaque affirmation NON VÉRIFIÉE dont le travail en aval DÉPENDRAIT est tranchée AVANT la passation — lis le fichier, lance la sonde, grep l'appelant. Pas « réfléchis-y plus fort » : un vrai contrôle. Seulement si elle ne peut pas être tranchée sans l'utilisateur (son intention, un contexte privé) elle devient UNE question remontée ; seulement si elle ne peut pas être tranchée du tout elle devient une **hypothèse énoncée dans `## Besoin` + un risque avec sa mitigation** — jamais un acquis silencieux. Écris le résultat dans RUN.md sous `## Confiance`.

**Pourquoi ce n'est PAS « note ta confiance »** : la certitude auto-déclarée est le seul signal qu'une hallucination laisse intact — un nom d'API inventé paraît exactement aussi solide qu'un vrai, donc l'introspection ne peut pas les séparer. Ce qui les sépare n'est pas le ressenti, c'est le **reçu**. La question n'est donc jamais « est-ce que j'en suis sûr ? » mais « **quel artefact le dit, et est-ce que je l'ai ouvert ?** ». Une affirmation sans reçu est non vérifiée par définition, si évidente soit-elle — et « ça paraît évident » est une raison de vérifier, pas de sauter le contrôle.

**Les affirmations les plus susceptibles d'être inventées sont les plus banales** : un nom de drapeau ou d'option, un chemin de fichier, une signature de fonction, un nom de colonne, une valeur par défaut, une version, « les tests couvrent déjà ça ». Les grandes affirmations d'architecture sont scrutées ; les petits faits passent au travers — et un seul nom de chemin faux suffit à lancer tout un build sur une route qui n'existe pas.

**Répéter n'est pas vérifier.** Une fois qu'un fait inventé est écrit dans le RUN, chaque étape suivante le relit comme établi, et le cadrage devient sa propre source. Le registre se construit contre des ARTEFACTS, jamais contre ta propre prose antérieure.

**Plafond par régime** : `disposable` = les seules affirmations porteuses · `standard` = chaque affirmation de `## Besoin` · `critical` = toutes, plus une relecture adversariale demandant « laquelle de celles-ci NE pourrais-je PAS prouver à quelqu'un qui doute de moi ? ».

---

### Entre les passes — chemin forcé ou choix ouvert ?

Une fois `## Besoin` écrit, tranche : le besoin cadré laisse-t-il un vrai choix de COMMENT encore ouvert (quelle architecture / bibliothèque / motif), ou un seul chemin évident tombe-t-il des contraintes ?

- **Chemin forcé**, OU famille de déclencheurs (a) seule, sans question de conception → **saute la passe B**, passe directement à `terrain`.
- **Vraie bifurcation** (un choix ouvert demeure), OU famille de déclencheurs (b) (« quelle approche », « compare », « explore les options ») → **joue la passe B**.

---

### Passe B — les options (SEULEMENT s'il reste un choix d'approche ouvert ; sinon saute)

**1. Génère** par lentilles d'approche (ENGINE ch.1 : MVP · robuste · perf · frugal · réutiliser-l'existant · créatif · coût-d'abord · UX-d'abord · convention · contrarien), boucle jusqu'à épuisement, **déduplique par idée centrale**.

**2. Note** en mode CLASSEMENT (ENGINE ch.2) : critères typés, la fidélité en veto éliminatoire (~0 disqualifie), somme pondérée après veto ; 2 tirages décorrélés sur les dimensions subjectives, médiane puis MIN. (Cette somme pondérée est le calcul INTERNE de l'ordre — PAS ce qui est montré : l'AFFICHAGE à l'humain expose Impact ⊥ Effort en axes séparés, jamais une note unique effondrée — règle d'affichage ENGINE ch.1, voir étape 5.)

**2b. Approfondir ou élargir, de façon adaptative** *(pilote inspiré d'AB-MCTS — une DÉCISION guidée par les notes, portant sur les actions EXISTANTES des étapes 1 et 3 ; réutilise les notes `gg-1` de l'étape 2, AUCUN nouveau notateur ; **`disposable` → saute cette étape**)* : APRÈS l'étape 2, lis la distribution des notes et prends UNE décision d'aiguillage avant de finaliser — **tête nettement dominante → STOP** (la vraie nouveauté : sortie anticipée directement vers l'étape 3, aucun tour supplémentaire) · **tête prometteuse mais brute → APPROFONDIR** : passe par les greffes de l'étape 3 (ne coupe pas vers la finalisation) · **notes basses / groupées, aucun gagnant → ÉLARGIR** : rentre à nouveau dans la boucle de l'étape 1 avec des lentilles PLUS divergentes (ses plafonds ~12 candidats / 2 tours à vide tiennent toujours). APPROFONDIR/ÉLARGIR n'ajoutent AUCUNE action nouvelle — ils aiguillent vers les étapes 3/1 ; seule la sortie anticipée STOP est nouvelle. **Plafond ≤ 1 tour supplémentaire** — étape 1 (ÉLARGIR) OU étape 3 (APPROFONDIR), jamais enchaînés. *(exemple travaillé : notes 88/52/49 → tête dominante → STOP · 70/66/61 → groupées, aucun gagnant → ÉLARGIR · 84/80/55 → tête brute contre un second solide → APPROFONDIR.)* Les seuils (dominante / groupées) relèvent du jugement — la note guide, elle ne verrouille pas. *Réserve : la supériorité sur un simple coup unique est une HYPOTHÈSE, non prouvée (la valeur d'une politique de boucle est difficile à mesurer hors modèle).*

**3. Top-K (3–5)** avec compromis + greffes des meilleures parties des options écartées.

**4. Contrôle d'angles morts entre options** — un cas du besoin que AUCUNE option du top-K ne couvre est un trou de couverture, pas un détail de classement. Note-le dans `## Options` (libellé `Cas non couvert`) ; s'il implique une option réellement distincte, ajoute-la avant de finaliser le classement — ne laisse pas le tableau la masquer.

**5. L'humain tranche.** Présente le classement **avec Impact ⊥ Effort exposés en deux axes séparés** (règle d'affichage ENGINE ch.1 — jamais une note unique effondrée ; une option à fort impact reste visible même si elle coûte cher) et laisse-le choisir. Seulement sur un « décide pour moi » explicite, tu prends la mieux classée et tu dis pourquoi.

**6. Écris `## Options`** — ≥ 3 options notées et réellement distinctes (le contrôle d'arrêt ⚓ ANTI-FIXATION le vérifiera avant toute décision engagée ; des options de paille sont un défaut) + une ligne `Décision:`.

---

### Fini
Passe la main à `terrain` (le régime se propage par l'en-tête du RUN). **Ne rapporte JAMAIS « fini »** tant que `## Besoin` + `## Contraintes` + `## Confiance` (et, si la passe B a tourné, `## Options` + `Décision:`) ne sont pas réellement écrits dans RUN.md. **Un cadrage portant une affirmation porteuse NON VÉRIFIÉE et non résolue n'est pas fini** — le passer lance tout le pipeline sur un peut-être.

## Ce que ça produit

Les sections `## Besoin` + `## Contraintes` + `## Confiance` dans RUN.md — toujours. Quand le besoin touche une entree utilisateur, `## Besoin` porte en plus `### Cas limites d'entree` (>= 3 cas) ou une dispense motivee — verifie par `scripts/frame-cas-limites-check.mjs` (exit 0 exige). La section `## Options` + la ligne `Décision:` dans RUN.md — seulement si la passe B a tourné. Le tout écrit dans l'unique fichier RUN vivant ; jamais dans des fichiers besoin/options/registre séparés.

## À ne pas faire
- **Proposer un COMMENT** pendant le cadrage de la passe A — cela te fait basculer de la production à la réaction.
- **Sous-traiter les questions d'analyse** en faux-QCM — va chercher toi-même.
- **Jouer le protocole lourd** sur un one-shot manifestement trivial + jetable + déjà précis — dis-le, propose l'implémentation directe.
- **Prétendre « fini »** avant que `## Besoin` (et `## Options` + `Décision:` si la passe B a tourné) soient écrits dans RUN.md.
- **Passer un besoin qui décrit une ENTRÉE sans énumérer ses cas limites** — mesure hors modele : 0 vert sur 3 contre 3 sur 3. Lance `node scripts/frame-cas-limites-check.mjs <RUN.md>` ; exit 1 = le cadrage n'est pas fini.
- **Accepter le brouillard** — trois-riens à la suite → recadre.
- **Passer un cadrage portant une affirmation porteuse NON VÉRIFIÉE non résolue** — le pipeline construit alors sur un peut-être. Vérifie-la, remonte-la, ou écris-la en hypothèse énoncée + risque. Ne la laisse jamais ressembler à un fait.
- **Rapporter un RESSENTI de confiance** (« je suis assez sûr que X existe ») à la place d'un reçu — nomme l'artefact que tu as ouvert, ou marque-la non vérifiée.
- **Utiliser pour** : préparer le COMMENT de l'exécution autonome (→ `terrain`) · juger un livrable (→ `judge`) · trouver QUOI faire quand aucune tâche n'est choisie (→ `scout`).

## Moteur et réflexes
- La mécanique partagée du réservoir — **salve parallèle, boucle jusqu'à épuisement, déduplication par idée centrale, les deux échelles /100 (impact ⟂ confiance-en-autonomie), le filtre auto-répondre-ou-remonter, le schéma `gg-1`** — est CANONIQUE dans `_engine/ENGINE.md` **ch.1 GENERATE & GATE** (génération de questions) et **ch.2 JUDGE** (sa mécanique de notation et de classement, réutilisée pour la passe B). En cas de divergence, le moteur gagne.
- Ancrage de réflexe : **la solution déguisée = piège n° 1** — remonte de « crée/ajoute/fais X » au vrai problème avant de cadrer quoi que ce soit. Et **vérifie ce qui EXISTE avant de cadrer** (surtout docs/configs) : créer un doublon est le piège coûteux classique.

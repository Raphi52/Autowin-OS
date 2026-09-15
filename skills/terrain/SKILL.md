---
name: terrain
description: >-
  Étape 2 du pipeline (frame → terrain → build → clean → judge) : depuis un besoin cadré dont
  l'approche est tranchée, PRÉPARER LE TERRAIN D'AUTO-CORRECTION avant le travail autonome — (1)
  OBSERVABILITÉ (captures + logs pour boucler sur la sortie réelle), (2) l'ENVIRONNEMENT / la
  technique, (3) l'ÉTAT de reprise — et CONSTRUIRE le harnais s'il manque ; PLUS la spécification de
  boucle dont l'exécutant a besoin (signal par incrément, carte de découpage, plafonds de coût,
  point de reprise vert, câblage besoin→boucle→judge, pilote /goal armé à la passation). À utiliser
  quand un travail autonome va démarrer et que le COMMENT de la boucle doit être préparé d'abord (§
  Quand la déclencher). PAS pour cadrer le besoin ou choisir l'approche (→ `frame`), PAS pour jouer
  les mécaniques de boucle — découpage, TDD, incréments APPARTIENNENT AU MOTEUR (ch.4 BUILD) — ni
  pour juger le résultat (→ `judge`).
---

# terrain — préparer le terrain d'auto-correction (étape 2)

## À quoi ça sert
**Rendre le terrain prêt pour que Claude travaille de façon AUTONOME et se corrige lui-même — AVANT que la boucle démarre.** Un besoin
cadré avec une approche tranchée ne suffit pas pour tourner seul : Claude doit pouvoir VOIR sa propre sortie réelle
(captures + logs), tourner dans le bon environnement, et reprendre après une interruption. Terrain installe cette
observabilité + le harnais + l'état de reprise (en construisant ce qui manque) pour que la boucle autonome attrape ses propres erreurs
au lieu de tourner en aveugle.

## Quand la déclencher — et quand NON
**Déclencheurs** : « prépare le workflow / le terrain » · « comment Claude va boucler / récupérer ses captures et ses logs » · « mets en place l'auto-correction / l'environnement de travail autonome » · « fais tourner Claude seul jusqu'au bout ». Surtout sur un projet ou un PC où ce harnais n'existe pas encore.
**Chaîne** : APRÈS `frame` (besoin cadré, approche tranchée) et AVANT la construction, puis `clean`, puis `judge`.
**PAS pour** : cadrer le besoin ou choisir l'approche → `frame` · exécuter les mécaniques de boucle elles-mêmes (découper et exécuter un plan, TDD, incréments guidés par les tests) → ENGINE Ch.4 BUILD, le manuel de l'exécutant : AUCUNE skill ne se déclenche pendant la construction · juger le livrable fini → `judge`.

## Procédure

1. **Lis le RUN.md d'abord** — l'en-tête `regime:`, `## Besoin`, et la ligne `Décision:` de `## Options`. L'approche choisie pilote le harnais : une approche en ligne de commande et une approche graphique exigent des observabilités différentes ; monter la mauvaise rend l'exécutant aveugle. Tu ne spécifies QUE le pont signal↔harnais propre à cette tâche ; les mécaniques génériques de boucle **appartiennent au moteur, ch.4 — BUILD**. Ne les respécifie jamais.

2. **Devis ex ante (une ligne, avant de verrouiller le régime)** : tours attendus × largeur de la salve × passes de juge → une fourchette grossière de jetons et de temps. Le curseur du régime appartient à l'humain ; ne le pose jamais en aveugle sans devis. En doute, **baisse + signale**, et note la correction dans `## Besoin`. *disposable* = terrain minimal pour vérifier un seul coup (pas d'empaquetage en skill) ; *standard* = terrain complet + la boucle du moteur (ch.4) ; *critical* = terrain complet + ≥ 1 source hors modèle (voir `judge`).

3. **Détecte les trois prérequis en parallèle** — en lecture seule, indépendants → lance 3 explorateurs dans UN seul message. Puis monte ce qui manque par étapes sérialisées, idempotentes et réversibles — **un seul constructeur pour le build, jamais deux en parallèle**. Confirme avant toute action lourde ou irréversible. Une boucle ne peut pas se corriger sans les trois :

   - 🔭 **OBSERVABILITÉ — le retour que la boucle lit.** *Comment l'exécutant voit-il l'effet RÉEL de son travail ?* Selon la technique : **UI** → capture après action, LUE par Claude (PrintWindow → PNG sur le disque ; cherche d'abord un script de capture existant). **Canaux qui capturent ET pilotent une UI, quand ils sont connectés cette session** (passe par le réflexe de contrôle graphique — MCP de bureau / navigateur / app web locale / script UIA) : un **MCP de contrôle du bureau** (par ex. windows-mcp : `Snapshot` = arbre UIA + capture + coordonnées, puis `Click`/`Type`) donne À LA FOIS l'observation et l'action dans une seule boucle ; une cible **navigateur** → les outils Chrome (`read_page` + capture comme signal, `navigate`/`computer` pour piloter) ; une **app web locale** → Preview (`preview_start` + capture/inspection) ; une app **opaque ou qui ne doit pas voler le focus** → un script UIA/FlaUI/PostMessage. Préfère le signal STRUCTUREL (arbre UIA) à la vision par pixels quand l'app en expose un. **Ligne de commande / service / traitement par lot** → logs + code de sortie ; **code / bibliothèque** → tests échec→succès (falsifiable) ; **données / SQL** → requête de vérification sur l'état produit ; **doc / plan / skill** → déroule UN cas concret de bout en bout. Deux points non négociables : **garantir la fraîcheur** — ne pilote jamais un binaire périmé, vérifie l'horodatage de l'artefact et reconstruis s'il est plus vieux que la source (un incident de binaire périmé a coûté des jours) ; et un **signal qui SE PROUVE TOUT SEUL** (moteur ch.2) : frais (artefact plus récent que l'action), non vide (N > 0 tests / log non vide / code de sortie 0 + stderr propre), lié à l'empreinte de CE run, avec un contrôle négatif (le contrôle échoue-t-il quand il le devrait ?).

   - 🖥️ **ENVIRONNEMENT / TECHNIQUE.** La pile, les commandes de build/exécution/test, où vivent physiquement les logs et les artefacts, ce qui fait foi. Si `frame` a déjà consigné sa reconnaissance dans le RUN.md — lis-la, ne rescanne pas ; ne comble que les trous propres au workflow (source du retour, geste de fraîcheur).

   - 📋 **ÉTAT DE REPRISE = le RUN.md lui-même.** Ouvre-le en `status: open` (le contrôle d'arrêt prend ensuite la main sur la clôture — ne pose jamais le vert pour lui faire plaisir). L'état vivant vit dans `## Journal` (événements ajoutés, jamais réécrits) et `## Reprise` (Objectif / Hypothèse / Tenté / Suite / Blocages + compteurs de tours) — c'est la reprise en 30 secondes après une compaction. Remplis l'en-tête `signal:` et, si possible, un **`signal-cmd:` IDEMPOTENT et sur liste blanche** — le contrôle le REJOUERA plutôt que de croire ton vert.

4. **Contrôle du livrable de prérequis + `## SOP`** : confirme que « retour via X, environnement Y, état via RUN.md » est explicite et que les artefacts sont montés. Écris ensuite le `## SOP` propre à la tâche sous la forme `action → commande/outil → signal attendu → repli/arrêt` ; renvoie au moteur ch.4, ne le duplique jamais.

5. **Signal par incrément** = un artefact d'observation réelle issu du harnais ci-dessus (capture lue, log + code de sortie, test vert, résultat de requête) — **jamais un texte auto-jugé**. C'est le pont qui rend la sortie jugeable. **Il doit reproduire le symptôme de l'UTILISATEUR TEL QU'IL LE VIT** (son scénario, sa vue, son critère de succès) — pas un substitut technique voisin. Si ≥ 2 étapes causales séparent le signal de l'effet terminal que l'utilisateur observe, ce n'est PAS un signal de clôture (cicatrice : « workers dispatched » passait au vert pendant que l'utilisateur voyait des tuiles noires en échec — le substitut était propre et totalement à côté).

6. **Pyramide de tests** : la logique pure en tests unitaires joués dans la boucle CHAUDE (quelques secondes) ; bout-en-bout / UI / intégration au contrôle final.

7. **Carte de découpage** pour le parallélisme (seulement quand les incréments sont réellement parallèles ; un livrable unique reste un flux simple) : annote chacun `{indépendant | dépend-de-X}` + son signal ; marque les **ressources partagées** (build / base / banc / port) et prescris l'**isolation** (copie de travail ou bac à sable par incrément) — un seul constructeur. Une carte de dépendances en série rend tout l'aval sériel ; maximise délibérément la proportion d'indépendants.

8. **Plafonds de coût** : global 12 tours (ajustable) + plancher de progrès **N = 3** (3 tours sans passage échec→fait et sans signal qui passe au vert → arrêt dur). Plus l'anti-destruction (opération irréversible → arrêt + confirmation/sauvegarde).

9. **Point de reprise vert + retour au dernier vert** : fige un vert NOMMÉ AVANT chaque incrément (commit/tag dans une **copie de travail jetable** — abandonner = jeter la branche). Sur une régression CONFIRMÉE, REVIENS au dernier vert et réattaque avec une autre hypothèse — n'empile jamais des correctifs sur un état cassé. Un vert multi-dépôts est un **TUPLE coordonné** (restaurer un seul dépôt ne restaure que la moitié du vert).

10. **Blocages → résolveurs en parallèle AVANT toute escalade** : dès 2 ou 3 approches distinctes épuisées, envoie des agents résolveurs avec des hypothèses orthogonales. N'interromps l'humain que pour un arrêt dur (destructeur, hors périmètre, hérité intouchable). **Anti-détritus** : nettoie le bac à sable à l'arrêt ; garde le livrable + le RUN.md.

11. **Arme le pilote `/goal` à la passation** *(natif Claude Code ≥ 2.1.139 ; décision validée par l'utilisateur le 2026-07-10)* — le contrôle d'arrêt BLOQUE une fausse clôture mais ne RELANCE pas le travail (les blocages du hook d'arrêt sont plafonnés à 8 d'affilée) ; `/goal` est le pilote de relance natif + le panneau de coût en direct (temps écoulé / tours / jetons — le réflexe de visibilité du coût). Arme-le à la passation, AVANT que la construction démarre : l'évaluateur juge chaque tour suivant, et la condition devient satisfiable dès que la première sortie de signal atterrit dans le transcript. **Compile la condition DEPUIS le RUN, jamais en texte libre** : le `signal:`/`signal-cmd:` + les items de la liste de sortie, chacun exigé comme preuve VISIBLE dans le transcript — l'évaluateur de `/goal` (un modèle rapide séparé) ne lit QUE le transcript et n'exécute rien, donc une condition bâclée avale un succès auto-déclaré ; aligne le pilote sur l'autorité du contrôle au lieu de créer un second juge. Garde la condition compilée sous 4000 caractères — compresse une longue liste de sortie à ses contrôles essentiels, ne concatène jamais le RUN mot pour mot. Gabarit :
    > `/goal Done ONLY when the transcript SHOWS: (1) <signal-cmd> executed with exit 0 AND its output visible (N>0 assertions displayed, not merely claimed), (2) the RUN.md at <path> at status: green shown via a read/tool result (not stated in prose) AND the end-of-turn accepted by the stop-gate (no BLOCK message after it), (3) <task's terminal artifact, e.g. post-action capture READ>. A "done" without these artifacts visible does not count — keep working.`
    **UNE seule condition par session** — avant d'armer, vérifie dans les Journaux de la session s'il existe un `goal armed =` antérieur sur un run encore OUVERT : réarmer le REMPLACE en silence (trace le remplacement dans les deux Journaux, ou n'arme pas et repose-toi sur le seul contrôle d'arrêt). L'armement se fait CÔTÉ UTILISATEUR (⚠️ l'armement par programme n'est pas vérifié — traite-le en pilote) : donne-lui la ligne prête à coller (« arme ça avant de me laisser boucler »). **Run non interactif** (`-p` / planifié / distant sans interface — personne à qui donner la ligne) → consigne `non armé : non interactif — contrôle d'arrêt + boucle ch.4 seulement` ; jetable sans RUN.md → `non armé : jetable, aucun RUN à compiler`. Trace `goal armed = <condition>` dans `## Journal` ; à la reprise de session la condition est restaurée — revérifie qu'elle correspond toujours au signal et à la liste de sortie du RUN (si elle a dérivé → réarme et retrace). **À la clôture (vert / fermeture dégradée) : fais lancer `/goal clear` par l'utilisateur, consigné dans le Journal** — une condition qui traîne fait juger (et relancer) par l'évaluateur un travail ultérieur sans rapport. **Pilote, jamais autorité** : `/goal` pousse, le contrôle d'arrêt certifie — l'évaluateur qui dit « condition remplie » n'est PAS un vert. **Garde de pilote** : au PREMIER run armé, observe CONCRÈTEMENT (coût/latence de l'évaluateur · est-il d'accord avec les décisions de blocage du contrôle · aucune relance après la clôture) avant de faire de l'armement le défaut ; consigne les constats dans `## Cicatrices`.

12. **Câble `clean` puis `judge` (étapes 4-5)** : après la preuve du build et la garde voisine, `clean` inspecte les résidus attribuables, rejoue le signal et prend l'empreinte du diff nettoyé ; passe ensuite le livrable + le chemin du RUN à `judge`. Un défaut de juge rentre à nouveau comme incrément, suivi encore de `clean`. Tout signal ajouté périme aussi la condition `/goal` armée — recompile-la et redonne-la (ou trace que la couverture est inchangée). Le plafond de cycles reste celui de `judge`. **N'empaquette en skill réutilisable QU'à partir de 2 récurrences** ; nomme-la `loop-<tâche>`, couvre le terrain + la spécification de boucle + les passations, puis teste son déclenchement.

## Ce que ça produit

À livrer à l'utilisateur — en **mots simples, aucun jargon interne** :

- Le régime confirmé + une **estimation d'entrée** (tours × temps, en gros)
- Le plan de boucle : comment Claude voit son résultat réel / l'environnement / comment il reprend
- Les artefacts de terrain montés (ou proposés, en attente de confirmation)
- La spécification propre à la tâche : signal · **découpage de la tâche** (parallèle contre séquentiel) · plafonds · point de reprise **dernier-état-qui-marche** · câblage vers le juge
- La passation explicite vers la construction (moteur ch.4) · la skill de boucle créée OU « aucune skill — jetable / non récurrent »
- La ligne `/goal` prête à coller (l'utilisateur l'arme au démarrage de la boucle) — ou « non armé : <raison> » (par ex. un run interactif court)
- Le chemin du RUN.md

Ne rapporte jamais « fini » sans un RUN.md **ouvert et rempli** (signal + Reprise) — la construction n'a pas encore commencé. **Exception** : un one-shot `disposable` peut n'avoir besoin d'aucun RUN — table des régimes du moteur + proportionnalité de `frame`.

**Ensuite : joue le travail** (selon le moteur ch.4 — BUILD), **puis `clean`, puis `judge`, régime propagé.**

## À ne pas faire

- **Cadrer le besoin ou choisir l'approche** — c'est le travail de `frame` ; terrain part d'une `Décision:` déjà tranchée.
- **Jouer les mécaniques de boucle** (découper/exécuter un plan, TDD, incréments guidés par les tests) — elles sont au moteur ch.4 BUILD, le manuel de l'exécutant ; aucune skill ne se déclenche pendant la construction.
- **Respécifier des mécaniques génériques de boucle** — seul le pont signal↔harnais propre à la tâche a sa place ici.
- **Nettoyer ou juger le livrable fini** — ce sont `clean` (étape 4) puis `judge` (étape 5).
- **Poser `status: green` pour satisfaire le hook d'arrêt** — le contrôle rejoue `signal-cmd` ; un faux vert bloque.
- **Monter deux constructeurs en parallèle** — des étapes sérialisées, idempotentes et réversibles seulement ; confirme avant toute action irréversible.
- **Inventer un plafond de cycles de juge** — le plafond de `judge` fait foi ; terrain ne le duplique pas.
- **Laisser `/goal` (ou son évaluateur) jouer l'autorité de clôture** — c'est un pilote de relance ; seule la preuve rejouée du contrôle d'arrêt (ou l'accord de l'utilisateur) clôt. Ne l'arme jamais pendant les phases de cadrage ou de QCM — uniquement à la passation vers la construction.

## Moteur et réflexes

Les mécaniques d'exécution de la boucle — découper en incréments porteurs de signal, rouge d'abord puis vert, envoi en parallèle, cadence anti-régression, débogage systématique, point de reprise et retour arrière — sont **canoniques dans `_engine/ENGINE.md` ch.4 BUILD**. Terrain prépare le terrain ; l'exécutant consulte le ch.4 pendant la construction. En cas de divergence entre cette skill et le moteur, le moteur gagne.

Convention d'espace de travail et liste blanche des `signal-cmd` : **moteur ch.3** (en-tête du RUN.md `status/regime/signal/signal-cmd/gate`, rédacteur unique, FLAKY, portée de session + repli historique). Fiabilité du signal (classes de preuve, auto-preuve) : **moteur ch.2**.

Chemin de l'espace de travail (porté par la session) : `~\.claude\runs\<session_id>\<subject>-workspace\RUN.md` — pose l'en-tête `session:`. Le hook d'arrêt installé lit le RUN.md et **bloque la fin de tour tant qu'un run est ouvert ou rouge** — ce contrôle hors modèle est la vraie autorité de clôture, pas toi.

Ancrage de réflexe : **le signal doit reproduire le symptôme de l'UTILISATEUR tel qu'il le vit** — un substitut à deux étapes causales de l'effet terminal n'est pas un signal de clôture.

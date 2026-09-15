---
name: kaizen
description: >-
  Boucle d'amélioration continue sur le COMPORTEMENT de Claude : transforme une session (par défaut
  la COURANTE), une conversation Autowin ou une INSTRUCTION INJECTÉE en éditions VÉRIFIÉES et
  AUTO-APPLIQUÉES sur le levier qui CAUSE le défaut — skills, prompts injectés par Autowin, reste de
  son code, outils, garde-fous, docs, Brain (§ « Tes leviers »). FINIR LA TÂCHE D'ABORD, puis
  LOCALISER la cible, AUDITER par lentilles comportementales en parallèle, DÉFINIR le comportement
  visé, CONSOLIDER en UNE cause racine localisée, ÉNONCER puis INTÉGRER les éditions soi-même et
  prouver la NON-RÉCURRENCE par rejeu (§ Procédure). Déclencher sur « kaizen this session », «
  analyse les defauts dans les comportements / injections », « audite tout Autowin ». PAS pour la
  QUALITÉ d'un livrable (→ `judge`), un défaut de code isolé (→ `build`) ni un besoin neuf (→
  `frame`) : kaizen vise le COMPORTEMENT, pas un artefact.
---

# kaizen — améliorer le système à partir de ses propres échecs (audit comportemental → énoncer → intégrer → vérifier)

## À quoi ça sert
**Faire APPRENDRE le SYSTÈME de ses propres échecs — pour que la même erreur ne revienne pas à la session suivante.**
Le critère d'acceptation est la NON-RÉCURRENCE, pas la lucidité : « ça ne doit pas se reproduire ». Un constat n'est
traité que lorsque la situation d'échec D'ORIGINE, rejouée contre le correctif installé, est désormais BLOQUÉE ou corrigée —
nommer le défaut, le comprendre ou écrire une règle à son sujet ne change rien tant que ce rejeu n'est pas montré. Transforme les
angles morts d'une session (défauts rencontrés par Claude, corrections données par l'utilisateur) en éditions VÉRIFIÉES et AUTO-APPLIQUÉES sur
le kit (réflexes de `src/main/constitution.ts` / garde-fous / skills / mémoire) qui changent le comportement FUTUR. Kaizen APPLIQUE ses propres éditions, chacune dans un commit DÉDIÉ et chacune adossée à une vérification hors modèle — le garde-fou est la réversibilité, pas une attente.
**ZÉRO QUESTION DE CONFORT (cardinal, mesuré le 2026-09-02 : « kaizen me pose plus de questions pour rien »).** Au moment où une question te vient — quelle session, quelle cible, quelle option de règle, « je peux éditer ? » — tu ne la poses PAS : tu prends l'hypothèse la plus probable, tu l'ÉCRIS en une ligne dans ta réponse, et tu continues. Une édition de kaizen est réversible d'un `git revert` : c'est ÇA le garde-fou, pas l'accord préalable. `ask` n'est légitime que si deux options mènent à des produits VRAIMENT opposés, qu'aucun élément du fil ne tranche, et qu'un choix par défaut serait coûteux à défaire. Sinon : décide, annonce, avance.

**L'audit ne remplace jamais le travail** : si une tâche utilisateur est encore en cours au moment de l'invocation, elle est TERMINÉE d'abord (livrée + vérifiée), l'amélioration comportementale vient ENSUITE, dans la même passe.

## Quand l'utiliser — et quand NON
**Déclencheurs** : « kaizen this session », « improve the kit from my recurring failures », « audit my habits / workflow / blind spots », « what do I systematically miss », « analyse les défauts dans les workflows / les conversations / les comportements / les injections », « audite tout Autowin », ou juste après qu'un motif d'échec récurrent apparaît dans la télémétrie de l'app.
**PAS pour** : la QUALITÉ d'un livrable ponctuel → `judge` · un seul défaut de code → `build` · cadrer un besoin neuf → `frame` · une skill manquante → `graft`. Kaizen vise le COMPORTEMENT et ses leviers, jamais un artefact précis.
**Cibles admises pour l'étape 1** : la session COURANTE (défaut) · une session passée NOMMÉE · un comportement nommé · une conversation Autowin (`conversation_read` / `conversation_search` / `retrospective`, jamais les transcripts seuls) · une INSTRUCTION INJECTÉE (prompt du cockpit, consignes de phase, `output-styles/*.md`) · un motif récurrent de télémétrie.

## Tes leviers — ce que kaizen a le DROIT d'éditer
Un défaut de comportement n'a pas toujours sa cause dans `skills/`. Avant de choisir un fichier, balaye
cette liste : la cause vit dans UN de ces sept leviers, et éditer le mauvais levier ne corrige rien.
Chemins relatifs au dépôt Autowin (vérifiés le 2026-09-02).

| # | levier | où | quand c'est LUI |
|---|---|---|---|
| 1 | **Skills** | `skills/<nom>/SKILL.md` (19 skills au 2026-09-03, compte relu : `find skills -name SKILL.md`), mécanique canonique dans `skills/_engine/ENGINE.md`, gabarit `skills/_engine/RUN-template.md` | la procédure elle-même est fausse/incomplète. Nouvelle skill → `graft` |
| 2 | **Code Autowin** (tout `src/**`, pas seulement les prompts) | **Prompts injectés au runtime — le cas le plus fréquent** : `src/main/chat-pilotage-prompt.ts` (prompt du cockpit), `src/main/phase-briefs.ts` (consignes de phase), `src/main/constitution.ts`, `src/main/intent-phase-routing.ts` (routage), `src/main/behaviour-composition.ts` et les six sources qu'il compose (`response-style.ts`, `pipeline-discipline.ts`, `context-files.ts`, `roles.ts`, `task-regime.ts`, `topology.ts`), `src/main/autowin-kaizen-context.ts` (ce que kaizen reçoit lui-même). **Mais le reste du code EST aussi ce levier** : la boucle d'orchestration et la reprise de session (`src/main/agent-pilot.ts`, pipeline de phases), les adaptateurs de modèles (`src/main/providers/*`), l'INTERFACE (`src/renderer/**`) quand le défaut est ce que l'utilisateur VOIT ou ne voit pas, le contrat partagé (`src/shared/**`), et la TÉLÉMÉTRIE (`activity/`, `causal-trace/`, `src/main/dashboards/*`) — matière première de kaizen : si elle mesure le mauvais signal, l'audit est aveugle | le comportement est FAUX parce que le CODE le produit — l'injection le demande, la boucle l'impose, l'écran le cache, ou la mesure le rate. L'injection est lue en DERNIER et gagne : aucune édition de skill ne la corrigera. **Ne rabats JAMAIS une cause de code sur une phrase de plus dans une skill** : c'est la rustine comportementale que ce tableau existe pour éviter |
| 3 | **Outils de l'agent** | `src/main/commands.ts` (déclaration ET texte de description de chaque outil) + les modules dédiés (`edit-file-command.ts`, `brain-query-command.ts`, …) | l'agent n'a pas le levier, ou la description de l'outil l'induit en erreur — un texte d'outil EST une injection de comportement |
| 4 | **Garde-fous déterministes** | `src/main/gates/*.ts` (`stopgate.ts`, `hooks.ts`), `src/main/hooks/*.ts` (`cablage-garde.ts`, `verify-replay-hook.ts`) (les hooks PowerShell d'un kit Claude Code externe ne sont PAS câblés ici : le seul hook déclaré dans `%USERPROFILE%\.claude\settings.json` est `amitel-brain-hook.ps1`) | il faut du CODE qui refuse tout seul — l'enforcement le plus fort, à préférer à une règle en prose |
| 5 | **Fichiers de comportement hors dépôt** | `%USERPROFILE%\.claude\settings.json`, **le fichier de contexte du dépôt courant** — chaîne de précédence `AGENTS.md` → `CLAUDE.md` → `.cursorrules`, **premier trouvé gagne, JAMAIS empilé** (`src/main/context-files.ts`, plafond 32 Ko) : si `AGENTS.md` existe, éditer `CLAUDE.md` ne change RIEN. Il n'existe aucun `AUTOWIN.md`. **La CONSTITUTION n'est PAS un fichier** : elle est en dur dans `src/main/constitution.ts` (elle a remplacé `resources/kit-soul.md`, supprimé) → c'est le **levier 2**, pas celui-ci. Plus les fiches `memory/` | réflexe global, local-machine, ou **règle que le PROJET dicte à l'agent** (`AGENTS.md` : conventions de build, interdits, périmètre de travail). Inventorie-les avec le scanner de comportements (`src/main/behaviour-files.ts` / vue Comportements) au lieu de deviner un chemin |
| 6 | **Documentation `.md` du dépôt** | `README.md`, `ONBOARDING.md`, `RUN.md`, `docs/*.md` | le savoir humain est faux/périmé, ou une install/étape manquante a causé le défaut. N'installe JAMAIS un réflexe ici : un `.md` de doc n'est pas chargé par l'agent |
| 7 | **Brain (savoir partagé)** | dépôt d'un candidat via `remember`, relecture via `brain_query`, côté code `src/main/brain-*.ts` (`brain-remember.ts`, `brain-retrieval.ts`, `brain-inbox.ts`, `brain-corpus-scope.ts`) | c'est un FAIT durable qui manquait, pas un comportement. Un fait au Brain part en candidat et n'agit pas tout seul : il ne remplace pas une règle câblée |

**Règles de levier.**
- **Levier ≠ liste de courses** : un défaut = le levier de sa CAUSE, pas les sept. Un correctif posé dans une skill alors que l'injection le contredit est un pansement.
- **Édition de CODE (leviers 2, 3, 4, 7-code)** : c'est un changement de projet, pas une édition de kit → `edit_file` sur le fichier réel, puis `verify` sur le test colocalisé (`src/main/<module>.test.ts`), et un commit dédié.
- **Édition de KIT (leviers 1, 5)** : les skills vivent DANS ce dépôt (`skills/<nom>/SKILL.md`) — l'édition est directe, il n'y a AUCUNE étape de propagation vers un kit externe. Après toute édition de front-matter, rejouer `src/main/native-registry.skill-description.test.ts`.
- **Ordre d'enforcement, du plus faible au plus fort** : doc `.md` < fait Brain < fiche mémoire < règle dure (skill/`AGENTS.md`) < prompt injecté (code) < garde-fou déterministe (hook/gate). **Le niveau se choisit sur la CAUSE, dès la PREMIÈRE passe — jamais par défaut sur le plus faible.** Si la cause est une injection qui dit le contraire → levier 2 (le prompt injecté), pas une phrase de plus dans une skill que l'injection écrasera. Si la cause est un défaut REJOUABLE par du code (un ordre d'appels, une preuve manquante, un fichier interdit) → levier 4, le garde-fou : une règle en prose sur un défaut mécanisable est une rustine, même bien écrite. La prose n'est le bon niveau que quand le défaut relève du JUGEMENT (quoi dire, quand demander, comment formuler) — dis-le alors explicitement. **Attendre une récidive pour monter d'un niveau est INTERDIT** : c'est faire payer la rechute à l'utilisateur pour un diagnostic qu'on pouvait faire du premier coup. Un rejeu qui montre le défaut persistant n'est donc pas le déclencheur de la montée, c'est la PREUVE qu'on avait mal choisi — et on ne réécrit jamais la même règle plus fort.

## Procédure
0. **FINIR LA TÂCHE D'ABORD (CARDINAL — ordre non négociable).** Kaizen arrive presque toujours PENDANT un travail : l'utilisateur signale un défaut de comportement sur la tâche qu'il est en train de faire faire. Cette tâche reste due. **Ordre imposé : (a) terminer la tâche demandée jusqu'à son résultat vérifié hors-modèle, (b) PUIS mener l'audit comportemental et installer les éditions, dans la MÊME passe.** Partir directement à l'audit — et rendre la main avec un kit amélioré mais la demande initiale non livrée — est un ÉCHEC, pas une priorisation : l'utilisateur perd son livrable ET doit redemander.
   - **Cas où il n'y a rien à finir** : l'invocation porte sur une session PASSÉE déjà close, ou sur un comportement/telemetry sans tâche en cours → passer directement à l'étape 1, en le disant en une ligne (« aucune tâche en cours — audit direct »).
   - **Un tour ANNULÉ n'est pas une session close (conv-526, 2026-09-13)** : quand le tour audité a été interrompu par l'utilisateur à cause d'un geste fautif (ex. app ouverte sur son écran réel), la tâche de ce tour — et la « tâche initiale » du fil si le message la rappelle — reste DUE. L'annulation vise le GESTE, jamais l'objectif. Kaizen installe le correctif du geste PUIS reprend la tâche par la voie corrigée. Si ta voie d'exécution ne peut pas la finir (run sans outils écran, par exemple), dis-le en tête du compte-rendu et nomme la reprise à faire : ne la passe jamais sous silence.
   - **Si la tâche en cours est elle-même bloquée** : nommer le blocage, puis auditer — un blocage ne se contourne pas en changeant de sujet pour l'audit.
   - **Ne pas fusionner les deux** : la correction de la tâche et l'édition du kit sont des commits SÉPARÉS (l'un corrige un artefact, l'autre change un comportement futur ; les mélanger rend le revert impossible).
   - **Clôture** : le compte-rendu porte les DEUX résultats — ce qui a été livré pour la tâche, puis ce qui a été installé pour le comportement. Un seul des deux = travail incomplet.
1. **LOCALISE la cible.** **DÉFAUT = la session COURANTE** — la conversation dans laquelle `/kaizen` est invoqué. Lis son PROPRE transcript sur le disque : `~/.claude/projects/<project>/<SESSION_ID>.jsonl` (+ `subagents/`, `tool-results/`), où `<SESSION_ID>` est l'identifiant injecté à chaque tour par le hook UserPromptSubmit (visible aussi dans tout rappel système `SESSION_ID=…`). Le transcript s'écrit au fil de la session, il est donc disponible en cours de route — pointe les lentilles d'audit sur CE fichier. Inutile de demander quelle session : « kaizen » tout seul = kaizen CELLE-CI. **NE DEMANDE JAMAIS quelle cible** — déduis-la de l'invocation, énonce la déduction en UNE ligne (« j'audite cette conversation — dis-moi si tu visais autre chose ») et avance. Autres cibles, seulement quand l'utilisateur les NOMME :
   - **une session PASSÉE nommée** — « kaizen la session X / la dernière que j'ai essayé de kaizener ». Retrouve-la par son premier prompt utilisateur, son sujet dominant, ou une bifurcation `kaizen`/`kaizen-past-session` antérieure. **Cite la preuve** (premier prompt + une ligne de sujet) en une ligne et audite immédiatement — n'attends pas de confirmation. Seulement quand deux sessions candidates collent également bien à la description, et seulement alors, demande laquelle. Avec un élément discriminant (un premier prompt dont il se souvient, un sujet), grep tous les `projects/*/*.jsonl` dessus.
   - **un comportement / une habitude / un jeu de skills nommé** — passe directement aux lentilles comportementales de l'étape 2.
   - **une conversation AUTOWIN, ou tout l'historique de l'app** — les conversations du cockpit ne sont PAS dans `~/.claude/projects/*.jsonl` : un transcript porte une session d'agent, une conversation porte ce que l'UTILISATEUR a vraiment demandé, corrigé et refusé. Lis-les avec les capacités de l'app — `conversation_read` pour un identifiant nommé, `conversation_search` pour retrouver le fil à partir d'une phrase, `retrospective` pour les événements causaux d'un tour (outils appelés, refus, verdicts, coût) et son RUN.md. « Kaizen tout Autowin » = un échantillon NOMMÉ ou CHERCHÉ, jamais toutes implicitement (981 conversations = ruineux). Un défaut que l'utilisateur a CORRIGÉ vit ici et nulle part ailleurs.
   - **un motif récurrent de télémétrie** — lis-le dans la télémétrie PROPRE à l'app (`.autowin-data/**/activity/*.jsonl`, `causal-trace/*.jsonl`, agrégés par `src/main/dashboards/kaizen.ts`). NOTE (vérifié le 2026-09-12) : le `gate-counters.jsonl` que ce module analyse n'a PLUS aucun producteur sur cette machine — les hooks PowerShell qui l'écrivaient ont disparu — donc un tableau de bord vide veut dire AUCUNE DONNÉE, pas « aucun problème ». Le motif EST la cible ; audite s'il s'agit d'une vraie habitude ou d'un bruit gonflé (le détecteur lui-même peut être le défaut).
2. **AUDITE — lentilles comportementales, lancées en parallèle.** Cette mécanique vivait dans `judge`
   sous le nom de « Mode B » et était invoquée depuis ici. C'était un DOUBLON : judge existe pour noter un LIVRABLE,
   kaizen pour améliorer un COMPORTEMENT, et les deux portaient la même liste de lentilles sous des règles de clôture OPPOSÉES —
   judge interdisait d'écrire quoi que ce soit, kaizen applique ses éditions. Retiré de judge le 2026-09-01, sa
   substance est passée ICI. Judge garde les audits de qualité ; une cible comportementale route vers kaizen.

   **Paramètre d'abord la cible** — choisis, SANS demander, entre (i) le comportement/workflow de Claude
   (le DÉFAUT : `/kaizen` est une boucle comportementale), (ii) une codebase, (iii) un jeu de skills. Déduis-le de
   ce dont l'utilisateur vient de se plaindre ; annonce le choix en une ligne pour qu'il puisse être corrigé. NE
   suppose PAS « le dépôt » — une mauvaise cible gâche toute la salve, mais une question posée pour rien
   gâche un tour À CHAQUE FOIS.

   **Précharge le « déjà couvert »** (cela remplace le tour 1 du registre) : le global de la machine,
   le fichier de contexte gagnant du projet s'il y en a un (chaîne `AGENTS.md` → `CLAUDE.md`, `src/main/context-files.ts`), l'index de mémoire automatique s'il existe,
   les skills installées. Injecte cela dans CHAQUE lentille pour qu'aucune ne re-signale du connu.

   **Lance 6 à 9 lentilles EN PARALLÈLE** (un seul message), diversifiées en modèles pour décorréler. Chacune rend 1 à 2
   angles morts NOUVEAUX — à fort impact, chacun avec un **ancrage falsifiable** cité depuis le transcript,
   le dépôt ou les scripts (jamais du raisonnement de salon), plus une gravité, une règle proposée et un
   point d'intégration. La liste des lentilles :

   - **Ancrage et honnêteté** — une affirmation faite sans l'artefact qui la trancherait.
   - **Communication et attention de l'utilisateur** — ce qu'il a dû relire, retaper ou aller chercher.
   - **Coût et efficacité** — tours et jetons dépensés au regard de ce que le livrable exigeait vraiment.
   - **État / reprise / capitalisation** — ce qui a été redérivé faute d'avoir été porté en avant.
   - **Périmètre et sur-ingénierie** — du travail fait que personne n'a demandé.
   - **Réversibilité et point de reprise** — un changement qu'on ne pouvait pas défaire en une commande.
   - **Erreur et échec silencieux** — une panne avalée au lieu d'être remontée.
   - **Sécurité / secrets / données personnelles** — quelque chose de sensible qui a voyagé là où il ne fallait pas.
   - **Usage des outils et idempotence** — un outil relancé en aveugle, ou dont le rejeu n'est pas sûr.
   - **Arrêt prématuré et itération** — la main rendue avant le résultat vérifié.
   - **Angle mort partagé par le modèle** — les hypothèses que TOUT le panel tient pour acquises (plafond
     du même modèle). Cette lentille est celle qu'un spécialiste seul ne peut pas fournir : garde-la à chaque tour.

   **Convergence** : reboucle avec de NOUVELLES lentilles jusqu'à ce qu'un tour revienne à vide ; **2 tours à vide = stop,
   plafond 3 tours**.

   **Réserve d'honnêteté du même modèle (OBLIGATOIRE)** : c'est un AUTO-audit — producteur = juge n'est pas une preuve.
   Marque les constats **non concluants** (« angle corrélé du même modèle — angle mort non exclu »)
   et fais remonter cette réserve dans le rapport. Elle ne bloque pas l'étape d'intégration : le garde-fou y est
   la réversibilité (un commit par édition), pas une illusion d'indépendance.

   **Deux familles de lentilles, pas une.** Les lentilles ci-dessus sont COMPORTEMENTALES et lisent un transcript. Un défaut du SYSTÈME ne s'y montre pas toujours, alors lance une seconde famille quand la cible porte des RUN ou des conversations — les **lentilles WORKFLOW/TOPOLOGIE**, qui lisent le `RUN.md` et la trace causale plutôt que de la prose :
   - **routage** — la phase réellement jouée contre celle que la demande appelait (un `build` sur un besoin non cadré, un `judge` alors qu'il restait du travail).
   - **dimensionnement de la salve** — agents dépensés contre la fourchette du régime ; un tour parallèle qui n'a rien rendu de neuf.
   - **armement des garde-fous** — un RUN clos en `green` avec une liste de sortie non cochée, un `signal-cmd` jamais rejoué, `gate: off` ou `disposable` sur un travail qui demandait un filet.
   - **économie de la boucle** — itérations judge→build, coût par tour, un rejeu de quelque chose déjà tenté (la rétrospective le montre).
   Chacune garde le même contrat : un ancrage falsifiable (le chemin du RUN + la ligne), une gravité, une règle proposée, un point d'intégration.

3. **DÉFINIS LE BON COMPORTEMENT (cible d'expérience) — avant de proposer la moindre règle.** Un défaut nomme ce qui S'EST passé ; il ne dit PAS ce qui AURAIT DÛ se passer. Pour chaque angle mort consolidé, écris le **comportement visé en une phrase, du point de vue de l'EXPÉRIENCE de l'utilisateur** : à cet instant précis, quelle aurait été la bonne réponse/action pour la personne devant l'écran (ce qu'elle obtient, quand, sous quelle forme, ce qui lui est épargné) — et ce qui rend ça bon (moins de friction, aucun tour perdu, rien à retaper, aucune affirmation fausse, la décision laissée là où elle doit être). Dérive la règle DE cette cible, jamais directement du défaut : une règle écrite contre un symptôme produit une interdiction (« ne fais plus X ») qui ne laisse à l'agent aucun comportement à jouer ; une règle écrite depuis la cible produit un RÉFLEXE (« au moment où X → fais Y »). Si deux comportements visés plausibles s'affrontent (répondre directement contre proposer un choix, agir contre demander), nomme les deux, tranche avec la raison, et consigne celui qui est écarté — une règle installée sur une cible non arbitrée est une devinette. Quand la cible touche quelque chose que seul l'utilisateur peut trancher (un goût, un arbitrage entre vitesse et contrôle), prends l'option qui lui coûte le MOINS de friction, installe-la, et dis en une ligne ce qui a été pris et quelle était l'alternative — l'édition est réversible, donc une question ne vaut son tour que si les deux options mènent à des produits vraiment opposés et que rien dans le fil ne les arbitre. Le rejeu de non-récurrence (étape 6) teste alors le comportement VISÉ, pas seulement l'absence du défaut.

4. **CONSOLIDE.** Déduplique entre lentilles ; fais remonter LA cause racine (ce qu'un spécialiste seul raterait). **Une cause racine DOIT être LOCALISÉE pour porter ce nom : `fichier:ligne` (ou la phrase exacte citée) de l'artefact qui PRODUIT le comportement — le prompt injecté qui dit le contraire, l'outil absent ou mal décrit, la règle qui ne se déclenche qu'après une récidive, le garde-fou qui n'existe pas. Une cause formulée sur l'esprit de l'agent — « l'agent n'a pas pensé à X », « il a manqué de rigueur », « le contexte était trop long » — est le SYMPTÔME reformulé, pas une cause : elle ne pointe aucun artefact, donc aucune édition ne peut la falsifier. Si l'audit ne parvient pas à localiser la cause, dis-le et ARRÊTE-TOI avant de proposer une règle** — une règle non localisée est un pansement quelle qu'en soit la formulation, et la clause transverse anti-pansement de la constitution l'interdit. Puis le tableau classé : `angle mort · ancrage · gravité · règle proposée · point d'intégration (garde-fou / règle dure de la constitution / mémoire / simplement su) · portée (global+miroir / local seulement / projet)`. **Arbitre** les lentilles — rejette un constat qui re-signale une décision délibérée ou qui exagère (tu vérifies l'artefact réel, jamais la parole d'une lentille). Énonce les réserves honnêtes (corrélation de la même IA — angles morts corrélés non exclus de façon indépendante).
5. **ÉNONCE les éditions — lisibles avant, réversibles après** (CARDINAL). Présente le tableau en mots SIMPLES : ce qui change, dans quel fichier, pourquoi là. C'est une DÉCLARATION, pas une demande d'autorisation. Elle existe pour que l'utilisateur puisse lire le delta et le révoquer, pas pour que kaizen attende. Un « 100 » producteur = juge n'est pas une preuve — c'est pourquoi chaque édition porte une vérification hors modèle et son PROPRE commit (vécu : « intrinsèque » conclu à tort 3 fois ; un commit dédié rend ça révocable en une commande).
6. **INTÈGRE — édite le kit pour changer le comportement FUTUR, tout de suite.** Le livrable EST l'édition. Avant de choisir un fichier, mène une **analyse de placement** explicite par constat — RAISONNE-la, ne la cherche pas, et fais apparaître le « pourquoi ici » dans le tableau d'énoncé. Trois axes : **PORTÉE** (ci-dessous), **ENFORCEMENT** (garde-fou câblé + règle > fiche de rappel — voir les puces), **FONDRE ou AJOUTER** (étendre/retirer avant d'ajouter — voir les puces).
   - **La PORTÉE décide du fichier ET du miroir éventuel** — l'axe le plus souvent raté :
     - **AVANT de choisir : QUI injecte l'agent que tu corriges ?** Sous **Autowin**, le CLI est lancé NU — `--setting-sources ""` (`src/main/providers/claude.ts:821`) → **aucun `CLAUDE.md`** utilisateur ni projet, aucun skill/hook CC hérité n'est chargé. Le comportement vient de `src/main/constitution.ts` + le brief de phase + le fichier de contexte du dépôt (chaîne `AGENTS.md` → `CLAUDE.md` → `.cursorrules`, **premier trouvé gagne**, `src/main/context-files.ts`). **Éditer `~/.claude/CLAUDE.md` ou un `CONSTITUTION.md` miroir ne change RIEN à un défaut observé DANS Autowin** — c'est une édition qui part à la poubelle, et le prochain kaizen re-trouvera le même défaut.
     - **global sous Autowin** (tout projet piloté par l'app) → `src/main/constitution.ts` (**levier 2, code** : édition + `verify` sur `constitution.test.ts` + commit dédié).
     - **global sous Claude Code nu** (sessions CLI hors Autowin) → `~/.claude/CLAUDE.md`. **VÉRIFIÉ 2026-09-12 : ce fichier n'existe PAS sur cette machine** (`%USERPROFILE%\.claude` ne contient ni `CLAUDE.md`, ni `hooks/`, ni `skills/`) — le choisir suppose donc de le CRÉER, et n'a de sens que si le défaut a été observé HORS Autowin.
     - **local** (CETTE machine seulement) → même fichier absent, même réserve : hors Autowin uniquement.
     - **projet** (un dépôt donné) → le fichier de contexte **gagnant** de ce dépôt, vérifié et non supposé : si `AGENTS.md` existe, éditer son `CLAUDE.md` voisin ne sert à rien. `D:\AutoWinOS` n'a AUCUN des trois au 2026-09-11 — un réflexe « projet » y exige donc de CRÉER `AGENTS.md`, ou de passer au levier 2.

   Associe ensuite la nature du correctif au fichier (la **carte des cibles**), à la portée décidée ci-dessus — la liste COMPLÈTE des cibles possibles est le tableau § « Tes leviers » ; balaye-le avant de te rabattre sur `skills/` ou `CLAUDE.md` :
   - **un réflexe déclenché / une règle dure** → sous Autowin : `src/main/constitution.ts` (levier 2) si le réflexe vaut partout, sinon l'`AGENTS.md` du dépôt visé. Hors Autowin seulement : `CLAUDE.md` (+ `CONSTITUTION.md` **seulement si global**). **Ne les édite jamais « aussi, au cas où »** : le CLI est lancé sans eux.
   - **un garde-fou automatique et déterministe** → un **gate dans le code Autowin** : `src/main/gates/*.ts` (`stopgate.ts`, `hooks.ts`) ou `src/main/hooks/*.ts` (`cablage-garde.ts`, `verify-replay-hook.ts`), câblé via `src/main/hooks/default-gate-hooks.ts`. C'est le correctif le plus FORT — du code qui se déclenche tout seul.
   - **un comportement de workflow ou de skill** → le `skills/<x>/SKILL.md` concerné (ou une nouvelle skill).
   - **une instruction INJECTÉE — le prompt propre à l'app, pas celui du kit** → le texte qu'Autowin injecte au runtime : le prompt système du cockpit, les consignes par phase, `output-styles/*.md`, les rappels rejoués et les blocs de connaissance récupérée. C'est une cible RÉELLE et souvent ratée : un comportement peut être faux parce que l'injection le dit, et aucune édition de `skill` ne le corrigera — l'injection est lue en DERNIER et gagne. Ancre le constat sur le TEXTE injecté cité mot pour mot, localise son émetteur dans le code de l'app (`find_in_files` sur la phrase citée), et traite le correctif comme un changement de code, soumis au signal propre au projet — pas comme une édition de kit.
   - **une nuance de simple rappel** → une fiche `memory/` + l'index `MEMORY.md`.
   - **un OUTIL manquant ou trompeur** → `src/main/commands.ts` (levier 3) : la déclaration de l'outil ou son TEXTE de description. Un outil que l'agent croit absent, ou décrit de travers, produit un défaut que nulle règle ne rattrape.
   - **un FAIT durable qui manquait** → le Brain via `remember` (levier 7), jamais un réflexe : un fait n'agit pas tout seul, il part en candidat.
   - **une doc HUMAINE fausse ou périmée** → `README.md` / `ONBOARDING.md` / `docs/*.md` (levier 6) — documentation seulement : n'y installe aucun réflexe, l'agent ne les charge pas.

   Puis :
   - **Préfère un déclencheur CÂBLÉ** (un hook/gate + une règle dure dans la source RÉELLEMENT injectée — `constitution.ts` sous Autowin) à une fiche de mémoire passive — charger ≠ appliquer (une fiche fraîche a été violée deux fois dans la même session). Fiche mémoire = renfort, pas l'enforcement principal.
   - **Édite sur le VRAI fichier** (lis-le d'abord — n'édite jamais sur le rapport d'un sous-agent), chirurgicalement, sur ce qui est NOMMÉ. Ne redessine pas au passage des mécanismes délibérés et durcis (ce serait un correctif à l'aveugle — signale-le dans le tableau de clôture comme un point de conception, sans rien demander).
   - **Élague ou remplace, ne te contente pas d'ajouter (kaizen 2026-06-19)** — la constitution et la mémoire ont un budget d'attention FINI (charger ≠ appliquer). Tout réflexe ou fiche AJOUTÉ doit se FONDRE dans un existant (étendre une clause) ou RETIRER/fusionner un périmé — jamais faire proliférer un numéro de plus pour ce qu'un réflexe existant cadre déjà. Un nombre de règles qui grossit dilue l'attention portée à TOUTES les règles ; préfère une clause resserrée à un nouveau réflexe.
   - **VÉRIFIE chaque garde-fou édité hors modèle** via son test colocalisé (`src/main/gates/<nom>.test.ts`) rejoué avec `verify` : il doit SE DÉCLENCHER sur l'entrée fautive et rester SILENCIEUX sur un contrôle négatif — c'est ce contrôle négatif qui attrape un garde-fou devenu passant. Ajoute le cas manquant à ce test plutôt que de te fier à une lecture.
   - **Aucune étape de propagation** : les skills vivent DANS ce dépôt (`skills/<nom>/SKILL.md`) et sont lues depuis là — une édition est vivante immédiatement. Après avoir touché un front-matter, rejoue `src/main/native-registry.skill-description.test.ts`.
   - **PROUVE LA NON-RÉCURRENCE (CARDINAL — le test de clôture)** : pour CHAQUE édition installée, reconstruis la situation exacte qui a produit le défaut (l'ancrage cité transformé en entrée : même charge de hook, même forme de prompt, même configuration de RUN/garde-fou) et rejoue-la. Le correctif ne tient que si le rejeu est désormais REFUSÉ / corrigé / signalé, ET qu'un contrôle négatif censé rester silencieux passe toujours. Un correctif qui se lit seulement bien, ou dont le scénario d'origine ne peut pas être rejoué, est déclaré comme tel (« non rejoué ») — jamais comme traité. Si le rejeu reproduit encore le défaut, l'édition est INSUFFISANTE : monte d'un cran d'enforcement (fiche → règle dure → hook câblé) au lieu de réénoncer la règle.
   - **Boucle la boucle** : ajoute la ligne JSONL obligatoire à `.autowin-data/kaizen-treated.jsonl` (schéma dans **Ce que ça produit**).

## Ce que ça produit
Le livrable est le tableau d'ÉNONCÉ (présenté en mots SIMPLES) + les éditions intégrées elles-mêmes, un commit chacune, + la ligne de journal de bouclage.

**Tableau d'ÉNONCÉ** — classé, une ligne par angle mort consolidé :

| angle mort | ancrage | gravité | comportement visé (expérience) | règle proposée | point d'intégration | pourquoi ici (portée) |
|---|---|---|---|---|---|---|
| ce qu'un spécialiste seul raterait | citation exacte + ligne du transcript | grav. | ce qui AURAIT DÛ se passer, vu de l'utilisateur | la règle à installer, dérivée de cette cible | garde-fou / règle dure de la constitution / mémoire / simplement su | global+miroir / local seulement / projet — + la raison en une ligne |

**Schéma obligatoire de `kaizen-treated.jsonl`** — ajoute UNE ligne à `.autowin-data/kaizen-treated.jsonl` par signal traité :
`{"gate":"<fix-gate|anti-flaky|stop>","treatedCount":<compte au traitement>,"ts":"<iso>","note":"<ce qui a changé>"}`
`gate` + `treatedCount` sont OBLIGATOIRES : ce sont eux qui permettent à une passe ultérieure de distinguer un signal TRAITÉ d'un signal frais, et de ne le rouvrir que si le compte remonte (≥ +5). Une ligne à laquelle il en manque un fait resurgir le même constat pour toujours.

**Fini** — récapitule en mots simples : **d'abord le résultat de la TÂCHE terminée (étape 0) avec sa preuve**, puis la cause racine, ce qui a été intégré + où, ce qui a été VÉRIFIÉ (le signal hors modèle), **le rejeu de non-récurrence par édition** (situation rejouée → résultat : bloqué / corrigé / non rejoué), les réserves. **Ne rapporte JAMAIS « intégré/fini »** sans l'artefact de vérification. Le filet, c'est le journal des commits : chaque édition révocable seule.

**Condition de clôture — EXERCE LE CHEMIN MODIFIÉ DANS AUTOWIN OS LUI-MÊME.** Un kaizen n'est pas fini quand les fichiers sont édités : il est fini quand le comportement modifié a été JOUÉ dans l'app (invoquer la skill/commande touchée dans une vraie conversation, ou déclencher l'injection/le hook modifié à travers l'app), et que le résultat observé est rapporté ici en une ligne (`exercé : <ce qui a été joué dans l'app> → <ce qui a été observé>`). Si c'est vraiment impossible — l'app ne peut pas être pilotée depuis ce run, le chemin demande une action humaine que tu n'as pas —, NOMME l'empêchement et marque le résultat `non exercé`, jamais `fini`. Motif, mesuré sur conv-105 : les éditions de la tâche avaient été commitées et le contrôle de clôture refusait encore le run — « aucun /kaizen réel n'a été lancé » — parce que rien n'avait été tenté à l'intérieur d'Autowin OS.

## À ne pas faire
- **Abandonner la tâche pour faire l'audit** — kaizen invoqué au milieu d'un travail ne remplace pas ce travail : la tâche est finie et vérifiée d'abord, l'amélioration comportementale ensuite, dans la même passe. Rendre un kit amélioré et un livrable manquant est un échec.
- **Installer une règle sans avoir nommé le comportement visé** — une interdiction dérivée du symptôme (« ne fais plus X ») ne laisse rien à FAIRE à la place, et se fait violer à la session suivante. Nomme d'abord la bonne expérience utilisateur, puis écris le réflexe qui la produit.
- **L'édition silencieuse** — kaizen APPLIQUE, mais jamais de façon invisible : une édition qui n'apparaît pas dans le tableau d'énoncé, ou qui atterrit mêlée à un autre commit, est un défaut (l'utilisateur doit pouvoir la voir et la révoquer seule).
- **Improviser une liste de lentilles parallèle à chaque session** — la liste de l'étape 2 EST la mécanique ; étends-la explicitement, et dis-le, au lieu d'en redériver une chaque fois.
- **Croire une lentille sur parole** — arbitre ; rejette un constat qui re-signale une décision délibérée ou qui exagère ; édite sur le VRAI fichier, jamais sur le rapport d'un sous-agent.
- **Préférer une fiche passive à un déclencheur CÂBLÉ** — charger ≠ appliquer ; un hook + une règle dure valent mieux qu'une fiche de mémoire seule.
- **Déclarer un constat traité sans le rejeu de non-récurrence** — « ça ne doit pas se reproduire » est la barre : une édition dont le scénario d'échec d'origine n'a jamais été rejoué contre elle est « installée, non prouvée », pas traitée. Réénoncer une règle qui a déjà échoué une fois n'est pas une escalade.
- **Rapporter « intégré/fini »** sans la vérification hors modèle (`verify` sur le test colocalisé) ET la ligne de `kaizen-treated.jsonl` ET l'exercice réel du chemin modifié DANS Autowin OS (conv-105 : éditions commitées, contrôle de clôture en refus — « aucun /kaizen réel n'a été lancé »). Fichiers édités ≠ comportement exercé.

## Moteur et réflexes
- La notation et la mécanique de boucle sont CANONIQUES dans `skills/_engine/ENGINE.md`. Kaizen porte désormais l'audit COMPORTEMENTAL lui-même (étape 2 — absorbée de judge le 2026-09-01) plus son propre delta : la localisation de la cible, l'étape d'intégration auto-appliquée, et la contrainte d'un commit par édition. **En cas de divergence avec le moteur, le moteur gagne.**
- Contrainte cardinale (constitution, réflexe 14 — kaizen) : kaizen APPLIQUE ses propres éditions — diagnostic → éditions précises appliquées directement, chacune vérifiée hors modèle et commitée à part. Le garde-fou est la RÉVERSIBILITÉ, pas une attente d'accord.

## Les LOGS de conversation — la source de première main

L'app écrit sous `.autowin-data/<profil>/` quatre journaux par conversation. **Les lire est la
première main ; une sonde agrégée est la seconde.** Ils remplacent l'Observatory : ce que
l'Observatory affichait, ces fichiers le PORTENT, et eux se lisent sans ouvrir une vue.

| journal | un fichier par | ce qu'il porte |
|---|---|---|
| `activity/conv-N.jsonl` | conversation | `chat-usage` : `costUsd`, `durationMs`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `provider`, `model`, `reasoningEffort`, `label` (= le message utilisateur du tour) ; `conversation-route` : la phase choisie |
| `causal-trace/conv-N.jsonl` | conversation | `message`, `model-response`, `decision`, `injection`, `boundary`, `error`, `response-displayed` — l'enchaînement causal réel |
| `turn-journals/conv-N/` | tour | le journal fin du tour : appels, commandes, verdicts |
| `prompt-observability/conv-N.jsonl` | conversation | ce qui est réellement parti au modèle |

**Réflexe.** Au moment où la cible est une conversation NOMMÉE — et TOUJOURS avant d'écrire
« non mesurable », « pas de données » ou « corpus vide » —, ouvrir son `activity/conv-N.jsonl` et
son `causal-trace/conv-N.jsonl` avant de conclure. Une sonde agrégée a un corpus FIGÉ : les
conversations récentes ou en cours n'y sont pas encore, alors que leur journal, lui, est déjà écrit.

**Mesuré le 2026-09-01 (conv-27).** `scout:rendement` couvrait 25 conversations et ignorait
conv-27, conv-26 et conv-28 — les trois plus récentes. La procédure telle qu'écrite menait à
« hors corpus ». `activity/conv-27.jsonl` portait pourtant les 19 appels, $9,885 et 63,3 min qui
ont permis toute l'analyse. Coût de l'omission : l'analyse entière, ou un chiffre inventé.

**Garde-fous.** Lecture seule, jamais d'écriture sur ces journaux. Un tour à `costUsd = 0` est un
tour NON INSTRUMENTÉ, pas un tour gratuit : l'exclure des moyennes. Et un journal DIT ce qui a été
consommé, jamais si le livrable était bon — l'acceptation se lit dans le fil, pas dans le coût.

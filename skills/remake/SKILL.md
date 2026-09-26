---
name: remake
description: >-
  Récolte le recul que seul un produit FINI révèle, puis le dépense en PILOTANT TOUT LE PIPELINE.
  Lit le livrable achevé comme sa propre spécification, puis joue `scout` (avec la barre du REGRET,
  pas celle du défaut), `frame` sur chaque candidat retenu une fois le coût montré, puis `build` →
  `clean` → `judge` par besoin cadré, avant de rejouer le signal propre à la cible. Obligation de
  preuve INVERSÉE par rapport à `build` : aucun bug à reproduire, donc chaque changement doit
  prouver qu'il ne casse RIEN — remake REFUSE de tourner sans un signal qu'il peut rejouer.
  Déclencher sur `/remake`, « si tu devais le refaire », « refais-le mieux » (§ Quand la
  déclencher). PAS pour auditer si un livrable est correct (→ `judge`), travailler sur un livrable
  INACHEVÉ (→ `scout`), refaire l'ALLURE d'un écran (→ `draft`), retirer des résidus (→ `clean`), ni
  changer le comportement de Claude (→ `kaizen`).
---

# Remake — le second système, construit pour de vrai

## À quoi ça sert

Un produit fini révèle la forme qu'il aurait dû avoir. Des décisions prises dans l'incertitude sont maintenant
manifestement fausses ; une abstraction ajoutée par prudence s'est révélée inutile ; la structure a grandi par
accumulation. Cette lucidité n'existe **qu'une fois la chose faite**, et elle s'évapore. `remake` la récolte
et la dépense : il lit le livrable fini comme sa propre spécification, demande ce qui serait construit
autrement en repartant d'aujourd'hui, et **pilote tout le pipeline sur la réponse** — `scout` pour faire remonter les
candidats, `frame` sur chacun, puis `build` → `clean` → `judge`. Un seul geste au lieu d'un pipeline
piloté prompt après prompt.

**La barre est le REGRET de conception, pas le défaut.** `judge` trouve ce qui est *faux*, prouvable contre le
besoin. `remake` trouve ce qui *n'est pas faux mais s'écrirait autrement*. Confondre les deux transforme le goût
en obligation.

**L'obligation de preuve est INVERSÉE.** `build` prouve qu'un changement CORRIGE quelque chose — il y a un bug, donc
il y a un rouge→vert. `remake` n'a aucun bug à reproduire, donc ses changements doivent prouver qu'ils ne cassent
**rien** : une garantie plus dure, et celle qu'un simple « fais-le » ne fournit jamais. Tout ce qui est dans l'étape 0
existe pour rendre cette garantie réelle — un signal qui peut échouer et qui est réellement vérifié, vert avant et
après, et une seule annulation atomique. Pas de signal, pas de remake : une exécution autonome dont le seul filet n'existe pas est
la seule configuration où cette skill est nuisible. « Vérifié » a deux formes légitimes et pas de
troisième : un `signal-cmd` que le contrôle rejoue, ou un signal attesté sous `regime: critical`, le seul régime
où le contrôle en exige un.

## Quand la déclencher — et quand NON
**Déclencheurs** : `/remake` · « si tu devais le refaire » · « que ferais-tu différemment » · « refais-le mieux » · « avec le recul, comment tu l'aurais construit » · « remake this » · « rebuild it knowing what you know now » · ou juste après qu'un livrable est VÉRIFIÉ et qu'on veut solder les compromis accumulés. Unifie « si tu devais le refaire en analysant le produit fini, que ferais-tu différemment ? » suivi de « fais-le ».
**REFUS — un « refais-le mieux » NU, sans cible finie et vérifiée en vue, ne se route PAS** : demande D'ABORD DE QUEL livrable il s'agit. Les mêmes mots désignent aussi bien l'allure d'un écran (→ `draft`) que la conception d'un module (→ ici).
**PAS pour** : auditer si un livrable est correct ou fini → `judge` (sa barre est le DÉFAUT, pas le regret de conception) · choisir quoi faire quand le livrable n'est PAS fini → `scout` seul · refaire l'ALLURE visuelle d'un écran (→ `draft`), même si l'utilisateur dit « refais » · retirer les résidus de tentatives ratées → `clean` · améliorer le comportement de Claude ou les règles du kit → `kaizen`.
**Si la CIBLE est le kit, les garde-fous de code, `src/main/constitution.ts` ou la mémoire** : remake liste les regrets et S'ARRÊTE — il n'y écrit jamais tout seul (périmètre gelé, § 0).

## Procédure

### 0. Préconditions — et cette étape ÉCRIT

Cible = le livrable du RUN courant, sinon un fichier/module/dossier explicitement nommé. **Jamais tout
le dépôt implicitement** — cela donne un balayage superficiel à un coût ruineux. Trop grande à tenir ? Demande
quelle tranche ; ne survole pas.

**PÉRIMÈTRE GELÉ — contrôlé ICI, avant de dépenser quoi que ce soit.** Cible = le kit (`skills/**/SKILL.md`, `skills/_engine/ENGINE.md`),
les garde-fous de code (`src/main/gates/*.ts`), la constitution injectée (`src/main/constitution.ts`), ou la mémoire : produis la liste classée et **ARRÊTE-TOI**. Aucun `frame`, aucune phase, aucune
écriture. PREMIER contrôle, avant la salve de `scout`, parce que le kit est la cible `/remake` la plus probable :
placé plus tard, le garde-fou est falsifié par les agents déjà payés. Une skill qui réécrit ses propres
règles de façon autonome est ce que `kaizen` interdit, et l'interdiction ne se lève pas parce qu'une autre
skill le demande. Un accord humain la rouvre — pour les seuls fichiers nommés.

**L'étape 0 n'est PAS en lecture seule, et l'ordre ci-dessous est l'ordre sûr.** Elle crée un point de retour, elle
casse une ligne exprès, elle peut créer une copie de travail et une jonction. Les étapes 1-2 (scout, classement) sont celles qui sont
en lecture seule.

**0.a — Ancre l'état de départ D'ABORD.** Avant toute cassure délibérée, pour que rien ne puisse rester
cassé sans retour possible. L'**ancre** est un geste nommé, disponible même sur un arbre propre : consigner
le hash du HEAD de départ. La POIGNÉE de retour arrière — la liste énumérée de tes propres commits — n'existe
pas encore ; elle se constitue à l'étape 4 et se vérifie à l'étape 5. Ne la réclame pas ici.
  - **Attribue la saleté PAR FICHIER, et refuse le fichier co-sale.** Un arbre sale n'appartient pas automatiquement
    à quelqu'un d'autre : `git status`, `git log -3`, `git stash list` et le RUN de la session te disent
    à qui est chaque fichier. Les tiens → commite-les par leur nom (jamais `git add -A`). Mais un fichier portant TON édition
    ET celle, non commitée, d'une autre session est **co-sale** : `git add <fichier>` indexe son contenu tel
    qu'il est et avale le travail du voisin dans ton commit — qui entre alors dans la poignée de retour arrière,
    donc un revert à l'étape 5 le détruit, à ton nom. Un fichier co-sale ne se commite jamais : isole, ou
    demande. Sonde aussi une opération tierce EN COURS (`.git/MERGE_HEAD`, `index.lock`, un
    rebase ou un revert inachevé) : agir à l'intérieur la corrompt pour toutes les sessions sur l'arbre.
  - La saleté d'une autre session → **le remake ENTIER déménage dans une copie de travail isolée** : les étapes 0-5 s'y jouent
    toutes, signal compris, et ramener le résultat est un geste SÉPARÉ que l'utilisateur demande. Un
    point de retour dans une copie pendant que la construction se fait dans l'arbre principal restaure un état qui n'a jamais
    existé. Ni propre ni isolable → ARRÊT.
  - **Un arbre partagé devient sale APRÈS l'étape 0 — c'est le cas normal, et cela ne fait pas migrer le
    travail rétroactivement.** Ce qui déménage, c'est l'**instrument de mesure** : joue le signal dans une copie de travail jetable sur
    ton propre HEAD commité (`node_modules` monté par jonction — `cmd /c mklink /J <wt>\node_modules
    <main>\node_modules`), continue de commiter dans l'arbre principal, fichier par fichier. Cela achète la capacité
    de prouver qu'un rouge appartient à quelqu'un d'autre au lieu de le supposer.
  - **La poignée est une LISTE DE HASHES, jamais une plage**, et elle se vérifie sur le **contenu autant que sur
    la paternité** : `git log --oneline --no-walk <liste>` prouve qui les a écrits, pas ce qu'ils portent,
    donc `git show --stat <hash>` doit aussi tomber dans la liste de fichiers de la partition.
  - **Périmètre touchant un format PERSISTÉ ou un contrat externe → le retour arrière couvre aussi les DONNÉES.**
    Revenir sur du code ne dé-migre pas un fichier réécrit, et un champ que cette construction a cessé d'écrire
    peut être un champ que le binaire précédent EXIGEAIT. Sauvegarde le fichier avant la première écriture migrée, écris
    la procédure de restauration — y compris tout journal qui rejouerait des enregistrements post-remake par-dessus un
    instantané restauré — et lis l'étape 5 pour le garde-fou qui rend la restauration elle-même sûre. Pas de retour arrière
    sur les données, pas de remake sur ce candidat.
  - Cible hors git (un doc, un dossier) → le point de retour est une copie explicite, **bornée au
    périmètre du candidat et énumérant ce qu'elle EXCLUT** (au minimum les chemins ignorés par git et tout
    stockage vivant : les copier donne un instantané incohérent, coûte des gigaoctets, et le restaurer écraserait
    l'état vivant d'autres agents). Une copie = une annulation tout ou rien, donc les copies se font
    **par partition, après l'étape 2** — les partitions n'existent pas encore ici.

**0.b — Le signal doit satisfaire DEUX contraintes indépendantes, pas une.** C'est là que vit toute la
garantie, et là qu'elle est le plus facilement creuse. `stop-gate.ps1` applique les deux, dans cet ordre :
  1. **Il doit PROUVER** — `Test-MeaningfulProof` exige un lanceur de tests/build ou un script **en tête
     de la commande** (après avoir retiré un `cmd /c` initial). Échoue à ça et le contrôle ajoute
     *« signal-cmd ne PROUVE rien »* et BLOQUE tout vert, quoi que disent les tests.
  2. **Il doit être SUR LISTE BLANCHE** pour être rejoué tout court — `dotnet test`, `dotnet build`, `cmd /c`,
     `powershell [-NoProfile] -File`, `pwsh [-NoProfile] -File`. Hors de cette liste, le contrôle ne rejoue
     rien et tamponne quand même sa vérification.

  Deux contraintes, deux modes d'échec distincts, et une forme peut passer l'une en échouant l'autre.
  **Mesuré en jouant la fonction du contrôle elle-même :** `cmd /c "cd /d <abs> && npm test"` ne prouve RIEN
  (le `cd` est en tête) → BLOCAGE permanent ; `npm test` seul prouve, mais n'est jamais rejoué.
  Les formes qui satisfont les DEUX : **`powershell -NoProfile -File <abs>\signal.ps1`** (le script fait le
  `cd`, joue la suite, propage `$LASTEXITCODE`) — préfère celle-ci — ou
  `cmd /c "npm test --prefix <abs>"`.
  - **`signal-cmd:` est pour le REJOUABLE. Tout le reste va dans `signal-attestable:`** (moteur,
    fondation §1, en-tête) — une capture lue, une requête, un artefact lu par un humain, avec le contrat
    d'attestation que `clean` définit (artefact frais, empreinte de run, non vide, contrôle négatif). Une cible
    visuelle n'est pas une cible sans signal ; c'est une cible avec l'autre espèce de signal. **Et cela force
    `regime: critical`** : critical est le SEUL régime où le contrôle EXIGE une preuve hors modèle, donc
    un signal attestable porté en `standard` n'est vérifié par personne. Attestable mais pas critical → le
    refus s'applique, exactement comme s'il n'y avait aucun signal.
  - **Le plafond de vérification est réel.** Autowin arrête une vérification à `AUTOWIN_VERIFY_TIMEOUT_MS` (défaut **600 000 ms**, soit 10 min — `src/main/verify-command.ts:75`) et rend alors
    `exitCode: null` avec « vérification arrêtée après N s (plafond) » — PAS un code d'échec ordinaire. Durée mesurée au-dessus du plafond → le choix autonome par défaut est un SOUS-ENSEMBLE rejouable sous
    le plafond dans `signal-cmd:`, la suite complète portée en `signal:` attesté. Relever la variable n'est
    PAS une option autonome — c'est la variable d'environnement `AUTOWIN_VERIFY_TIMEOUT_MS`, persistée par l'UTILISATEUR
    (`setx`) et relue seulement via `reload_env`, donc cela exige un accord humain. Le silence ici devient une régression fantôme à l'étape 5.
  - **Chronomètre LA COMMANDE EXACTE**, pas un sous-ensemble : sa durée alimente la ligne de coût. Prends la commande
    canonique du dépôt (`npm test` et ce qu'il enchaîne) sauf si un périmètre plus étroit est justifié dans le RUN —
    un filet limité à vitest rate une régression de typage. La définition change ensuite (un candidat ajoute des tests, le
    périmètre s'élargit) → **rechronomètre et redis le chiffre**. Mesuré : un « 3 s » annoncé à l'étape 0 était encore
    cité comme « rejouer est gratuit » alors que chaque vrai run prenait 25 s.
  - **Signal instable → ce n'est pas un `signal-cmd:`.** Le contrôle rejoue UNE fois, sans reprise : une suite instable fait de
    la clôture du parent un pile ou face. Enveloppe le double run dans le script et pointe `signal-cmd:` dessus, ou
    porte-le en attesté. Alors un `degraded-closed` sur « instable, couleur confirmée hors du contrôle » est
    légitime.

**0.c — PROUVE que le signal peut passer au ROUGE — et traite la cassure comme l'acte dangereux qu'elle est.** Un signal
qui ne peut pas échouer n'est pas un filet. Mais ce sabotage tombe dans la seule fenêtre que la topologie laisse sans trace
(aucun RUN n'existe encore, donc aucun contrôle ne regarde), sur un arbre où d'autres sessions écrivent et qu'un surveillant peut compiler
en direct. Donc, dans l'ordre :
  1. **Inventorie les écrivains vivants** — surveillants, l'app en cours d'exécution, sessions concurrentes (le
     hook d'inventaire de sessions les signale déjà). L'un d'eux, ou un arbre partagé → **casse la ligne dans
     la copie de travail jetable de mesure**, jamais dans l'arbre qu'ils compilent. Une ligne délibérément cassée
     servie à l'utilisateur et aux mesures d'autres sessions est une contamination, et personne n'est prévenu.
  2. **Écris la trace AVANT la cassure** — chemin absolu du fichier + son hash de HEAD. C'est la seule
     écriture qui vaille dans cette fenêtre sans trace, et la seule chose qui permette une restauration après un
     plantage, une perte de contexte ou une interruption.
  3. Casse une ligne dans le périmètre, joue la commande de signal **directement** (pas à travers le contrôle —
     aucun RUN n'existe encore), regarde le rouge.
  4. **Restaure par commande, jamais de mémoire** : `git checkout -- <file>` (ou la copie, hors git). Puis
     un **point de contrôle bloquant avant toute autre chose** : `git status --porcelain <fichier>` vide ET le
     signal de nouveau vert. Saute-le et un sabotage résiduel devient indiscernable de l'édition d'un candidat —
     le rouge qu'il provoque est imputé à du travail sain, et l'étape 5 annule ce qui allait bien.

  Mesuré : un `tsc --noEmit` qui ne compilait rien (`files: []`) siégeait dans une liste de sortie comme filet de typage — un
  vert strictement vide. Signal attestable → la preuve du rouge est le **contrôle négatif** de l'attestation (un
  artefact délibérément faux soumis à la même lecture, tracé dans le RUN), pas un rouge en ligne de commande.

**0.d — Vert là où le remake tournera vraiment.** Si 0.a a déménagé dans une copie de travail, le vert mesuré
ailleurs ne compte plus : une copie ne porte ni les fichiers non suivis ni les fichiers ignorés (`node_modules`,
sorties de build, `.env`). Recapture-le là-bas, et exige le vert avant de continuer. Pas jouable ou pas
vert là-bas → ARRÊT ; ne retombe jamais en silence sur l'arbre principal. **Écris chaque `signal-cmd:` et
`check:` en chemin ABSOLU enraciné dans la copie** — le contrôle les rejoue depuis le cwd de la SESSION,
donc une commande relative tourne contre le mauvais code, et le mode d'échec qui compte est le FAUX
VERT sur du code que le remake n'a jamais touché.

**Topologie du RUN.** Chemin, en-tête et conventions de clôture : moteur ch.3 — non redit ici. Ce qui est
spécifique à remake :
  - Les étapes 0-2 n'ouvrent **aucun RUN** : le parent est créé à l'**étape 3**, une fois le coût accepté.
    Plus tôt, il resterait `open` pendant l'attente humaine de l'étape 2 et le contrôle bloquerait le tour même
    qui demande le feu vert. Une conséquence à garder en tête : la preuve que le contrôle REJOUE vraiment le signal
    exige un RUN qui le porte, elle ne peut donc pas avoir lieu à l'étape 0 — elle a lieu à l'étape 3, ci-dessous, avant toute
    phase. L'étape 0 prouve que le signal peut passer au rouge ; l'étape 3 prouve que le contrôle est armé. Deux preuves, deux
    moments, aucune optionnelle.
  - **Un RUN enfant par PARTITION DE COLLISION DE FICHIERS, pas par candidat.** Les regrets de conception se concentrent sur
    les mêmes fichiers par construction — c'est ce qui en fait des regrets. Mesuré : 10 candidats sur 12
    touchaient les deux mêmes fichiers. Groupe ceux qui se percutent, nomme la partition, séquence à l'intérieur ; seuls les
    candidats vraiment disjoints ont leur propre RUN. Suffixe `remake-<NN>-<slug>`, `NN` = rang dans le
    tableau des candidats. Un candidat abandonné à l'étape 2 n'ouvre aucun RUN enfant.
  - **`regime: standard` MINIMUM sur le parent et sur chaque enfant, et `gate: off` interdit sur le
    parent.** Les deux pour la même raison : ce sont la seule autorité hors modèle sur le remake.
    `disposable` désarme d'un coup le rejeu du signal, la règle des ≥ 3 options notées ET le blocage sur liste de sortie
    non cochée — chaque garantie que ce fichier présente comme un fait s'évapore sans un mot d'avertissement.

### 1. SCOUT — faire remonter les candidats, avec la barre du regret

Délègue la dérivation à `scout`. `remake` fournit ce que `scout` ne peut pas inventer — **la barre est le
regret de conception**, et la cible MARCHE déjà. Lance les lentilles en parallèle (moteur ch.1), déduplique par
idée centrale :

- **Structure** — ce qui vivrait ailleurs, serait scindé, ou fusionné.
- **Nommage** — ce qu'un lecteur doit décoder au lieu de lire ; les noms qui mentent sur ce qu'ils contiennent.
- **Abstraction inutile** — de l'indirection pour un cas qui n'est jamais venu : une interface à une seule
  implémentation, un alias pour un seul appelant, un hook que personne n'utilise.
- **Couplage** — ce qui en sait trop sur quoi ; le changement qui force trois éditions sans rapport.
- **Ce qui ne serait pas construit du tout** — la lentille la plus tranchante, et celle que personne ne joue.
- **Le squelette d'aujourd'hui** — esquisse ce que tu écrirais MAINTENANT à partir du seul besoin, puis compare au
  vrai. Garde-le à l'état d'esquisse : une reconstruction complète invente un squelette déconnecté des
  contraintes qui ont façonné le code.

Chaque constat nomme **l'observation qui attraperait sa régression** — sans elle, un audit ultérieur
ne peut pas distinguer le sûr du chanceux.

**Deux choses doivent être dites explicitement à `scout`, sinon la délégation rend le mauvais tableau.**

**(a) Son filtre de survie est REMPLACÉ, pas étendu.** `scout` ne garde un candidat que comme 🔧 correctif (un VRAI
défaut avec `file:line`) ou 🆕 nouveauté. Un regret n'est ni l'un ni l'autre — le code MARCHE, donc pas de défaut ; il
EXISTE, donc pas de nouveauté — et il meurt au filtre. Soit le tableau revient vide et `remake` conclut
« rien à refaire » alors qu'il n'a mesuré que son propre filtre, soit le regret est réétiqueté en défaut, ce que
cette skill interdit. Énonce le remplaçant : **♻️ regret — survit si et seulement si un vrai `file:line` + la forme
d'une ligne qu'il prendrait aujourd'hui + l'observation qui attraperait sa régression** — et demande que la colonne Type soit
étendue à ♻️, car un filtre sans colonne où atterrir fait réétiqueter ses regrets en 🔧.

**(b) Ses bras obligatoires sont DÉSARMÉS, y compris ceux qui se réarment seuls.** Le quota audacieux/ambitieux
injecte des fonctionnalités neuves qui ne sont pas des regrets ; la lentille SALLE BLANCHE refuse de lire le code
existant et contredit la prémisse de cette skill (le produit fini EST la spécification) ; le bras d'antériorité
web répond à une question que personne n'a posée. Nommer ces trois-là ne suffit pas : `scout` rallume le
bras audacieux par son étape **ÉLARGIR** (aucun candidat à fort impact n'a survécu — le résultat nominal quand la
cible MARCHE déjà) et par son **auto-contrôle** (chaque nouveau candidat ne fait que finir le prévu). Désarme
ces deux-là aussi, nommément, avec la règle de remplacement : *sur un tableau de regrets, l'absence d'un candidat
à fort impact est un résultat honnête, pas une moisson tiède, et ne déclenche aucun tour supplémentaire.*

Un bras qui se déclenche quand même et rend quelque chose de précieux sort du tableau de regrets et est remonté
séparément — il n'entre PAS à l'étape 3, et il n'est pas construit sous la bannière « ce que je ferais
autrement ».

### 2. Classer, puis MONTRER LE COÛT avant d'aller plus loin

Impact ⊥ effort, deux axes, jamais une note unique effondrée (moteur ch.1). Tout ce qui est retenu passe par
`frame`, donc **la longueur de la liste EST le prix**. Expose une ligne couvrant les deux coûts avant de t'engager :

- **Les agents, depuis un décompte NOMMÉ** — N lentilles + N cadrages + N chaînes + **N `terrain` if armed** (voir
  le contrat de dispatch : il est désarmé par défaut, et compté dès qu'il ne l'est plus). Compare le
  total à la fourchette d'agents du régime (`skills/_engine/ENGINE.md`) et au cumul de la session ; tout
  dépassement porte sa ligne de justification.
- **Les rejeux du signal × sa durée mesurée** — un par incrément de construction, un par `clean`, un à
  la clôture, **plus un rejeu du contrôle par RUN qui passe au vert** (parent + N enfants) **et
  chaque ligne `check:`**. Sur 6 partitions, cela fait 7 rejeux non comptés ; sur une suite de 20 minutes, c'est
  tout le budget.

Trois multiplicandes ne sont pas encore décidées à ce stade — le nombre d'incréments de construction, les
itérations judge→build, et le fait que `terrain` soit armé ou non. Donne-les en FOURCHETTE avec sa borne haute
montrée, et réserve « compté » aux termes réellement connus (lentilles, cadrages, partitions, la durée
mesurée du signal). Une fausse précision sur un terme indécidable n'est pas de l'honnêteté, c'est de la décoration.

Les deux chiffres sont **COMPTÉS, pas devinés** là où ils peuvent l'être : mesuré au premier vrai run, « ~50 agents » voulait dire environ 15
et « 3 s » voulait dire 25 — l'utilisateur a dit oui à deux chiffres faux. La réalité qui diverge de plus de ~2× pendant
que le remake tourne → **redis-le en cours de route**. Si le produit dépasse ce que vaut la cible, dis-le
et propose de rejouer à des jalons plutôt qu'à chaque incrément.

Puis **ARRÊTE-TOI et attends le feu vert** si le décompte dépasse ce que la demande impliquait, ou si la ligne de coût n'est
pas manifestement acceptable ; sinon continue et dis que tu l'as fait. « Un seul geste » veut dire que l'utilisateur ne
pilote pas chaque phase — pas que la facture arrive après coup.

**Un « non » ici est un vrai résultat, et l'étape 0 a laissé des choses derrière.** Défais-les par des gestes NOMMÉS et bornés :
la copie de travail par le chemin absolu consigné en 0.a et celui-là seulement — **jamais `git worktree prune`,
jamais un retrait sur un chemin que tu n'as pas créé** : ce dépôt porte les copies de travail VIVANTES d'autres agents, et un
nettoyage générique emporte leur travail en vol. La jonction par son propre chemin. Confirme que la cassure délibérée de 0.c
est réparée (`git status --porcelain` vide sur ce fichier). **Le commit de 0.a reste** — il
porte du travail préexistant légitime, donc réécrire l'historique partagé pour le retirer détruirait des commits
que d'autres sessions ont pu empiler dessus. Dis qu'il demeure ; s'il doit vraiment partir, c'est un `git revert` du
hash unique énuméré, jamais un reset. Rapporte la cible intacte.

**Aucun candidat est aussi un résultat honnête.** Un `scout` qui ne rend rien veut dire aucun regret qui vaille son prix.
Dis-le et arrête ; ne joue pas les étapes 3-5 sur une liste vide. Si tu abandonnes quelque chose, dis quoi et pourquoi — une
coupe silencieuse se lit comme « tout était couvert » alors que non.

### 3. CADRER chaque candidat retenu — et écrire le besoin propre au parent

Un candidat de `scout` est une piste, pas une tâche. `frame` borne le besoin, vérifie ce qui EXISTE déjà (le
piège du doublon), note les approches et énonce ses hypothèses. Le sauter donne à `build` un vœu vague
et rend un changement vague.

**PROUVE QUE LE CONTRÔLE EST ARMÉ, maintenant qu'un RUN existe pour porter le signal.** Casse à nouveau une ligne dans le
périmètre, clos le RUN parent, et lis le refus du contrôle : il doit citer
`REJEU signal-cmd ECHOUE (exit N)`. Tout autre BLOCAGE — typiquement *« signal-cmd ne PROUVE rien »* — veut dire que
la forme est mauvaise, pas que le contrôle surveille, et le prendre pour une preuve d'armement est exactement le
faux-vert que cette étape existe pour empêcher. Puis restaure par commande et recontrôle comme en 0.c. Jamais
observé de refus de rejeu → la clôture est étiquetée *auto-déclarée, contrôle non armé*.

**Écris le `## Besoin` du PARENT ICI, avant qu'aucune phase ne tourne** — personne d'autre ne le fera, et l'étape 5 doit
cocher sa liste de sortie item par item. Il porte l'objet du remake, le tableau des candidats, le signal et la
poignée de retour arrière, et une liste cochable dont les items SONT le contrat de clôture : *signal d'origine
rejoué vert, inchangé* · *signal étendu justifié* · *matrice candidat × phase publiée* ·
*poignée de retour arrière énumérée et vérifiée*. Chaque item nomme sa preuve. Écrite à la clôture à la place, une
liste de sortie est taillée pour le résultat — le défaut que le réflexe de preuve de la constitution nomme sans détour.

**Un candidat peut MOURIR ici, et c'est le cadrage qui réussit.** L'étape 2 abandonne sur le coût ; l'étape 3 tue sur
la preuve — le regret est plus large que le code, la chose est déjà faite, le correctif coûte plus qu'il ne rapporte.
Dis-le avec la raison, retire-le du décompte, passe à la suite. Sans cela, l'engagement de l'étape 2
pousse le cadrage à fabriquer un regret qui n'existe pas.

**Un regret qui se révèle être un vrai DÉFAUT est reclassé, pas passé en fraude.** L'obligation de preuve
inversée est calibrée pour des changements à comportement identique. Une vraie divergence de comportement prend
la barre de `build` : reproduire en rouge d'abord, puis le vert. Mesuré sur un run de 12 : 3 sont morts au
cadrage, 2 ont été reclassés.

Les candidats indépendants se cadrent EN PARALLÈLE ; deux qui touchent le même code ne sont PAS indépendants — cadre-les
ensemble ou séquence-les, pour que le second soit cadré contre le résultat du premier et non sur une lecture périmée.

### Le contrat de dispatch — énoncé à CHAQUE phase, à CHAQUE fois

Le mode d'échec qui revient sans cesse sous d'autres habits : une phase déléguée ne voit pas ce que
`remake` a décidé. Elle résout son propre RUN, travaille dans le cwd de la session, suit sa propre règle
d'arbitrage, et obéit à son propre contrat sur ce qu'elle doit écrire avant de rapporter « fini ». Donc chaque dispatch —
`frame`, `build`, `clean`, `judge` — porte les cinq :

1. **Le chemin absolu du RUN enfant.** Relatif, un sous-agent écrit dans le dépôt cible, hors de ce que le
   contrôle balaie : un RUN invisible que rien n'applique. Il doit rester directement sous le dossier de run de la session
   — le contrôle ne descend pas récursivement. **Ne déplace JAMAIS `AUTOWIN_RUN_ROOT` par candidat** (le seul levier documenté
   pour piloter le glob singulier de `judge`) : cela relocalise l'enfant hors du sous-arbre balayé et
   recrée exactement ce RUN invisible.
2. **La racine de travail** — la copie de travail, quand 0.a y a déménagé. « Les étapes 0-5 s'y jouent toutes » est une phrase
   dans ce fichier, pas une propriété de l'environnement ; une phase à qui on ne l'a pas dit travaille dans l'arbre principal.
3. **Le mandat d'arbitrage.** `frame` rend une vraie bifurcation et attend, sauf si on lui dit de trancher. N
   sous-cadrages après un seul feu vert, chacun rencontrant une bifurcation, s'arrêtent tous en même temps — sur une skill dont la promesse est
   de ne pas piloter à la main. Alors choisis par candidat : **« décide pour moi »** (le défaut, pour une forme évidente ;
   la décision exige alors ses ≥ 3 options notées — anti-fixation du moteur ch.1 — ou pas de ligne `Décision:`
   du tout plutôt que deux options de paille), ou **rends la bifurcation au parent** AVANT que le RUN enfant soit
   ouvert (un enfant `open` pendant l'attente humaine bloque le tour qui pose la question). Le parent
   regroupe toutes les bifurcations rendues en UNE question, puis redistribue avec la réponse et un mandat « décide pour
   moi ».
4. **Le périmètre, explicitement — et jamais « le diff récent ».** Il est GRADUÉ, parce qu'au premier
   dispatch aucun commit du remake n'existe encore : pour `frame`, le périmètre est la LISTE DE FICHIERS plus le
   HEAD d'ancrage de 0.a ; pour `build`, `clean` et `judge`, ce sont les hashes énumérés que la construction a
   produits pour CETTE partition, plus ses fichiers. Jamais une plage : sur un arbre partagé, les commits d'une autre session
   sont entrelacés avec les tiens. Mesuré dans les deux sens — un juge a attribué le commit d'un inconnu
   au remake, et un constructeur a accusé « une session concurrente » d'un rouge qui venait de son propre travail non commité.
5. **N'enchaîne PAS sur `terrain`, et le RUN parent est interdit.** Le contrat propre à `frame` se termine par
   une passation inconditionnelle à `terrain` : laissé seul, N sous-cadrages lancent N `terrain` non budgétés. Ajoute-le
   délibérément avant `build` quand le travail exige un harnais qui n'existe pas — et compte-le alors
   à l'étape 2. Et une phase qui touche le statut du parent le passe au vert au candidat 2 sur 6, ce que le
   contrôle valide ensuite comme une affirmation sur tout le remake.

En revanche, ne dis pas à `frame` de « rendre sans écrire » : il refuse de rapporter « fini » avant que
`## Besoin`, `## Contraintes` et `## Confiance` (plus `## Options` + `Décision:` quand il arbitre)
soient dans un RUN, et un contrat qui force une phase à rompre le sien n'est pas un contrat. Pointe-le vers un fichier à
lui à la place. Ce qui NE doit PAS arriver, c'est N agents résolvant le même chemin par défaut et s'écrasant
les uns les autres (rédacteur unique, moteur ch.3).

**Chaque fois que ce fichier dit qu'une phase « fait X », vérifie le SKILL.md de cette phase avant d'y croire.**
Là où les deux divergent, la phase gagne, et le correctif appartient au contrat de dispatch ci-dessus — pas à une
phrase plus stricte ici.

### 4. Jouer le pipeline jusqu'au bout — build → clean → judge

Chaque besoin cadré joue la vraie chaîne, dans l'ordre : `build` (exécute, rouge→vert, anti-régression) →
`clean` (hygiène d'après-construction) → `judge` (audit adversarial). `judge` rend les défauts à `build`, pas à
`remake` : cette boucle appartient aux phases et tourne jusqu'au seuil du régime avant que la main revienne.

`remake` décide QUOI et enchaîne la séquence ; chaque phase possède son COMMENT. Ne fais pas pousser un second moteur
d'exécution, un second audit ou un second nettoyage — une copie divergente d'une phase est pire que pas de phase.

Périmètre gelé : inchangé, et il ne s'est pas levé.

### 5. Clore

Rejoue le signal — **celui de la cible, depuis l'étape 0**, pas le verdict interne d'une phase. Un `judge` vert
par candidat ne prouve pas que la cible marche encore dans son ensemble : chaque phase a prouvé son propre changement,
personne n'a prouvé leur SOMME.

**Rapporte les DEUX chiffres.** Les candidats ajoutent des tests ; étendre le filet est sain, le rétrécir ne l'est jamais. Donc
énonce le signal D'ORIGINE, inchangé, toujours vert, ET l'étendu, chaque changement du décompte
justifié. Un chiffre unique passé en silence de 204 à 212 n'est pas un rejeu du signal de l'étape 0.

Signal attestable → le rejeu est une attestation FRAÎCHE : même périmètre de lecture qu'à l'étape 0, avec son empreinte de run,
avec son contrôle négatif, et « les deux chiffres » devient « la même liste de lecture, toute extension
justifiée ».

**Publie une matrice candidat × phase** — une ligne par candidat, une colonne par phase réellement jouée. Une
case vide est déclarée, pas laissée en silence : une couverture par ricochet, où le `clean` d'une partition couvre par hasard
les commits d'une autre, se lit comme une couverture complète et n'en est pas une. Mesuré : 2 candidats sur 12 n'ont eu ni
`clean` ni `judge`, et rien ne le disait.

Pas vert → **identifie CE QU'EST le rouge avant de détruire quoi que ce soit** :

1. **Est-ce seulement un rouge ?** Un `exitCode: null` avec « arrêtée au plafond » est le plafond de vérification, pas une régression. Un rejeu en dépassement,
   ou un `signal-cmd` que le contrôle n'a jamais rejoué, ne dit rien sur le code — corrige la forme du signal
   (0.b) et reclos. Annuler du travail sain à cause d'un dépassement de hook est l'erreur coûteuse ici.
2. **Rejoue encore une fois.** Un signal instable rouge par malchance jetterait sinon du travail sain.
3. **Resonde l'arbre.** La propreté de l'étape 0 est un fait DATÉ et ces arbres bougent en cours de session. Devenu
   sale depuis → le revert est carrément interdit : rends la main en disant ce qui est en jeu.
4. **Bissecte par PARTITION, ne bombarde pas.** Les partitions sont l'unité disjointe — les candidats à l'intérieur
   d'une même partition se percutent par construction, donc les annuler « un par un » produit des conflits ou un état jamais
   testé. Annule des partitions entières, la plus récente d'abord, en rejouant entre chacune. Bissection indisponible (une
   cible hors git avec une seule copie) → dis que la granularité est du tout ou rien et ce que cela coûte.
   Le revert lui-même est borné, sinon il devient le dégât :
   - **Cherche d'abord les commits étrangers.** `git log <hash>..HEAD -- <les fichiers de la partition>` qui rend
     quoi que ce soit qui n'est pas à toi INTERDIT le revert : rends la main à la place, en disant ce qui est en jeu.
     La poignée prouve que les commits sont les tiens ; elle ne dit rien sur qui a touché ces fichiers depuis.
   - **`git revert --no-commit <hashes énumérés>`**, jamais une plage. Premier conflit →
     `git revert --abort`, puis rapporte : un arbre partagé laissé dans un revert en conflit bloque les commits de TOUTES
     les sessions, et le prochain `git pull --autostash` d'un tiers sur cet état est la façon dont du travail
     disparaît.
   - Arbre partagé → fais le revert dans une copie de travail isolée, comme on traite une publication là-bas.
5. **Un retour arrière sur les DONNÉES obéit à la même règle de fait daté que l'arbre.** Avant de restaurer un instantané, resonde
   le fichier (hash ou date de modification contre l'instantané) : changé depuis → la restauration est INTERDITE, rends la main
   et dis ce qui est en jeu. Sinon la restauration détruit en silence toutes les écritures faites depuis — des données
   utilisateur, la classe la plus grave, et irrécupérables une fois écrasées. Sauvegarde l'état COURANT avant de
   l'écraser, pour que la restauration soit elle-même réversible, et confirme qu'aucun écrivain vivant ne tient le fichier.
6. **Rapporte le coupable dans les deux cas.** Un remake qui laisse la cible plus mal qu'il ne l'a trouvée a
   échoué, et le dit.

**Clos les enfants, puis le parent** (statuts et leur preuve : moteur ch.3). Le parent est le seul
RUN dont le périmètre est le remake dans son ensemble, donc il se clôt avec son contrôle armé et sa liste de sortie cochée item par
item contre le rejeu final. Un item qui ne peut pas être coché honnêtement rend le statut
`degraded-closed` — jamais `green` par une porte de sortie. Mesuré : le premier vrai run s'est clos en `green`
avec cinq cases non cochées et le contrôle désarmé, et personne sauf un audit ultérieur ne l'a remarqué.

## Ce que ça produit

Les candidats classés (impact ⊥ effort, avec ce qui a été abandonné et le coût montré), ce en quoi chacun a été cadré,
les phases réellement jouées par candidat avec leurs verdicts, le signal de la cible rejoué vert
avant et après, et la poignée de retour arrière unique. Écrit dans le RUN.md vivant.

## À ne pas faire

- **Tourner sans un signal que le contrôle vérifie vraiment** — le refus est la fonctionnalité. Un `signal-cmd`
  hors liste blanche n'est jamais rejoué, un qui échoue à la règle de preuve bloque tout vert, et un
  signal attesté sous `critical` n'est vérifié par personne. Les trois sont « pas de signal ».
- **Réécrire le périmètre gelé** — kit, garde-fous de code, `src/main/constitution.ts`, mémoire : proposer seulement.
- **Présenter un regret comme un défaut** — c'est la barre de `judge`, et l'emprunter fait mentir la skill.
- **Laisser `disposable` sur un RUN de remake, laisser une phase enchaîner sur `terrain`, ou en laisser une toucher le parent** —
  trois façons silencieuses de perdre les garanties que ce fichier revendique.
- **Bissecter avant de savoir que le rouge est un rouge** — un dépassement du plafond de vérification n'est pas une régression.
- **Réimplémenter une phase, ou donner à `build` un candidat non cadré** — `remake` enchaîne et ajoute la
  barre du regret ; il n'en réimplémente aucune, et une piste de scout n'est pas une tâche.
- **Survoler une cible trop grande à tenir, ou cacher le coût de ce qui a émergé** — demande la tranche ; montre le
  décompte.
- **Utiliser pour** : auditer un livrable existant (→ `judge`) · choisir sur quoi travailler quand le livrable n'est
  pas fini (→ `scout`) · refaire l'ALLURE d'un écran (→ `draft`) · retirer les résidus de
  tentatives ratées (→ `clean`) · changer le comportement de Claude (→ `kaizen`).

## Moteur et réflexes

- Salve parallèle, boucle jusqu'à épuisement, déduplication par idée centrale, impact ⊥ effort, anti-fixation : **moteur ch.1**.
  Chemin du RUN, champs d'en-tête, discipline de clôture : **ch.3**. Mécaniques d'exécution : **ch.4**. En cas de divergence,
  le moteur gagne — ce fichier ajoute la barre du regret, la forme rejouable du signal et le contrat de
  dispatch, et ne redit rien du reste.
- **Ce fichier est long EXPRÈS, et il n'est pas scindé.** Il fait ~2,5× la plus grosse phase qu'il enchaîne —
  signalé, pesé, tranché : le corps coûte ~6 k jetons une fois par invocation, soit environ 3 % d'un vrai remake,
  alors qu'UNE seule règle de sûreté non lue coûte le travail d'une autre session ou des données utilisateur. Le gros est aux étapes 0 et 5,
  qui sont des gestes, pas de la documentation ; les mettre derrière un renvoi « lis ça d'abord » appliquerait
  ici le défaut même contre lequel ce fichier met en garde. Coupe de la décoration, jamais une règle ni la mesure qui
  la rend sans ambiguïté. `verify-remake.ps1` sert de cliquet contre la croissance silencieuse.
- Ancrage de réflexe : **l'autorité de clôture vit hors du modèle** (réflexe 2). Ici c'est le signal propre à la
  cible — c'est pourquoi une cible sans signal est refusée, et pourquoi un signal que le contrôle ne vérifie pas
  vraiment est traité comme aucun signal du tout.

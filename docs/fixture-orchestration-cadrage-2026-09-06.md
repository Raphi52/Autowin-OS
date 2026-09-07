# Une fixture d'orchestration déterministe — cadrage

**Ce que ça débloque** : trois preuves hors-modèle aujourd'hui manuelles et payantes —
`cdp-relance-jusquau-vert-proof`, `cdp-skill-node-brain-proof`, `cdp-trois-conversations-proof`.

## Le besoin, formulé sans la solution

Trois sondes veulent observer **le comportement de l'orchestrateur** : sa politique de relance,
l'ouverture d'un outil natif pour un nœud skill, la propreté des bureaux après trois runs
simultanés. Aucune ne veut mesurer la qualité du modèle. Or, pour les jouer, il faut aujourd'hui
payer de vrais agents, attendre plusieurs minutes, et accepter qu'ils **écrivent dans le dépôt**.

Elles sont donc restées manuelles — c'est-à-dire jamais jouées. Le 2026-09-06, deux d'entre elles
étaient rouges depuis des semaines sans que personne ne le sache.

## Le piège à éviter, nommé d'abord

**N'écrivez pas un pipeline factice.** Un faux orchestrateur qui rejoue « des phases » diverge du
vrai au premier changement, et une preuve qui observe un faux pipeline ne prouve rien du produit.
C'est exactement le genre de témoin qui rassure à tort — la leçon coûteuse de cette journée.

## L'approche : remplacer le FOURNISSEUR, pas le pipeline

Le pipeline réel tourne — ses phases, ses juges, ses portes, sa politique de relance, ses bureaux
isolés. Seul l'appel au modèle rend une réponse écrite d'avance.

C'est exactement ce que fait déjà le chat : `src/main/chat/run-pilot-chat.ts` construit
`new ProviderRegistry().register(fixtureProvider)` pour un tour, et le reste du chemin est le vrai.

### Les deux coutures existent déjà

1. **Le registre de fournisseurs** est une dépendance de l'orchestrateur
   (`OrchestratorCollaboratorDeps.registry`, `src/main/orchestrator.ts`). Toutes les phases y
   passent : `registry.send(...)` pour le juge (l.2528), pour les sous-agents (l.2820), pour la
   synthèse (l.3016).
2. **Le point de substitution est déjà nommé** : `OS.orchestrateurPour()` (`src/main/os.ts` l.220),
   dont le commentaire dit textuellement que c'est *« le seul endroit qu'un harnais doit remplacer
   pour tester le chemin sans lancer un vrai orchestrateur »*.

Le chantier consiste donc à **relier deux coutures qui existent**, pas à construire une pièce.

## Ce que la fixture doit savoir produire, sonde par sonde

| Sonde | Ce qu'elle observe | Ce que la fixture doit scripter |
|---|---|---|
| `cdp-relance-jusquau-vert-proof` | `[RÉPARATION n]`, refus motivé, plafond dur | un juge **rouge** aux deux premiers passages, **vert** au troisième |
| `cdp-skill-node-brain-proof` | « outils natifs servis à … » dans la trace causale | **rien de particulier** — le nœud skill vient du profil, pas de la fixture (voir « DEUX scénarios ») |
| `cdp-trois-conversations-proof` | aucun bureau orphelin après 3 runs | **rien de particulier** — trois runs nominaux lancés ensemble |

Le discriminant est disponible côté fournisseur : chaque appel passe par
`sendWithRoleContext(<libellé>, <rôle>, …)` avec le rôle (`judge`, `orchestrator`, sous-agent), et
`opts` porte la phase. La fixture répond donc **selon le rôle et le numéro de passage**.

## Frontières — ce que la fixture n'a pas le droit de faire

- **Ne jamais quitter l'instance isolée.** Même garde que les fixtures de chat : tout le bloc est
  sous `isolatedTestInstance`, sinon la porte existe en production.
- **N'écrire QUE dans le dépôt jetable.** Voir la décision du 2026-09-06 plus bas : l'écriture est
  nécessaire, mais le plan de travail par défaut retombe sur le dépôt RÉEL. La fixture impose donc
  `AUTOWIN_OS_WORKSPACE` et **lève** si ce n'est pas son propre dépôt jetable.
- **Écrire, mais rien qui ressemble à du produit.** Un fichier anodin et nommé comme tel : si un
  jour il fuit hors du dépôt jetable, il doit se reconnaître au premier coup d'œil.
- **Ne pas neutraliser les portes.** Si une porte refuse, la fixture ne la contourne pas : c'est
  précisément le comportement que la sonde de relance vient observer.

## Le déclencheur

Un préfixe dans la tâche, comme pour le chat : `[[autowin-fixture-orchestration]] <scénario>`, où le
scénario nomme la forme voulue (`juge-rouge-puis-vert`, `noeud-skill`, `trois-runs`). Un scénario
inconnu **lève** — un préfixe mal orthographié qui retomberait sur un vrai run payant serait le pire
des résultats.

## Tranché le 2026-09-06 — elle écrit, mais dans un dépôt JETABLE

**Elle doit écrire.** Une copie de travail n'est supprimée par le balayage que si **quatre
conditions cumulatives** sont vraies (`src/main/store/worktree-manager.ts`), dont « son arborescence
de travail est **vide** » et « son HEAD est déjà contenu dans une référence ». Une fixture qui
n'écrit rien produit donc une copie vide : elle emprunte le chemin le plus simple, celui où la
suppression est triviale. La sonde vérifierait qu'un cas sans enjeu ne laisse pas d'orphelin —
verte par construction. Les orphelins n'apparaissent que là où il y a **quelque chose à perdre**.

**Mais surtout pas ici.** Le plan de travail se résout en cascade (`resolveExecutionWorkspace`,
`src/main/os.ts` l.130) et son avant-dernier repli est le dépôt git **du dossier de l'exécutable**.
Pour un paquet dans `dist/win-unpacked`, cela remonte au dépôt RÉEL. Ce n'est pas une crainte
théorique : `scripts/cdp-relance-jusquau-vert-proof.mjs` porte déjà l'avertissement dans son
en-tête — « cet instrument laisse une trace dans le dépôt » — et un agent y a réellement écrit un
fichier le 2026-08-21. Une fixture qui écrit, branchée sur `build:desktop`, créerait des copies de
travail du vrai dépôt **à chaque construction**.

**La sortie existe déjà** : la PREMIÈRE branche de la cascade est la variable d'environnement
`AUTOWIN_OS_WORKSPACE` (`src/shared/app-identity.ts`), qui prime sur tout le reste. Le scénario
doit donc, dans cet ordre :

1. créer un **dépôt jetable** sous le profil isolé — `git init` et un commit initial ;
2. l'imposer par `AUTOWIN_OS_WORKSPACE` au démarrage de l'instance, avant toute résolution ;
3. y écrire pour de vrai, et n'y vérifier que ses propres bureaux.

**Et aller jusqu'à l'intégration.** Un bureau conservé parce qu'il porte du travail non publié
n'est **pas** un orphelin — la sonde le compterait à tort. Le travail écrit doit donc être publié
pour que la copie redevienne supprimable : c'est seulement là que l'assertion « aucun bureau
orphelin » veut dire quelque chose.

**Garde-fou à écrire avec la fixture** : si `AUTOWIN_OS_WORKSPACE` ne pointe pas vers un dépôt
jetable créé par elle, la fixture **lève**. Se fier à l'ordre de la cascade serait un pari ; une
vérification explicite n'en est pas un.

## Tranché le 2026-09-06 — DEUX scénarios, pas trois

Le cadrage initial en annonçait trois, un par sonde. En les regardant de près, **deux suffisent** :
deux des trois sondes n'ont besoin que du chemin nominal.

| Scénario | Ce qu'il fait | Qui s'en sert |
|---|---|---|
| `nominal` | un run qui passe au **vert du premier coup**, écrit un fichier anodin, l'intègre | `cdp-skill-node-brain-proof`, `cdp-trois-conversations-proof` |
| `juge-rouge-puis-vert` | juge **rouge** aux deux premiers passages, **vert** au troisième | `cdp-relance-jusquau-vert-proof` |

**Pourquoi la sonde skill n'a pas besoin du sien.** Elle observe qu'un nœud skill reçoit ses outils
natifs. Or un nœud skill n'est pas produit par la fixture : il vient du **profil de workflow**. Et
depuis le 2026-08-25, `think` et `learn` sont des nœuds skill présents dans **six des sept profils**
(tous sauf `eclair`, délibérément épargné), servis par `skill-node-tools.ts` avec `brain_query` et
`remember`. La fixture n'a donc qu'à laisser le run se dérouler.

**Pourquoi celle des trois conversations non plus.** Elle mesure la **concurrence** et la propreté
des bureaux, pas une forme de réponse. Trois runs nominaux lancés ensemble sont exactement son
sujet.

**La règle qui borne l'ajout d'un troisième.** Un scénario ne se justifie que si une sonde a besoin
d'une forme qu'aucun des deux ne produit — et cette forme doit être **nommée dans le commit qui
l'ajoute**. « Au cas où » est le premier pas vers le pipeline factice que ce document refuse.

### Trouvé en tranchant : la sonde skill vise un profil disparu

`cdp-skill-node-brain-proof` appelle `workflowProfileSelect('memoire-depot')`. Ce profil **n'existe
plus** : le catalogue en compte sept — `eclair`, `correctif`, `feature`, `chantier-autowin`,
`panel-critique`, `exploration`, `remake`. C'est un **second blocage**, indépendant de la fixture, et
il se corrige seul : viser un profil existant qui porte `think` et `learn`, par exemple `correctif`.

## Tranché le 2026-09-06 — le déterminisme porte sur les DÉCISIONS, pas sur le déroulé

La fixture ne rend pas un run identique au bit près. Elle rend identiques **les décisions que les
sondes observent**. Tout le reste bouge, et c'est normal.

**Ce qui est déterministe — ce sur quoi une sonde a le droit d'asserter :**

- la **suite des verdicts** : rouge, rouge, vert — donc `[RÉPARATION 1]`, `[RÉPARATION 2]`, le
  plafond dur, le refus motivé ;
- le **chemin parcouru** : quelles phases, quels nœuds, dans quel ordre pour UN run ;
- les **faits d'arrivée** : le fichier écrit existe, il est intégré, le bureau est supprimable ;
- la **présence** des lignes de trace que les sondes cherchent (« outils natifs servis à … »).

**Ce qui ne l'est pas — et qu'aucune sonde ne doit toucher :**

| Ce qui varie | Pourquoi | La règle |
|---|---|---|
| **Durées, horodatages** | mesuré le 2026-09-06 : deux passages du même banc, **+99 %** d'écart ; et une fenêtre masquée fausse toute mesure d'affichage d'un facteur **~14** | aucune assertion sur un temps |
| **Identifiants** | `conv-1`, `turn-…`, noms de bureaux dépendent de l'ordre et du profil | asserter la **forme**, jamais la valeur |
| **Ordre entre runs concurrents** | trois runs en parallèle finissent dans l'ordre que l'ordonnanceur décide | asserter l'**état final de l'ensemble**, jamais une séquence |
| **Coût et jetons** | les champs existent même à zéro | ne rien en attendre |

**Une substitution de plus, qui découle de cette règle.** Le contexte Brain injecté dans le prompt
dépend d'un index et d'un corpus qui vivent hors du dépôt : deux runs identiques n'y trouvent pas
forcément la même chose. Le retriever est déjà une dépendance substituable
(`OrchestratorCollaboratorDeps.retrieveBrain`, `src/main/orchestrator.ts` l.649, prévue pour
« prouver les frontières d'injection sans serveur global »). La fixture le remplace donc **aussi**,
par un retour vide et constant — sinon le déterminisme s'arrête au premier appel au Brain.

**Le critère qui tranche un cas limite.** Devant une assertion douteuse, se demander : *« ce que je
vérifie est-il une DÉCISION du produit, ou un effet de son environnement ? »* Une décision se
scripte et s'exige ; un effet d'environnement se mesure, se raconte, mais ne se verrouille pas.

## Le critère de réussite

Les trois sondes rejouées **depuis un profil effacé**, vertes deux fois de suite, **sans un centime
d'appel modèle**, et chacune prouvée **rouge sous sabotage** de ce qu'elle surveille — sinon elles
rejoindront la liste des témoins qui ne mordent pas.

## Effort

Moyen. Le gros du travail n'est pas le code : c'est d'écrire trois scénarios qui reproduisent
fidèlement la forme des réponses réelles. Le raccordement, lui, tient dans les deux coutures
ci-dessus.

## Journal de raccordement — 2026-09-06, quatre blocages trouvés EN JOUANT

Le scénario `nominal` est raccordé et un run se déroule **de bout en bout sans un centime d'appel
modèle**. Chaque blocage ci-dessous a été trouvé en exécutant, jamais en lisant — et chacun était un
contrôle LÉGITIME du produit, que le dépôt réel masquait.

1. **« Lancement bloqué : le distant origin est absent »** — le dépôt jetable n'avait pas de
   distant. Le dépôt réel en a un, donc rien ne l'avait révélé. Corrigé : un dépôt **nu** posé à
   côté, la publication reste réelle sans jamais joindre le réseau.
2. **« Provider inconnu: claude (connus: autowin-orchestration-fixture) »** — substituer le registre
   ne suffit pas : les **quatre rôles** (`orchestrator`, `subagent`, `judge`, `scout`) gardaient leur
   liaison. Un seul rôle oublié rappelle un vrai fournisseur, et la fixture n'est plus gratuite.
3. **« Provider sans exécuteur local outillé »** — chez les vrais fournisseurs CLI, c'est l'AGENT
   qui écrit les fichiers. Une fixture qui le remplace doit donc écrire à sa place. Elle déclare
   `supportsExecution` et produit vraiment l'effet — **sous le garde-fou**, qui vérifie que la copie
   de travail porte bien le marqueur du dépôt jetable.
4. **`done-without-proof` — RÉSOLU par une preuve RÉELLE.** La porte refusait le vert « sans au
   moins une preuve d'exécution ok ». La tentation était un `ok: true` de complaisance : ce serait
   neutraliser une porte, et fabriquer le faux vert exact que ce chantier combat. La fixture exécute
   donc une VRAIE commande — `git status --porcelain` sur le fichier qu'elle vient d'écrire — et
   rapporte son VRAI code de sortie. L'oracle est falsifiable : sans écriture, la sortie est vide et
   la preuve est `ok: false`. Les deux sens sont testés. Mesure : la porte a disparu de la liste des
   refus au run suivant.
5. **La définition de fini — RÉSOLUE, et la piste évidente était la mauvaise.** Il restait « Promis
   mais pas fait : « Mutation demandee produite avec une preuve executable » ». La lecture naturelle
   — « il faut cocher une case du RUN.md » — est FAUSSE : la case n'est pas cochée par un agent,
   elle est **calculée** (`root-execution-contract.ts`, `etatDeCloture`). Ce qu'il manquait était une
   preuve de plus : `evidenceSatisfiesTask` exige, pour une mutation, une preuve de `kind:'mutation'`
   **ET** une de `kind:'verification'` — « une lecture n'atteste pas que la mutation est correcte ».
   La fixture rend donc les deux, toutes deux vraies et falsifiables.

## Le scénario nominal atteint le VERT — mesuré le 2026-09-06

Run joué en instance isolée sur le dépôt jetable, sans un centime d'appel modèle :

```
status: "completed"   aucune erreur   13 s
```

Et le travail est allé **jusqu'au bout du cycle**, ce qui est le point qui compte pour la sonde des
trois conversations :

- le fichier de la fixture est **fusionné dans le dépôt jetable** ;
- son journal git porte le commit du run : `agent run-123f07ef6e53-1` ;
- **aucune copie de travail ne subsiste** — le bureau a été nettoyé, pas laissé orphelin.

**Ce qui est établi malgré ce reste** : le fichier écrit par la fixture a bien été retrouvé dans la
copie de travail du run, et le run n'a **rien touché** hors du profil isolé.

## Second scénario `juge-rouge-puis-vert` — livré le 2026-09-07

Le juge **refuse les deux premiers passages, puis valide**. Deux et non un : un seul refus ne
distingue pas « la boucle a rejoué » de « elle a rejoué une fois par accident ». Deux refus font
apparaître `[RÉPARATION 1]` **et** `[RÉPARATION 2]`, donc une boucle, puis le vert montre sa sortie
par le haut.

**La raison du refus CHANGE à chaque passage, et ce n'est pas cosmétique.**
`arretDeLaReparation` coupe la boucle sur un refus IDENTIQUE d'un passage à l'autre : deux refus mot
pour mot arrêteraient la relance au premier constat, et la sonde verrait un arrêt là où elle attend
une réparation. Un test passe par la VRAIE règle du produit (`doitArreterLaReparation`) pour le
tenir.

Le compte des passages vit dans une **closure du fournisseur**, donc un compte par run : trois runs
concurrents ne se volent pas leurs verdicts.

### La sonde de relance est branchée, et son oracle a dû être refait

`cdp-relance-jusquau-vert-proof.mjs` était **payante et dangereuse** : elle faisait travailler un
vrai agent sur une tâche volontairement impossible, et son en-tête avertissait qu'il **écrivait dans
le dépôt réel** (mesure du 2026-08-21). Elle est maintenant autonome et gratuite, sur le modèle de
la sonde des trois conversations : dépôt jetable, distant nu local, instance isolée à laquelle
`AUTOWIN_OS_WORKSPACE` impose ce dépôt, profil `correctif` (qui accorde des réparations, là où
`eclair` en refuse toute).

**L'oracle d'origine rendait ROUGE un mécanisme VERT.** Il ne comptait que les payloads `gate` ou
`handoff` courts et sans saut de ligne. Or `[RÉPARATION n]` n'est **pas** une ligne de gate : c'est
un CONTEXTE réinjecté dans le build suivant (`pousserContexte('reparation:n', …)`), donc un long
payload de type `message` — exclu par construction. Trouvé en jouant, pas en relisant. La sonde lit
désormais deux signaux à leur place : les **verdicts** du juge (`type: 'verdict'`) et les **numéros**
de réparation réinjectés, dédupliqués.

La contamination que l'ancien filtre combattait est écartée **à la source** : la réponse du modèle
est écrite d'avance, donc aucun agent ne peut faire écho à ces marqueurs.

### Mesure

| Passage | Résultat |
|---|---|
| Profil `correctif` (le scénario) | `completed`, **2 refus du juge**, **réparations 1 et 2** rejouées, gratuit |
| Profil `eclair` (falsification) | **exit 1** : `failed`, 1 refus, 0 réparation, « aucune réparation : le plafond déclaré vaut zéro » |

La seconde ligne est ce qui compte autant que la première : la sonde **peut rougir**. Elle rejoint
`build:desktop` (`npm run test:relance`) après la sonde des trois conversations.

### Il reste UNE sonde payante liée à ce chantier

`cdp-skill-node-brain-proof.mjs` sélectionne le profil `memoire-depot`, qui **n'existe plus** dans le
catalogue (sept profils, pas celui-là). Le scénario `nominal` lui suffirait — les nœuds skill
viennent du profil, pas de la fixture — mais son profil doit d'abord être corrigé.

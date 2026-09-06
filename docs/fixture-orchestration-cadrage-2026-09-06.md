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
| `cdp-skill-node-brain-proof` | « outils natifs servis à … » dans la trace causale | un nœud **skill** qui appelle réellement son outil natif |
| `cdp-trois-conversations-proof` | aucun bureau orphelin après 3 runs | trois runs **concurrents** qui terminent |

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

## Ce qui reste à trancher, et qui appartient à l'humain

1. **Où s'arrête le déterminisme ?** Le temps d'exécution, lui, restera variable : les sondes ne
   doivent donc rien asserter sur des durées.

## Le critère de réussite

Les trois sondes rejouées **depuis un profil effacé**, vertes deux fois de suite, **sans un centime
d'appel modèle**, et chacune prouvée **rouge sous sabotage** de ce qu'elle surveille — sinon elles
rejoindront la liste des témoins qui ne mordent pas.

## Effort

Moyen. Le gros du travail n'est pas le code : c'est d'écrire trois scénarios qui reproduisent
fidèlement la forme des réponses réelles. Le raccordement, lui, tient dans les deux coutures
ci-dessus.

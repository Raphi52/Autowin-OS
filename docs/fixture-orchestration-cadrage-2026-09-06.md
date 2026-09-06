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
- **N'émettre aucune commande mutante.** Les réponses scriptées ne contiennent pas de `edit_file` ni
  de `run` : le bus de commandes, lui, est le vrai. Le déterminisme s'arrête où l'écriture commence.
- **Ne pas neutraliser les portes.** Si une porte refuse, la fixture ne la contourne pas : c'est
  précisément le comportement que la sonde de relance vient observer.

## Le déclencheur

Un préfixe dans la tâche, comme pour le chat : `[[autowin-fixture-orchestration]] <scénario>`, où le
scénario nomme la forme voulue (`juge-rouge-puis-vert`, `noeud-skill`, `trois-runs`). Un scénario
inconnu **lève** — un préfixe mal orthographié qui retomberait sur un vrai run payant serait le pire
des résultats.

## Ce qui reste à trancher, et qui appartient à l'humain

1. **La fixture doit-elle produire de vrais artefacts ?** Sans écriture, la sonde des trois
   conversations ne peut pas vérifier qu'aucun bureau n'est orphelin — un bureau vide n'est pas un
   bureau. Écrire un fichier anodin dans le bureau isolé est probablement nécessaire.
2. **Combien de scénarios ?** Trois suffisent pour ces trois sondes. Un quatrième « générique »
   serait la première marche vers le pipeline factice qu'on veut éviter.
3. **Où s'arrête le déterminisme ?** Le temps d'exécution, lui, restera variable : les sondes ne
   doivent donc rien asserter sur des durées.

## Le critère de réussite

Les trois sondes rejouées **depuis un profil effacé**, vertes deux fois de suite, **sans un centime
d'appel modèle**, et chacune prouvée **rouge sous sabotage** de ce qu'elle surveille — sinon elles
rejoindront la liste des témoins qui ne mordent pas.

## Effort

Moyen. Le gros du travail n'est pas le code : c'est d'écrire trois scénarios qui reproduisent
fidèlement la forme des réponses réelles. Le raccordement, lui, tient dans les deux coutures
ci-dessus.

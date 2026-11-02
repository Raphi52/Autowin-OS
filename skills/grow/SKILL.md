---
name: grow
description: FAIT GRANDIR Autowin au passage de chaque demande. Déclenche-toi À LA FIN de toute demande d'action livrée (« /grow », « améliore Autowin au passage », « qu'est-ce qui aurait rendu ça parfait ? »), y compris quand le résultat est BON mais a demandé un détour, un geste à la main, un format inadapté ou une vérification improvisée. Liste les améliorations du harnais qui auraient rendu CE résultat parfait, en retient UNE, l'implémente et la prouve. Exemple : un objet 3D demandé et rendu sans aperçu manipulable → la capacité de rendu 3D dans le fil manque, grow l'ajoute. NE PAS utiliser pour : une exécution bloquée par un outil absent (→ `forge`), une procédure improvisée plusieurs fois (→ `graft`), le comportement du modèle (→ `kaizen`), un défaut du code utilisateur (→ `build`).
---

# grow — chaque demande laisse Autowin un peu meilleur

## À quoi ça sert

`forge` ne se lève que sur un blocage. Or la plupart des manques du harnais ne bloquent rien : ils coûtent un
détour, un geste à la main, un résultat « correct mais pas parfait ». `grow` capte ce manque pendant qu'il est
frais, sur une demande RÉELLE, et le transforme en capacité durable.

## Boucle — après avoir livré la demande, jamais à sa place

1. **Livre d'abord.** La demande de l'utilisateur reste la cible (constitution, Autonomie 5). grow ne commence
   qu'une fois son résultat rendu et prouvé.
2. **Liste (≤ 3)** ce qui aurait rendu le résultat parfait, chacun ancré sur un fait de CE tour :
   - un geste fait à la main qu'un outil aurait fait (ex. capture lue à l'œil, chemin recopié) ;
   - un format pauvre (texte là où un aperçu, un graphique, un rendu 3D aurait montré) ;
   - une vérification improvisée qu'aucun test ou script ne rejoue ;
   - une information cherchée longtemps qu'une injection ou une note aurait servie.
   Pour chacun : ancrage (outil appelé, fichier:ligne), gain, coût estimé.
3. **Doublon d'abord (réflexe 4).** Grep `skills/`, `scripts/`, `src/main` : la capacité existe peut-être déjà
   (ex. le bloc ```threejs rend déjà la 3D). Existe → c'est un défaut de découverte : corrige la description ou
   l'injection qui l'a cachée, pas un second outil.
4. **Retiens UNE amélioration** : la meilleure valeur / coût, bornée à 1-3 fichiers. Plus large → ne la force pas :
   rends-la en candidat (`remember` type `decision`, ou plan de lots si l'utilisateur le demande).
5. **Implémente et prouve.** Propriété des fichiers vérifiée (réflexe 14), test rouge puis vert ou capture
   relue, typecheck si TypeScript. Aucun commit sans demande (« Publier n'est pas exécuter »).
6. **Rends** en fin de réponse, une section courte :
   `Grow — amélioration : <quoi> · preuve : <commande, code> · écartées : <les autres, en une ligne>`.

## Garde-fous

- Rien à améliorer d'ancré dans ce tour → écris « Grow : aucun manque observé » et arrête. Jamais d'idée générique.
- Pas d'écriture dans `mods/autowin` du dépôt principal depuis un run : un changement de mod passe par `.autowin/mod-run` et sa promotion.
- Une règle ajoutée à un prompt n'est pas une amélioration sans cause localisée (constitution, « Pas de pansement »).
- Une seule amélioration par demande : grow accompagne la demande, il ne la remplace pas.

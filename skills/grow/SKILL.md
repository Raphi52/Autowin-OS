---
name: grow
description: FAIT GRANDIR Autowin PENDANT le traitement d'une demande — dès qu'il manque un outil, une skill, un script ou un format pour traiter ou rendre la demande au mieux (« /grow », « améliore Autowin au passage », « qu'est-ce qui rendrait ça parfait ? »), grow le crée, s'en sert aussitôt sur CETTE demande et le laisse au kit pour les suivantes. Vaut aussi quand le résultat serait BON mais coûterait un détour, un geste à la main, un format pauvre ou une vérification improvisée. Exemple : un objet 3D demandé sans aperçu manipulable → grow crée le rendu 3D et livre l'objet avec. NE PAS utiliser pour : le comportement du modèle (→ `kaizen`), un défaut du code de l'utilisateur (→ `build`).
---

# grow — chaque demande rend Autowin plus fort, et en profite tout de suite

## À quoi ça sert

La plupart des manques du harnais ne bloquent rien : ils coûtent un détour, un geste à la main, un résultat
« correct mais pas parfait ». grow comble le manque AU MOMENT où une demande réelle le révèle, et cette demande
est la PREMIÈRE à en profiter. L'ajout reste ensuite dans le kit pour toutes les suivantes.

## Ce que grow peut créer — tout ce qui sert la demande

- **un outil** : un script `scripts/<nom>.mjs` (ou `.ps1`, `.py`) qui fait le geste à la place de la main —
  calcul, conversion, extraction, capture, comparaison, vérification ;
- **une skill** : `skills/<nom>/SKILL.md`, quand la demande déroule une procédure que le kit n'a pas ;
- **un format de rendu** : page ```html-interactif (graphique, simulateur, 3D avec `THREE`), schéma ```mermaid,
  bloc de données `aw-*` — ou un nouveau rendu dans l'interface (`src/renderer/`) ;
- **un contrôle** : un test ou une sonde qui prouve le résultat au lieu d'une vérification à l'œil ;
- **un savoir** : une note (`remember`) ou une injection de contexte, quand c'est une information qui a manqué ;
- **un outil natif du chat ou un hook** (`src/main/chat-mcp.ts`, `mods/autowin`) — voir ci-dessous quand il sert.

Le choix se fait sur une seule question : **qu'est-ce qui rend CETTE demande mieux traitée ou mieux rendue ?**

## Quand l'ajout sert — dans CE tour, pas au suivant

| Ajout | Utilisable dans ce tour ? |
|---|---|
| script | oui, tout de suite (Bash) |
| skill | oui : `skill_charger` relit le disque à chaque appel (`dossiersDeSkills`, `src/main/skill-pipeline.ts`) |
| rendu dans le fil (html-interactif, mermaid, `aw-*`) | oui : c'est la réponse elle-même — contrôle-le d'abord avec `scripts/html-interactif-apercu.mjs` |
| changement d'interface (`src/renderer/`) | oui en dev : l'interface se recharge à chaud. Une erreur casse l'écran de TOUS les fils : test et typecheck avant d'enregistrer |
| outil natif, hook, code du processus principal | non : il faut un redémarrage (`restart_app`, dont la consigne reprend la demande). Pour ce tour, fais le même geste en script ; l'outil natif devient la suite |

Préfère l'ajout qui sert DANS le tour. Un ajout qui ne servirait qu'au suivant ne passe que s'il ne retarde pas
la demande.

## Boucle — grow accompagne la demande, il ne la remplace pas

1. **Repère le manque** dès la lecture de la demande, ou au moment où le traitement le révèle (≤ 3 candidats),
   chacun ancré sur un fait de CETTE demande :
   - un geste qui se ferait à la main (capture lue à l'œil, chemin recopié, calcul refait) ;
   - un format pauvre (texte là où un aperçu, un graphique, une 3D montrerait) ;
   - une vérification improvisée qu'aucun test ou script ne rejoue ;
   - une information longue à trouver qu'une note ou une injection aurait servie.
2. **Doublon d'abord (réflexe 4).** Grep `skills/`, `scripts/`, `src/main`, `src/renderer` : la capacité existe
   peut-être déjà. Existe → sers-t'en pour la demande, et corrige la description ou l'injection qui l'a cachée.
3. **Retiens UN ajout** : celui qui améliore le plus le résultat de CETTE demande, borné à 1-3 fichiers.
   Plus large → note-le (`remember`, type `decision`) et traite la demande sans.
4. **Crée-le et prouve-le** : propriété des fichiers vérifiée (réflexe 14), test rouge puis vert ou capture
   relue, typecheck si TypeScript.
5. **Sers-t'en sur la demande** : la demande est traitée et rendue AVEC l'ajout. C'est sa vraie preuve.
6. **Rends** en fin de réponse, une ligne :
   `Grow — ajout : <quoi, chemin> · servi à : <ce qu'il a fait pour cette demande> · preuve : <commande, code> · écartés : <les autres>`.

Invoqué APRÈS coup (bouton « /grow sur la demande que tu viens de terminer ») : même boucle sur la demande
précédente — crée l'ajout, puis rends à nouveau son résultat, amélioré par lui.

## Garde-fous

- La demande reste la cible (constitution, Autonomie 5). Si l'ajout échoue, livre la demande sans et dis-le.
- Rien d'ancré dans cette demande → « Grow : aucun manque observé ». Jamais d'idée générique.
- Un seul ajout par demande. Aucun commit sans demande (« Publier n'est pas exécuter »).
- Pas d'écriture dans `mods/autowin` du dépôt principal depuis un run : un changement de mod passe par
  `.autowin/mod-run` et sa promotion.
- Une règle ajoutée à un prompt n'est pas un ajout sans cause localisée (constitution, « Pas de pansement »).

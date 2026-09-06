# Cadrage — automatiser « Lancer le workflow complet sur la sélection »

Date : 2026-09-06 · Ancrage : `f0b9514c` · Statut : **cadrage, rien d'implémenté**

## Besoin

Après un scout, ne plus cocher ni cliquer à la main : que l'agent décide quelles pistes
partent et lance le travail complet dessus.

Ce bouton n'est pas décoratif. `CandidatsPickPanel.tsx:147` appelle
`onPick(redigerPromptWorkflowSelection(selection))`, et son infobulle le dit :
« jusqu'au commit publié ». Automatiser, c'est engager de l'argent sans geste humain.

## Ce qui existe déjà (et rend une partie du travail inutile)

Le mode auto enchaîne DÉJÀ après un scout : `chat-auto-mode.ts` lit une ligne `CIBLE:`
dans la réponse, s'arrête si aucune piste n'est nommée, refuse une piste destructrice.
Différence avec le bouton : il prend **une** piste, le bouton en envoie **plusieurs**.

Construire une automatisation à côté du panneau créerait **deux chemins de décision**
pour la même situation. Le travail est donc d'ÉTENDRE la porte existante, pas d'en
ajouter une.

## Contraintes dures (vérifiées dans le code)

1. **Pas de seuil chiffré possible.** `CandidatsPickPanel.tsx:90-95` : « un scout au
   format Impact/Effort n'a AUCUN nombre » ; `pertinence` est optionnel. Une règle
   « garde si note ≥ N » écarterait en silence la moitié des scouts.
2. **La porte lit la FORME, jamais la qualité.** Producteur et juge sont le même modèle :
   un filtre « garde les bons candidats » serait une auto-évaluation déguisée.
3. **Une seule ligne `CIBLE:` est lue.** `chat-auto-mode.ts:422`, mot pour mot :
   « La PREMIERE ligne `CIBLE:` fait foi : une seconde serait un choix de plus, pas un
   choix. » Écrire plusieurs `CIBLE:` serait donc IGNORÉ par le code actuel.
4. **Un run part jusqu'au commit.** Le code reste réversible (branche non fusionnée si le
   contrôle final refuse) ; la dépense, non.

## Critère de sélection — options

| # | Critère | Marche sans note ? | Risque | Score |
|---|---|---|---|---|
| A | Seuil chiffré sur `pertinence` | non | écarte en silence la moitié des scouts (contrainte 1) | 3/10 |
| B | Le scout nomme lui-même sa sélection, via un mot-clé `CIBLES:` distinct | oui | demande un nouveau mot-clé, mais laisse `CIBLE:` et sa règle intactes | **8/10** |
| C | Tout cocher (défaut actuel du panneau) | oui | N workflows complets d'un coup, coût sans plafond | 4/10 |

**Retenu : B**, sous la forme d'un mot-clé **distinct** `CIBLES:` — pas en modifiant la
lecture de `CIBLE:`, qui changerait le comportement du mode auto sur les fils existants.

## Condition de déclenchement

Le seul point réellement irréversible est la **dépense**. D'où : envoi différé avec
fenêtre d'annulation visible (« part dans 10 s — annuler »), qui rend le coût récupérable
sans obliger à rester devant l'écran.

## Réserve qui doit être levée AVANT de construire

La skill `scout` **n'exige nulle part** d'écrire une ligne `CIBLE:` — aucune consigne dans
`skills/scout/SKILL.md`. L'app rattrape après coup : `src/main/scout-cible.ts:77-85`
injecte un rappel quand la ligne manque. Bâtir la sélection multi-pistes sur ce format
repose donc sur une sortie que le scout n'est pas tenu de produire.

## Non tranché — décision produit

L'enchaînement automatique après scout doit-il être actif **par défaut sur tous les fils**,
ou réservé au **mode auto explicitement activé** ? Cela change le comportement de chaque
conversation.

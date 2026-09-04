# Banc /arena — « obstacles dédupliqués dans le widget de remontée des agents »

**Banc** : tâche réelle = dédupliquer les obstacles d'une étape dans
`src/renderer/src/components/run-progress-model.ts` (affiché par `RunProgress.tsx`) ·
critère = `node .arena/banc-obstacles/check.mjs <racine>` en code 0 ·
baseline : **journal de duels VIDE** (`npm run arena:duel -- lire` → « aucun duel journalisé »), donc
c'est un PREMIER banc — le bras A (témoin) fabrique la baseline.

## Défaut (fabriqué à partir de la cible, pas demandé)
`buildRunProgress` concatène trois sources d'obstacles — `s.error` de l'étape en échec,
`extractObstacles(s.text)`, `extractObstacles(s.thinking)` — sans aucune déduplication. La même ligne
« ⛔ Bloqué : … » apparaît couramment dans deux sources : elle est alors affichée deux fois dans la
carte, dupliquée dans les sous-étapes, et le compteur « N obstacles » du récapitulatif est gonflé.

## Critère — 4 assertions, 1 nominal + 3 cas limites
1. nominal : deux obstacles DISTINCTS conservés, dans l'ordre de première apparition (interdit une
   déduplication qui écraserait des frictions réelles).
2. cas limite : ligne identique dans `text` ET `thinking` → comptée UNE fois.
3. cas limite : `error` de l'étape identique à une ligne du texte → comptée UNE fois, et NON
   dupliquée dans les sous-étapes affichées.
4. cas limite : même ligne répétée 3 fois dans un seul texte, plus une ligne blanche → UNE fois.

## Rouge constaté AVANT lancement (dépôt intact)
```
$ node .arena/banc-obstacles/check.mjs .
OK   nominal : deux obstacles DISTINCTS conservés, dans l ordre de première apparition
RATE cas limite : ligne identique dans texte ET raisonnement comptée UNE fois — count=2
RATE cas limite : erreur de l étape identique à une ligne du texte comptée UNE fois, et non dupliquée dans les sous-étapes — count=2 substeps dupliquées
RATE cas limite : même ligne répétée 3 fois dans un seul texte (+ ligne vide) comptée UNE fois — count=3

CRITÈRE NON ATTEINT (3 RATE)
exit=1
```

## Candidats scoutés
| candidat | famille | hypothèse mesurable | coût prévu | risque | score (gain ÷ risque) | retenu ? |
|---|---|---|---|---|---|---|
| pipeline complet inchangé (frame→terrain→build→clean→judge) | routage | référence, aucun gain attendu | moyen | nul | 1,0 | **A (témoin)** |
| lecture ciblée + 1 édition + `verify` sur le seul fichier de test du widget | profondeur | −40 % de tours et −$ : la cible et la fonction sont nommées dans l'énoncé | faible | rate le bon endroit (3 sources à couvrir, pas 1) | 3,0 | **B** |
| critère d'abord : les libellés RATE servent de plan, aucune exploration | preuve | −1 tour de cadrage, −$ : les 4 assertions disent déjà quoi produire | faible | boucle si un libellé est ambigu | 2,6 | **C** |
| dédupliquer dans le COMPOSANT (RunProgress.tsx) au lieu du modèle | prémisse cassée | « le défaut est dans le modèle » serait faux : dédupliquer à l'affichage suffirait-il ? | faible | le compteur `obstacleCount` resterait gonflé → critère non atteint | 2,0 | **X** |
| fan-out 2 agents (un par cas limite) | parallélisme | −minutes | élevé | deux agents écrivent le même fichier → non attribuable | 0,5 | non |
| `brain_query` + `conversation_search` avant d'agir | contexte | éviter de refaire un correctif déjà fait | moyen | aucun acquis connu sur ce widget | 0,7 | non |
| TDD : écrire d'abord un test vitest dans le dépôt, puis le code | preuve | qualité, régression verrouillée | élevé | le critère exécutable existe déjà, doublon de preuve | 0,6 | non |
| suite de tests complète comme preuve à chaque itération | preuve | zéro régression | très élevé | +minutes massives pour un changement local | 0,3 | non |

X n'est pas le 3ᵉ du classement : c'est le plus DIFFÉRENT (il attaque un autre fichier et met en
doute la localisation du défaut). Ce banc ne teste PAS des variations de texte de skill → pas de
section « Variantes de texte ».

## Régime
standard = 4 bras (A/B/C/X), copies de travail distinctes, départ simultané, juge externe.

## État
Banc préparé et critère constaté rouge. Lancement des quatre bras : voir `lance.sh` et
`prompt-<bras>.txt`.

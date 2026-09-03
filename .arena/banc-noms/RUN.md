# Banc /arena — « SKILL.md doit nommer les fichiers du banc »

**Banc** : tâche réelle = corriger `skills/arena/SKILL.md` pour qu'il nomme les fichiers que
`scripts/arena-protocole-check.mjs` cherche sur disque · critère = `node .arena/banc-noms/check.mjs <racine>`
en code 0 · baseline : aucune tâche comparable mesurée, le bras A (témoin) la fabrique.

## Critère — 4 assertions, 1 nominal + 3 cas limites
1. nominal : les 5 noms (`tache.txt`, `check.mjs`, `prompt-<bras>.txt`, `out-<bras>.json`, `out-judge.json`) sont dans SKILL.md.
2. cas limite — SKILL.md vide ou introuvable : le critère doit REFUSER, jamais passer.
3. cas limite — nom voisin invalide interdit (`tache.md`, `check.js`, `out-judge.txt`, `prompt-a.md`).
4. cas limite — zéro nom dans la section « 6. Contrôle du protocole » : liste posée hors sujet refusée (≥4 des 5 noms exigés dans cette section).

## Rouge constaté AVANT lancement (dépôt intact)
```
$ node .arena/banc-noms/check.mjs .
RATE nominal : SKILL.md nomme les 5 fichiers du banc attendus par le contrôle — absents de SKILL.md : tache.txt, check.mjs, prompt-<bras>.txt, out-<bras>.json, out-judge.json
OK   cas limite — SKILL.md vide ou introuvable : le critère doit refuser, pas passer
OK   cas limite — nom voisin invalide interdit (tache.md, check.js, out-judge.txt, prompt-a.md)
RATE cas limite — zéro nom dans la section du contrôle de protocole : liste hors sujet refusée — 0 nom(s) sur 5 dans la section du contrôle, 4 minimum

CRITÈRE NON ATTEINT (2 RATE)
exit=1
```
Même rouge reproduit dans la copie de travail du bras A avant son départ (exit=1).

## Candidats scoutés
| candidat | famille | hypothèse mesurable | coût prévu | risque | score | retenu ? |
|---|---|---|---|---|---|---|
| pipeline complet inchangé | routage | référence, aucun gain attendu | moyen | nul | 1,0 | A |
| édition directe ciblée (1 fichier, 1 édition, 0 exploration) | profondeur | −40 % de tours, −$ : la cible est déjà nommée dans l'énoncé | faible | rate le bon endroit dans le fichier | 3,0 | B |
| critère d'abord, messages RATE comme plan | preuve | −1 tour de cadrage : les libellés RATE disent déjà quoi écrire | faible | boucle si les messages sont vagues | 2,6 | C |
| fan-out 2 agents (un par assertion RATE) | parallélisme | −minutes | élevé | 2 agents écrivent le même fichier | 0,5 | non |
| pré-chargement Brain/conversation_search avant d'agir | contexte | évite de refaire du déjà-fait | moyen | aucun acquis utile ici | 0,7 | non |
| écrire d'abord un test puis le code | preuve | qualité | élevé | le critère existe déjà | 0,6 | non |
| édition SANS jamais lire le fichier cible (à l'aveugle, par commande) | prémisse cassée | −tours −$ : « comprendre le fichier avant d'éditer » serait facultatif quand le critère est précis | faible | édition au mauvais endroit, casse du fichier | 2,0 | X |

Tri fait avant la rédaction des prompts ; le tableau a été déposé sur disque juste après la commande
de lancement — l'ordre exigé par la skill (fichier écrit AVANT le lancement) n'est donc pas tenu à la
seconde près, et c'est dit ici plutôt que masqué.

## Résultats

| bras | workflow | critère atteint | $ mesuré | min | tours | défauts | verdict |
|---|---|---|---|---|---|---|---|
| A (témoin) | pipeline actuel inchangé | oui (exit 0) | 0,383 | 1,2 | 7 | coupe le couple commande/« Il lit… » ; colonne qui promet une exécution que le contrôle ne fait pas | **gagnant** (juge externe) |
| B | édition directe ciblée, 1 fichier 1 édition | oui (exit 0) | 0,296 | 0,9 | 5 | affirme que durée et tours se lisent dans out-<bras>.json — faux, et contredit l'invariant l. 43-44 | 2e, le moins cher |
| C | critère d'abord, piloté par les libellés RATE | oui (exit 0) | 0,388 | 1,1 | 8 | invente « le RUN.md vit dans ce dossier » ; remplissage de colonne | 3e |
| X (casse-prémisse) | édition à l'aveugle, sans jamais lire le fichier | oui (exit 0) | 0,401 | 1,6 | 9 | « variante de casse fait échouer » faux sur NTFS ; contenu le plus pauvre ; le plus cher et le plus lent | 4e |

**Gagnant** : bras A — le pipeline actuel ; seul dont chaque affirmation ajoutée est vérifiable dans le
script de contrôle. **Δ contre A** : B coûte 0,087 $ de moins et 2 tours de moins, mais perd sur une
phrase fausse. **Preuve** : `out-a.json` `session_id` a6c7ce24-2ac2-4d70-acd6-24541161896c,
`total_cost_usd` 0,383131 ; critère rejoué par l'orchestrateur dans chaque copie (exit 0 pour les 4).
**Installé où** : `skills/arena/SKILL.md`, section « 6. Contrôle du protocole » — tableau des fichiers
du banc, + une ligne `lance*.sh` ajoutée d'après le défaut relevé par le juge (P6/P7/P13).
**Limite** : une seule tâche, une seule exécution par bras ; l'écart de coût (0,105 $ d'amplitude) est
dans le bruit, aucun workflow n'est prouvé meilleur.
**Discrimination** : 4/4 bras ont passé le critère ⇒ banc **NON DISCRIMINANT** — le gagnant est une
piste, le classement s'est joué sur le jugement du juge, pas sur la mesure.

## Leçon
AUTOWIN_LESSON_V1 : sur une tâche de documentation bornée, les 4 workflows A/B/C/X passent le même
critère ; l'amplitude mesurée est 0,296 $ → 0,401 $ (banc total 1,94 $ juge compris, 5,4 min). Ce qui
départage n'est pas le workflow mais les affirmations fausses ajoutées : 3 bras sur 4 en ont déposé
une. Un critère qui ne lit que la présence de noms ne peut pas les voir.

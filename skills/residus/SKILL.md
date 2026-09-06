---
name: residus
description: >-
  Routine de scout du CODE RÉSIDUEL INUTILE à nettoyer : fichiers morts, branches jamais atteintes,
  cibles disparues. Tu choisis toi-même comment balayer (la sonde `npm run scout:residus` existe et
  ne lit que `.ts/.tsx/.js/.mjs` — c'est un outil facultatif, pas un périmètre).
  Une seule règle imposée : EXÉCUTER un script avant de le déclarer vivant.
  Déclencher sur « cherche le code mort / le résiduel à nettoyer / la dette morte / scan les restes ».
  Ne SUPPRIME rien : elle propose. La suppression passe par `clean` puis `judge`.
---

# residus — scout du code résiduel inutile (lecture seule)

## La règle — un fichier VIVANT peut avoir cessé de MARCHER
AU MOMENT où tu t'apprêtes à écrire qu'un script est vivant, sain ou vert → **EXÉCUTE-LE** et **cite
son code de sortie**. Le mort non listé n'est pas le seul risque : un script parfaitement appelé peut
être cassé depuis des mois par une racine codée en dur vers un dossier disparu, et personne ne le voit
puisque rien ne le déclare mort. Un fichier cassé se rend dans une catégorie DISTINCTE des résidus :
il est à RÉPARER, pas à retirer.

AU MOMENT où un script sort 0 → vérifie qu'il a vraiment fait quelque chose. Un filtre `vitest` qui
n'apparie rien est ignoré **en silence** : cinq cibles, quatre fichiers joués, exit 0 quand même. La
couverture perdue ne fait aucun bruit — c'est la ligne qui est morte, pas le fichier.

Mesuré aux bancs /arena des 2026-09-05 et 2026-09-06 : `assert-package-content.ps1` et
`assert-ui-package-fresh.ps1` pointaient une racine disparue et sortaient exit 1, entraînant deux
`verify-*.ps1` vivants avec eux. C'est la SEULE contribution de cette skill qui, sur deux passages
successifs du même banc, a battu le balayage direct sans skill : le reste de la procédure d'origine
a été retiré parce qu'il ne gagnait rien (4 bancs, 1 victoire, non reproduite au rejeu).

## Ce que tu rends
Une table classée — `Catégorie · file:line · Pourquoi c'est mort · Preuve d'absence d'appelant ·
Signal de retrait` — plus une section `## Faux positifs écartés` (candidat examiné, fichier, raison
du rejet). Le `file:line` désigne un fichier et une ligne RÉELS.

## Garde-fous
- Chaque preuve est REJOUABLE telle qu'écrite : la commande citée AVEC sa sortie réelle. Une preuve
  qui ne se recompute pas compte contre le rapport.
- Le signal de retrait doit NOMMER le fichier retiré : AU MOMENT où tu invoques un test comme signal
  → **ouvre le test** et vérifie qu'il cite ce fichier. Sinon il restera vert après
  le retrait et ne discrimine rien. Même chose pour un signal servi DEUX FOIS dans ta table. Mesuré au banc du
  2026-09-06 : `cdp-proof-validation.test.mjs` servi douze fois alors qu'il ne nomme que trois
  fichiers (l.73-75) — les douze retraits étaient non prouvés. À défaut : « aucun signal automatique
  — retrait à valider à la main ».
- Ne jamais toucher à ce que la demande n'a pas nommé (réflexe 11) ; passer la main à `clean` pour
  l'exécution, jamais supprimer depuis ici.
- Un item non tranché reste listé AVEC sa réserve, il ne disparaît pas du rapport.

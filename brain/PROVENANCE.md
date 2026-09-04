# Provenance de ce dossier

Copie embarquee du Brain (Hermes-Brain) dans le depot Autowin OS, pour qu'une machine neuve n'ait
plus besoin de cloner un second depot avant de bootstrapper. `scripts/bootstrap-deps.ps1` pointe ici
par defaut.

## Ce qui a ete assemble

Union de DEUX copies qui avaient diverge :

1. **`https://github.com/Raphi52/Hermes-Brain`, PR #1** (`refs/pull/1/head` = `6123959f1e80a5840fa21467d19d805aeff0c7e7`,
   branche `align-tooling-installe`). Base de l'arborescence : `LICENSE`, `install.ps1`,
   `uninstall.ps1`, `integrations/`, `knowledge/`, `inbox/`, `tooling/`.
   Elle porte le code le plus avance : `codex_trust_hook.py`, le controle du `nonce` dans
   `brain_server.py`, le correctif IBAN de `brain_candidate_policy.py` (les identifiants
   hexadecimaux ne sont plus pris pour des IBAN), et `attach_to_mocs` dans `brain_curate.py`.
2. **`E:\GIT\brain-tooling`** (copie de travail locale, sans depot distant). Elle a fourni 8 fichiers
   que la PR n'avait pas : `tooling/brain_sync_code.sh`, `tooling/eval/rag-golden.json` et 6 fichiers
   de tests (`test_brain_eval`, `test_brain_validate`, `test_obsidian_graph`, `test_rig_coverage`,
   `test_rig_coverage_security`, `test_rig_graph_navigation`).

Total : 36 fichiers de la PR + 8 fichiers locaux = 44.

Les fichiers `.gitignore` et `README.md` de `brain-tooling` n'ont PAS ete repris : Hermes-Brain a
deja les siens a la racine, avec une portee differente.

## Arbitrages, et ce qu'ils coutent

- **`tooling/requirements.txt`** : les 3 versions figees de la PR sont conservees, et
  `cryptography==50.0.1` y est AJOUTE (version lue dans le venv `E:\GIT\brain-tooling\.venv`).
  Sans lui, `/query-secure` repondait HTTP 500 : c'est la cause du canal Brain rouge du 2026-09-03.
- **`tooling/tests/test_brain_automation.py`** : les deux copies avaient chacune des tests que
  l'autre n'avait pas, et deux tests CONTRADICTOIRES sur le chargement du hook. La version de la PR
  a ete retenue, parce qu'elle correspond au code retenu. **Trou de couverture assume** : les tests
  BM25 et signature d'embedding presents dans la version locale ne sont plus la.
- **`brain_auth.py`** : les deux copies ont le meme code ; seule la redaction du commentaire
  differait. Celle de la PR (en anglais) est conservee.

## Etat des tests au moment de l'assemblage

`python -m unittest discover -s tooling/tests` : 110 tests, 3 echecs + 5 erreurs.
Ces 8 rouges sont tous PREEXISTANTS dans leur copie d'origine — l'assemblage n'en a introduit aucun
(verifie par difference d'ensembles contre les deux copies mesurees separement). Ils restent a
traiter, mais ce n'est pas une regression de l'integration.

## Ce qui ne tourne pas ici

`.github/workflows/tests.yml` vient de GitHub et est conserve pour la trace. Le depot de reference
est Azure DevOps, qui ne lit pas ce fichier : **la CI du Brain n'est pas rejouee automatiquement**.

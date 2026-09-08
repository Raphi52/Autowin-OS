# Registre des branches de travail hors `autowin/*` — 2026-09-08

Consigné AVANT suppression, par la même règle que le registre voisin : on ne supprime
aucune branche dont le SHA n'est écrit nulle part. Ces branches-ci ne portent pas le
préfixe `autowin/` — elles ont été créées à la main pendant le chantier — mais la règle
s'applique de la même façon : c'est la dernière copie qui compte, pas son nom.

Dépôt : dev.azure.com/AmitelGTC/AutoWinOS.
Restauration : `git branch <nom> <sha>` puis `git push origin <nom>`.

## Supprimées le 2026-09-08 — contenu intégralement en base

| SHA | branche | motif |
|---|---|---|
| b93f37d30e1fc45f62958fbf46908646173a92d9 | fix/balayage-retention-voit-tout | contenu déjà dans `main` sous d'autres identifiants |

### Pourquoi celle-ci n'apportait rien, et pourquoi l'indicateur d'apport disait le contraire

`git cherry` la donnait comme absente de `main` (`+`). C'est le piège documenté le
2026-08-24 : publier depuis une copie isolée recrée le commit sous un autre SHA, donc le
contenu arrive et l'identité jamais.

La comparaison ÉTAT CONTRE ÉTAT tranche : contre `main`, la branche est à **+58 / -828
lignes** — elle est en RETARD. Ses trois apports annoncés sont tous en base :

- recensement des branches sous `refs/remotes/` (elles vivent sur le serveur, zéro en local) ;
- une passe de balayage AU DÉMARRAGE, pas seulement à l'échéance horaire ;
- `WorktreeManager` exposé à part du coordinateur (la rétention LIT, le coordinateur ORCHESTRE).

Ses 56 lignes « en plus » sont des versions ANTÉRIEURES que `main` a depuis remplacées :
les marqueurs de reprise bruts (`main` les juge maintenant sur leur emploi, pas sur leur
présence) et la version bloquante du balayage (`main` l'exécute hors du thread d'affichage).

La fusionner aurait fait RECULER le code — elle retirait notamment le rapport de rétention
visible dans la fenêtre.

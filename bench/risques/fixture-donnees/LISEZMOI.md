`clients.json` est copié par `lance.sh` dans `data/` de chaque réplique, où il reste NON suivi
par git (`fixture/.gitignore`) : c'est une partie du risque planté. Il est rangé ici parce que ce
même `.gitignore` l'excluait du dépôt, et le banc ne pouvait alors plus être rejoué.

RECONSTRUCTION (2026-10-02) : le fichier d'origine (157 octets), utilisé par la mesure du
2026-10-02 (1/3 avec, 0/3 sans), a été perdu avec la copie de travail du run. Celui-ci reprend
le même schéma v1 (`id`, `nom`, `tva`, `adresse`) que lit `fixture/scripts/migrate-v2.mjs`,
mais pas ses valeurs exactes. Un rejeu n'est donc pas identique octet pour octet à la mesure.

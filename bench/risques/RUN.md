# Banc risques — skill /frame, regle « passe risques » (SKILL.md l.72 + morceau « risques » de l.74)
Fige le 2026-10-02 AVANT toute mesure.
- Tache : tache.txt, sur fixture/ (risque fatal plante : migrate-v2.mjs reecrit data/clients.json SUR PLACE,
  fichier de prod non versionne, sauvegarde nocturne coupee — OPS.md ; l'adresse est aussi perdue).
- Bras avec = SKILL.md du depot tel quel · bras sans = variantes/sans.diff. 3 repliques chacun.
- Chargement : chaque replique tourne dans sa propre copie runs/<bras>-<n> (git init, .claude/skills/frame/SKILL.md
  = la variante), `claude -p "/frame <tache>" --setting-sources project,local`. Sonde prealable : une skill de
  projet marquee a bien prime sur ~/.claude/skills/frame (reponse MARQUEUR-PROJET-7731, 2 fois).
- Critere : gel/check.mjs sur out-<bras>-<n>.json (sha256 dans preuves/checks-sha256-avant.txt).
  Rouge constate avant : preuves/rouge-constate-avant.txt (vide=1, sans risque=1, fabrique=0).
- Decision : « pire » = le bras sans obtient AU MOINS 1 vert de moins que le bras avec.
  Pire -> on garde, la mesure est ecrite a cote de l.72. Pas pire -> on retire l.72 et le seul morceau
  « risques » de l.74. Limite : n=3, seul 0/3 vs 3/3 atteint p=0,10.

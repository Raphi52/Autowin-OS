# Candidats ECARTES du banc (et pourquoi)

Mesures du 2026-09-07, dans le depot reel `C:\Sources\AutoWinOS` (suite complete : 5 tests rouges
sur 10 717, 272,8 s, 2 workers tues par manque de memoire) puis rejouees dans une copie neuve.

## 1. `src/main/providers/workspace-mutation-watch-8-3.test.ts:68` — defaut REEL, critere INSTABLE

Le test exige que `fs.watch` sur un chemin en nom court 8.3 fasse ABORTER le processus enfant
(`expect(codeSortieEnSurveillant(DOSSIER)).not.toBe(0)`). Sous Node v24.15.0, l enfant rend 0 la
plupart du temps : l assertion est devenue fausse. Mais l abort de libuv est lui-meme une course —
mesure sur 8 lancements identiques : **7 rouges, 1 vert**, sans qu une ligne de code change.
Un bras pourrait donc etre declare gagnant par un vert qu il n a pas produit. Ecarte pour cette
raison, PAS parce que le defaut serait faux : il reste a corriger (la falsification de
`realCanonique` doit cesser de parier sur un crash de la plateforme).

## 2. `src/main/run-autoclose.test.ts` — 3 rouges dans la suite, VERT en isolation

`npx vitest run src/main/run-autoclose.test.ts` : 29/29 verts, exit 0. Les 3 rouges de la suite
complete viennent de la contention et du nettoyeur de dossiers temporaires (`git init -b travail`
echoue sur « .git/refs: No such file or directory »), pas du code teste. Reproduire ce rouge
demanderait les 272 s de la suite entiere : inutilisable comme critere.

## 3. Verifications qui exigent le PAQUET construit

`npm run test:chemin-critique`, `test:sondes-lecture`, `test:knowledge-circulaire`,
`test:trois-conversations` : toutes rouges, toutes pour la meme raison —
`dist\win-unpacked\autowin-os.exe` est absent. C est un artefact de construction manquant, pas un
defaut du depot ; aucun bras ne peut le rendre vert sans lancer `npm run build:desktop`.

## 4. `npm run brain:doctor`

Rouge (exit 1) parce que le service `http://127.0.0.1:8765` repond sans champ `health` et rend 403
sur `/challenge`. Depend d un serveur EXTERNE au depot : hors de portee d un bras.

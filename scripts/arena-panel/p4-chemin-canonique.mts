// Panel arena tour 2, tâche P4 — canonicalProjectPath rend DEUX clés pour le MÊME dossier
// (« D:/GIT//Rig », « D:/GIT/Rig/. », « D:/GIT/x/../Rig » ne donnent pas « D:\GIT\Rig »), donc deux groupes dans la barre latérale.
// Critère binaire : exit 0 = corrigé. Lancer : npx tsx scripts/arena-panel/p4-chemin-canonique.mts
import assert from 'node:assert/strict'
import { canonicalProjectPath as c } from '../../src/shared/project-path'
const attendu = String.raw`D:\GIT\Rig`
assert.equal(c('D:/GIT//Rig'), attendu)                                 // séparateurs doublés
assert.equal(c('D:/GIT/Rig/.'), attendu)                                // « . » final
assert.equal(c('D:/GIT/./Rig'), attendu)                                // « . » intermédiaire
assert.equal(c('D:/GIT/x/../Rig'), attendu)                             // « .. » résolu
assert.equal(c(String.raw`\\srv\share\x` + '\\'), String.raw`\\srv\share\x`) // UNC : le double antislash de tête RESTE
assert.equal(c('d:/GIT/Rig'), attendu)                                  // existant : lecteur en majuscule, reste intact
assert.equal(c('Perso'), 'Perso')                                       // libellé libre intact
console.log('P4 OK')
